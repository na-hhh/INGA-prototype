// Filière GPU de la fumée 3D. Tout ce qui se voit (la densité) vit sur le GPU
// dans des « atlas de tranches » : un volume nx×ny×nz rangé en tuiles dans une
// texture 2D, ce qui permet de le mettre à jour en UNE passe plein écran
// (WebGL2 ne sait dessiner que dans une tranche de texture 3D à la fois).
//
// Trois modes, mêmes briques :
//  - 'hybrid'    : vitesse grossière 32³ du solveur FFT (dans un Worker),
//                  densité fine advectée sur GPU (MacCormack).
//  - 'full'      : vitesse elle aussi sur GPU (projection de Jacobi).
//  - 'particles' : un million de particules déplacées par le GPU.
// Et les astuces, toutes débrayables pour mesurer leur effet :
//  - turbulence sous-maille (bruit de curl ajouté à la vitesse d'advection) ;
//  - boîte de simulation qui suit la fumée (mêmes cellules, plus petites) ;
//  - simulation à 20 Hz, image interpolée à 60 (la densité glisse le long de
//    la vitesse entre deux pas) ;
//  - volume de lumière basse résolution (auto-ombrage) ;
//  - lancer de rayons en demi-résolution, décalé à chaque image et accumulé.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const COMMON = `
  precision highp float;
  precision highp sampler3D;
  varying vec2 vUv;
  uniform vec3 uG;        // grille de la cible (cellules)
  uniform vec2 uT;        // tuiles de la cible (colonnes, lignes)
  uniform vec3 uBoxMin;   // boîte monde couverte par la grille
  uniform vec3 uBoxSize;
  // Grille « en perspective » : en x et z, la taille des cellules croît
  // linéairement avec la distance au foyer (le joueur) — x = f + s·sinh(t).
  // La résolution à l'écran reste à peu près constante : fine sous le nez,
  // grossière au loin, pour le même nombre de cellules. uWarp = s (0 = grille
  // régulière) ; uWA = (asinh du bord min, étendue) pour x puis z.
  uniform vec3 uFocus; uniform float uWarp; uniform vec4 uWA;
  // Correspondance du pas précédent (la boîte ou le foyer ont pu bouger).
  uniform vec3 uOBoxMin; uniform vec3 uOBoxSize; uniform vec3 uOFocus; uniform float uOWarp; uniform vec4 uOWA;
  float asinhf(float x) { return log(x + sqrt(x * x + 1.0)); }
  float sinhf(float x) { float e = exp(x); return 0.5 * (e - 1.0 / e); }
  vec3 mapW(vec3 u, vec3 mn, vec3 sz, vec3 f, float s, vec4 wa) {
    vec3 p = mn + u * sz;
    if (s > 0.0) { p.x = f.x + s * sinhf(wa.x + u.x * wa.y); p.z = f.z + s * sinhf(wa.z + u.z * wa.w); }
    return p;
  }
  vec3 mapU(vec3 p, vec3 mn, vec3 sz, vec3 f, float s, vec4 wa) {
    vec3 u = (p - mn) / sz;
    if (s > 0.0) { u.x = (asinhf((p.x - f.x) / s) - wa.x) / wa.y; u.z = (asinhf((p.z - f.z) / s) - wa.z) / wa.w; }
    return u;
  }
  vec3 toWorld(vec3 u) { return mapW(u, uBoxMin, uBoxSize, uFocus, uWarp, uWA); }
  vec3 toUVW(vec3 p) { return mapU(p, uBoxMin, uBoxSize, uFocus, uWarp, uWA); }
  vec3 toUVWOld(vec3 p) { return mapU(p, uOBoxMin, uOBoxSize, uOFocus, uOWarp, uOWA); }
  // Lecture trilinéaire d'un atlas : 2 lectures bilinéaires + mélange en z.
  vec4 atlasS(sampler2D t, vec3 uvw, vec3 G, vec2 T) {
    vec3 g = uvw * G;
    float zf = clamp(g.z - 0.5, 0.0, G.z - 1.0);
    float z0 = floor(zf), z1 = min(z0 + 1.0, G.z - 1.0);
    vec2 xy = clamp(g.xy, vec2(0.5), G.xy - 0.5);
    vec2 inv = 1.0 / (G.xy * T);
    vec2 t0 = vec2(mod(z0, T.x), floor(z0 / T.x)) * G.xy;
    vec2 t1 = vec2(mod(z1, T.x), floor(z1 / T.x)) * G.xy;
    return mix(texture2D(t, (t0 + xy) * inv), texture2D(t, (t1 + xy) * inv), zf - z0);
  }
  bool inside(vec3 u) { return all(greaterThanEqual(u, vec3(0.0))) && all(lessThanEqual(u, vec3(1.0))); }
  // Cellule du fragment courant dans la cible.
  ivec3 fragCell() {
    ivec2 fc = ivec2(gl_FragCoord.xy), g = ivec2(uG.xy);
    return ivec3(fc.x % g.x, fc.y % g.y, fc.x / g.x + (fc.y / g.y) * int(uT.x));
  }
  vec3 fragUVW() { return (vec3(fragCell()) + 0.5) / uG; }
  vec4 fetchG(sampler2D t, ivec3 c, vec3 G, vec2 T) {
    ivec3 g = ivec3(G);
    c = clamp(c, ivec3(0), g - 1);
    return texelFetch(t, ivec2(c.x + (c.z % int(T.x)) * g.x, c.y + (c.z / int(T.x)) * g.y), 0);
  }
  vec4 fetchC(sampler2D t, ivec3 c) { return fetchG(t, c, uG, uT); }
  // Obstacles construits : boîtes alignées sur les axes (min, max).
  uniform vec3 uSMin[24]; uniform vec3 uSMax[24]; uniform int uSN;
  float boxSolid(vec3 p) {
    for (int i = 0; i < 24; i++) {
      if (i >= uSN) break;
      if (all(greaterThan(p, uSMin[i])) && all(lessThan(p, uSMax[i]))) return 1.0;
    }
    return 0.0;
  }
  // Le segment a → b traverse-t-il une boîte ? (lumière arrêtée par un mur)
  float segBlocked(vec3 a, vec3 b) {
    vec3 d = b - a;
    vec3 di = 1.0 / (d + vec3(equal(d, vec3(0.0))) * 1e-6);
    for (int i = 0; i < 24; i++) {
      if (i >= uSN) break;
      vec3 t0 = (uSMin[i] - a) * di, t1 = (uSMax[i] - a) * di;
      vec3 mn = min(t0, t1), mx = max(t0, t1);
      float tn = max(max(mn.x, mn.y), mn.z), tf = min(min(mx.x, mx.y), mx.z);
      if (tf > max(tn, 0.0) && tn < 1.0) return 1.0;
    }
    return 0.0;
  }
`;
// Vitesse en un point monde : texture 3D du solveur CPU, ou atlas GPU.
const VEL = `
  #ifdef VEL_ATLAS
  uniform sampler2D uVel; uniform vec3 uVG; uniform vec2 uVT;
  vec3 velAt(vec3 p) { vec3 u = toUVW(p); return inside(u) ? atlasS(uVel, u, uVG, uVT).xyz : vec3(0.0); }
  #else
  uniform sampler3D uVel3; uniform vec3 uVelMin; uniform vec3 uVelInv;
  vec3 velAt(vec3 p) { return texture(uVel3, clamp((p - uVelMin) * uVelInv, 0.0, 1.0)).xyz; }
  #endif
  // Turbulence sous-maille : deux octaves d'un champ à divergence nulle
  // (curl d'un potentiel de bruit), d'autant plus fort que le fluide bouge.
  uniform sampler3D uCurl; uniform float uTurb; uniform float uTime;
  vec3 turbAt(vec3 p, vec3 v) {
    if (uTurb <= 0.0) return vec3(0.0);
    vec3 c = (texture(uCurl, p * 0.11 + vec3(0.0, uTime * 0.02, 0.0)).xyz - 0.5) * 2.0
           + (texture(uCurl, p * 0.29 - vec3(uTime * 0.03, 0.0, uTime * 0.017)).xyz - 0.5) * 1.2;
    return c * uTurb * (0.3 + 0.55 * length(v));
  }
  // Le joueur : un cylindre vertical en mouvement. L'écoulement autour de lui
  // est connu exactement (écoulement potentiel d'un cylindre : un dipôle), il
  // est donc ajouté analytiquement, à la finesse de la grille de densité —
  // la fumée s'écarte devant et se referme derrière, sans maille ni coût.
  uniform vec3 uBodyPos; uniform vec3 uBodyVel; uniform float uBodyR; uniform float uBodyH; uniform float uBodyK;
  vec3 bodyAt(vec3 p) {
    if (uBodyK <= 0.0) return vec3(0.0);
    float hy = clamp((p.y - uBodyPos.y + 0.35) / 0.35, 0.0, 1.0) * clamp((uBodyPos.y + uBodyH + 0.35 - p.y) / 0.35, 0.0, 1.0);
    if (hy <= 0.0) return vec3(0.0);
    vec2 r = p.xz - uBodyPos.xz, Uv = uBodyVel.xz;
    float r2 = dot(r, r), a2 = uBodyR * uBodyR;
    vec2 u = r2 <= a2 ? Uv : a2 / r2 * (2.0 * dot(Uv, r) * r / r2 - Uv);
    return vec3(u.x, 0.0, u.y) * hy * uBodyK;
  }
  // Balles lancées : même idée en 3D (dipôle d'une sphère en mouvement,
  // u = a³/2r³ · (3(U·r̂)r̂ − U)). La sphère est balayée sur le trajet du
  // pas de simulation, sinon une balle rapide ne percerait que des trous.
  uniform vec4 uBallA[8]; uniform vec3 uBallV[8]; uniform vec3 uBallS[8]; uniform int uBallN;
  // v : vitesse d'advection déjà connue en p (solveur + turbulence). À
  // l'intérieur d'une boule, l'air va exactement à sa vitesse : on REMPLACE v
  // (l'ajouter doublait la vitesse, et la fumée sortait par l'avant en s'étirant
  // en filet). Autour, on ajoute l'écoulement de contournement.
  vec3 ballsAt(vec3 p, vec3 v) {
    vec3 u = vec3(0.0);
    float inW = 0.0; vec3 inV = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      if (i >= uBallN) break;
      vec3 Uv = uBallV[i];
      // uBallS : chemin réellement parcouru depuis le pas précédent (une balle
      // de fusil fait plusieurs mètres) ; uBallV : vitesse de l'air entraîné.
      float a = uBallA[i].w;
      vec3 Sw = uBallS[i];
      vec3 p0 = uBallA[i].xyz - Sw;
      vec3 r = p - (p0 + Sw * clamp(dot(p - p0, Sw) / max(dot(Sw, Sw), 1e-4), 0.0, 1.0));
      float r2 = dot(r, r);
      if (r2 > 36.0 * a * a) continue;
      if (r2 <= a * a) { float w = 1.0 - smoothstep(0.75, 1.0, sqrt(r2) / a); if (w > inW) { inW = w; inV = Uv; } u += Uv * (1.0 - w); }
      else { float ir = inversesqrt(r2); vec3 rh = r * ir; u += a * a * a * ir * ir * ir * 0.5 * (3.0 * dot(Uv, rh) * rh - Uv); }
    }
    return mix(v + u * uBodyK, inV * max(uBodyK, 1.0), inW * step(0.001, uBodyK));
  }
  // Aspirateurs : écoulement de puits (vitesse dirigée vers la bouche). Ce
  // champ n'est pas à divergence nulle — c'est justement un puits — donc il
  // vit ici, dans l'advection, et non dans le solveur qui le projetterait.
  // uVacK : 1 = aspirateur (avale la fumée), 0 = simple attracteur qui la retient en boule.
  uniform vec4 uVacA[12]; uniform float uVacQ[12]; uniform float uVacR[12]; uniform float uVacK[12]; uniform int uVacN;
  vec3 vacAt(vec3 p) {
    vec3 u = vec3(0.0);
    for (int i = 0; i < 12; i++) {
      if (i >= uVacN) break;
      vec3 r = p - uVacA[i].xyz;
      float a = uVacA[i].w, d = length(r);
      // Rien au-delà de la portée, rien derrière un mur construit.
      if (d >= uVacR[i] || segBlocked(p, uVacA[i].xyz) > 0.5) continue;
      // Décroissance en 1/r, ramenée à zéro en douceur à la portée.
      u -= r / max(d, 1e-4) * uVacQ[i] * (d > a ? a / d * (1.0 - smoothstep(0.55, 1.0, d / uVacR[i])) : d / a);
    }
    return u;
  }
  // Fraction de fumée gardée : elle disparaît en entrant dans une bouche.
  float vacKeep(vec3 p) {
    float k = 1.0;
    for (int i = 0; i < 12; i++) {
      if (i >= uVacN) break;
      if (uVacK[i] < 0.5) continue;
      k *= smoothstep(0.55, 1.0, length(p - uVacA[i].xyz) / uVacA[i].w);
    }
    return k;
  }
