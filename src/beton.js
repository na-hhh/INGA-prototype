// ---- Béton : textures du sol et des murs ------------------------------------
// Le domaine BÉTON règle ici le sol (une seule coulée lisse, sans joint, avec
// ses imperfections) et les murs (grandes plaques de coffrage, trous de
// banche, à la manière de Tadao Ando). La galerie utilise exactement les
// mêmes matériaux : ce que l'on règle dans le domaine s'y voit aussitôt.
//
// - Les textures sont des photos de béton CC0 (ambientCG, Poly Haven), en
//   1024 px dans public/assets/beton/ (crédits dans LICENCE.txt).
// - Le reste est dessiné dans le shader d'après la position dans le monde,
//   net à toute distance et réglable en direct : plaques en colonnes et
//   rangées alternées (une grande, une étroite), joints fins avec leur
//   coulure, 2 ou 4 trous de banche en cône, pores semés en grappes, et des
//   marbrures à grande échelle qui cassent la répétition de la photo.
// - Réglages : brouillon dans le navigateur, « Enregistrer » les écrit dans
//   src/data/beton.json (serveur de dev), version partagée par le projet.
import * as THREE from 'three';

const PROJECT = import.meta.glob('./data/beton.json', { eager: true, import: 'default' });
const DRAFT_KEY = 'ingaBeton4';

export const BETON_LIB = [
  { id: 'concrete016', name: 'Clair à pores (ambientCG 016)' },
  { id: 'concrete_floor_worn_001', name: 'Sol lisse gris, marques (Poly Haven)' },
  { id: 'concrete034', name: 'Lisse très clair (ambientCG 034)' },
  { id: 'concrete030', name: 'Gris moyen, petits trous (ambientCG 030)' },
  { id: 'concrete014', name: 'Nuagé de coffrage (ambientCG 014)' },
  { id: 'concrete027', name: 'Coffrage à bulles (ambientCG 027)' },
  { id: 'concrete_wall_008', name: 'Mur lisse beige (Poly Haven)' },
];

export const BETON_DEFAULTS = {
  floor: {
    tex: 'concrete034', scale: 3.5, tint: '#efeeea', bright: 1.35, rough: 0.7, relief: 0.35, shine: 0.06, reflect: 0.12, mottle: 0.45, pores: 0.3,
    // Fissures : le sol se casse par endroits en dalles irrégulières, les
    // joints se remplissent de mousse (référence : béton fissuré envahi).
    // Dans le domaine BÉTON seulement (la galerie garde son sol lisse).
    crack: 0.45, crackW: 0.022, crackMoss: 0.85, crackCell: 0.5,
  },
  wall: {
    tex: 'concrete016', scale: 3, tint: '#e6e4df', bright: 1.5, rough: 0.95, relief: 0.6,
    // Grandes plaques verticales, comme sur les photos de référence :
    // colonnes d'une grande plaque (2,4 m) puis d'une étroite (0,7 m) ;
    // une rangée basse (2,6 m) au pied du mur, puis une haute (4,8 m) —
    // 7,4 m, la hauteur des murs du hall : un seul joint horizontal.
    panelW: 2.4, panelW2: 0.7, panelH: 4.8, panelH2: 2.6,
    // 4 trous dans les grandes plaques (2 × 2), 2 dans les étroites.
    holesX: 2, holesY: 2, holeR: 0.021, insetX: 0.35, insetY: 0.45, holeDepth: 1,
    joint: 0.004, jointDark: 0.45, bleed: 0.5, panelVar: 0.08, mottle: 0.5, pores: 0.6, poreSize: 1,
    // Mousse de façade : des coulures vertes depuis le haut des murs, là
    // où l'eau ruisselle (algues, mousse), avec de fines traînées.
    moss: 0.55, mossLen: 3.2,
  },
};

const clone = (o) => JSON.parse(JSON.stringify(o));
function merge(base, src) {
  const out = clone(base);
  for (const part of ['floor', 'wall']) for (const k in out[part]) {
    const v = src?.[part]?.[k];
    if (typeof v === typeof out[part][k]) out[part][k] = v;
  }
  return out;
}
export const projectBeton = () => merge(BETON_DEFAULTS, PROJECT['./data/beton.json']);
// Pièces construites avec l'avatar (X), enregistrées avec les réglages.
export const projectPieces = () => PROJECT['./data/beton.json']?.pieces || [];
export function loadBeton() {
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch { /* brouillon illisible */ }
  return merge(projectBeton(), draft);
}
export function saveDraft(state) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(state)); } catch { /* quota */ } }
export function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* stockage indisponible */ } }
export function hasDraft() { try { return !!localStorage.getItem(DRAFT_KEY); } catch { return false; } }
// Écrit les réglages dans src/data/beton.json (serveur de dev seulement).
export async function saveProject(state) {
  const r = await fetch('/__inga/save?file=beton', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-inga-editor': '1' }, body: JSON.stringify(state),
  });
  if (!r.ok) throw new Error(r.status === 404 ? 'possible seulement avec le serveur local (npm run dev)' : await r.text());
  clearDraft();
}