`;
const F_ADVECT = `
  uniform sampler2D uQ; uniform float uDt; uniform float uKeep; uniform float uOldSrc;
  void main() {
    vec3 p = toWorld(fragUVW());
    if (solidW(p) > 0.5) { gl_FragColor = vec4(0.0); return; }
    vec3 v = velAt(p); v += turbAt(p, v) + bodyAt(p) + vacAt(p); v = ballsAt(p, v);
    // L'aller lit le champ dans la correspondance du pas précédent : le
    // changement de boîte ou de foyer est absorbé par l'advection, sans
    // passe de rééchantillonnage (donc sans flou) supplémentaire.
    vec3 b = uOldSrc > 0.5 ? toUVWOld(p - v * uDt) : toUVW(p - v * uDt);
    gl_FragColor = inside(b) ? atlasS(uQ, b, uG, uT) * uKeep : vec4(0.0);
  }`;
// MacCormack (Selle et al. 2008) : aller q̂, retour q̃, correction bornée aux
// 8 voisins du point de départ.
const F_MAC = `
  uniform sampler2D uQ; uniform sampler2D uHat; uniform sampler2D uTilde; uniform float uDt; uniform float uKeep;
  void main() {
    ivec3 c = fragCell();
    vec3 p = toWorld((vec3(c) + 0.5) / uG);
    if (solidW(p) > 0.5) { gl_FragColor = vec4(0.0); return; }
    vec3 v = velAt(p); v += turbAt(p, v) + bodyAt(p) + vacAt(p); v = ballsAt(p, v);
    vec3 bu = toUVWOld(p - v * uDt);
    vec4 hat = fetchC(uHat, c);
    if (!inside(bu)) { gl_FragColor = hat * uKeep; return; }
    ivec3 b0 = ivec3(floor(bu * uG - 0.5));
    vec4 mn = vec4(1e9), mx = vec4(-1e9);
    for (int k = 0; k < 8; k++) {
      vec4 q = fetchC(uQ, b0 + ivec3(k & 1, (k >> 1) & 1, k >> 2));
      mn = min(mn, q); mx = max(mx, q);
    }
    vec4 r = clamp(hat + 0.5 * (atlasS(uQ, toUVWOld(p), uG, uT) - fetchC(uTilde, c)), mn, mx) * uKeep * vacKeep(p);
    if (abs(r.x) + abs(r.y) + abs(r.z) < 0.0015) r = vec4(0.0);
    gl_FragColor = r;
  }`;
const F_SPLAT = `
  uniform sampler2D uQ; uniform vec3 uAt; uniform float uRadius; uniform vec4 uAmount; uniform float uSpin;
  void main() {
    ivec3 c = fragCell();
    vec3 p = toWorld((vec3(c) + 0.5) / uG);
    vec4 q = fetchC(uQ, c);
    vec3 d = (p - uAt) / uRadius;
    float d2 = dot(d, d);
    if (d2 < 1.0 && solidW(p) < 0.5) {
      float f = (1.0 - d2) * (1.0 - d2);
      q += (uAmount + vec4(-d.z, 0.0, d.x, 0.0) * uSpin) * f;
    }
    gl_FragColor = q;
  }`;
// Changement de boîte : rééchantillonne l'ancien volume dans la nouvelle.
const F_REBOX = `
  uniform sampler2D uQ;
  void main() {
    vec3 b = toUVWOld(toWorld(fragUVW()));
    gl_FragColor = inside(b) ? atlasS(uQ, b, uG, uT) : vec4(0.0);
  }`;
// Sources continues : jusqu'à 24 bouches qui déposent de la densité.
const F_EMIT = `
  uniform sampler2D uQ; uniform vec4 uSrcA[24]; uniform float uSrcB[24]; uniform vec3 uSrcC[24]; uniform float uSrcD[24]; uniform int uCount;
  void main() {
    ivec3 c = fragCell();
    vec3 p = toWorld((vec3(c) + 0.5) / uG);
    vec4 q = fetchC(uQ, c);
    if (solidW(p) < 0.5) {
      for (int i = 0; i < 24; i++) {
        if (i >= uCount) break;
        vec3 d = (p - uSrcA[i].xyz) / uSrcA[i].w;
        float d2 = dot(d, d);
        if (d2 < 1.0) {
          // r = densité ; g, b, a = densité × couleur (prémultipliée) : la
          // teinte voyage et se mélange avec la fumée, sans passe de plus.
          // uSrcD : densité maximale que cette source peut atteindre (une
          // fumée noire épaisse monte bien plus haut qu'une brume).
          float add = min(uSrcB[i] * (1.0 - d2) * (1.0 - d2), max(0.0, uSrcD[i] - q.r));
          q += vec4(add, add * uSrcC[i]);
        }
      }
    }
    gl_FragColor = q;
  }`;
// Densité grossière sur le domaine fixe, relue par le CPU (poids, boîte).
const F_REDUCE = `
  uniform sampler2D uSrc; uniform vec3 uSG; uniform vec2 uST; uniform vec3 uDomMin; uniform vec3 uDomSize;
  void main() {
    vec3 b = toUVW(uDomMin + fragUVW() * uDomSize);
    float d = inside(b) ? atlasS(uSrc, b, uSG, uST).r : 0.0;
    gl_FragColor = vec4(clamp(d / 1.4, 0.0, 1.0), 0.0, 0.0, 1.0);
  }`;
// Volume de lumière : transmittance vers le soleil, quelques pas suffisent.
const F_LIGHT = `
  #include <packing>
  uniform sampler2D uSrc; uniform vec3 uSG; uniform vec2 uST; uniform vec3 uSun; uniform float uLStep; uniform float uLK;
  uniform sampler2D tShadow; uniform mat4 uShadowMatrix; uniform float uHasShadow;
  void main() {
    vec3 p = toWorld(fragUVW());
    float s = 0.0;
    for (int i = 0; i < 10; i++) {
      vec3 q = toUVW(p + uSun * uLStep * (float(i) + 0.6));
      if (inside(q)) s += atlasS(uSrc, q, uSG, uST).r;
    }
    float self = exp(-s * uLStep * uLK);
    // Le soleil réel de la scène (carte d'ombres) : les rais des fentes du
    // plafond sont précalculés ici, une fois par pas, à basse résolution.
    float sunV = 1.0;
    if (uHasShadow > 0.5) {
      vec4 sc = uShadowMatrix * vec4(p, 1.0);
      if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0 || sc.z < 0.0) sunV = 0.7;
      else sunV = sc.z - 0.002 < unpackRGBAToDepth(texture2D(tShadow, sc.xy)) ? 1.0 : 0.0;
    }
    gl_FragColor = vec4(self * sunV, self, 0.0, 1.0);
  }`;
// Lumières ponctuelles colorées : pour chaque cellule du volume de lumière,
// la somme des lampes (atténuation en 1/d², portée, murs qui font écran, et
// un peu d'ombre propre de la fumée). C'est ce qui teinte la fumée.
const F_LIGHT2 = `
  uniform sampler2D uSrc; uniform vec3 uSG; uniform vec2 uST; uniform float uLK;
  uniform vec4 uPL[8]; uniform vec3 uPLC[8]; uniform int uPLN;
  void main() {
    vec3 p = toWorld(fragUVW());
    vec3 sum = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      if (i >= uPLN) break;
      vec3 L = uPL[i].xyz - p;
      float d = length(L), range = uPL[i].w;
      if (d > range) continue;
      float f = d / range;
      float att = (1.0 - f * f * f * f); att = att * att / (d * d + 0.35);
      if (segBlocked(p, uPL[i].xyz) > 0.5) continue;
      float s = 0.0, st = min(d, 3.0) / 4.0;
      for (int k = 0; k < 4; k++) {
        vec3 q = toUVW(p + L / max(d, 1e-4) * st * (float(k) + 0.5));
        if (inside(q)) s += atlasS(uSrc, q, uSG, uST).r;
      }
      sum += uPLC[i] * att * exp(-s * st * uLK);
    }
    gl_FragColor = vec4(sum, 1.0);
  }`;
// ---- Solveur de vitesse entièrement GPU (mode 'full') -------------------------
const F_CURL = `
  uniform sampler2D uQ;
  void main() {
    ivec3 c = fragCell();
    vec3 h = uBoxSize / uG;
    vec3 xa = fetchC(uQ, c + ivec3(1, 0, 0)).xyz, xb = fetchC(uQ, c - ivec3(1, 0, 0)).xyz;
    vec3 ya = fetchC(uQ, c + ivec3(0, 1, 0)).xyz, yb = fetchC(uQ, c - ivec3(0, 1, 0)).xyz;
    vec3 za = fetchC(uQ, c + ivec3(0, 0, 1)).xyz, zb = fetchC(uQ, c - ivec3(0, 0, 1)).xyz;
    gl_FragColor = vec4(
      (ya.z - yb.z) / (2.0 * h.y) - (za.y - zb.y) / (2.0 * h.z),
      (za.x - zb.x) / (2.0 * h.z) - (xa.z - xb.z) / (2.0 * h.x),
      (xa.y - xb.y) / (2.0 * h.x) - (ya.x - yb.x) / (2.0 * h.y), 1.0);
  }`;
const F_FORCE = `
  uniform sampler2D uQ; uniform sampler2D uCurlT; uniform sampler2D uSrc; uniform vec3 uSG; uniform vec2 uST;
  uniform float uDt; uniform float uWeight; uniform float uSwirl;
  void main() {
    ivec3 c = fragCell();
    vec3 u = (vec3(c) + 0.5) / uG;
    if (solidW(uBoxMin + u * uBoxSize) > 0.5) { gl_FragColor = vec4(0.0); return; }
    vec3 v = fetchC(uQ, c).xyz;
    v.y -= uWeight * atlasS(uSrc, u, uSG, uST).r * uDt;
    vec3 h = uBoxSize / uG;
    vec3 w = fetchC(uCurlT, c).xyz;
    vec3 g = vec3(
      length(fetchC(uCurlT, c + ivec3(1, 0, 0)).xyz) - length(fetchC(uCurlT, c - ivec3(1, 0, 0)).xyz),
      length(fetchC(uCurlT, c + ivec3(0, 1, 0)).xyz) - length(fetchC(uCurlT, c - ivec3(0, 1, 0)).xyz),
      length(fetchC(uCurlT, c + ivec3(0, 0, 1)).xyz) - length(fetchC(uCurlT, c - ivec3(0, 0, 1)).xyz)) / (2.0 * h);
    g /= length(g) + 1e-5;
    v += uSwirl * uDt * cross(g, w);
    gl_FragColor = vec4(v, 1.0);
  }`;
const NEIGH = `
  bool outG(ivec3 c) { return any(lessThan(c, ivec3(0))) || any(greaterThanEqual(c, ivec3(uG))); }
  float solidC(ivec3 c) { return solidW(uBoxMin + (vec3(c) + 0.5) / uG * uBoxSize); }