// ---- Qualité : LÉGER (petites machines), MOYEN, COMPLET (grosse carte) ----
//   léger   : textures 1K, filtrage faible, ni pores ni coulures ni relief
//             des trous dans le shader, sol sans vernis ni reflets ;
//   moyen   : tous les effets, textures 1K ;
//   complet : tous les effets, textures 2K (quand elles existent),
//             filtrage maximal.
// Par défaut, la qualité générale de la page (?q=low|medium|high).
export const BETON_QUALITIES = [
  ['leger', 'LÉGER', 'Portable, petite carte graphique'],
  ['moyen', 'MOYEN', 'Tous les effets, textures 1K'],
  ['complet', 'COMPLET', 'Textures 2K, filtrage maximal'],
];
const Q_INDEX = { leger: 0, moyen: 1, complet: 2 };
const HAS_2K = new Set(['concrete016', 'concrete034']);
let quality = 'moyen';
export function initBetonQuality(pageQuality) {
  let q = { low: 'leger', medium: 'moyen', high: 'complet' }[pageQuality] || 'moyen';
  try { const v = localStorage.getItem('ingaBetonQ'); if (v in Q_INDEX) q = v; } catch { /* stockage indisponible */ }
  quality = q;
  return q;
}
export const betonQuality = () => quality;
export function setBetonQuality(q) {
  if (!(q in Q_INDEX)) return;
  quality = q;
  try { localStorage.setItem('ingaBetonQ', q); } catch { /* quota */ }
}
const hooked = new Set(); // matériaux dont le shader dépend de la qualité

// ---- Textures ----
const loader = new THREE.TextureLoader();
const texCache = new Map();
// Une instance par rôle (sol / mur) et par résolution : chacun a sa répétition.
function texture(id, kind, role, renderer) {
  const res = quality === 'complet' && HAS_2K.has(id) ? '_2k' : '';
  const aniso = Math.min([2, 4, 16][Q_INDEX[quality]], renderer.capabilities.getMaxAnisotropy());
  const key = `${id}/${kind}${res}/${role}`;
  let t = texCache.get(key);
  if (!t) {
    t = loader.load(`${import.meta.env.BASE_URL}assets/beton/${id}/${kind}${res}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (kind === 'color') t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    texCache.set(key, t);
  } else if (t.anisotropy !== aniso) {
    t.anisotropy = aniso;
    if (t.image) t.needsUpdate = true; // renvoyée une fois, pas à chaque curseur
  }
  return t;
}
// Les UV des boîtes valent 0,4 par mètre (TEX_DENSITY de main.js).
const UV_PER_M = 0.4;
function setMaps(mat, p, role, renderer) {
  const rep = 1 / (p.scale * UV_PER_M);
  mat.map = texture(p.tex, 'color', role, renderer);
  mat.normalMap = texture(p.tex, 'normal', role, renderer);
  mat.roughnessMap = texture(p.tex, 'rough', role, renderer);
  for (const t of [mat.map, mat.normalMap, mat.roughnessMap]) t.repeat.set(rep, rep);
  mat.color.set(p.tint).multiplyScalar(p.bright);
  mat.roughness = p.rough;
  mat.normalScale.set(p.relief, p.relief);
  mat.needsUpdate = true;
}

// ---- GLSL commun : bruit, pores, marbrures ----
const COMMON_GLSL = `
varying vec3 vBtWP; varying vec3 vBtWN;
float btHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float btNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( btHash( i ), btHash( i + vec2( 1, 0 ) ), f.x ), mix( btHash( i + vec2( 0, 1 ) ), btHash( i + vec2( 1, 1 ) ), f.x ), f.y );
}
// Hachage sans sinus (stable entre GPU et JS, voir crackAt plus bas).
vec2 btHash2( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.xx + p3.yz ) * p3.zy );
}
// Marbrures : taches claires et sombres de 0,5 à 3 m (cassent la répétition).
float btMottle( vec2 p ) { return ( btNoise( p * 0.35 ) - 0.5 ) * 0.6 + ( btNoise( p * 1.3 + 7.0 ) - 0.5 ) * 0.3 + ( btNoise( p * 4.1 + 3.0 ) - 0.5 ) * 0.1; }
// Pores (bulles d'air du coffrage) : un au plus par cellule de 3,5 cm,
// semés en grappes. Ils s'effacent au loin plutôt que de scintiller.
float btPores( vec2 p, float dens, float size ) {
  vec2 g = p / 0.035; vec2 c = floor( g );
  float cluster = 0.25 + 1.5 * btNoise( p * 0.9 + 11.0 );
  if ( btHash( c ) > dens * cluster * 0.22 ) return 0.0;
  vec2 o = c + 0.25 + 0.5 * vec2( btHash( c + 7.1 ), btHash( c + 3.3 ) );
  float r = ( 0.035 + 0.11 * pow( btHash( c + 9.7 ), 2.0 ) ) * size;
  float aa = max( fwidth( g.x ), 1e-4 );
  float pore = 1.0 - smoothstep( r - aa, r + aa, length( g - o ) );
  return pore * ( 1.0 - smoothstep( 0.08, 0.3, aa ) );
}
`;
const VERT_INJECT = [
  ['#include <common>', '#include <common>\nvarying vec3 vBtWP; varying vec3 vBtWN;'],
  ['#include <project_vertex>', 'vBtWP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvBtWN = normalize( mat3( modelMatrix ) * objectNormal );\n#include <project_vertex>'],
];
function hook(mat, key, uniforms, fragCommon, mapCode, normalCode, roughCode) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(mat, sh, r);
    Object.assign(sh.uniforms, uniforms);
    for (const [a, b] of VERT_INJECT) sh.vertexShader = sh.vertexShader.replace(a, b);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + COMMON_GLSL + fragCommon)
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + mapCode)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + (roughCode || ''))
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + (normalCode || ''));
  };
  mat.customProgramCacheKey = () => prevKey() + '|beton-' + key + '-q' + Q_INDEX[quality];
  mat.defines = { ...(mat.defines || {}), BT_Q: Q_INDEX[quality] };
  hooked.add(mat);
  mat.needsUpdate = true;
}
// Après un changement de qualité : les shaders se recompilent.
export function refreshQualityDefines() {
  for (const m of hooked) { m.defines = { ...(m.defines || {}), BT_Q: Q_INDEX[quality] }; m.needsUpdate = true; }
}

// ---- Sol : une seule coulée, marbrures et rares pores ----
// Fissures et mousse de façade : seulement dans le domaine BÉTON (sa pièce,
// loin de la galerie). x, z : centre ; z : demi-côté ; w : haut des murs.
export const betonDomain = { value: new THREE.Vector4(1e6, 0, 0, 5.4) };
const inDomainGLSL = `
uniform vec4 uBtDomain;
float btInDomain() { return step( abs( vBtWP.x - uBtDomain.x ), uBtDomain.z ) * step( abs( vBtWP.z - uBtDomain.y ), uBtDomain.z ); }
`;
export const floorUniforms = { uFMottle: { value: 0 }, uFPores: { value: 0 }, uCrack: { value: 0 }, uCrackW: { value: 0.02 }, uCrackMoss: { value: 0 }, uCrackCell: { value: 0.5 }, uBtDomain: betonDomain };
export function applyFloor(mat, p, renderer) {
  setMaps(mat, p, 'floor', renderer);
  if ('clearcoat' in mat) { mat.clearcoat = quality === 'leger' ? 0 : p.shine; mat.clearcoatRoughness = 0.35; }
  floorUniforms.uFMottle.value = p.mottle;
  floorUniforms.uFPores.value = p.pores;
  floorUniforms.uCrack.value = p.crack; floorUniforms.uCrackW.value = p.crackW;
  floorUniforms.uCrackMoss.value = p.crackMoss; floorUniforms.uCrackCell.value = p.crackCell;
}
// ---- Fissures moussues : même calcul en JS (pour poser touffes et herbes) ----
const fract = (x) => x - Math.floor(x);
function hash2(x, y) {
  let a = fract(x * 0.1031), b = fract(y * 0.1030), c = fract(x * 0.0973);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d; b += d; c += d;
  return [fract((a + b) * c), fract((a + c) * b)];
}
// Bruit de valeur sur ce hachage (btNoiseS côté GPU).
const vnoise = (x, y) => {
  const h = (i, j) => hash2(i, j)[0];
  const i = Math.floor(x), j = Math.floor(y); let fx = x - i, fy = y - j;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = h(i, j), b = h(i + 1, j), c = h(i, j + 1), d = h(i + 1, j + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
};
// Zone fissurée (0..1) et distance au joint le plus proche (m), au point x, z.
export function crackAt(x, z, p) {
  const zone = Math.min(1, Math.max(0, (vnoise(x * 0.16 + 3.1, z * 0.16 + 8.7) - (1 - p.crack)) * 6));
  if (zone <= 0) return { zone: 0, dist: 1e3, width: 0 };
  const C = p.crackCell;
  const wx = x + (vnoise(x * 2.3, z * 2.3) - 0.5) * 0.14 * C / 0.5, wz = z + (vnoise(x * 2.3 + 5.2, z * 2.3 + 1.7) - 0.5) * 0.14 * C / 0.5;
  const gx = wx / C, gz = wz / C, ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
  let md = 8, mrx = 0, mrz = 0, mix = 0, miz = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const o = hash2(ix + i, iz + j), rx = i + o[0] - fx, rz = j + o[1] - fz, d = rx * rx + rz * rz;
    if (d < md) { md = d; mrx = rx; mrz = rz; mix = i; miz = j; }
  }
  md = 8;
  for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
    const o = hash2(ix + mix + i, iz + miz + j), rx = mix + i + o[0] - fx, rz = miz + j + o[1] - fz;
    const dx = rx - mrx, dz = rz - mrz, l2 = dx * dx + dz * dz;
    if (l2 > 1e-5) md = Math.min(md, ((mrx + rx) * 0.5 * dx + (mrz + rz) * 0.5 * dz) / Math.sqrt(l2));
  }
  const width = p.crackW * (0.35 + 1.1 * vnoise(x * 1.7 + 2.0, z * 1.7)) * zone;
  return { zone, dist: md * C, width };
}
export function installFloor(mat) {
  hook(mat, 'floor', floorUniforms, FLOOR_GLSL, `{
  vec2 p = vBtWP.xz;
  diffuseColor.rgb *= 1.0 + btMottle( p ) * uFMottle;
#if BT_Q > 0
  diffuseColor.rgb *= 1.0 - 0.6 * btPores( p, uFPores, 0.8 );
#endif
  // Fissures : dalles cassées, joints sombres remplis de mousse qui déborde
  // un peu sur les bords ; en MOYEN et COMPLET, fines craquelures sur les
  // dalles et relief (le joint est en creux, la mousse bombée).
  btCrackK = 0.0; btCrackH = 0.0;
  if ( uCrack > 0.001 && vBtWN.y > 0.5 && btInDomain() > 0.5 ) {
    float zone = clamp( ( btNoiseS( p * 0.16 + vec2( 3.1, 8.7 ) ) - ( 1.0 - uCrack ) ) * 6.0, 0.0, 1.0 );
    if ( zone > 0.0 ) {
      vec2 wp = p + ( vec2( btNoiseS( p * 2.3 ), btNoiseS( p * 2.3 + vec2( 5.2, 1.7 ) ) ) - 0.5 ) * 0.14 * uCrackCell / 0.5;
      float d = btVoronoiEdge( wp / uCrackCell ) * uCrackCell;
      float w = uCrackW * ( 0.35 + 1.1 * btNoiseS( p * 1.7 + vec2( 2.0, 0.0 ) ) ) * zone;
      float aa = fwidth( d ) + 1e-4;
      float gap = 1.0 - smoothstep( w * 0.5 - aa, w * 0.5 + aa, d );
      // Mousse : remplit le joint et déborde en touffes irrégulières.
      float tuft = btNoise( p * 38.0 ) * 0.6 + btNoise( p * 90.0 ) * 0.4;
      float spill = w * 0.5 + w * 1.4 * tuft * uCrackMoss;
      float mossK = ( 1.0 - smoothstep( spill - aa, spill + aa, d ) ) * uCrackMoss * smoothstep( 0.25, 0.55, btNoise( p * 4.0 + 9.0 ) + 0.35 );
      vec3 soil = vec3( 0.16, 0.15, 0.12 );
      vec3 mossA = vec3( 0.22, 0.32, 0.09 ), mossB = vec3( 0.42, 0.55, 0.16 );
      vec3 mc = mix( mossA, mossB, btNoise( p * 60.0 ) ) * ( 0.75 + 0.5 * btNoise( p * 140.0 ) );
      // Bords des dalles : un peu salis, et légèrement éclatés.
      float edge = 1.0 - smoothstep( w * 0.5, w * 0.5 + 0.03, d );
      diffuseColor.rgb *= 1.0 - 0.25 * edge * zone;
      diffuseColor.rgb = mix( diffuseColor.rgb, soil, gap );
      diffuseColor.rgb = mix( diffuseColor.rgb, mc, mossK );
      btCrackK = max( gap, mossK );
      btCrackH = -gap * ( 1.0 - mossK ) + mossK * tuft * 0.6;
#if BT_Q > 0
      // Craquelures fines sur les dalles (plus petites, sans mousse).
      float dh = btVoronoiEdge( wp / ( uCrackCell * 0.35 ) + 17.0 ) * uCrackCell * 0.35;
      float hair = ( 1.0 - smoothstep( 0.0008, 0.0008 + fwidth( dh ) * 1.5, dh ) ) * smoothstep( 0.45, 0.7, btNoise( p * 3.0 + 4.0 ) ) * zone;
      diffuseColor.rgb *= 1.0 - 0.45 * hair;
      btCrackH -= hair * 0.3;
#endif
    }
  }
}`, `{
#if BT_Q > 0
  // Relief des fissures, par dérivées écran (comme une carte de bosses).
  // (Dérivées hors de toute condition : elles doivent l'être.)
  {
    float hs = btCrackH * 0.004; // 4 mm de creux / de bosse
    vec3 sp = -vViewPosition;
    vec3 sx = dFdx( sp ), sy = dFdy( sp );
    vec2 dH = vec2( dFdx( hs ) / max( length( sx ), 1e-6 ), dFdy( hs ) / max( length( sy ), 1e-6 ) );
    sx = normalize( sx ); sy = normalize( sy );
    vec3 r1 = cross( sy, normal ), r2 = cross( normal, sx );
    float det = dot( sx, r1 );
    vec3 grad = sign( det ) * ( dH.x * r1 + dH.y * r2 );
    if ( btCrackK > 0.0 || btCrackH != 0.0 ) normal = normalize( abs( det ) * normal - grad );
  }
#endif
}`, `{
  // Le ciré s'use par plages : un peu plus mat ici et là.
  roughnessFactor = clamp( roughnessFactor + ( btNoise( vBtWP.xz * 0.5 + 5.0 ) - 0.5 ) * 0.25 * uFMottle, 0.04, 1.0 );
  roughnessFactor = mix( roughnessFactor, 1.0, btCrackK );
}`);
}

const FLOOR_GLSL = `
uniform float uFMottle; uniform float uFPores;
uniform float uCrack; uniform float uCrackW; uniform float uCrackMoss; uniform float uCrackCell;
float btCrackK; float btCrackH;
` + inDomainGLSL + `
float btNoiseS( vec2 p ) {
  vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( btHash2( i ).x, btHash2( i + vec2( 1, 0 ) ).x, f.x ), mix( btHash2( i + vec2( 0, 1 ) ).x, btHash2( i + vec2( 1, 1 ) ).x, f.x ), f.y );
}
// Distance au bord de la cellule de Voronoï (iq) : les joints des dalles.
float btVoronoiEdge( vec2 x ) {
  vec2 n = floor( x ), f = fract( x ), mg, mr;
  float md = 8.0;
  for ( int j = -1; j <= 1; j++ ) for ( int i = -1; i <= 1; i++ ) {
    vec2 g = vec2( float( i ), float( j ) ), r = g + btHash2( n + g ) - f;
    float d = dot( r, r );
    if ( d < md ) { md = d; mr = r; mg = g; }
  }
  md = 8.0;
#if BT_Q > 0
  for ( int j = -2; j <= 2; j++ ) for ( int i = -2; i <= 2; i++ ) {
#else
  for ( int j = -1; j <= 1; j++ ) for ( int i = -1; i <= 1; i++ ) {
#endif
    vec2 g = mg + vec2( float( i ), float( j ) ), r = g + btHash2( n + g ) - f;
    if ( dot( mr - r, mr - r ) > 1e-5 ) md = min( md, dot( 0.5 * ( mr + r ), normalize( r - mr ) ) );
  }
  return md;
}
`;

// ---- Murs : plaques, joints, trous de banche ----
// Uniforms partagés : un curseur bouge, le mur suit sans recompiler.
export const wallUniforms = {
  uColA: { value: 1 }, uColB: { value: 0 }, uRowA: { value: 1 }, uRowB: { value: 0 },
  uHoles: { value: new THREE.Vector2() }, uInset: { value: new THREE.Vector2() },
  uHoleR: { value: 0 }, uHoleDepth: { value: 1 }, uJoint: { value: 0 }, uJointDark: { value: 0 }, uBleed: { value: 0 },
  uPanelVar: { value: 0 }, uMottle: { value: 0 }, uPores: { value: 0 }, uPoreSize: { value: 1 },
  uMoss: { value: 0 }, uMossLen: { value: 3 }, uBtDomain: betonDomain,
};
export function applyWall(mats, p, renderer) {
  for (const m of mats) setMaps(m, p, 'wall', renderer);
  const u = wallUniforms;
  u.uColA.value = p.panelW; u.uColB.value = p.panelW2;
  // Rangées : la basse au pied du mur, puis la haute.
  if (p.panelH2 > 0.01) { u.uRowA.value = p.panelH2; u.uRowB.value = p.panelH; } else { u.uRowA.value = p.panelH; u.uRowB.value = 0; }
  u.uHoles.value.set(Math.round(p.holesX), Math.round(p.holesY));
  u.uInset.value.set(p.insetX, p.insetY);
  u.uHoleR.value = p.holeR; u.uHoleDepth.value = p.holeDepth;
  u.uJoint.value = p.joint; u.uJointDark.value = p.jointDark; u.uBleed.value = p.bleed;
  u.uPanelVar.value = p.panelVar; u.uMottle.value = p.mottle; u.uPores.value = p.pores; u.uPoreSize.value = p.poreSize;
  u.uMoss.value = p.moss; u.uMossLen.value = p.mossLen;
}
const WALL_GLSL = `
uniform float uColA; uniform float uColB; uniform float uRowA; uniform float uRowB;
uniform vec2 uHoles; uniform vec2 uInset;
uniform float uHoleR; uniform float uHoleDepth; uniform float uJoint; uniform float uJointDark; uniform float uBleed;
uniform float uPanelVar; uniform float uMottle; uniform float uPores; uniform float uPoreSize;
uniform float uMoss; uniform float uMossLen;
` + inDomainGLSL + `
// Coordonnées dans le plan du mur (m), et ses deux axes dans le monde.
vec2 btPlane( out vec3 U, out vec3 V ) {
  vec3 a = abs( vBtWN );
  if ( a.y > a.x && a.y > a.z ) { U = vec3( 1, 0, 0 ); V = vec3( 0, 0, 1 ); return vBtWP.xz; }
  if ( a.x > a.z ) { U = vec3( 0, 0, 1 ); V = vec3( 0, 1, 0 ); return vBtWP.zy; }
  U = vec3( 1, 0, 0 ); V = vec3( 0, 1, 0 ); return vBtWP.xy;
}
// Un axe découpé en segments alternés a, b (b = 0 : tous égaux) :
// début, taille et numéro du segment.
vec3 btSeg( float x, float a, float b ) {
  if ( b < 0.01 ) { float i = floor( x / a ); return vec3( i * a, a, i ); }
  float P = a + b; float k = floor( x / P ); float r = x - k * P;
  return r < a ? vec3( k * P, a, k * 2.0 ) : vec3( k * P + a, b, k * 2.0 + 1.0 );
}
// Plaque sous le point : position dans la plaque, taille, identifiant.
void btCell( vec2 p, out vec2 f, out vec2 size, out vec2 id ) {
  vec3 sx = btSeg( p.x, uColA, uColB ), sy = btSeg( p.y, uRowA, uRowB );
  f = p - vec2( sx.x, sy.x ); size = vec2( sx.y, sy.y ); id = vec2( sx.z, sy.z );
}
// Distance au trou le plus proche : grandes plaques 2 colonnes, étroites 1.
// Du centre du trou le plus proche au point (m, dans le plan du mur).
vec2 btHoleVec( vec2 f, vec2 size ) {
  if ( uHoles.x < 0.5 || uHoles.y < 0.5 ) return vec2( 1e3 );
  vec2 n = vec2( size.x > 1.5 ? uHoles.x : max( 1.0, uHoles.x - 1.0 ), uHoles.y );
  vec2 ins = min( uInset, size * 0.45 );
  vec2 span = size - 2.0 * ins;
  vec2 k = clamp( floor( ( f - ins ) / max( span, vec2( 1e-3 ) ) * ( n - 1.0 ) + 0.5 ), vec2( 0.0 ), n - 1.0 );
  vec2 c = mix( size * 0.5, ins + k / max( n - 1.0, vec2( 1.0 ) ) * span, step( 1.5, n ) );
  return f - c;
}
float btHoleDist( vec2 f, vec2 size ) { return length( btHoleVec( f, size ) ); }
float btJointDist( vec2 f, vec2 size ) { vec2 d = min( f, size - f ); return min( d.x, d.y ); }
// Relief : creux du joint et cône peu profond du trou de banche.
float btHeight( vec2 p ) {
  vec2 f, size, id; btCell( p, f, size, id );
  float h = -uHoleDepth * ( 1.0 - smoothstep( uHoleR * 0.35, uHoleR, btHoleDist( f, size ) ) );
  h -= 0.5 * ( 1.0 - smoothstep( uJoint * 0.5, uJoint * 0.5 + 0.002, btJointDist( f, size ) ) );
  return h;
}
`;
export function installPanels(mat, key = 'wall') {
  hook(mat, key, wallUniforms, WALL_GLSL, `{
  vec3 U, V; vec2 p = btPlane( U, V );
  vec2 f, size, id; btCell( p, f, size, id );
  // Chaque plaque a sa coulée : teinte propre, laitance plus claire en haut.
  float tone = 1.0 + ( btHash( id ) - 0.5 ) * uPanelVar;
  tone *= 1.0 + ( smoothstep( 0.7, 1.0, f.y / size.y ) * 0.4 - 0.2 * smoothstep( 0.25, 0.0, f.y / size.y ) ) * uPanelVar;
  diffuseColor.rgb *= tone * ( 1.0 + btMottle( p + id * 3.7 ) * uMottle );
  // Joint fin et sa coulure sombre, irrégulière le long du joint.
  vec2 dd = min( f, size - f );
  float jd = min( dd.x, dd.y );
#if BT_Q > 0
  float along = dd.x < dd.y ? p.y : p.x;
  float w = uJoint * 0.5 + 0.03 * uBleed * btNoise( vec2( along * 1.7, id.x + id.y * 5.0 ) );
  float bleed = ( 1.0 - smoothstep( uJoint * 0.5, w, jd ) ) * uBleed * ( 0.3 + 0.7 * btNoise( vec2( along * 7.0, 3.0 ) ) );
  diffuseColor.rgb *= 1.0 - 0.35 * bleed;
#endif
  diffuseColor.rgb *= 1.0 - uJointDark * ( 1.0 - smoothstep( uJoint * 0.5, uJoint * 0.5 + 0.002, jd ) );
  // Trou de banche : fond gris un peu plus sombre (le relief fait le croissant).
  diffuseColor.rgb *= 1.0 - 0.22 * ( 1.0 - smoothstep( uHoleR * 0.6, uHoleR, btHoleDist( f, size ) ) );
#if BT_Q > 0 && NUM_DIR_LIGHTS > 0
  // Micro-ombre : le bord du trou côté soleil projette un croissant sur le
  // fond. Un point du fond est à l'ombre si, en remontant vers le soleil
  // sur la profondeur du trou, on sort du trou (on heurte sa paroi).
  {
    vec2 hv = btHoleVec( f, size );
    if ( length( hv ) < uHoleR ) {
      vec3 Lw = normalize( ( vec4( directionalLights[ 0 ].direction, 0.0 ) * viewMatrix ).xyz );
      float ln = dot( Lw, normalize( vBtWN ) );
      vec2 lp = vec2( dot( Lw, U ), dot( Lw, V ) );
      float sunK = clamp( dot( directionalLights[ 0 ].color, vec3( 0.3, 0.5, 0.2 ) ) * 0.35, 0.0, 1.0 );
      float len = 0.018 * uHoleDepth * length( lp ) / max( ln, 0.06 );
      vec2 q = hv + normalize( lp + 1e-5 ) * len;
      float sh = ln > 0.0 ? smoothstep( uHoleR * 0.82, uHoleR * 1.02, length( q ) ) : 1.0;
      diffuseColor.rgb *= 1.0 - 0.55 * sh * sunK;
    }
  }
#endif
#if BT_Q > 0
  diffuseColor.rgb *= 1.0 - 0.75 * btPores( p, uPores, uPoreSize );
#endif
  // Mousse de façade : depuis le haut du mur, l'eau qui ruisselle laisse des
  // coulures vert-jaune, denses en haut, qui s'effilochent en traînées vers
  // le bas ; par plages le long du mur. Murs seulement (pas le plafond).
  if ( uMoss > 0.001 && abs( vBtWN.y ) < 0.5 && btInDomain() > 0.5 ) {
    float top = uBtDomain.w;
    float down = top - p.y; // distance sous le haut du mur
    float band = smoothstep( 0.35, 0.65, btNoise( vec2( p.x * 0.28 + 4.0, 1.0 ) ) + ( uMoss - 0.5 ) * 0.6 );
    // Longueur de la coulure : varie colonne par colonne (fines colonnes).
    float col = btNoise( vec2( p.x * 3.1, 0.5 ) ) * 0.6 + btNoise( vec2( p.x * 11.0, 2.5 ) ) * 0.4;
    float len = uMossLen * ( 0.25 + 1.1 * col ) * band;
    float m = 1.0 - smoothstep( len * 0.35, len, down + ( btNoise( p * vec2( 2.0, 0.6 ) ) - 0.5 ) * 0.6 );
    m *= smoothstep( -0.05, 0.25, down ) * 0.4 + 0.6;
    // Densité : nuageuse en haut, piquetée (taches d'algues) vers le bas.
    float cloud = btNoise( p * vec2( 4.0, 1.2 ) ) * 0.6 + btNoise( p * 14.0 ) * 0.4;
    float k = m * smoothstep( 0.2, 0.7, cloud + 0.35 * ( 1.0 - down / max( len, 0.01 ) ) );
#if BT_Q > 0
    // Fines traînées qui descendent plus bas que la masse.
    float drip = smoothstep( 0.78, 0.92, btNoise( vec2( p.x * 45.0, p.y * 0.35 ) ) ) * ( 1.0 - smoothstep( len * 0.6, len * 1.7, down ) ) * band;
    float speck = step( 0.82, btHash( floor( p * 220.0 ) ) ) * m;
    k = max( k, drip * 0.8 );
    k = clamp( k + speck * 0.5 * ( 1.0 - k ), 0.0, 1.0 );
#endif
    vec3 g1 = vec3( 0.30, 0.38, 0.10 ), g2 = vec3( 0.56, 0.60, 0.22 ), g3 = vec3( 0.20, 0.27, 0.10 );
    vec3 mc = mix( mix( g2, g1, btNoise( p * 6.0 ) ), g3, smoothstep( 0.3, 1.0, 1.0 - down / max( len, 0.01 ) ) * 0.6 );
    diffuseColor.rgb = mix( diffuseColor.rgb, mc * ( 0.8 + 0.4 * btNoise( p * 40.0 ) ), k * min( 1.0, uMoss * 1.4 ) * 0.92 );
  }
}`, `{
#if BT_Q > 0
  vec3 U, V; vec2 p = btPlane( U, V );
  float e = 0.0015;
  float h0 = btHeight( p );
  vec2 g = vec2( btHeight( p + vec2( e, 0.0 ) ) - h0, btHeight( p + vec2( 0.0, e ) ) - h0 ) / e;
  vec3 dw = ( U * g.x + V * g.y ) * 0.012;
  normal = normalize( normal - ( viewMatrix * vec4( dw, 0.0 ) ).xyz );
#endif
}`);
}

// ---- Panneau du domaine BÉTON ----
export function createBetonPanel({ getState, onChange, onGallery, extra = () => ({}), onClose }) {
  const el = document.createElement('div');
  el.className = 'beton';
  el.style.display = 'none';
  document.body.append(el);
  const mk = (tag, cls, parent, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; parent.append(e); return e; };
  let status;
  function render() {
    const s = getState();
    el.innerHTML = '';
    const hd = mk('div', 'bt-h', el, '<b>BÉTON · RÉGLAGES</b><span>Le sol et les murs de la galerie · <kbd>P</kbd> fermer</span>');
    const x = mk('button', 'bt-x', hd, '×');
    x.type = 'button'; x.title = 'Fermer (P)';
    x.addEventListener('click', () => onClose?.());
    // Qualité : agit aussi sur la galerie (mêmes matériaux).
    const qs = mk('div', 'bt-q', el);
    for (const [id, name, desc] of BETON_QUALITIES) {
      const qb = mk('button', 'bt-qb' + (id === quality ? ' on' : ''), qs, `<b>${name}</b><span>${desc}</span>`);
      qb.type = 'button';
      qb.addEventListener('click', () => { setBetonQuality(id); refreshQualityDefines(); onChange(s); render(); });
    }
    const changed = () => { saveDraft(s); onChange(s); status.textContent = '● Brouillon (pas encore enregistré dans le projet)'; };
    const sec = (t) => mk('div', 'bt-sec', el, t);
    const select = (label, part, key) => {
      const w = mk('label', 'bt-row', el, `<span>${label}</span>`);
      const sel = mk('select', '', w);
      for (const t of BETON_LIB) { const o = mk('option', '', sel, t.name); o.value = t.id; }
      sel.value = s[part][key];
      sel.addEventListener('change', () => { s[part][key] = sel.value; changed(); });
    };
    const slider = (label, part, key, min, max, step, unit = '') => {
      const w = mk('label', 'bt-sl', el);
      const top = mk('div', '', w, `<span>${label}</span>`);
      const val = mk('span', '', top);
      const inp = mk('input', '', w);
      inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = s[part][key];
      const show = () => { val.textContent = (+inp.value).toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 0) + unit; };
      show();
      inp.addEventListener('input', () => { s[part][key] = +inp.value; show(); changed(); });
    };
    const color = (label, part, key) => {
      const w = mk('label', 'bt-row', el, `<span>${label}</span>`);
      const inp = mk('input', '', w);
      inp.type = 'color'; inp.value = s[part][key];
      inp.addEventListener('input', () => { s[part][key] = inp.value; changed(); });
    };
    sec('SOL · UNE SEULE COULÉE');
    select('Texture', 'floor', 'tex');
    slider('Taille du motif', 'floor', 'scale', 0.6, 8, 0.1, ' m');
    color('Teinte', 'floor', 'tint');
    slider('Luminosité', 'floor', 'bright', 0.5, 1.6, 0.01);
    slider('Marbrures', 'floor', 'mottle', 0, 1.2, 0.01);
    slider('Pores', 'floor', 'pores', 0, 1.5, 0.01);
    slider('Rugosité', 'floor', 'rough', 0.2, 1, 0.01);
    slider('Relief', 'floor', 'relief', 0, 2, 0.05);
    slider('Brillant (ciré)', 'floor', 'shine', 0, 0.6, 0.01);
    slider('Reflets (murs, plafond)', 'floor', 'reflect', 0, 0.6, 0.01);
    sec('SOL · FISSURES ET MOUSSE');
    slider('Fissures (étendue)', 'floor', 'crack', 0, 1, 0.01);
    slider('Taille des dalles cassées', 'floor', 'crackCell', 0.2, 1.5, 0.01, ' m');
    slider('Largeur des joints', 'floor', 'crackW', 0.004, 0.06, 0.001, ' m');
    slider('Mousse dans les joints', 'floor', 'crackMoss', 0, 1, 0.01);
    sec('MURS · BÉTON');
    select('Texture', 'wall', 'tex');
    slider('Taille du motif', 'wall', 'scale', 0.6, 8, 0.1, ' m');
    color('Teinte', 'wall', 'tint');
    slider('Luminosité', 'wall', 'bright', 0.5, 1.6, 0.01);
    slider('Marbrures', 'wall', 'mottle', 0, 1.2, 0.01);
    slider('Pores', 'wall', 'pores', 0, 2, 0.01);
    slider('Taille des pores', 'wall', 'poreSize', 0.3, 2.5, 0.05);
    slider('Rugosité', 'wall', 'rough', 0.3, 1, 0.01);
    slider('Relief', 'wall', 'relief', 0, 2, 0.05);
    sec('MURS · MOUSSE DE FAÇADE');
    slider('Mousse (coulures)', 'wall', 'moss', 0, 1, 0.01);
    slider('Longueur des coulures', 'wall', 'mossLen', 0.5, 7, 0.1, ' m');
    sec('MURS · PLAQUES');
    slider('Grande plaque : largeur', 'wall', 'panelW', 0.6, 4.8, 0.05, ' m');
    slider('Plaque étroite : largeur (0 = aucune)', 'wall', 'panelW2', 0, 2.4, 0.05, ' m');
    slider('Rangée haute : hauteur', 'wall', 'panelH', 0.6, 7.4, 0.05, ' m');
    slider('Rangée basse : hauteur (0 = aucune)', 'wall', 'panelH2', 0, 4, 0.05, ' m');
    slider('Joints : largeur', 'wall', 'joint', 0, 0.02, 0.001, ' m');
    slider('Joints : sombres', 'wall', 'jointDark', 0, 0.9, 0.01);
    slider('Joints : coulures', 'wall', 'bleed', 0, 1.5, 0.01);
    slider('Variation entre plaques', 'wall', 'panelVar', 0, 0.4, 0.01);
    sec('MURS · TROUS DE BANCHE');
    slider('Colonnes (grandes plaques)', 'wall', 'holesX', 0, 4, 1);
    slider('Rangées', 'wall', 'holesY', 0, 4, 1);
    slider('Rayon', 'wall', 'holeR', 0.005, 0.04, 0.001, ' m');
    slider('Distance aux joints (côtés)', 'wall', 'insetX', 0.05, 1.2, 0.01, ' m');
    slider('Distance aux joints (haut, bas)', 'wall', 'insetY', 0.05, 1.2, 0.01, ' m');
    slider('Profondeur', 'wall', 'holeDepth', 0, 3, 0.05);
    const row = mk('div', 'bt-btns', el);
    const b = (label, cls, on) => { const x = mk('button', 'bt-btn ' + cls, row, label); x.type = 'button'; x.addEventListener('click', on); return x; };
    b('Voir dans la galerie', 'prim', onGallery);
    b('Enregistrer', '', async () => {
      try { await saveProject({ ...s, ...extra() }); status.textContent = '✓ Enregistré dans src/data/beton.json (réglages et pièces construites)'; } catch (e) { status.textContent = 'Échec : ' + e.message; }
    });
    b('Revenir au projet', '', () => {
      if (!confirm('Abandonner le brouillon et revenir aux réglages enregistrés dans le projet ?')) return;
      clearDraft(); Object.assign(s, projectBeton()); onChange(s); render();
    });
    b('Valeurs d\'origine', '', () => {
      if (!confirm('Remettre toutes les valeurs d\'origine ?')) return;
      Object.assign(s, clone(BETON_DEFAULTS)); saveDraft(s); onChange(s); render();
    });
    status = mk('div', 'bt-status', el, hasDraft() ? '● Brouillon (pas encore enregistré dans le projet)' : '✓ Réglages du projet');
    mk('div', 'bt-note', el, 'Les changements s\'appliquent aussi à la galerie. P : fermer ce panneau · X : construire · T : caméra / avatar.');
  }
  // Les touches du jeu ne doivent pas réagir pendant qu'on règle.
  el.addEventListener('keydown', (e) => e.stopPropagation());
  let visible = false;
  return {
    el,
    get visible() { return visible; },
    show(on) { visible = on; if (on) render(); el.style.display = on ? 'block' : 'none'; },
  };
}