`;
const F_DIV = NEIGH + `
  uniform sampler2D uQ;
  vec3 vN(ivec3 c, vec3 vc) { if (outG(c)) return vc; if (solidC(c) > 0.5) return vec3(0.0); return fetchC(uQ, c).xyz; }
  void main() {
    ivec3 c = fragCell();
    vec3 h = uBoxSize / uG, vc = fetchC(uQ, c).xyz;
    float d = (vN(c + ivec3(1, 0, 0), vc).x - vN(c - ivec3(1, 0, 0), vc).x) / (2.0 * h.x)
            + (vN(c + ivec3(0, 1, 0), vc).y - vN(c - ivec3(0, 1, 0), vc).y) / (2.0 * h.y)
            + (vN(c + ivec3(0, 0, 1), vc).z - vN(c - ivec3(0, 0, 1), vc).z) / (2.0 * h.z);
    gl_FragColor = vec4(d, 0.0, 0.0, 1.0);
  }`;
// Pression : bord de boîte ouvert (p = 0), paroi solide = gradient nul.
const PRESS = NEIGH + `
  uniform sampler2D uP;
  float pN(ivec3 c, float pc) { if (outG(c)) return 0.0; if (solidC(c) > 0.5) return pc; return fetchC(uP, c).r; }
`;
const F_JACOBI = PRESS + `
  uniform sampler2D uDiv;
  void main() {
    ivec3 c = fragCell();
    vec3 a = uG * uG / (uBoxSize * uBoxSize);
    float pc = fetchC(uP, c).r;
    float s = a.x * (pN(c + ivec3(1, 0, 0), pc) + pN(c - ivec3(1, 0, 0), pc))
            + a.y * (pN(c + ivec3(0, 1, 0), pc) + pN(c - ivec3(0, 1, 0), pc))
            + a.z * (pN(c + ivec3(0, 0, 1), pc) + pN(c - ivec3(0, 0, 1), pc));
    gl_FragColor = vec4((s - fetchC(uDiv, c).r) / (2.0 * (a.x + a.y + a.z)), 0.0, 0.0, 1.0);
  }`;
const F_GRAD = PRESS + `
  uniform sampler2D uQ;
  void main() {
    ivec3 c = fragCell();
    if (solidC(c) > 0.5) { gl_FragColor = vec4(0.0); return; }
    vec3 h = uBoxSize / uG;
    float pc = fetchC(uP, c).r;
    vec3 g = vec3(pN(c + ivec3(1, 0, 0), pc) - pN(c - ivec3(1, 0, 0), pc),
                  pN(c + ivec3(0, 1, 0), pc) - pN(c - ivec3(0, 1, 0), pc),
                  pN(c + ivec3(0, 0, 1), pc) - pN(c - ivec3(0, 0, 1), pc)) / (2.0 * h);
    gl_FragColor = vec4(fetchC(uQ, c).xyz - g, 1.0);
  }`;
// ---- Particules ----------------------------------------------------------------
const F_PUPDATE = `
  uniform sampler2D uPos; uniform float uDt; uniform float uFade; uniform float uS;
  uniform vec2 uSpawn; uniform vec3 uAt; uniform float uRadius; uniform float uSeed;
  uniform vec3 uDomMin; uniform vec3 uDomSize;
  vec3 hash3(float n) {
    vec3 p = fract(vec3(n) * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }
  void main() {
    vec4 P = texelFetch(uPos, ivec2(gl_FragCoord.xy), 0);
    float idx = floor(gl_FragCoord.y) * uS + floor(gl_FragCoord.x);
    bool sp = uSpawn.x < uSpawn.y ? (idx >= uSpawn.x && idx < uSpawn.y) : (uSpawn.x > uSpawn.y && (idx >= uSpawn.x || idx < uSpawn.y));
    if (sp) {
      vec3 h = hash3(idx * 0.137 + uSeed);
      float z = h.x * 2.0 - 1.0, a = h.y * 6.2831853, s = sqrt(1.0 - z * z);
      P = vec4(uAt + vec3(s * cos(a), z, s * sin(a)) * uRadius * pow(h.z, 0.5), 1.0);
    } else if (P.a > 0.0) {
      vec3 v = velAt(P.xyz); v += turbAt(P.xyz, v);
      P.xyz += v * uDt;
      P.xyz = clamp(P.xyz, uDomMin + 0.5, uDomMin + uDomSize - 0.5);
      P.y = max(P.y, 0.04);
      P.a *= uFade;
      if (P.a < 0.03) P.a = 0.0;
    }
    gl_FragColor = P;
  }`;
// ---- Lancer de rayons, accumulation, composition ------------------------------
const F_MARCH = `
  uniform sampler2D tDepth; uniform float uHasDepth;
  uniform mat4 uProjInv; uniform mat4 uViewInv; uniform vec3 uCamPos;
  uniform sampler2D uDens; uniform vec3 uDG; uniform vec2 uDT;
  uniform sampler2D uLight; uniform vec3 uLG; uniform vec2 uLT;
  uniform vec3 uSun; uniform float uGain; uniform float uLum; uniform float uTau; uniform float uFrame;
  uniform float uShadow; uniform float uCell; uniform float uGrow;
  uniform vec3 uSunCol; uniform sampler2D uLight2; uniform float uHasPL; uniform int uSteps; uniform float uMono;
  float hash12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  void main() {
    float depth = uHasDepth > 0.5 ? texture2D(tDepth, vUv).x : 1.0;
    vec4 view = uProjInv * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    view /= view.w;
    vec3 rd = (uViewInv * vec4(view.xyz, 1.0)).xyz - uCamPos;
    float dist = length(rd);
    rd /= dist;
    vec3 rdi = 1.0 / (rd + vec3(equal(rd, vec3(0.0))) * 1e-6);
    vec3 ta = (uBoxMin - uCamPos) * rdi, tb = (uBoxMin + uBoxSize - uCamPos) * rdi;
    vec3 tmn = min(ta, tb), tmx = max(ta, tb);
    float tn = max(max(tmn.x, tmn.y), max(tmn.z, 0.0));
    float tf = min(min(tmx.x, tmx.y), min(tmx.z, dist));
    vec3 ins = vec3(0.0);
    float trans = 1.0;
    if (tf > tn) {
      // Décalage d'un pas entier, différent à chaque image : l'accumulation
      // temporelle le lisse au lieu de laisser des coquilles ou du grain.
      float j = hash12(gl_FragCoord.xy + uFrame * vec2(47.3, 91.7));
      float cosT = dot(rd, uSun);
      float hg = (1.0 - 0.2025) / (12.566 * pow(1.2025 - 0.9 * cosT, 1.5));
      float phase = mix(0.0796, hg, 0.55);
      vec3 sunCol = uSunCol;
      // Le pas suit la taille locale des cellules : fin près de la caméra,
      // il grandit avec la distance.
      float t = tn;
      for (int i = 0; i < 330; i++) {
        if (i >= uSteps) break;
        float ss = max(uCell + t * uGrow, (tf - tn) / float(uSteps));
        float t1 = min(t + ss, tf), seg = t1 - t;
        if (seg <= 0.0) break;
        vec3 p = uCamPos + rd * (t + seg * j);
        // Interpolation entre deux pas de simulation : la densité est lue
        // là d'où la vitesse l'aurait amenée depuis le dernier pas.
        vec3 q = uTau > 0.0 ? p - velAt(p) * uTau : p;
        vec3 u = toUVW(q);
        vec4 dq = inside(u) ? atlasS(uDens, u, uDG, uDT) : vec4(0.0);
        float d = dq.r;
        vec3 tint = uMono > 0.5 ? vec3(1.0) : clamp(dq.gba / max(d, 1e-4), 0.0, 1.2);
        // Le voile très ténu que laisse la diffusion numérique est atténué :
        // les volutes gardent un bord lisible au lieu de noyer la pièce.
        d = d * d / (d + 0.02);
        if (d > 0.002) {
          vec2 lit = uShadow > 0.5 ? atlasS(uLight, toUVW(p), uLG, uLT).rg : vec2(1.0);
          float a = exp(-d * 0.26 * uGain * seg);
          vec3 S = vec3(uLum) * (0.3 + 0.7 * lit.g) + sunCol * phase * 3.6 * lit.r;
          if (uHasPL > 0.5) S += atlasS(uLight2, toUVW(p), uLG, uLT).rgb;
          ins += trans * (1.0 - a) * S * tint;
          trans *= a;
          if (trans < 0.01) break;
        }
        t = t1;
      }
    }
    gl_FragColor = vec4(ins, trans);
  }`;
const F_TEMPORAL = `precision highp float; varying vec2 vUv; uniform sampler2D tCur; uniform sampler2D tHist; uniform float uW;
  void main() { gl_FragColor = mix(texture2D(tCur, vUv), texture2D(tHist, vUv), uW); }`;
// Composition. En demi-résolution, l'agrandissement tient compte de la
// profondeur : chaque pixel prend la fumée des texels basse résolution qui
// sont à la même profondeur que lui, sinon elle bave sur les bords des objets.
const F_COMPOSITE = `precision highp float; varying vec2 vUv; uniform sampler2D tScene; uniform sampler2D tSmoke;
  uniform sampler2D tDepth; uniform float uAware; uniform vec2 uLow; uniform float uNear; uniform float uFar;
  float lin(float d) { return uNear * uFar / (uFar - d * (uFar - uNear)); }
  void main() {
    vec4 c = texture2D(tScene, vUv);
    vec4 s;
    if (uAware > 0.5) {
      float z0 = lin(texture2D(tDepth, vUv).x);
      vec2 g = vUv * uLow - 0.5, b = floor(g), f = g - b;
      vec4 acc = vec4(0.0); float wsum = 0.0;
      for (int k = 0; k < 4; k++) {
        vec2 o = vec2(float(k & 1), float(k >> 1));
        vec2 uv = (b + o + 0.5) / uLow;
        float w = (o.x > 0.5 ? f.x : 1.0 - f.x) * (o.y > 0.5 ? f.y : 1.0 - f.y);
        w /= 0.02 + abs(lin(texture2D(tDepth, uv).x) - z0) / z0;
        acc += texture2D(tSmoke, uv) * w; wsum += w;
      }
      s = acc / max(wsum, 1e-6);
    } else s = texture2D(tSmoke, vUv);
    gl_FragColor = vec4(c.rgb * s.a + s.rgb, c.a);
  }`;

// Rangement des nz tranches en tuiles : atlas le plus carré possible, sans
// dépasser la taille maximale de texture du GPU. null si rien ne tient.
let MAX_TEX = 16384;
// Le navigateur refuse toute texture de plus d'environ 1 Go (limite de
// Chrome/ANGLE, indépendante de la puissance du GPU).
const TEX_CAP = 2 ** 30;
const cellsOf = (n) => n * Math.round(n * 0.75) * n;
const tilesFor = (nx, ny, nz) => {
  let cols = Math.max(1, Math.min(Math.floor(MAX_TEX / nx), Math.ceil(Math.sqrt(nz * ny / nx))));
  while (cols <= Math.floor(MAX_TEX / nx) && Math.ceil(nz / cols) * ny > MAX_TEX) cols++;
  if (cols * nx > MAX_TEX || Math.ceil(nz / cols) * ny > MAX_TEX) return null;
  return new THREE.Vector2(cols, Math.ceil(nz / cols));
};
class Atlas {
  constructor(nx, ny, nz, type, filter = THREE.LinearFilter, format = THREE.RGBAFormat) {
    this.G = new THREE.Vector3(nx, ny, nz);
    this.T = tilesFor(nx, ny, nz);
    this.rt = new THREE.WebGLRenderTarget(nx * this.T.x, ny * this.T.y, {
      type, format, minFilter: filter, magFilter: filter,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false, stencilBuffer: false,
    });
  }
  get texture() { return this.rt.texture; }
  dispose() { this.rt.dispose(); }
}

export function createSmoke3D(renderer, { domain, solidGLSL, sunDir, velConfig, depthTexture = null, uniforms = {}, spawnCenter = null, shadow = null, defaults = {} }) {
  MAX_TEX = renderer.capabilities.maxTextureSize;
  const DOM_MIN = new THREE.Vector3().fromArray(domain.min), DOM_SIZE = new THREE.Vector3().fromArray(domain.size);
  const params = {
    mode: 'hybrid', res: 128, vres: 64, simHz: 20, turb: 1, follow: true, interp: true, halfRes: true, shadows: true,
    gain: 1.8, lum: 0.3, weight: 5.5, swirl: 2.5, dissip: 0.07, visc: 0.08, jacobi: 24, particles: 1024,
    focus: false, focusScale: 3, velN: 32, lightFull: false, march: 1, ...defaults,
  };
  const stats = { workerMs: 0, hz: 0, cell: 0, alive: false };
  const box = { min: DOM_MIN.clone(), size: DOM_SIZE.clone() };
  const focus = new THREE.Vector3();
  const shared = {
    uBoxMin: { value: box.min }, uBoxSize: { value: box.size }, uTime: { value: 0 },
    uFocus: { value: focus }, uWarp: { value: 0 }, uWA: { value: new THREE.Vector4(0, 1, 0, 1) },
    uOBoxMin: { value: box.min.clone() }, uOBoxSize: { value: box.size.clone() },
    uOFocus: { value: new THREE.Vector3() }, uOWarp: { value: 0 }, uOWA: { value: new THREE.Vector4(0, 1, 0, 1) },
    uSMin: { value: Array.from({ length: 24 }, () => new THREE.Vector3()) }, uSMax: { value: Array.from({ length: 24 }, () => new THREE.Vector3()) }, uSN: { value: 0 },
    ...uniforms,
  };
  const sunCol = new THREE.Vector3(1.0, 0.92, 0.78).multiplyScalar(2.6);
  let lights = [];
  const camPos = new THREE.Vector3();
  let sources = [];
  // Correspondance grille ↔ monde courante (boîte + foyer), et celle du pas
  // précédent, que les passes d'advection lisent.
  function updateMap(force) {
    const want = params.focus && params.mode === 'hybrid' ? params.focusScale : 0;
    const hi = box.min.clone().add(box.size);
    const target = camPos.clone().clamp(box.min, hi);
    if (force || want !== shared.uWarp.value || target.distanceTo(focus) > 1.2 || focus.x < box.min.x || focus.x > hi.x || focus.z < box.min.z || focus.z > hi.z) focus.copy(target);
    shared.uWarp.value = want;
    if (want > 0) {
      const ax = Math.asinh((box.min.x - focus.x) / want), az = Math.asinh((box.min.z - focus.z) / want);
      shared.uWA.value.set(ax, Math.asinh((hi.x - focus.x) / want) - ax, az, Math.asinh((hi.z - focus.z) / want) - az);
    }
  }
  function commitMap() {
    shared.uOBoxMin.value.copy(box.min); shared.uOBoxSize.value.copy(box.size);
    shared.uOFocus.value.copy(focus); shared.uOWarp.value = shared.uWarp.value; shared.uOWA.value.copy(shared.uWA.value);
  }
  // Taille des cellules au foyer (les plus fines), en mètres.
  const nearCell = () => (shared.uWarp.value > 0 ? shared.uWarp.value * Math.min(shared.uWA.value.y, shared.uWA.value.w) : Math.min(box.size.x, box.size.z)) / params.res;
  const quad = new FullScreenQuad(null);
  let time = 0, acc = 0, active = false, busy = false, frame = 0, lastStepAt = 0, sinceSpawn = 0, stepCount = 0;

  // ---- Bruit de curl 32³ répétable (potentiel vecteur lissé, puis rotationnel)
  const curlTex = (() => {
    const N = 32, P = 8;
    const lat = [0, 1, 2].map(() => { const a = new Float32Array(P * P * P); for (let i = 0; i < a.length; i++) a[i] = Math.random(); return a; });
    const smp = (a, x, y, z) => {
      const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
      let fx = x - x0, fy = y - y0, fz = z - z0;
      fx = fx * fx * fx * (fx * (fx * 6 - 15) + 10); fy = fy * fy * fy * (fy * (fy * 6 - 15) + 10); fz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
      const w = (v) => ((v % P) + P) % P;
      const xa = w(x0), xb = w(x0 + 1), ya = w(y0) * P, yb = w(y0 + 1) * P, za = w(z0) * P * P, zb = w(z0 + 1) * P * P;
      const l = (p, q, f) => p + (q - p) * f;
      return l(l(l(a[xa + ya + za], a[xb + ya + za], fx), l(a[xa + yb + za], a[xb + yb + za], fx), fy),
        l(l(a[xa + ya + zb], a[xb + ya + zb], fx), l(a[xa + yb + zb], a[xb + yb + zb], fx), fy), fz);
    };
    const s = P / N, e = 0.5;
    const psi = (c, x, y, z) => smp(lat[c], x * s, y * s, z * s);
    const data = new Uint8Array(N * N * N * 4);
    const raw = new Float32Array(N * N * N * 3);
    let mx = 1e-6, o = 0;
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++, o += 3) {
      const cx = (psi(2, x, y + e, z) - psi(2, x, y - e, z)) - (psi(1, x, y, z + e) - psi(1, x, y, z - e));
      const cy = (psi(0, x, y, z + e) - psi(0, x, y, z - e)) - (psi(2, x + e, y, z) - psi(2, x - e, y, z));
      const cz = (psi(1, x + e, y, z) - psi(1, x - e, y, z)) - (psi(0, x, y + e, z) - psi(0, x, y - e, z));
      raw[o] = cx; raw[o + 1] = cy; raw[o + 2] = cz;
      mx = Math.max(mx, Math.abs(cx), Math.abs(cy), Math.abs(cz));
    }
    for (let i = 0, k = 0; i < raw.length; i += 3, k += 4) {
      data[k] = 127.5 + 127.5 * raw[i] / mx; data[k + 1] = 127.5 + 127.5 * raw[i + 1] / mx; data[k + 2] = 127.5 + 127.5 * raw[i + 2] / mx; data[k + 3] = 255;
    }
    const t = new THREE.Data3DTexture(data, N, N, N);
    t.format = THREE.RGBAFormat;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
    t.needsUpdate = true;
    return t;
  })();

  // ---- Vitesse CPU (Worker) → texture 3D demi-flottante
  let VN = params.velN;
  const makeVelTex = () => {
    const t = new THREE.Data3DTexture(new Uint16Array(VN * VN * VN * 4), VN, VN, VN);
    t.format = THREE.RGBAFormat; t.type = THREE.HalfFloatType;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  };
  let velTex = makeVelTex();
  let worker = null;
  let rhoBuf = new Float32Array(VN * VN * VN);
  function ensureWorker() {
    if (worker) return;
    worker = new Worker(new URL('./smokeVelWorker.js', import.meta.url), { type: 'module' });
    worker.postMessage({ type: 'config', n: VN, ...velConfig(), sim: { visc: params.visc, weight: params.weight, swirl: params.swirl } });
    worker.onmessage = (e) => {
      if (e.data.type !== 'vel') return;
      if (e.data.buf.length !== velTex.image.data.length) return;
      velTex.image.data = e.data.buf;
      velTex.needsUpdate = true;
      rhoBuf = e.data.rho;
      stats.workerMs += (e.data.ms - stats.workerMs) * 0.2;
      busy = false;
    };
  }
  const velUniforms = { uVel3: { value: velTex }, uVelMin: { value: DOM_MIN }, uVelInv: { value: new THREE.Vector3(1 / DOM_SIZE.x, 1 / DOM_SIZE.y, 1 / DOM_SIZE.z) }, uVel: { value: null }, uVG: { value: new THREE.Vector3(1, 1, 1) }, uVT: { value: new THREE.Vector2(1, 1) }, uCurl: { value: curlTex }, uTurb: { value: 0 }, uBodyPos: { value: new THREE.Vector3() }, uBodyVel: { value: new THREE.Vector3() }, uBodyR: { value: 0.4 }, uBodyH: { value: 1.8 }, uBodyK: { value: 0 },
    uBallA: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) }, uBallV: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) }, uBallS: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) }, uBallN: { value: 0 },
    uVacA: { value: Array.from({ length: 12 }, () => new THREE.Vector4(0, 0, 0, 1)) }, uVacQ: { value: new Array(12).fill(0) }, uVacR: { value: new Array(12).fill(4) }, uVacK: { value: new Array(12).fill(1) }, uVacN: { value: 0 } };
  let body = null, balls = [], ballLast = new Map(), keep = [];

  // ---- Matériaux (deux variantes selon la source de vitesse)
  const mats = new Map();
  const U = (names) => { const u = { ...shared, uG: { value: new THREE.Vector3() }, uT: { value: new THREE.Vector2() } }; for (const n of names) u[n] = { value: null }; return u; };
  function mat(key, body, names, { vel = false, atlasVel = false } = {}) {
    const k = key + (atlasVel ? ':a' : '');
    let m = mats.get(k);
    if (!m) {
      m = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: COMMON + solidGLSL + (vel ? VEL : '') + body,
        uniforms: { ...U(names), ...(vel ? velUniforms : {}) },
        defines: atlasVel ? { VEL_ATLAS: 1 } : {},
        depthTest: false, depthWrite: false,
      });
      mats.set(k, m);
    }
    return m;
  }
  // Exécute une passe sur un atlas cible.
  function run(m, target, values) {
    const u = m.uniforms;
    u.uG.value.copy(target.G); u.uT.value.copy(target.T);
    for (const k in values) {
      const v = values[k];
      if (u[k].value && u[k].value.copy && v && v.copy && !v.isTexture) u[k].value.copy(v); else u[k].value = v;
    }
    quad.material = m;
    renderer.setRenderTarget(target.rt);
    quad.render(renderer);
  }
  const clearRT = (rt) => {
    const col = renderer.getClearColor(new THREE.Color()), al = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(rt);
    renderer.clear(true, false, false);
    renderer.setClearColor(col, al);
  };

  // ---- Atlas
  let A = null; // { d:[4], light, reduce, v:[4], p:[2], div, curl, dep, pos:[2] }
  const HF = THREE.HalfFloatType;
  function allocate() {
    dispose();
    const n = params.res, ny = Math.round(n * 0.75);
    A = { d: [], v: [], p: [], pos: [] };
    A.reduce = new Atlas(VN, VN, VN, THREE.UnsignedByteType, THREE.NearestFilter);
    A.reduceBytes = new Uint8Array(A.reduce.rt.width * A.reduce.rt.height * 4);
    if (params.mode === 'particles') {
      A.dep = new Atlas(64, 48, 64, HF);
      A.light = new Atlas(64, 48, 64, THREE.UnsignedByteType);
      const S = params.particles;
      const mk = () => new THREE.WebGLRenderTarget(S, S, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false });
      A.pos = [mk(), mk()];
      buildPoints(S);
    } else {
      // Au-delà d'1 Go par volume en RGBA (densité + couleur), on passe à un
      // seul canal : quatre fois moins de mémoire, mais fumée sans teinte.
      A.mono = cellsOf(n) * 8 > TEX_CAP;
      for (let i = 0; i < 4; i++) A.d.push(new Atlas(n, ny, n, HF, THREE.LinearFilter, A.mono ? THREE.RedFormat : THREE.RGBAFormat));
      const ld = params.lightFull && cellsOf(n) * 8 <= TEX_CAP ? 0 : 1; // volume de lumière : demi ou pleine résolution
      A.light = new Atlas(n >> ld, ny >> ld, n >> ld, THREE.UnsignedByteType);
      A.light2 = new Atlas(n >> ld, ny >> ld, n >> ld, HF);
      if (params.mode === 'full') {
        const vn = params.vres, vy = Math.round(vn * 0.75);
        for (let i = 0; i < 4; i++) A.v.push(new Atlas(vn, vy, vn, HF));
        A.p = [new Atlas(vn, vy, vn, HF, THREE.NearestFilter), new Atlas(vn, vy, vn, HF, THREE.NearestFilter)];
        A.div = new Atlas(vn, vy, vn, HF, THREE.NearestFilter);
        A.curl = new Atlas(vn, vy, vn, HF, THREE.NearestFilter);
      }
    }
    clear();
  }
  function dispose() {
    if (!A) return;
    for (const a of [...A.d, ...A.v, ...A.p, A.light, A.light2, A.reduce, A.div, A.curl, A.dep]) a?.dispose();
    for (const r of A.pos) r.dispose();
    A = null;
  }
  const allRTs = () => [...A.d, ...A.v, ...A.p, A.light, A.light2, A.div, A.curl, A.dep].filter(Boolean).map((a) => a.rt).concat(A.pos);
  function clear() {
    if (!A) return;
    const prev = renderer.getRenderTarget();
    for (const rt of allRTs()) clearRT(rt);
    renderer.setRenderTarget(prev);
    worker?.postMessage({ type: 'clear' });
    velTex.image.data.fill(0); velTex.needsUpdate = true;
    box.min.copy(DOM_MIN); box.size.copy(DOM_SIZE);
    updateMap(true); commitMap();
    active = false; busy = false; acc = 0; spawnQueue.length = 0; cursor = 0;
    stats.alive = false;
    points.visible = false;
  }

  // ---- Particules : géométrie de références + matériaux de dépôt et de rendu
  const points = new THREE.Points(new THREE.BufferGeometry(), new THREE.ShaderMaterial({
    uniforms: {
      uPos: { value: null }, uSize: { value: 0.16 }, uScale: { value: 600 }, uOpacity: { value: 0.05 },
      uLight: { value: null }, uLG: { value: new THREE.Vector3() }, uLT: { value: new THREE.Vector2() },
      uDomMin: { value: DOM_MIN }, uDomSize: { value: DOM_SIZE }, uLum: { value: 0.3 }, uShadow: { value: 1 },
    },
    vertexShader: `
      precision highp float;
      uniform sampler2D uPos; uniform float uSize; uniform float uScale;
      uniform sampler2D uLight; uniform vec3 uLG; uniform vec2 uLT; uniform vec3 uDomMin; uniform vec3 uDomSize; uniform float uShadow;
      varying float vA; varying float vLit;
      vec4 atlasS(sampler2D t, vec3 uvw, vec3 G, vec2 T) {
        vec3 g = uvw * G;
        float zf = clamp(g.z - 0.5, 0.0, G.z - 1.0);
        float z0 = floor(zf), z1 = min(z0 + 1.0, G.z - 1.0);
        vec2 xy = clamp(g.xy, vec2(0.5), G.xy - 0.5);
        vec2 inv = 1.0 / (G.xy * T);
        vec2 t0 = vec2(mod(z0, T.x), floor(z0 / T.x)) * G.xy;
        vec2 t1 = vec2(mod(z1, T.x), floor(z1 / T.x)) * G.xy;
        return mix(texture2D(t, (t0 + xy) * inv), texture2D(t, (t1 + xy) * inv), zf - z0);
      }
      void main() {
        vec4 P = texture2D(uPos, position.xy);
        if (P.a <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; vLit = 0.0; return; }
        vec4 mv = viewMatrix * vec4(P.xyz, 1.0);
        gl_Position = projectionMatrix * mv;
        float s = uSize * uScale / -mv.z;
        vA = P.a * min(1.0, s * s / 2.25);
        gl_PointSize = max(s, 1.5);
        vLit = uShadow > 0.5 ? atlasS(uLight, (P.xyz - uDomMin) / uDomSize, uLG, uLT).r : 1.0;
      }`,
    fragmentShader: `
      precision highp float;
      uniform float uOpacity; uniform float uLum; varying float vA; varying float vLit;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float f = max(0.0, 1.0 - dot(c, c) * 4.0);
        vec3 col = vec3(uLum * 2.2) * (0.3 + 0.7 * vLit) + vec3(1.0, 0.93, 0.8) * 0.75 * vLit;
        gl_FragColor = vec4(col, f * f * vA * uOpacity);
      }`,
    transparent: true, depthWrite: false, fog: false,
  }));
  points.frustumCulled = false;
  points.visible = false;
  const depPoints = new THREE.Points(points.geometry, new THREE.ShaderMaterial({
    uniforms: { uPos: { value: null }, uG: { value: new THREE.Vector3() }, uT: { value: new THREE.Vector2() }, uDomMin: { value: DOM_MIN }, uDomSize: { value: DOM_SIZE }, uMass: { value: 1 } },
    vertexShader: `
      precision highp float;
      uniform sampler2D uPos; uniform vec3 uG; uniform vec2 uT; uniform vec3 uDomMin; uniform vec3 uDomSize; uniform float uMass;
      varying float vM;
      void main() {
        vec4 P = texture2D(uPos, position.xy);
        vec3 c = floor(clamp((P.xyz - uDomMin) / uDomSize, 0.0, 0.9999) * uG);
        vec2 px = c.xy + 0.5 + vec2(mod(c.z, uT.x), floor(c.z / uT.x)) * uG.xy;
        gl_Position = P.a > 0.0 ? vec4(px / (uG.xy * uT) * 2.0 - 1.0, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
        gl_PointSize = 1.0;
        vM = P.a * uMass;
      }`,
    fragmentShader: `precision highp float; varying float vM; void main() { gl_FragColor = vec4(vM, 0.0, 0.0, 1.0); }`,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    depthTest: false, depthWrite: false, transparent: true,
  }));
  depPoints.frustumCulled = false;
  const depScene = new THREE.Scene();
  depScene.add(depPoints);
  const depCam = new THREE.Camera();
  function buildPoints(S) {
    const ref = new Float32Array(S * S * 3);
    for (let y = 0, o = 0; y < S; y++) for (let x = 0; x < S; x++, o += 3) { ref[o] = (x + 0.5) / S; ref[o + 1] = (y + 0.5) / S; }
    points.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(ref, 3));
    points.geometry = g; depPoints.geometry = g;
  }
  const spawnQueue = [];
  let cursor = 0;
  const PUFF = 0.16; // fraction du tampon de particules par bouffée

  // ---- Boîte qui suit la fumée
  const _nb = { min: new THREE.Vector3(), size: new THREE.Vector3() };
  const MIN_BOX = new THREE.Vector3(10, 8, 10);
  function fitBox(lo, hi, margin, out) {
    for (const a of ['x', 'y', 'z']) {
      let mn = lo[a] - margin, mx = hi[a] + margin;
      const need = MIN_BOX[a] - (mx - mn);
      if (need > 0) { mn -= need / 2; mx += need / 2; }
      const dLo = DOM_MIN[a], dHi = DOM_MIN[a] + DOM_SIZE[a];
      if (mx - mn >= DOM_SIZE[a]) { mn = dLo; mx = dHi; } else { if (mn < dLo) { mx += dLo - mn; mn = dLo; } if (mx > dHi) { mn -= mx - dHi; mx = dHi; } }
      out.min[a] = mn; out.size[a] = mx - mn;
    }
    return out;
  }
  function rebox(nb) {
    if (params.mode === 'particles') return;
    commitMap();
    box.min.copy(nb.min); box.size.copy(nb.size);
    updateMap(true);
    const m = mat('rebox', F_REBOX, ['uQ']);
    run(m, A.d[1], { uQ: A.d[0].texture });
    [A.d[0], A.d[1]] = [A.d[1], A.d[0]];
    if (params.mode === 'full') {
      run(m, A.v[1], { uQ: A.v[0].texture });
      [A.v[0], A.v[1]] = [A.v[1], A.v[0]];
      clearRT(A.p[0].rt);
    }
    commitMap();
    relight();
  }
  const _lo = new THREE.Vector3(), _hi = new THREE.Vector3();
  function onReadback(bytes) {
    // Octets → densité par cellule de vitesse (unités du solveur CPU), et
    // boîte englobante de la fumée sur le domaine fixe.
    const cols = A.reduce.T.x, W = A.reduce.rt.width;
    let x0 = VN, x1 = -1, y0 = VN, y1 = -1, z0 = VN, z1 = -1, i = 0;
    for (let z = 0; z < VN; z++) {
      const ox = (z % cols) * VN, oy = Math.floor(z / cols) * VN;
      for (let y = 0; y < VN; y++) {
        let o = ((oy + y) * W + ox) * 4;
        for (let x = 0; x < VN; x++, o += 4, i++) {
          const b = bytes[o];
          rhoBuf[i] = b * 1.4;
          if (b > 2) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
        }
      }
    }
    stats.alive = x1 >= 0;
    if (!stats.alive && !sources.length) { if (sinceSpawn > 1.5) active = false; return; }
    if (!params.follow || params.mode === 'particles') return;
    const hx = DOM_SIZE.x / VN, hy = DOM_SIZE.y / VN, hz = DOM_SIZE.z / VN;
    if (stats.alive) {
      _lo.set(DOM_MIN.x + x0 * hx, DOM_MIN.y + y0 * hy, DOM_MIN.z + z0 * hz);
      _hi.set(DOM_MIN.x + (x1 + 1) * hx, DOM_MIN.y + (y1 + 1) * hy, DOM_MIN.z + (z1 + 1) * hz);
    } else { _lo.setScalar(1e9); _hi.setScalar(-1e9); }
    // La boîte doit aussi contenir les sources, et l'endroit où vont arriver
    // les nuages rapides (boule d'air, boule de feu) : sinon ils sortent de la
    // boîte avant qu'elle n'ait suivi, et la fumée est perdue.
    for (const o of sources.concat(keep)) {
      const r = (o.radius ?? 1) + 0.5;
      _lo.x = Math.min(_lo.x, o.x - r); _lo.y = Math.min(_lo.y, o.y - r); _lo.z = Math.min(_lo.z, o.z - r);
      _hi.x = Math.max(_hi.x, o.x + r); _hi.y = Math.max(_hi.y, o.y + r); _hi.z = Math.max(_hi.z, o.z + r);
    }
    // Hystérésis : on ne change de boîte que si la fumée approche du bord
    // (1,2 m) ou si la boîte est devenue nettement trop grande.
    const tight = 1.2;
    let escape = false;
    for (const a of ['x', 'y', 'z']) {
      const atLo = box.min[a] <= DOM_MIN[a] + 1e-3, atHi = box.min[a] + box.size[a] >= DOM_MIN[a] + DOM_SIZE[a] - 1e-3;
      if ((!atLo && _lo[a] < box.min[a] + tight) || (!atHi && _hi[a] > box.min[a] + box.size[a] - tight)) escape = true;
    }
    fitBox(_lo, _hi, 3.2, _nb);
    const vol = (s) => s.x * s.y * s.z;
    if (escape || vol(box.size) > 1.7 * vol(_nb.size)) pendingBox = { min: _nb.min.clone(), size: _nb.size.clone() };
  }
  let pendingBox = null, reading = false;
  function readback(src, srcBox, thenStep, dt) {
    const m = mat('reduce', F_REDUCE, ['uSrc', 'uSG', 'uST', 'uDomMin', 'uDomSize']);
    const u = m.uniforms;
    u.uSG.value = src.G; u.uST.value = src.T; u.uDomMin.value = DOM_MIN; u.uDomSize.value = DOM_SIZE;
    run(m, A.reduce, { uSrc: src.texture });
    if (reading) return;
    reading = true;
    const rt = A.reduce.rt, bytes = A.reduceBytes, gen = A;
    renderer.readRenderTargetPixelsAsync(rt, 0, 0, rt.width, rt.height, bytes).then(() => {
      reading = false;
      if (gen !== A) return;
      onReadback(bytes);
      if (thenStep && worker && active) {
        const rho = rhoBuf;
        rhoBuf = new Float32Array(0);
        worker.postMessage({ type: 'step', dt, rho, jets: sources.map((o) => ({ x: o.x, y: o.y, z: o.z, jx: o.jx, jy: o.jy, jz: o.jz, rv: Math.max(o.radius * 1.6, 1.15) })), bodies: (body ? [body] : []).concat(balls.map((b) => ({ ...b, h: 0, k: velUniforms.uBodyK.value * (b.gain ?? 0.6) }))) }, [rho.buffer]);
      } else if (thenStep) busy = false;
    }).catch(() => { reading = false; busy = false; });
  }
  const domBox = { min: DOM_MIN, size: DOM_SIZE };
  const _ident = new THREE.Matrix4();
  function relight() {
    if (!params.shadows) return;
    const src = params.mode === 'particles' ? A.dep : A.d[0];
    const m = mat('light', F_LIGHT, ['uSrc', 'uSG', 'uST', 'uSun', 'uLStep', 'uLK', 'tShadow', 'uShadowMatrix', 'uHasShadow']);
    const u = m.uniforms;
    const sh = shadow ? shadow() : null;
    u.tShadow.value = sh ? sh.map : null; u.uShadowMatrix.value = sh ? sh.matrix : _ident; u.uHasShadow.value = sh ? 1 : 0;
    u.uSG.value = src.G; u.uST.value = src.T; u.uSun.value = sunDir;
    u.uLStep.value = 0.75; u.uLK.value = 0.26 * params.gain * 2.2;
    run(m, A.light, { uSrc: src.texture });
    if (lights.length && A.light2) {
      const m2 = mat('light2', F_LIGHT2, ['uSrc', 'uSG', 'uST', 'uLK', 'uPL', 'uPLC', 'uPLN']);
      const u2 = m2.uniforms, n = Math.min(8, lights.length);
      u2.uSG.value = src.G; u2.uST.value = src.T; u2.uLK.value = 0.26 * params.gain * 1.2;
      u2.uPL.value = Array.from({ length: 8 }, (_, i) => { const l = lights[Math.min(i, n - 1)]; return new THREE.Vector4(l.x, l.y, l.z, l.range); });
      u2.uPLC.value = Array.from({ length: 8 }, (_, i) => { const l = lights[Math.min(i, n - 1)]; return new THREE.Vector3(l.r, l.g, l.b); });
      run(m2, A.light2, { uSrc: src.texture, uPLN: n });
    }
  }
  // Transport d'un champ (SL ou MacCormack) : q → out, tampons s1, s2.
  function transport(q, out, s1, s2, dt, keep, atlasVel, turb) {
    velUniforms.uTurb.value = turb;
    const a = mat('advect', F_ADVECT, ['uQ', 'uDt', 'uKeep', 'uOldSrc'], { vel: true, atlasVel });
    run(a, s1, { uQ: q.texture, uDt: dt, uKeep: 1, uOldSrc: 1 });
    run(a, s2, { uQ: s1.texture, uDt: -dt, uKeep: 1, uOldSrc: 0 });
    const m = mat('mac', F_MAC, ['uQ', 'uHat', 'uTilde', 'uDt', 'uKeep'], { vel: true, atlasVel });
    run(m, out, { uQ: q.texture, uHat: s1.texture, uTilde: s2.texture, uDt: dt, uKeep: keep });
  }
  function simStep(dt) {
    const prev = renderer.getRenderTarget();
    const full = params.mode === 'full';
    shared.uTime.value = time;
    velUniforms.uBallN.value = Math.min(8, balls.length);
    const seen = new Map();
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      // Chemin parcouru depuis le pas de simulation précédent (suivi par
      // identifiant) ; à défaut, vitesse × durée du pas.
      const last = b.id !== undefined ? ballLast.get(b.id) : null;
      b.sx = last ? b.x - last[0] : b.vx * dt; b.sy = last ? b.y - last[1] : b.vy * dt; b.sz = last ? b.z - last[2] : b.vz * dt;
      if (b.id !== undefined) seen.set(b.id, [b.x, b.y, b.z]);
      if (i >= 8) continue;
      velUniforms.uBallA.value[i].set(b.x, b.y, b.z, b.r);
      velUniforms.uBallV.value[i].set(b.vx, b.vy, b.vz);
      velUniforms.uBallS.value[i].set(b.sx, b.sy, b.sz);
    }
    ballLast = seen;
    if (pendingBox) {
      // Solveur complet : rééchantillonnage explicite (vitesse et pression
      // partagent la boîte). Densité fine : absorbé par l'advection.
      if (full) rebox(pendingBox); else { box.min.copy(pendingBox.min); box.size.copy(pendingBox.size); }
      pendingBox = null;
    }
    if (!full) updateMap(false);
    if (params.mode === 'particles') {
      // Dépôt des particules sur une grille grossière → lumière, poids.
      const u = depPoints.material.uniforms;
      u.uPos.value = A.pos[0].texture; u.uG.value.copy(A.dep.G); u.uT.value.copy(A.dep.T);
      const S = params.particles, cellVol = (DOM_SIZE.x / 64) * (DOM_SIZE.y / 48) * (DOM_SIZE.z / 64);
      u.uMass.value = 0.9 / (S * S * PUFF / (4.19 * 5.2 ** 3 * 0.45) * cellVol);
      const col = renderer.getClearColor(new THREE.Color()), al = renderer.getClearAlpha();
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(A.dep.rt);
      renderer.clear(true, false, false);
      const ac = renderer.autoClear; renderer.autoClear = false;
      renderer.render(depScene, depCam);
      renderer.autoClear = ac;
      renderer.setClearColor(col, al);
      relight();
      busy = true;
      readback(A.dep, domBox, true, dt);
    } else {
      if (full) {
        const [v0, v1, v2, v3] = A.v;
        velUniforms.uVel.value = v0.texture; velUniforms.uVG.value.copy(v0.G); velUniforms.uVT.value.copy(v0.T);
        run(mat('curl', F_CURL, ['uQ']), A.curl, { uQ: v0.texture });
        const f = mat('force', F_FORCE, ['uQ', 'uCurlT', 'uSrc', 'uSG', 'uST', 'uDt', 'uWeight', 'uSwirl']);
        f.uniforms.uSG.value = A.d[0].G; f.uniforms.uST.value = A.d[0].T;
        run(f, v1, { uQ: v0.texture, uCurlT: A.curl.texture, uSrc: A.d[0].texture, uDt: dt, uWeight: params.weight, uSwirl: params.swirl });
        velUniforms.uVel.value = v1.texture;
        transport(v1, v0, v2, v3, dt, 1, true, 0);
        run(mat('div', F_DIV, ['uQ']), A.div, { uQ: v0.texture });
        const j = mat('jacobi', F_JACOBI, ['uP', 'uDiv']);
        for (let i = 0; i < params.jacobi; i++) { run(j, A.p[1], { uP: A.p[0].texture, uDiv: A.div.texture }); A.p.reverse(); }
        run(mat('grad', F_GRAD, ['uP', 'uQ']), v1, { uP: A.p[0].texture, uQ: v0.texture });
        A.v = [v1, v0, v2, v3];
        velUniforms.uVel.value = v1.texture;
      }
      const [d0, d1, d2, d3] = A.d;
      transport(d0, d1, d2, d3, dt, Math.max(0, 1 - params.dissip * dt), full, params.turb);
      A.d = [d1, d0, d2, d3];
      commitMap();
      if (sources.length) {
        // Émission des sources dans la grille toute fraîche.
        const e = mat('emit', F_EMIT, ['uQ', 'uSrcA', 'uSrcB', 'uSrcC', 'uSrcD', 'uCount']);
        const cell = nearCell();
        const n = Math.min(24, sources.length);
        const sa = [], sb = [], sc = [], sd = [];
        for (let i = 0; i < 24; i++) {
          const o = sources[Math.min(i, n - 1)];
          sa.push(new THREE.Vector4(o.x, o.y, o.z, Math.max(o.radius, cell * 2)));
          sb.push(i < n ? o.rate * dt : 0);
          sc.push(new THREE.Vector3(o.r ?? 1, o.g ?? 1, o.b ?? 1));
          sd.push(o.cap ?? 1.33);
        }
        e.uniforms.uSrcA.value = sa; e.uniforms.uSrcB.value = sb; e.uniforms.uSrcC.value = sc; e.uniforms.uSrcD.value = sd;
        run(e, A.d[1], { uQ: A.d[0].texture, uCount: n });
        [A.d[0], A.d[1]] = [A.d[1], A.d[0]];
      }
      relight();
      if (full) { if (stepCount % 3 === 0) readback(A.d[0], box, false, dt); } else { busy = true; readback(A.d[0], box, true, dt); }
    }
    stepCount++;
    renderer.setRenderTarget(prev);
    const now = performance.now();
    if (lastStepAt) stats.hz += (1000 / Math.max(1, now - lastStepAt) - stats.hz) * 0.15;
    lastStepAt = now;
    stats.cell = params.mode === 'particles' ? box.size.x / 64 : nearCell();
  }
  function particleFrame(dt) {
    const sp = spawnQueue.shift();
    const prev = renderer.getRenderTarget();
    const S = params.particles, total = S * S;
    velUniforms.uTurb.value = params.turb;
    const m = mat('pupdate', F_PUPDATE, ['uPos', 'uDt', 'uFade', 'uS', 'uSpawn', 'uAt', 'uRadius', 'uSeed', 'uDomMin', 'uDomSize'], { vel: true });
    const u = m.uniforms;
    u.uPos.value = A.pos[0].texture; u.uDt.value = dt; u.uFade.value = Math.max(0, 1 - params.dissip * dt); u.uS.value = S;
    u.uDomMin.value = DOM_MIN; u.uDomSize.value = DOM_SIZE; u.uSeed.value = Math.random() * 50;
    if (sp) {
      const count = Math.floor(total * PUFF), end = (cursor + count) % total;
      u.uSpawn.value = new THREE.Vector2(cursor, end);
      u.uAt.value = sp.at; u.uRadius.value = sp.r;
      cursor = end;
    } else u.uSpawn.value = new THREE.Vector2(0, 0);
    quad.material = m;
    renderer.setRenderTarget(A.pos[1]);
    quad.render(renderer);
    A.pos.reverse();
    renderer.setRenderTarget(prev);
    const pu = points.material.uniforms;
    pu.uPos.value = A.pos[0].texture; pu.uLight.value = A.light.texture; pu.uLG.value.copy(A.light.G); pu.uLT.value.copy(A.light.T);
    pu.uLum.value = params.lum; pu.uShadow.value = params.shadows ? 1 : 0;
    pu.uOpacity.value = 0.05 * params.gain / 1.8 * (1024 / S);
    pu.uSize.value = 0.16 * Math.sqrt(1024 / S);
  }
  function step(frameDt, camera) {
    if (!A) allocate();
    time += frameDt; sinceSpawn += frameDt;
    shared.uTime.value = time;
    camPos.copy(camera.position);
    if (sources.length && !active && params.mode === 'hybrid') {
      // Première source : la boîte part autour des bouches.
      if (params.follow) {
        const lo = new THREE.Vector3(1e9, 1e9, 1e9), hi = new THREE.Vector3(-1e9, -1e9, -1e9);
        for (const o of sources) { lo.min(new THREE.Vector3(o.x, o.y, o.z).subScalar(o.radius)); hi.max(new THREE.Vector3(o.x, o.y, o.z).addScalar(o.radius)); }
        fitBox(lo, hi, 3.2, _nb);
        box.min.copy(_nb.min); box.size.copy(_nb.size);
      }
      updateMap(true); commitMap();
      ensureWorker();
      active = true; sinceSpawn = 0;
    }
    if (params.mode === 'particles') {
      points.visible = active;
      points.material.uniforms.uScale.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
      if (active) particleFrame(Math.min(frameDt, 1 / 30));
    }
    if (!active) return;
    acc += frameDt;
    if (acc >= 1 / params.simHz && !busy) {
      const dt = Math.min(acc, 0.1);
      acc = 0;
      simStep(dt);
    }
  }
  function spawn() {
    if (!A) allocate();
    const prev = renderer.getRenderTarget();
    const cx = spawnCenter ? spawnCenter[0] : DOM_MIN.x + DOM_SIZE.x / 2, cz = spawnCenter ? spawnCenter[1] : DOM_MIN.z + DOM_SIZE.z / 2;
    const at = new THREE.Vector3(cx + (Math.random() - 0.5) * 14, 12 + Math.random() * 5, cz + (Math.random() - 0.5) * 14);
    const r = 5.2, rv = 7, push = 3.5 + Math.random() * 3, spin = (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 6);
    if (params.mode !== 'full') { ensureWorker(); worker.postMessage({ type: 'impulse', px: at.x, py: at.y, pz: at.z, rv, push, spin }); }
    if (params.mode === 'particles') {
      spawnQueue.push({ at, r });
    } else {
      if (params.follow) {
        const lo = at.clone().subScalar(r), hi = at.clone().addScalar(r);
        if (active) { lo.min(box.min); hi.max(box.min.clone().add(box.size)); }
        fitBox(lo, hi, 3.2, _nb);
        if (active) rebox(_nb); else { box.min.copy(_nb.min); box.size.copy(_nb.size); updateMap(true); commitMap(); }
      } else if (!active) { box.min.copy(DOM_MIN); box.size.copy(DOM_SIZE); updateMap(true); commitMap(); }
      const s = mat('splat', F_SPLAT, ['uQ', 'uAt', 'uRadius', 'uAmount', 'uSpin']);
      s.uniforms.uAt.value = at;
      s.uniforms.uAmount.value = new THREE.Vector4(1.02, 1.02, 1.02, 1.02); // bouffée blanche
      run(s, A.d[1], { uQ: A.d[0].texture, uRadius: r, uSpin: 0 });
      [A.d[0], A.d[1]] = [A.d[1], A.d[0]];
      if (params.mode === 'full') {
        s.uniforms.uAmount.value = new THREE.Vector4(0, -push, 0, 0);
        run(s, A.v[1], { uQ: A.v[0].texture, uRadius: rv, uSpin: spin });
        [A.v[0], A.v[1]] = [A.v[1], A.v[0]];
      }
      relight();
    }
    renderer.setRenderTarget(prev);
    active = true; sinceSpawn = 0; stats.alive = true;
  }

  // ---- Passe de rendu : lancer de rayons (demi-résolution), accumulation
  // temporelle, composition sur l'image.
  class SmokePass extends Pass {
    constructor() {
      super();
      this.w = 2; this.h = 2; this.rts = null; this.scale = 0;
      this.march = new Map();
      this.temporal = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: F_TEMPORAL, uniforms: { tCur: { value: null }, tHist: { value: null }, uW: { value: 0 } }, depthTest: false, depthWrite: false });
      this.composite = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: F_COMPOSITE, uniforms: { tScene: { value: null }, tSmoke: { value: null }, tDepth: { value: null }, uAware: { value: 0 }, uLow: { value: new THREE.Vector2() }, uNear: { value: 0.1 }, uFar: { value: 100 } }, depthTest: false, depthWrite: false });
      this.fsq = new FullScreenQuad(this.composite);
      this.prevCam = new THREE.Matrix4();
      this.camera = null;
    }
    setSize(w, h) { this.w = w; this.h = h; this.scale = 0; }
    targets() {
      const sc = params.halfRes ? 0.5 : 1;
      if (this.rts && this.scale === sc) return;
      if (this.rts) for (const r of this.rts) r.dispose();
      const mk = () => new THREE.WebGLRenderTarget(Math.max(2, Math.round(this.w * sc)), Math.max(2, Math.round(this.h * sc)), { type: HF, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false });
      this.rts = [mk(), mk(), mk()];
      this.scale = sc;
      this.fresh = true;
    }
    render(rndr, writeBuffer, readBuffer) {
      this.targets();
      const cam = this.camera, full = params.mode === 'full';
      const key = full ? 'a' : 'c';
      let m = this.march.get(key);
      if (!m) {
        m = new THREE.ShaderMaterial({
          vertexShader: VERT, fragmentShader: COMMON + VEL + F_MARCH,
          uniforms: { ...U(['tDepth', 'uHasDepth', 'uProjInv', 'uViewInv', 'uCamPos', 'uDens', 'uDG', 'uDT', 'uLight', 'uLG', 'uLT', 'uSun', 'uGain', 'uLum', 'uTau', 'uFrame', 'uShadow', 'uCell', 'uGrow', 'uSunCol', 'uLight2', 'uHasPL', 'uSteps', 'uMono']), ...velUniforms },
          defines: full ? { VEL_ATLAS: 1 } : {}, depthTest: false, depthWrite: false,
        });
        m.uniforms.uProjInv.value = new THREE.Matrix4(); m.uniforms.uViewInv.value = new THREE.Matrix4(); m.uniforms.uCamPos.value = new THREE.Vector3();
        this.march.set(key, m);
      }
      const u = m.uniforms, d = A.d[0];
      const depth = typeof depthTexture === 'function' ? depthTexture() : depthTexture;
      u.tDepth.value = depth; u.uHasDepth.value = depth ? 1 : 0;
      u.uProjInv.value.copy(cam.projectionMatrixInverse); u.uViewInv.value.copy(cam.matrixWorld); u.uCamPos.value.copy(cam.position);
      u.uDens.value = d.texture; u.uDG.value = d.G; u.uDT.value = d.T;
      u.uLight.value = A.light.texture; u.uLG.value = A.light.G; u.uLT.value = A.light.T;
      u.uSun.value = sunDir; u.uGain.value = params.gain; u.uLum.value = params.lum;
      u.uSunCol.value = sunCol; u.uLight2.value = A.light2 ? A.light2.texture : null; u.uHasPL.value = lights.length && A.light2 ? 1 : 0;
      u.uTau.value = params.interp ? Math.min(acc, 0.12) : 0;
      u.uFrame.value = frame++ % 64; u.uShadow.value = params.shadows ? 1 : 0;
      const nc = Math.min(nearCell(), box.size.y / (params.res * 0.75));
      // Finesse du lancer de rayons : pas plus courts, et plus nombreux.
      const mq = Math.max(1, params.march);
      u.uCell.value = nc * 1.1 / mq;
      u.uGrow.value = (shared.uWarp.value > 0 ? nc / shared.uWarp.value : 0.01) / mq;
      u.uSteps.value = Math.round(110 * mq);
      u.uMono.value = A.mono ? 1 : 0;
      const [cur, hist, accT] = this.rts;
      this.fsq.material = m;
      rndr.setRenderTarget(cur);
      this.fsq.render(rndr);
      // Accumulation : forte caméra immobile, légère quand elle bouge.
      const moved = !this.prevCam.equals(cam.matrixWorld);
      this.prevCam.copy(cam.matrixWorld);
      this.temporal.uniforms.tCur.value = cur.texture; this.temporal.uniforms.tHist.value = hist.texture;
      this.temporal.uniforms.uW.value = this.fresh ? 0 : moved ? 0.25 : 0.78;
      this.fresh = false;
      this.fsq.material = this.temporal;
      rndr.setRenderTarget(accT);
      this.fsq.render(rndr);
      this.rts = [cur, accT, hist];
      const cu = this.composite.uniforms;
      cu.tScene.value = readBuffer.texture; cu.tSmoke.value = accT.texture;
      cu.tDepth.value = depth; cu.uAware.value = depth && params.halfRes ? 1 : 0;
      cu.uLow.value.set(accT.width, accT.height); cu.uNear.value = cam.near; cu.uFar.value = cam.far;
      this.fsq.material = this.composite;
      rndr.setRenderTarget(this.renderToScreen ? null : writeBuffer);
      this.fsq.render(rndr);
    }
  }
  const pass = new SmokePass();
  pass.enabled = false;

  return {
    params, stats, pass, points, step, spawn, clear,
    get active() { return active; },
    get volume() { return active && params.mode !== 'particles'; },
    setSources(list) { sources = list; },
    // Déplace le domaine fixe (fenêtre de simulation qui suit le joueur dans
    // un grand niveau). La densité est conservée là où l'ancienne et la
    // nouvelle fenêtre se recouvrent ; la vitesse repart de zéro.
    setDomainMin(v) {
      DOM_MIN.copy(v);
      velTex.image.data.fill(0); velTex.needsUpdate = true;
      if (worker) worker.postMessage({ type: 'config', n: VN, ...velConfig(), sim: { visc: params.visc, weight: params.weight, swirl: params.swirl } });
      busy = false;
      const lo = box.min.clone().max(DOM_MIN), hi = box.min.clone().add(box.size).min(DOM_MIN.clone().add(DOM_SIZE));
      if (!active || hi.x - lo.x < 1 || hi.y - lo.y < 1 || hi.z - lo.z < 1) { clear(); return; }
      fitBox(lo, hi, 0, _nb);
      pendingBox = { min: _nb.min.clone(), size: _nb.size.clone() };
    },
    // Balles : sphères { x, y, z, vx, vy, vz, r } (rayon d'influence sur l'air).
    setBalls(list) { balls = list; },
    // Points à garder dans la boîte de simulation ({ x, y, z, radius }).
    setKeep(list) {
      // Un nouveau point hors de la boîte : on l'agrandit dès le prochain pas.
      if (active && params.follow && params.mode === 'hybrid' && !pendingBox) {
        const hi = box.min.clone().add(box.size);
        for (const o of list) {
          if (o.x > box.min.x + 1.2 && o.x < hi.x - 1.2 && o.y > box.min.y && o.y < hi.y - 1.2 && o.z > box.min.z + 1.2 && o.z < hi.z - 1.2) continue;
          const lo2 = box.min.clone(), hi2 = hi.clone();
          for (const q of list) { lo2.min(new THREE.Vector3(q.x, q.y, q.z).subScalar(q.radius ?? 1)); hi2.max(new THREE.Vector3(q.x, q.y, q.z).addScalar(q.radius ?? 1)); }
          fitBox(lo2, hi2, 1.5, _nb);
          pendingBox = { min: _nb.min.clone(), size: _nb.size.clone() };
          break;
        }
      }
      keep = list;
    },
    // Obstacles construits : boîtes { x, y, z, sx, sy, sz } (24 au plus).
    setSolids(boxes) {
      const n = Math.min(24, boxes.length);
      shared.uSN.value = n;
      for (let i = 0; i < n; i++) {
        const b = boxes[i];
        shared.uSMin.value[i].set(b.x - b.sx / 2, b.y - b.sy / 2, b.z - b.sz / 2);
        shared.uSMax.value[i].set(b.x + b.sx / 2, b.y + b.sy / 2, b.z + b.sz / 2);
      }
    },
    // Lampes colorées : { x, y, z, range, r, g, b } (couleur linéaire × force).
    setLights(list) { lights = list; },
    setSunColor(r, g, b) { sunCol.set(r, g, b); },
    // Aspirateurs : { x, y, z, r (bouche), q (vitesse à la bouche), range (portée) }, 6 au plus.
    setVacs(list) {
      const n = Math.min(12, list.length);
      velUniforms.uVacN.value = n;
      for (let i = 0; i < n; i++) { velUniforms.uVacA.value[i].set(list[i].x, list[i].y, list[i].z, list[i].r); velUniforms.uVacQ.value[i] = list[i].q; velUniforms.uVacR.value[i] = Math.max(list[i].range ?? 4, list[i].r * 1.2); velUniforms.uVacK.value[i] = list[i].hold ? 0 : 1; }
    },
    // Corps mobile (le joueur) : pieds en (x, y, z), vitesse, force 0..n.
    setBody(b) {
      body = b && b.k > 0 ? b : null;
      velUniforms.uBodyK.value = body ? body.k : 0;
      if (body) { velUniforms.uBodyPos.value.set(b.x, b.y, b.z); velUniforms.uBodyVel.value.set(b.vx, b.vy, b.vz); velUniforms.uBodyR.value = b.r; velUniforms.uBodyH.value = b.h; }
    },
    setMode(mode) { params.mode = mode; if (mode !== 'full') ensureWorker(); allocate(); },
    // La grille n tient-elle dans une texture de ce GPU ? Et sa mémoire vidéo
    // approximative (4 volumes de densité en RGBA demi-flottant), en Go.
    fits(n) { return !!tilesFor(n, Math.round(n * 0.75), n) && cellsOf(n) * 2 <= TEX_CAP; },
    mono(n) { return cellsOf(n) * 8 > TEX_CAP; },
    vram(n) { return cellsOf(n) * (cellsOf(n) * 8 > TEX_CAP ? 2 : 8) * 4 / 2 ** 30; },
    setRes(r) { if (!this.fits(r)) return false; params.res = r; allocate(); return true; },
    setVelRes(r) { params.vres = r; allocate(); },
    // Grille du solveur de vitesse FFT (Worker) : 32 ou 64 (≈ 8× plus coûteux).
    setVelN(n) {
      params.velN = n; VN = n;
      velTex.dispose();
      velTex = makeVelTex();
      velUniforms.uVel3.value = velTex;
      rhoBuf = new Float32Array(n * n * n);
      if (worker) worker.postMessage({ type: 'config', n: VN, ...velConfig(), sim: { visc: params.visc, weight: params.weight, swirl: params.swirl } });
      allocate();
    },
    setLightFull(v) { params.lightFull = v; allocate(); },
    setUniform(name, v) { shared[name].value = v; },
    // Les parois ont changé : le Worker reçoit les nouveaux masques.
    reconfigure(keep = false) {
      if (worker) worker.postMessage({ type: 'config', n: VN, ...velConfig(), sim: { visc: params.visc, weight: params.weight, swirl: params.swirl } });
      if (!keep) clear();
    },
    setParticles(s) { params.particles = s; allocate(); },
    setSim() { worker?.postMessage({ type: 'sim', sim: { visc: params.visc, weight: params.weight, swirl: params.swirl } }); },
    dispose() { dispose(); worker?.terminate(); worker = null; },
  };
}
