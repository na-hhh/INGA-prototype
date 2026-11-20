// ---- Îles flottantes ----------------------------------------------------------
// Rock islands hanging in a blue sky (after the user's references): layered
// sandstone/limestone walls, a dark columnar pendant underside, a dense
// cauliflower jungle spilling over the rim, beards of moss, falls, mist,
// satellites tied by vine cables, clouds above and a sea of cloud below.
//
// Data-driven: a world is a document { islands, links, env } of plain
// parameter objects (schemas below drive the editor's inspector). Each island
// lives in its own group, so moving one is free and changing its parameters
// rebuilds only that island (and its lianas). Deterministic: same document,
// same sky.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ---- Bruit -------------------------------------------------------------------
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Improved Perlin noise, 3D, roughly in [-1, 1].
function perlin3(seed) {
  const rnd = mulberry32(seed);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  const P = new Uint8Array(512);
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;
  const grad = (h, x, y, z) => {
    h &= 15;
    const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  };
  return (x, y, z) => {
    let X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    x -= X; y -= Y; z -= Z; X &= 255; Y &= 255; Z &= 255;
    const u = fade(x), v = fade(y), w = fade(z);
    const A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z, B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z;
    return lerp(
      lerp(lerp(grad(P[AA], x, y, z), grad(P[BA], x - 1, y, z), u), lerp(grad(P[AB], x, y - 1, z), grad(P[BB], x - 1, y - 1, z), u), v),
      lerp(lerp(grad(P[AA + 1], x, y, z - 1), grad(P[BA + 1], x - 1, y, z - 1), u), lerp(grad(P[AB + 1], x, y - 1, z - 1), grad(P[BB + 1], x - 1, y - 1, z - 1), u), v),
      w);
  };
}
const N1 = perlin3(1731), N2 = perlin3(9157), N3 = perlin3(4421);
function fbm(n, x, y, z, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * n(x * f, y * f, z * f); f *= 2.03; a *= 0.5; }
  return s;
}
const ridged = (n, x, y, z, oct = 3) => {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * (1 - Math.abs(n(x * f, y * f, z * f))); f *= 2.1; a *= 0.5; }
  return s;
};
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---- Textures procédurales (toutes raccordables) -----------------------------
// Periodic value-noise field in [0, 1]: cx × cy cells at the first octave.
function periodicField(S, cx, cy, oct, seed) {
  const rnd = mulberry32(seed);
  const out = new Float32Array(S * S);
  let amp = 0.5, tot = 0;
  for (let o = 0; o < oct; o++) {
    const gx = cx << o, gy = cy << o;
    const g = new Float32Array(gx * gy);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    for (let y = 0; y < S; y++) {
      const fy = (y / S) * gy, iy = Math.floor(fy), y1 = (iy + 1) % gy;
      let ty = fy - iy; ty = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < S; x++) {
        const fx = (x / S) * gx, ix = Math.floor(fx), x1 = (ix + 1) % gx;
        let tx = fx - ix; tx = tx * tx * (3 - 2 * tx);
        const a = g[iy * gx + ix], b = g[iy * gx + x1], c = g[y1 * gx + ix], d = g[y1 * gx + x1];
        out[y * S + x] += amp * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
      }
    }
    tot += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}
function dataTex(data, S, srgb) {
  const t = new THREE.DataTexture(data, S, S);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
// Tangent-space normal map from a periodic height field (Sobel).
function normalTex(h, S, strength) {
  const d = new Uint8Array(S * S * 4);
  const at = (x, y) => h[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
    const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
    let nx = -dx * strength, ny = -dy * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const k = (y * S + x) * 4;
    d[k] = (nx * 0.5 + 0.5) * 255; d[k + 1] = (ny * 0.5 + 0.5) * 255; d[k + 2] = (nz * 0.5 + 0.5) * 255; d[k + 3] = 255;
  }
  return dataTex(d, S, false);
}
// Rock wall: horizontal strata of uneven thickness, each its own colour
// (cream, tan, ochre, rust, grey), dark seams between them, vertical cracks,
// pitting and fine grain. u runs across the wall, v up it.
function rockTextures(S = 512) {
  const warp = periodicField(S, 3, 3, 3, 11);
  const fine = periodicField(S, 48, 48, 3, 12);
  const crack = periodicField(S, 22, 2, 3, 13);
  const blotch = periodicField(S, 5, 5, 4, 14);
  const pits = periodicField(S, 30, 30, 2, 15);
  const rnd = mulberry32(16);
  const L = 9; // layers per tile
  const bounds = [];
  for (let k = 0; k < L; k++) bounds.push((k + (rnd() - 0.5) * 0.55) / L);
  bounds.sort((a, b) => a - b);
  const palette = [[0.80, 0.75, 0.66], [0.72, 0.62, 0.48], [0.66, 0.52, 0.36], [0.58, 0.56, 0.52], [0.62, 0.47, 0.33], [0.76, 0.69, 0.57], [0.50, 0.48, 0.45], [0.70, 0.66, 0.60]];
  const layerCol = bounds.map(() => palette[Math.floor(rnd() * palette.length)]);
  const layerDepth = bounds.map(() => 0.35 + rnd() * 0.65);
  const h = new Float32Array(S * S);
  const col = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    let v = y / S + (warp[i] - 0.5) * 0.16;
    v -= Math.floor(v);
    let k = L - 1;
    for (let j = 0; j < L; j++) if (v < bounds[j]) { k = (j + L - 1) % L; break; }
    const b0 = bounds[k], b1 = k === L - 1 ? bounds[0] + 1 : bounds[k + 1];
    let vv = v; if (vv < b0) vv += 1;
    const local = (vv - b0) / (b1 - b0); // 0 at the layer's base, 1 at its top
    const seam = smooth(0, 0.07, local) * smooth(1, 0.9, local);
    const c = Math.pow(1 - Math.abs(crack[i] * 2 - 1), 10);
    const pit = smooth(0.62, 0.8, pits[i]);
    let hh = layerDepth[k] * (0.75 + 0.25 * local) * seam;
    hh += (fine[i] - 0.5) * 0.22 - c * 0.5 - pit * 0.12;
    h[i] = hh;
    const kn = (k + 1) % L, mixUp = smooth(0.75, 1, local) * 0.5;
    const pc = layerCol[k].map((c, q) => c + (layerCol[kn][q] - c) * mixUp);
    const shade = (0.72 + 0.42 * blotch[i]) * (0.55 + 0.45 * seam) * (1 - 0.55 * c) * (1 - 0.25 * pit) * (0.88 + 0.24 * fine[i]);
    // Rust stains running down from the cracks.
    const stain = smooth(0.5, 0.9, crack[(i + S * 7) % (S * S)]) * 0.25;
    col[i * 4] = Math.min(255, 255 * (pc[0] + stain * 0.15) * shade);
    col[i * 4 + 1] = Math.min(255, 255 * (pc[1] + stain * 0.02) * shade);
    col[i * 4 + 2] = Math.min(255, 255 * (pc[2] - stain * 0.08) * shade);
    col[i * 4 + 3] = 255;
  }
  return { map: dataTex(col, S, true), normal: normalTex(h, S, 3.2) };
}
// Ground: moss and short grass in clumps, a few bare earthy patches.
function grassTextures(S = 512) {
  const clump = periodicField(S, 10, 10, 4, 21);
  const blades = periodicField(S, 96, 96, 2, 22);
  const bare = periodicField(S, 4, 4, 3, 23);
  const h = new Float32Array(S * S), col = new Uint8Array(S * S * 4);
  const dark = [0.16, 0.24, 0.09], light = [0.42, 0.55, 0.18], earth = [0.33, 0.27, 0.18];
  for (let i = 0; i < S * S; i++) {
    const c = clump[i], b = blades[i];
    const e = smooth(0.62, 0.78, bare[i]) * 0.6;
    const t = smooth(0.25, 0.8, c * 0.7 + b * 0.3);
    h[i] = c * 0.6 + b * 0.4;
    for (let k = 0; k < 3; k++) col[i * 4 + k] = 255 * ((dark[k] + (light[k] - dark[k]) * t) * (1 - e) + earth[k] * e) * (0.8 + 0.35 * b);
    col[i * 4 + 3] = 255;
  }
  return { map: dataTex(col, S, true), normal: normalTex(h, S, 2.5) };
}
// Foliage: overlapping small leaves, darker in the gaps — gives the bushes
// their leafy cauliflower texture. Drawn with periodic wrap so it tiles.
function leafTextures(S = 256) {
  const rnd = mulberry32(31);
  const h = new Float32Array(S * S), col = new Float32Array(S * S * 3);
  for (let i = 0; i < S * S; i++) { col[i * 3] = 0.05; col[i * 3 + 1] = 0.09; col[i * 3 + 2] = 0.04; }
  const greens = [[0.22, 0.36, 0.11], [0.30, 0.44, 0.13], [0.17, 0.30, 0.10], [0.38, 0.50, 0.16], [0.26, 0.40, 0.17]];
  for (let n = 0; n < 1400; n++) {
    const cx = rnd() * S, cy = rnd() * S, r = 4 + rnd() * 6, ang = rnd() * Math.PI, el = 0.45 + rnd() * 0.2;
    const g = greens[Math.floor(rnd() * greens.length)], lift = 0.6 + rnd() * 0.4;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const u = (dx * ca + dy * sa) / r, w = (-dx * sa + dy * ca) / (r * el);
      const q = u * u + w * w;
      if (q > 1) continue;
      const x = (Math.floor(cx + dx) + S) % S, y = (Math.floor(cy + dy) + S) % S, i = y * S + x;
      const hh = lift * (1 - q) * 0.8 + 0.2 + n / 1400 * 0.25; // later leaves on top
      if (hh < h[i]) continue;
      h[i] = hh;
      const vein = Math.abs(w) < 0.12 ? 1.18 : 1;
      const sh = (0.7 + 0.4 * (1 - q)) * vein;
      col[i * 3] = g[0] * sh; col[i * 3 + 1] = g[1] * sh; col[i * 3 + 2] = g[2] * sh;
    }
  }
  const c8 = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) { for (let k = 0; k < 3; k++) c8[i * 4 + k] = Math.min(255, col[i * 3 + k] * 255 * (0.55 + 0.6 * h[i])); c8[i * 4 + 3] = 255; }
  return { map: dataTex(c8, S, true), normal: normalTex(h, S, 4) };
}
// Tileable grey noise for falls, clouds and mist breakup.
function noiseTex(S, cells, oct, seed) {
  const f = periodicField(S, cells, cells, oct, seed);
  const d = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = f[i] * 255; d[i * 4 + 3] = 255; }
  return dataTex(d, S, false);
}


// ---- Paramètres ------------------------------------------------------------------
// Every island is a plain object of parameters (its "def"); the editor builds
// its inspector from these schemas. Only values that differ from the defaults
// are saved, so tuning a default later reaches every island that kept it.
// Field: k (key), label, min/max/step (range), type 'color' | 'bool' | 'button',
// gallery: false hides a field on the gallery's own island (its outline is
// fixed by the building).
export const ISLE_SCHEMA = [
  { title: 'Forme', fields: [
    { k: 'radius', label: 'Rayon (m)', min: 2, max: 90, step: 0.5, gallery: false },
    { k: 'depth', label: 'Profondeur sous le bord (m)', min: 4, max: 260, step: 1 },
    { k: 'ellipse', label: 'Allongement', min: 0.4, max: 2.5, step: 0.01, gallery: false },
    { k: 'outline', label: 'Contour irrégulier', min: 0, max: 1, step: 0.01, gallery: false },
    { k: 'taper', label: 'Effilement du dessous', min: 1.1, max: 5, step: 0.05 },
    { k: 'belly', label: 'Ventre (rond ↔ pointu)', min: 0.3, max: 1.6, step: 0.01 },
    { k: 'tipShift', label: 'Décalage de la pointe', min: 0, max: 1, step: 0.01, gallery: false },
    { k: 'pendants', label: 'Blocs pendants', min: 0, max: 3, step: 0.05 },
    { k: 'dome', label: 'Bombement du dessus', min: 0, max: 0.5, step: 0.005, gallery: false },
    { k: 'hills', label: 'Relief du dessus', min: 0, max: 0.5, step: 0.005, gallery: false },
    { k: 'seed', label: 'Graine (forme aléatoire)', min: 1, max: 9999, step: 1, dice: true },
  ] },
  { title: 'Relief des parois', fields: [
    { k: 'buttress', label: 'Contreforts', min: 0, max: 2.5, step: 0.02 },
    { k: 'flutes', label: 'Cannelures verticales', min: 0, max: 3, step: 0.02 },
    { k: 'ledges', label: 'Corniches (strates en relief)', min: 0, max: 4, step: 0.02 },
    { k: 'ledgeSpacing', label: 'Espacement des corniches (m)', min: 1.5, max: 20, step: 0.1 },
    { k: 'columns', label: 'Colonnes du dessous', min: 0, max: 3, step: 0.02 },
    { k: 'detail', label: 'Finesse du maillage', min: 0.4, max: 2, step: 0.05 },
  ] },
  { title: 'Roche', fields: [
    { k: 'strataScale', label: 'Hauteur des strates (m)', min: 6, max: 80, step: 0.5 },
    { k: 'strataTilt', label: 'Inclinaison des strates', min: -0.4, max: 0.4, step: 0.005 },
    { k: 'rockTint', label: 'Teinte de la roche', type: 'color' },
    { k: 'rockBright', label: 'Luminosité', min: 0.3, max: 1.8, step: 0.01 },
    { k: 'relief', label: 'Relief fin (normal map)', min: 0, max: 3, step: 0.05 },
    { k: 'greyFrom', label: 'Début du gris (dessous)', min: 0, max: 1, step: 0.01 },
    { k: 'greyAmount', label: 'Intensité du gris', min: 0, max: 1, step: 0.01 },
    { k: 'moss', label: 'Mousse sur les corniches', min: 0, max: 2, step: 0.02 },
    { k: 'mossRuns', label: 'Coulures de mousse', min: 0, max: 2, step: 0.02 },
  ] },
  { title: 'Végétation', fields: [
    { k: 'jungle', label: 'Densité de la jungle', min: 0, max: 3, step: 0.02 },
    { k: 'bushSize', label: 'Taille des buissons', min: 0.3, max: 3, step: 0.02 },
    { k: 'overhang', label: 'Débord sur le bord', min: 0, max: 3, step: 0.02 },
    { k: 'trees', label: 'Grands arbres (part)', min: 0, max: 0.6, step: 0.005 },
    { k: 'treeSize', label: 'Taille des arbres', min: 0.3, max: 3, step: 0.02 },
    { k: 'leafHue', label: 'Feuillage · teinte', min: 0.1, max: 0.45, step: 0.002 },
    { k: 'leafSat', label: 'Feuillage · saturation', min: 0, max: 1, step: 0.01 },
    { k: 'leafLight', label: 'Feuillage · clarté', min: 0.1, max: 0.8, step: 0.01 },
    { k: 'leafVar', label: 'Feuillage · variation', min: 0, max: 3, step: 0.02 },
    { k: 'cliffClumps', label: 'Touffes sur les parois', min: 0, max: 5, step: 0.05 },
    { k: 'beards', label: 'Barbes de mousse (bord)', min: 0, max: 5, step: 0.05 },
    { k: 'beardLength', label: 'Longueur des barbes', min: 0.2, max: 4, step: 0.05 },
    { k: 'roots', label: 'Racines (dessous)', min: 0, max: 5, step: 0.05 },
    { k: 'rootLength', label: 'Longueur des racines', min: 0.2, max: 4, step: 0.05 },
  ] },
  { title: 'Eau, brume, mouvement', fields: [
    { k: 'fall', label: 'Cascade', type: 'bool' },
    { k: 'fallAngle', label: 'Cascade · direction (°)', min: 0, max: 360, step: 1 },
    { k: 'fallWidth', label: 'Cascade · largeur (m)', min: 0.5, max: 20, step: 0.1 },
    { k: 'fallLength', label: 'Cascade · hauteur (m)', min: 10, max: 300, step: 1 },
    { k: 'mist', label: 'Voiles de brume', min: 0, max: 3, step: 0.05 },
    { k: 'bob', label: 'Flottement (m)', min: 0, max: 4, step: 0.05 },
    { k: 'bobSpeed', label: 'Flottement · vitesse', min: 0.02, max: 1, step: 0.01 },
  ] },
];
export const ISLE_DEFAULTS = {
  name: 'Île', x: 0, y: 0, z: 0, rotY: 0,
  radius: 20, depth: 60, ellipse: 1, outline: 0.5, taper: 2.1, belly: 0.78, tipShift: 0.3, pendants: 1, dome: 0.14, hills: 0.12, seed: 1,
  buttress: 1, flutes: 1, ledges: 1, ledgeSpacing: 6, columns: 1, detail: 1,
  strataScale: 26, strataTilt: 0.05, rockTint: '#ffffff', rockBright: 1, relief: 1, greyFrom: 0.3, greyAmount: 0.85, moss: 1, mossRuns: 1,
  jungle: 1, bushSize: 1, overhang: 1, trees: 0.06, treeSize: 1, leafHue: 0.25, leafSat: 0.32, leafLight: 0.43, leafVar: 1,
  cliffClumps: 1, beards: 1, beardLength: 1, roots: 1, rootLength: 1,
  fall: false, fallAngle: 0, fallWidth: 4, fallLength: 110, mist: 0, bob: 0, bobSpeed: 0.15,
};
export const LINK_SCHEMA = [
  { title: 'Lianes', fields: [
    { k: 'count', label: 'Nombre de lianes', min: 1, max: 12, step: 1 },
    { k: 'sag', label: 'Affaissement', min: 0, max: 0.8, step: 0.01 },
    { k: 'thickness', label: 'Épaisseur (m)', min: 0.04, max: 1, step: 0.01 },
    { k: 'spread', label: 'Écart des ancrages', min: 0, max: 1, step: 0.01 },
    { k: 'anchorDepth', label: 'Profondeur des ancrages', min: 0, max: 0.6, step: 0.01 },
    { k: 'moss', label: 'Touffes de mousse', min: 0, max: 3, step: 0.05 },
    { k: 'strands', label: 'Filaments pendants', min: 0, max: 3, step: 0.05 },
    { k: 'color', label: 'Couleur', type: 'color' },
    { k: 'seed', label: 'Graine', min: 1, max: 9999, step: 1, dice: true },
  ] },
];
export const LINK_DEFAULTS = { a: '', b: '', count: 4, sag: 0.25, thickness: 0.22, spread: 1, anchorDepth: 0.25, moss: 1, strands: 1, color: '#59603c', seed: 1 };
export const ENV_SCHEMA = [
  { title: 'Ciel et nuages', fields: [
    { k: 'cloudCover', label: 'Nuages dans le ciel', min: 0, max: 1, step: 0.01 },
    { k: 'cloudSea', label: 'Mer de nuages', type: 'bool' },
    { k: 'cloudSeaY', label: 'Altitude de la mer de nuages', min: -400, max: -20, step: 1 },
    { k: 'ambSky', label: 'Lumière du ciel (îles)', type: 'color' },
    { k: 'ambGround', label: 'Lumière renvoyée (îles)', type: 'color' },
  ] },
  { title: 'Fragments flottants', fields: [
    { k: 'fragCount', label: 'Nombre', min: 0, max: 200, step: 1 },
    { k: 'fragSize', label: 'Taille', min: 0.2, max: 4, step: 0.05 },
    { k: 'fragSpread', label: 'Étendue (m)', min: 40, max: 400, step: 5 },
    { k: 'fragHeight', label: 'Étendue verticale (m)', min: 10, max: 300, step: 5 },
    { k: 'fragSeed', label: 'Graine', min: 1, max: 9999, step: 1, dice: true },
  ] },
];
export const ENV_DEFAULTS = { cloudCover: 0.5, cloudSea: true, cloudSeaY: -175, ambSky: '#9fb3c9', ambGround: '#6a5a44', fragCount: 34, fragSize: 1, fragSpread: 220, fragHeight: 160, fragSeed: 4242 };

// Only what differs from the defaults (and always the identity fields).
export function compactDef(def, defaults, keep = ['id', 'name', 'kind', 'a', 'b']) {
  const o = {};
  for (const [k, v] of Object.entries(def)) if (keep.includes(k) || defaults[k] !== v) o[k] = v;
  return o;
}

// ---- Kit partagé (textures, matériaux, géométries) -----------------------------
// Built once per page, shared by every world (gallery and island workshop).
let KIT = null;
function getKit(lite) {
  if (KIT) return KIT;
  const time = { value: 0 };
  const detailTex = noiseTex(256, 8, 5, 77);
  const ROCK = rockTextures(lite ? 512 : 1024);
  const GRASS = grassTextures(512);
  const LEAF = leafTextures(256);
  const ambU = { uAmbSky: { value: new THREE.Color('#9fb3c9') }, uAmbGround: { value: new THREE.Color('#6a5a44') } };
  const ambientChunk = (scale = 1) => [
    '{',
    '  vec3 ambN = inverseTransformDirection( normal, viewMatrix );',
    `  outgoingLight += diffuseColor.rgb * mix( uAmbGround, uAmbSky, ambN.y * 0.5 + 0.5 ) * ${scale.toFixed(2)};`,
    '}',
    '#include <opaque_fragment>',
  ].join('\n');
  // Whiteout-blended triplanar normal mapping.
  const TRIPLANAR_NORMAL = [
    '  nX = vec3( nX.xy + wn.zy, abs( nX.z ) * wn.x );',
    '  nY = vec3( nY.xy + wn.xz, abs( nY.z ) * wn.y );',
    '  nZ = vec3( nZ.xy + wn.xy, abs( nZ.z ) * wn.z );',
    '  vec3 wn2 = normalize( nX.zyx * bw.x + nY.xzy * bw.y + nZ.xyz * bw.z );',
    '  normal = normalize( ( viewMatrix * vec4( wn2, 0.0 ) ).xyz );',
  ].join('\n');
  // Rock: one material per island (its own colour / strata uniforms), one
  // shared shader program. Coordinates are the island's own (local) space,
  // so the texture stays put when the island is moved or turned.
  const rockTexU = {
    uRockMap: { value: ROCK.map }, uRockNrm: { value: ROCK.normal },
    uGrassMap: { value: GRASS.map }, uGrassNrm: { value: GRASS.normal }, uDetail: { value: detailTex },
  };
  function makeRockMat() {
    const U = {
      uStrata: { value: new THREE.Vector3(26, 0.05, 1) }, // height, tilt, relief
      uTint: { value: new THREE.Color(1, 1, 1) },
      uGrey: { value: new THREE.Vector2(0.3, 0.85) },
      uMossK: { value: new THREE.Vector2(1, 1) },
    };
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, ambU, rockTexU, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vIsleLP;\nattribute vec2 aIsle;\nvarying vec2 vIsle;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvIsle = aIsle;\nvIsleLP = position;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', [
          '#include <common>',
          'varying vec3 vIsleLP; varying vec2 vIsle;',
          'uniform sampler2D uRockMap, uRockNrm, uGrassMap, uGrassNrm, uDetail;',
          'uniform vec3 uAmbSky, uAmbGround, uStrata, uTint;',
          'uniform vec2 uGrey, uMossK;',
        ].join('\n'))
        .replace('#include <normal_fragment_begin>', [
          '#include <normal_fragment_begin>',
          '{',
          '  vec3 wn = inverseTransformDirection( normal, viewMatrix );',
          '  vec3 bw = pow( abs( wn ), vec3( 5.0 ) ); bw /= bw.x + bw.y + bw.z;',
          '  vec3 p = vIsleLP;',
          '  vec2 uvX = vec2( p.z, p.y + p.z * uStrata.y ) / uStrata.x, uvZ = vec2( p.x, p.y - p.x * uStrata.y ) / uStrata.x, uvY = p.xz / 7.0;',
          '  float macro = texture2D( uDetail, p.xz * 0.004 + p.y * 0.002 ).r;',
          '  vec3 cX = mix( texture2D( uRockMap, uvX ).rgb, texture2D( uRockMap, uvX * 0.31 + 0.17 ).rgb, 0.35 );',
          '  vec3 cZ = mix( texture2D( uRockMap, uvZ ).rgb, texture2D( uRockMap, uvZ * 0.31 + 0.53 ).rgb, 0.35 );',
          '  vec3 cY = texture2D( uGrassMap, uvY ).rgb * mix( 0.8, 1.15, texture2D( uDetail, p.xz * 0.03 ).r );',
          '  vec3 rock = ( cX * bw.x + cZ * bw.z ) / max( bw.x + bw.z, 1e-3 );',
          // Columnar grey underside (photo 3), from uGrey.x down.
          '  float lum = dot( rock, vec3( 0.3, 0.59, 0.11 ) );',
          '  float grey = smoothstep( uGrey.x, uGrey.x + 0.3, vIsle.x ) * uGrey.y;',
          '  rock = mix( rock, vec3( lum ) * vec3( 0.86, 0.87, 0.9 ) * 0.85, grey );',
          '  rock *= uTint * ( 0.8 + 0.4 * macro );',
          '  float n1 = texture2D( uDetail, vec2( ( p.x + p.z ) * 0.05, p.y * 0.006 ) ).r;',
          '  float runs = smoothstep( 0.6, 0.78, n1 ) * ( 1.0 - grey ) * smoothstep( 0.9, 0.3, abs( wn.y ) ) * uMossK.y;',
          '  float ledge = smoothstep( 0.42, 0.78, wn.y + ( texture2D( uDetail, p.xz * 0.11 + p.y * 0.05 ).r - 0.5 ) * 0.8 ) * min( uMossK.x, 1.0 );',
          '  ledge = max( ledge, smoothstep( 0.2, 0.6, wn.y ) * max( uMossK.x - 1.0, 0.0 ) );',
          '  float g = clamp( max( max( ledge, vIsle.y ), runs * 0.9 ), 0.0, 1.0 );',
          '  diffuseColor.rgb *= mix( rock, cY, g );',
          '  vec3 nX = texture2D( uRockNrm, uvX ).xyz * 2.0 - 1.0; nX.xy *= uStrata.z;',
          '  vec3 nZ = texture2D( uRockNrm, uvZ ).xyz * 2.0 - 1.0; nZ.xy *= uStrata.z;',
          '  vec3 nY = texture2D( uGrassNrm, uvY ).xyz * 2.0 - 1.0;',
          TRIPLANAR_NORMAL,
          '}',
        ].join('\n'))
        .replace('#include <opaque_fragment>', ambientChunk(1));
    };
    m.customProgramCacheKey = () => 'inga-isle-rock-v3';
    m.userData.U = U;
    return m;
  }
  // Foliage: lumpy blobs, triplanar leaf texture and leafy normals (world
  // space, so it reads the same at any scale).
  const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 });
  leafMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, ambU, { uLeafMap: { value: LEAF.map }, uLeafNrm: { value: LEAF.normal } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vIsleWP;')
      .replace('#include <project_vertex>', [
        '#include <project_vertex>',
        '{',
        '  vec4 wp = vec4( transformed, 1.0 );',
        '  #ifdef USE_INSTANCING',
        '  wp = instanceMatrix * wp;',
        '  #endif',
        '  vIsleWP = ( modelMatrix * wp ).xyz;',
        '}',
      ].join('\n'));
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vIsleWP;\nuniform sampler2D uLeafMap, uLeafNrm;\nuniform vec3 uAmbSky, uAmbGround;')
      .replace('#include <normal_fragment_begin>', [
        '#include <normal_fragment_begin>',
        '{',
        '  vec3 wn = inverseTransformDirection( normal, viewMatrix );',
        '  vec3 bw = pow( abs( wn ), vec3( 3.0 ) ); bw /= bw.x + bw.y + bw.z;',
        '  vec3 p = vIsleWP / 2.6;',
        '  vec3 c = texture2D( uLeafMap, p.zy ).rgb * bw.x + texture2D( uLeafMap, p.xz ).rgb * bw.y + texture2D( uLeafMap, p.xy ).rgb * bw.z;',
        '  diffuseColor.rgb *= c * 2.4;',
        '  vec3 nX = texture2D( uLeafNrm, p.zy ).xyz * 2.0 - 1.0;',
        '  vec3 nY = texture2D( uLeafNrm, p.xz ).xyz * 2.0 - 1.0;',
        '  vec3 nZ = texture2D( uLeafNrm, p.xy ).xyz * 2.0 - 1.0;',
        TRIPLANAR_NORMAL,
        '}',
      ].join('\n'))
      .replace('#include <opaque_fragment>', ambientChunk(1.15));
  };
  leafMat.customProgramCacheKey = () => 'inga-isle-leaf-v3';
  // Hanging roots and moss beards: thin tapered strands that sway.
  const strandGeo = new THREE.CylinderGeometry(0.06, 0.018, 1, 4, 8, true).translate(0, -0.5, 0);
  strandGeo.deleteAttribute('uv');
  const strandMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, side: THREE.DoubleSide });
  strandMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, ambU, { uTime: time });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        '{',
        '  float ph = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.07 + instanceMatrix[3].y * 0.05;',
        '  float h = -position.y; float k = h * h * 0.035 * length( instanceMatrix[1].xyz );',
        '  transformed.x += sin( uTime * 0.6 + ph ) * k;',
        '  transformed.z += cos( uTime * 0.47 + ph * 1.3 ) * k;',
        '}',
      ].join('\n'));
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uAmbSky, uAmbGround;')
      .replace('#include <opaque_fragment>', ambientChunk(0.9));
  };
  strandMat.customProgramCacheKey = () => 'inga-isle-strand-v3';
  const makeCableMat = (color) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, ambU);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uAmbSky, uAmbGround;')
        .replace('#include <opaque_fragment>', ambientChunk(0.9));
    };
    m.customProgramCacheKey = () => 'inga-isle-cable';
    return m;
  };
  // Falls: ribbons of water thinning into spray.
  const fallMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uNoise: { value: null } }]),
    vertexShader: `
      #include <fog_pars_vertex>
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uTime;
      uniform sampler2D uNoise;
      varying vec2 vUv;
      void main() {
        float fall = vUv.y;
        float n = texture2D( uNoise, vec2( vUv.x * 0.9, fall * 2.2 - uTime * 0.55 ) ).r;
        float n2 = texture2D( uNoise, vec2( vUv.x * 2.3 + 0.3, fall * 5.0 - uTime * 1.1 ) ).r;
        float edge = smoothstep( 0.0, 0.25, vUv.x ) * smoothstep( 1.0, 0.75, vUv.x );
        float a = smoothstep( 0.3, 0.75, n * 0.6 + n2 * 0.5 ) * edge;
        a *= smoothstep( 0.0, 0.04, fall ) * ( 1.0 - smoothstep( 0.35, 1.0, fall ) );
        a = max( a, edge * 0.35 * smoothstep( 0.25, 0.9, fall ) * ( 1.0 - smoothstep( 0.7, 1.0, fall ) ) * n );
        gl_FragColor = vec4( vec3( 0.93, 0.96, 0.98 ), a * 0.88 );
        #include <fog_fragment>
      }`,
  });
  fallMat.uniforms.uTime = time;
  fallMat.uniforms.uNoise.value = detailTex;
  // Mist veil texture.
  const mistTex = (() => {
    const s = 128;
    const f = periodicField(s, 6, 6, 4, 31);
    const d = new Uint8Array(s * s * 4);
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
      const u = i / s - 0.5, v = j / s - 0.5;
      const r = Math.hypot(u, v * 1.7) * 2;
      const a = Math.max(0, 1 - r) ** 1.6 * (0.45 + 0.9 * f[j * s + i]);
      const k = (j * s + i) * 4;
      d[k] = d[k + 1] = d[k + 2] = 255;
      d[k + 3] = Math.max(0, Math.min(255, a * 255));
    }
    const t = new THREE.DataTexture(d, s, s);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  })();
  const bush = bushGeometry(1, 5), nearBush = bushGeometry(1, 3), tree = treeGeometry(1, 5, 8);
  KIT = { time, detailTex, ambU, makeRockMat, leafMat, strandGeo, strandMat, makeCableMat, fallMat, mistTex, bush, nearBush, tree };
  return KIT;
}

// ---- Végétation : géométries ----
// A bush is a small cluster of lumpy blobs (cauliflower); a tree is a thin
// trunk under a cluster. Vertex colour: dark inside and below, light on top.
function blob(detail, seed, sx, sy, ox, oy, oz) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const l = 1 + 0.22 * N1(x * 1.7 + seed, y * 1.7, z * 1.7) + 0.12 * N2(x * 3.6, y * 3.6 + seed, z * 3.6);
    p.setXYZ(i, ox + x * sx * l, oy + y * sy * l * (y < 0 ? 0.55 : 1), oz + z * sx * l);
  }
  g.computeVertexNormals();
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const v = 0.45 + 0.6 * smooth(oy - sy * 0.6, oy + sy, p.getY(i));
    c[i * 3] = v; c[i * 3 + 1] = v; c[i * 3 + 2] = v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
function bushGeometry(detail, seed) {
  const rnd = mulberry32(seed);
  const parts = [blob(detail, seed, 0.55, 0.42, 0, 0.32, 0)];
  for (let b = 0; b < 2; b++) {
    const a = rnd() * 6.28;
    parts.push(blob(detail, seed + b + 1, 0.36, 0.3, Math.cos(a) * 0.32, 0.28 + rnd() * 0.15, Math.sin(a) * 0.32));
  }
  const g = mergeGeometries(parts);
  g.computeBoundingSphere();
  return g;
}
function treeGeometry(detail, blobs, seed) {
  const rnd = mulberry32(seed);
  const t = new THREE.CylinderGeometry(0.02, 0.045, 0.72, 6, 1).translate(0, 0.36, 0);
  t.deleteAttribute('uv');
  t.setAttribute('color', new THREE.BufferAttribute(new Float32Array(t.attributes.position.count * 3).fill(0.28), 3));
  const parts = [t];
  for (let b = 0; b < blobs; b++) {
    const a = rnd() * 6.28, r = b === 0 ? 0 : 0.12 + rnd() * 0.18;
    parts.push(blob(detail, seed * 3 + b, 0.2 + rnd() * 0.12, 0.13 + rnd() * 0.06, Math.cos(a) * r, 0.74 + rnd() * 0.14 - r * 0.2, Math.sin(a) * r));
  }
  const g = mergeGeometries(parts);
  g.computeBoundingSphere();
  return g;
}

// ---- Générateur d'une île ----
// Polar grid: a centre vertex, cap rings out to the rim, side rows down the
// cliff to a pendant tip. Indexed and closed (the seam wraps), so normals are
// smooth everywhere. P = the island's parameters (see ISLE_SCHEMA).
// opt: cx, cz, y (rim height), R(θ) rim radius, Rmean, cap(x, z, s), tip,
//      seg, rings, rows, dispMul(θ, t).
export function islandGeometry(opt, P) {
  const { cx, cz, y: rimY, R, cap, seg, rings, rows } = opt;
  const H = P.depth;
  const tip = opt.tip || [0, 0];
  const sd = P.seed * 13.7;
  const sz = opt.Rmean / 30; // scale of the features
  const verts = 1 + rings * seg + rows * seg + 1;
  const pos = new Float32Array(verts * 3);
  const tArr = new Float32Array(verts);
  const capArr = new Uint8Array(verts);
  const ang = Array.from({ length: seg }, (_, i) => (i / seg) * Math.PI * 2);
  const rimR = ang.map((a) => R(a));
  const mul = opt.dispMul || (() => 1);
  const lsp = P.ledgeSpacing * Math.max(0.35, Math.min(1.6, sz));
  // Horizontal (outward) displacement: buttresses, vertical fluting, strata
  // ledges and, lower down, sharp vertical columns.
  const dispRaw = (x, y, z, t) => {
    const f = 0.075 / sz, g = 0.018 / sz;
    const flutes = fbm(N1, x * f + sd, y * f * 0.16, z * f, 4) + 0.45 * (ridged(N3, x * f * 2.6, y * f * 0.25 + sd, z * f * 2.6, 2) - 0.6);
    const bulge = fbm(N2, x * g, y * g * 0.7 + sd, z * g, 3);
    const ph = ((y / lsp + 0.5 * N3(x * 0.04, sd, z * 0.04)) % 1 + 1) % 1;
    const strata = smooth(0.7, 0.95, ph) - 0.35 * smooth(0, 0.3, ph) * (1 - t);
    const cols = t > 0.25 ? Math.pow(ridged(N2, x * f * 3.4 + sd, y * f * 0.03, z * f * 3.4, 1), 3) * smooth(0.25, 0.6, t) : 0;
    return (flutes * 3.6 * P.flutes + bulge * 9 * P.buttress + strata * 0.8 * P.ledges * (1 - 0.6 * t) + cols * 4.5 * P.columns) * sz * (1 + 1.2 * t * t);
  };
  const disp = (x, y, z, t, a) => mul(a, t) * dispRaw(x, y, z, t);
  const prof = (t) => Math.pow(Math.max(0, 1 - Math.pow(t, P.taper)), P.belly);
  let k = 0;
  const put = (x, y, z, t, c) => { pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z; tArr[k] = t; capArr[k] = c; k++; };
  put(cx, rimY + cap(cx, cz, 0), cz, 0, 1);
  for (let r = 1; r <= rings; r++) {
    const s = r / rings;
    const w = smooth(0.8, 1, s);
    for (let i = 0; i < seg; i++) {
      const c = Math.cos(ang[i]), sn = Math.sin(ang[i]);
      let x = cx + c * rimR[i] * s, z = cz + sn * rimR[i] * s;
      const y = rimY + cap(x, z, s);
      const dd = w * disp(x, rimY, z, 0, ang[i]) - w * w * 0.6 * sz * mul(ang[i], 0);
      x += c * dd; z += sn * dd;
      put(x, y, z, 0, s < 0.97 ? 1 : 0);
    }
  }
  for (let j = 1; j <= rows; j++) {
    const t = j / (rows + 1);
    const tt = t * t;
    for (let i = 0; i < seg; i++) {
      const c = Math.cos(ang[i]), sn = Math.sin(ang[i]);
      const r0 = rimR[i] * prof(t);
      let x = cx + c * r0 + tip[0] * tt, z = cz + sn * r0 + tip[1] * tt;
      let y = rimY - t * H;
      y -= tt * t * H * 0.35 * P.pendants * Math.max(0, ridged(N2, (x - cx) * 0.05 / sz, sd, (z - cz) * 0.05 / sz) - 0.45);
      const dd = Math.max(-r0 + 0.4 * sz, disp(x, y, z, t, ang[i]));
      x += c * dd; z += sn * dd;
      put(x, y, z, t, 0);
    }
  }
  put(cx + tip[0], rimY - H * 1.12, cz + tip[1], 1, 0);
  const idx = [];
  for (let i = 0; i < seg; i++) idx.push(0, 1 + ((i + 1) % seg), 1 + i);
  const ringStart = (r) => 1 + (r - 1) * seg;
  for (let r = 1; r < rings + rows; r++) {
    const a0 = ringStart(r), b0 = ringStart(r + 1);
    for (let i = 0; i < seg; i++) {
      const i1 = (i + 1) % seg;
      idx.push(a0 + i, a0 + i1, b0 + i, a0 + i1, b0 + i1, b0 + i);
    }
  }
  const last = verts - 1, l0 = ringStart(rings + rows);
  for (let i = 0; i < seg; i++) idx.push(l0 + i, l0 + ((i + 1) % seg), last);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Vertex colour = large-scale light (runoff streaks, darker belly);
  // aIsle = (depth down the side with noise, cap) for the shader.
  const col = new Float32Array(verts * 3);
  const isle = new Float32Array(verts * 2);
  for (let v = 0; v < verts; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2], t = tArr[v];
    const streak = smooth(0.15, 0.55, fbm(N1, x * 0.11 / sz, y * 0.006 + sd, z * 0.11 / sz, 3)) * (0.3 + 0.7 * Math.exp(-t * 3));
    const b = (0.92 + 0.2 * fbm(N3, x * 0.02, y * 0.02, z * 0.02, 3)) * (1 - 0.35 * streak) * (1 - 0.3 * smooth(0.4, 1, t));
    col[v * 3] = b; col[v * 3 + 1] = b; col[v * 3 + 2] = b;
    isle[v * 2] = t + 0.12 * N2(x * 0.03, y * 0.03, z * 0.03);
    isle[v * 2 + 1] = capArr[v];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aIsle', new THREE.BufferAttribute(isle, 2));
  geo.userData = { tArr, rimY, cx, cz, seg, rings, rows, rimR };
  geo.computeBoundingSphere();
  return geo;
}

// ---- Monde d'îles ------------------------------------------------------------------
// doc = { islands: [def…], links: [def…], env: {…} }. Each island lives in its
// own group (position / turn applied to the group, so moving never rebuilds);
// parameter changes rebuild just that island and its lianas.
// gallery (optional): the building's footprint; the island of kind 'gallery'
// is shaped around it and stays put.
export function createSkyIsles({ lite = false, sunDir, gallery = null, doc = null, lodCenter = true }) {
  const kit = getKit(lite);
  const root = new THREE.Group();
  root.name = 'îles flottantes';
  const items = new Map(); // id → { def, group, rock, mats, bob }
  const links = new Map(); // id → { def, group }
  let env = { ...ENV_DEFAULTS };
  const G = gallery;

  // ---- L'île de la galerie : contour et sol ----
  const outside = (x, z) => {
    let d = Infinity;
    for (const [x0, x1, z0, z1] of G.rects) {
      const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
      d = Math.min(d, Math.hypot(dx, dz));
    }
    return d;
  };
  const GI = G ? { cx: 0, cz: G.northEdge - 26, ax: 41, az: 26, y: G.bedY } : null;
  const galleryR = (a) => {
    const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    const r = Math.pow(Math.pow(c / GI.ax, 4) + Math.pow(s / GI.az, 4), -0.25);
    const north = Math.sin(a) > 0 ? smooth(0.55, 0.85, Math.sin(a)) : 0;
    const rough = (0.5 + 0.5 * N2(Math.cos(a) * 3.1, 7, Math.sin(a) * 3.1)) * 5 * (1 - north) + north * 0.3 * (0.5 + 0.5 * N1(a * 9, 1, 2));
    return r + rough;
  };
  const galleryCapH = (x, z) => {
    const d = outside(x, z);
    if (d <= 0) return 0;
    const hills = 0.6 + 3.2 * (0.5 + 0.5 * fbm(N1, x * 0.035, 3.3, z * 0.035, 4));
    return smooth(0.8, 16, d) * hills * (1 - 0.75 * smooth(G.northEdge - 18, G.northEdge - 2, z));
  };
  function groundAt(x, z) {
    if (!GI) return null;
    const r = Math.hypot(x - GI.cx, z - GI.cz);
    const rr = galleryR(Math.atan2(z - GI.cz, x - GI.cx));
    if (r > rr) return null;
    return GI.y + galleryCapH(x, z) * (1 - smooth(0.82, 1, r / rr));
  }

  // Rim radius of an ordinary island (local frame, before the group's turn).
  const rimFn = (P) => {
    const ph = (P.seed * 0.618) % 10;
    return (a) => {
      const c = Math.cos(a), s = Math.sin(a);
      const base = P.radius / Math.sqrt(c * c * P.ellipse + (s * s) / P.ellipse);
      const n = 0.5 + 0.5 * fbm(N2, Math.cos(a) * 1.6 + ph, P.seed, Math.sin(a) * 1.6, 3);
      return base * (1 - 0.18 * P.outline + 0.6 * P.outline * n * 0.6);
    };
  };

  // ---- Construction d'une île ----
  function buildIsland(def) {
    const P = { ...ISLE_DEFAULTS, ...def };
    const isGallery = P.kind === 'gallery';
    const group = new THREE.Group();
    group.name = P.name;
    const rnd = mulberry32(P.seed * 7919 + 13);
    const mat = kit.makeRockMat();
    applyRockUniforms(mat, P);
    let geo, Rof, Rm;
    const dist = lodCenter ? Math.hypot(P.x, P.z) : 60;
    const fine = Math.max(0.35, Math.min(1, 140 / Math.max(1, dist))) * (lite ? 0.8 : 1) * P.detail;
    if (isGallery) {
      Rm = 40; Rof = galleryR;
      geo = islandGeometry({
        cx: GI.cx, cz: GI.cz, y: GI.y, R: galleryR, Rmean: 32,
        cap: (x, z, s) => galleryCapH(x, z) * (1 - smooth(0.82, 1, s)),
        // Straight, quiet cliff right under the terrace; ragged further down.
        dispMul: (a, t) => { const n = Math.sin(a) > 0 ? smooth(0.5, 0.85, Math.sin(a)) : 0; return 1 - n * (1 - 0.12 - 0.88 * smooth(0.04, 0.35, t)); },
        tip: [7, -12], seg: Math.round((lite ? 220 : 320) * P.detail), rings: Math.round((lite ? 30 : 44) * P.detail), rows: Math.round((lite ? 70 : 96) * P.detail),
      }, P);
    } else {
      Rm = P.radius; Rof = rimFn(P);
      const seg = Math.round(Math.max(24, Math.min(260, Rm * 4.4 * fine + 16)));
      const ta = rnd() * Math.PI * 2;
      geo = islandGeometry({
        cx: 0, cz: 0, y: 0, R: Rof, Rmean: Rm,
        cap: (px, pz, s) => Rm * (P.dome + P.hills * fbm(N1, px * 0.04 + P.seed, 1, pz * 0.04, 3)) * (1 - s * s) + Rm * 0.3 * P.hills * fbm(N3, px * 0.2, P.seed, pz * 0.2, 2) * (1 - s),
        tip: [Math.cos(ta) * Rm * 0.6 * P.tipShift, Math.sin(ta) * Rm * 0.6 * P.tipShift],
        seg, rings: Math.max(4, Math.round(seg / 9)), rows: Math.round(Math.max(12, Math.min(140, P.depth * 0.8 * fine))),
      }, P);
      group.position.set(P.x, P.y, P.z);
      group.rotation.y = P.rotY;
    }
    const rock = new THREE.Mesh(geo, mat);
    rock.receiveShadow = isGallery;
    rock.userData.ed = { kind: 'island', id: P.id };
    group.add(rock);
    const farK = isGallery || !lodCenter ? 1 : 1 + Math.max(0, dist - 120) / 220;
    buildVegetation(group, rock, P, { isGallery, Rof, Rm, farK, rnd });
    if (P.fall) addFall(group, rock, P);
    if (P.mist > 0) addMist(group, P, Rm, rnd);
    return { group, rock, mat, P, Rof, Rm };
  }
  function applyRockUniforms(mat, P) {
    const U = mat.userData.U;
    U.uStrata.value.set(P.strataScale, P.strataTilt, P.relief);
    U.uTint.value.set(P.rockTint).multiplyScalar(P.rockBright);
    U.uGrey.value.set(P.greyFrom, P.greyAmount);
    U.uMossK.value.set(P.moss, P.mossRuns);
  }

  // ---- Végétation d'une île ----
  const M = new THREE.Matrix4(), Qn = new THREE.Quaternion(), S = new THREE.Vector3(), Pv = new THREE.Vector3(), E = new THREE.Euler();
  const hue = new THREE.Color();
  function buildVegetation(group, rock, P, { isGallery, Rof, Rm, farK, rnd }) {
    const g = rock.geometry, ud = g.userData;
    const pos = g.attributes.position, nor = g.attributes.normal;
    const bushes = [], near = [], trees = [], strands = [];
    const leafTint = (b = 1) => hue.setHSL(P.leafHue + (rnd() - 0.5) * 0.1 * P.leafVar, Math.min(1, P.leafSat + (rnd() - 0.4) * 0.2 * P.leafVar), P.leafLight + (rnd() - 0.4) * 0.14 * P.leafVar).multiplyScalar(b * 1.25).clone();
    const push = (list, x, y, z, h, w, tint, tilt = 0.12) => {
      E.set((rnd() - 0.5) * tilt, rnd() * 6.28, (rnd() - 0.5) * tilt);
      M.compose(Pv.set(x, y, z), Qn.setFromEuler(E), S.set(w, h, w));
      list.push([M.clone(), tint]);
    };
    const scale = isGallery ? 1 : Math.max(0.5, Math.min(1.5, Rm / 40 * 1.4));
    const tmpN = new THREE.Vector3();
    // Jungle over the top, on a jittered grid, with a few emergent trees.
    if (P.jungle > 0.01) {
      const sp = (isGallery ? 3.2 : Math.max(2.4, Rm * 0.15) * farK) * (lite ? 1.1 : 1) / Math.sqrt(P.jungle);
      for (let gx = -Rm * 1.4; gx <= Rm * 1.4; gx += sp) {
        for (let gz = -Rm * 1.4; gz <= Rm * 1.4; gz += sp) {
          const x = ud.cx + gx + (rnd() - 0.5) * sp, z = ud.cz + gz + (rnd() - 0.5) * sp;
          const a = Math.atan2(z - ud.cz, x - ud.cx);
          const s = Math.hypot(x - ud.cx, z - ud.cz) / Rof(a);
          if (s > 0.97) continue;
          if (isGallery) {
            const d = outside(x, z);
            if (d < 1.6) continue;
            const y = groundAt(x, z);
            if (y == null) continue;
            const tall = d > 4 && rnd() < P.trees * 3;
            const h = tall ? (5 + rnd() * 6) * P.treeSize : (1.2 + rnd() * 2.2) * Math.min(1, 0.45 + d * 0.12) * P.bushSize;
            if (tall) push(trees, x, y - 0.1, z, h, h * (0.9 + rnd() * 0.5), leafTint());
            else push(near, x, y - 0.2, z, h, h * (1.3 + rnd() * 0.7), leafTint());
            continue;
          }
          const ring = Math.max(1, Math.min(ud.rings, Math.round(s * ud.rings)));
          const vi = 1 + (ring - 1) * ud.seg + ((Math.round((a / (Math.PI * 2)) * ud.seg) % ud.seg) + ud.seg) % ud.seg;
          const y = pos.getY(vi);
          if (rnd() < P.trees) {
            const h = (6 + rnd() * 8) * Math.min(1.3, scale) * Math.sqrt(farK) * P.treeSize;
            push(trees, x, y - 0.3, z, h, h * (0.9 + rnd() * 0.6), leafTint());
          }
          const h = sp * (0.9 + rnd() * 0.8) * P.bushSize * Math.sqrt(P.jungle);
          push(bushes, x, y - h * 0.15, z, h, sp * (1.2 + rnd() * 0.6) * P.bushSize * Math.sqrt(P.jungle), leafTint());
        }
      }
      // Overhang: bushes on the rim, pushed out and down so the jungle spills.
      if (P.overhang > 0.01) {
        const step = Math.max(1, Math.round(ud.seg / (Rm * 2 * Math.PI / (sp * 1.1) * Math.min(2, P.overhang))));
        const rimStart = 1 + (ud.rings - 1) * ud.seg;
        for (let i = 0; i < ud.seg; i += step) {
          const v = rimStart + i;
          const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
          if (isGallery && (outside(x, z) < 2 || (z > G.northEdge - 4 && Math.abs(x) < G.terraceHalfW + 3))) continue;
          tmpN.set(x - ud.cx, 0, z - ud.cz).normalize();
          const h = sp * (0.9 + rnd() * 0.7) * P.bushSize;
          const out = 0.25 * P.overhang;
          push(isGallery ? near : bushes, x + tmpN.x * h * out, y - h * 0.35 * Math.min(1.5, P.overhang), z + tmpN.z * h * out, h, sp * (1.3 + rnd() * 0.6) * P.bushSize, leafTint(0.95), 0.5);
        }
      }
    }
    // Cliffs: clumps on ledges; rim and belly: moss beards and roots.
    const n0 = 1 + ud.rings * ud.seg;
    const sideCount = pos.count - n0;
    const clumps = Math.round(sideCount * (isGallery ? 0.02 : 0.012 / farK) * (lite ? 0.75 : 1) * P.cliffClumps);
    for (let n = 0; n < clumps; n++) {
      const v = n0 + Math.floor(rnd() * sideCount);
      const t = ud.tArr[v];
      if (t > 0.55 || nor.getY(v) < 0.05) continue;
      tmpN.set(nor.getX(v), 0, nor.getZ(v)).normalize();
      const h = (1.2 + rnd() * 2.5) * scale * P.bushSize;
      push(bushes, pos.getX(v) + tmpN.x * 0.3, pos.getY(v) - h * 0.3, pos.getZ(v) + tmpN.z * 0.3, h, h * 1.4, leafTint(0.85), 0.4);
    }
    const mossC = new THREE.Color('#5d7a33'), rootC = new THREE.Color('#5a4c38');
    const tries = Math.round(sideCount * (isGallery ? 0.03 : 0.025 / farK) * (lite ? 0.75 : 1) * Math.max(P.beards, P.roots));
    for (let n = 0; n < tries; n++) {
      const v = n0 + Math.floor(rnd() * sideCount);
      const t = ud.tArr[v];
      const ny = nor.getY(v);
      const rim = t < 0.06;
      if (!rim && ny > -0.15) continue;
      const isBeard = rim || t < 0.35;
      if (rnd() * Math.max(P.beards, P.roots) > (isBeard ? P.beards : P.roots)) continue;
      if (isGallery && pos.getZ(v) > G.northEdge - 3 && Math.abs(pos.getX(v)) < G.terraceHalfW + 2 && pos.getY(v) > GI.y - 6) continue; // terrace view stays clear
      const L = (rim ? 2 + rnd() * 9 : 2 + Math.pow(rnd(), 1.5) * 18) * Math.max(0.6, scale) * (isBeard ? P.beardLength : P.rootLength);
      const w = (0.8 + rnd() * 1.4) * (isGallery ? 1 : 1.5);
      M.compose(Pv.set(pos.getX(v), pos.getY(v) + 0.3, pos.getZ(v)), Qn.identity(), S.set(w, L, w));
      strands.push([M.clone(), (isBeard ? mossC : rootC).clone().multiplyScalar(0.8 + rnd() * 0.5)]);
    }
    instGroup(group, kit.nearBush, kit.leafMat, near, true);
    instGroup(group, kit.bush, kit.leafMat, bushes, false);
    instGroup(group, kit.tree, kit.leafMat, trees, false);
    instGroup(group, kit.strandGeo, kit.strandMat, strands, false);
  }
  function instGroup(parent, geo, mat, list, shadow) {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach(([m, tint], i) => { im.setMatrixAt(i, m); im.setColorAt(i, tint); });
    im.castShadow = shadow;
    im.receiveShadow = shadow;
    im.computeBoundingSphere();
    parent.add(im);
    return im;
  }
  function addFall(group, rock, P) {
    const ud = rock.geometry.userData, pos = rock.geometry.attributes.position;
    const angle = ((P.fallAngle * Math.PI / 180) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    const i = Math.round((angle / (Math.PI * 2)) * ud.seg) % ud.seg;
    const v = 1 + (ud.rings - 1) * ud.seg + i;
    const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
    const len = P.fallLength, wid = P.fallWidth;
    const g = new THREE.PlaneGeometry(wid, len, 1, 24);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const f = (len / 2 - p.getY(k)) / len;
      p.setXYZ(k, p.getX(k) * (1 + f * 1.8), -f * len, 1.5 + Math.sqrt(f) * len * 0.09);
    }
    g.computeBoundingSphere();
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setY(k, 1 - uv.getY(k));
    const mesh = new THREE.Mesh(g, kit.fallMat);
    mesh.position.set(x, y + 0.4, z);
    mesh.rotation.y = Math.atan2(Math.cos(angle), Math.sin(angle));
    mesh.renderOrder = 3;
    group.add(mesh);
  }
  function addMist(group, P, Rm, rnd) {
    const n = Math.round(2 + P.mist * 3);
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2;
      const w = Rm * (2 + rnd() * 2.5);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: kit.mistTex, color: '#f1f3f4', transparent: true, opacity: Math.min(0.8, (0.18 + rnd() * 0.22) * P.mist), depthWrite: false, fog: true }));
      sp.position.set(Math.cos(a) * Rm * 0.9, -P.depth * (0.05 + rnd() * 0.6), Math.sin(a) * Rm * 0.9);
      sp.scale.set(w, w * 0.3, 1);
      sp.renderOrder = 2;
      sp.userData.mist = { base: sp.position.clone(), ph: rnd() * 6.28, sp: 0.03 + rnd() * 0.05 };
      group.add(sp);
    }
  }
  function disposeGroup(g) {
    g.traverse((o) => {
      if (o.isSprite) o.material.dispose();
      if (o.isMesh && !o.isInstancedMesh && o.geometry && !sharedGeo.has(o.geometry)) o.geometry.dispose();
      if (o.isInstancedMesh) o.dispose();
    });
    const rockMesh = g.children.find((c) => c.userData.ed);
    if (rockMesh) rockMesh.material.dispose();
  }
  const sharedGeo = new Set([kit.bush, kit.nearBush, kit.tree, kit.strandGeo]);

  // ---- Lianes entre deux îles ----
  // Anchors are picked on the facing sides near the top of each island; each
  // cable is a tube along a sagging curve, dressed with moss and strands.
  const _wp = new THREE.Vector3();
  function anchorPoints(it, toward, n, L, rnd) {
    const g = it.rock.geometry, ud = g.userData, pos = g.attributes.position;
    it.group.updateMatrixWorld(true);
    const n0 = 1 + ud.rings * ud.seg;
    const r0 = Math.round(ud.rows * L.anchorDepth * 0.6), r1 = Math.max(r0 + 1, Math.round(ud.rows * (L.anchorDepth * 0.6 + 0.25)));
    const cand = [];
    const thr = 1 - 0.14 * (0.3 + L.spread);
    const cx = it.group.matrixWorld.elements[12], cz = it.group.matrixWorld.elements[14];
    for (let j = r0; j < r1; j++) for (let i = 0; i < ud.seg; i++) {
      const v = n0 + j * ud.seg + i;
      _wp.set(pos.getX(v), pos.getY(v), pos.getZ(v)).applyMatrix4(it.rock.matrixWorld);
      _wp.y -= it.bobY || 0;
      const dx = _wp.x - cx, dz = _wp.z - cz, l = Math.hypot(dx, dz) || 1;
      if ((dx * toward.x + dz * toward.z) / l > thr) cand.push(_wp.clone());
    }
    const out = [];
    for (let k = 0; k < n && cand.length; k++) out.push(cand[Math.floor(rnd() * cand.length)]);
    return out;
  }
  function buildLink(def) {
    const L = { ...LINK_DEFAULTS, ...def };
    const A = items.get(L.a), B = items.get(L.b);
    const group = new THREE.Group();
    group.name = 'Liane';
    if (!A || !B || A === B) return { group, L };
    const rnd = mulberry32(L.seed * 977 + 5);
    root.updateMatrixWorld(true);
    const ca = new THREE.Vector3().setFromMatrixPosition(A.group.matrixWorld);
    const cb = new THREE.Vector3().setFromMatrixPosition(B.group.matrixWorld);
    if (A.P.kind === 'gallery') ca.set(GI.cx, GI.y, GI.cz);
    if (B.P.kind === 'gallery') cb.set(GI.cx, GI.y, GI.cz);
    const dir = new THREE.Vector3(cb.x - ca.x, 0, cb.z - ca.z).normalize();
    const pa = anchorPoints(A, dir, L.count, L, rnd), pb = anchorPoints(B, dir.clone().negate(), L.count, L, rnd);
    const tubes = [], bush = [], strands = [];
    for (let k = 0; k < Math.min(pa.length, pb.length); k++) {
      const a = pa[k], b = pb[k];
      if (G && A.P.kind === 'gallery' && a.z > G.northEdge - 4 && Math.abs(a.x) < G.terraceHalfW + 3) continue;
      const span = a.distanceTo(b);
      const sag = span * L.sag * (0.6 + rnd() * 0.8);
      const pts = [];
      for (let s = 0; s <= 20; s++) {
        const u = s / 20;
        const p = a.clone().lerp(b, u);
        p.y -= sag * 4 * u * (1 - u) * (1 + 0.15 * Math.sin(u * 9 + k));
        pts.push(p);
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const r = L.thickness * (0.7 + rnd() * 0.6);
      tubes.push(new THREE.TubeGeometry(curve, 40, r, 5, false));
      const tufts = Math.round(span / 2.2);
      for (let q = 0; q < tufts; q++) {
        const u = 0.04 + rnd() * 0.92, p = curve.getPoint(u);
        if (rnd() < 0.55 * L.moss) {
          E.set(rnd(), rnd() * 6.28, rnd());
          M.compose(Pv.set(p.x, p.y - r, p.z), Qn.setFromEuler(E), S.setScalar(0.5 + rnd() * 0.8 * Math.max(0.5, L.moss)));
          bush.push([M.clone(), hue.setHSL(0.25 + (rnd() - 0.5) * 0.08, 0.32, 0.4).multiplyScalar(1.15).clone()]);
        }
        if (rnd() < L.strands) {
          const len = 0.5 + Math.pow(rnd(), 1.6) * 5;
          M.compose(Pv.set(p.x, p.y, p.z), Qn.identity(), S.set(0.7, len, 0.7));
          strands.push([M.clone(), new THREE.Color('#5d7a33').multiplyScalar(0.8 + rnd() * 0.4)]);
        }
      }
    }
    if (tubes.length) {
      const cm = new THREE.Mesh(mergeGeometries(tubes), kit.makeCableMat(L.color));
      cm.userData.ed = { kind: 'link', id: L.id };
      group.add(cm);
    }
    instGroup(group, kit.bush, kit.leafMat, bush, false);
    instGroup(group, kit.strandGeo, kit.strandMat, strands, false);
    return { group, L };
  }

  // ---- Fragments ----
  let fragMesh = null;
  function buildFragments() {
    if (fragMesh) { root.remove(fragMesh); fragMesh.geometry.dispose(); fragMesh.material.dispose(); fragMesh = null; }
    if (env.fragCount < 1) return;
    const rnd = mulberry32(env.fragSeed);
    const geos = [];
    const isl = [...items.values()].map((it) => ({ x: it.P.x, y: it.P.y, z: it.P.z, R: it.Rm, H: it.P.depth }));
    for (let n = 0, tries = 0; n < env.fragCount && tries < env.fragCount * 60; tries++) {
      const a = rnd() * Math.PI * 2, d = 60 + Math.pow(rnd(), 0.8) * env.fragSpread;
      const x = Math.cos(a) * d, z = Math.sin(a) * d * (rnd() < 0.6 ? 1 : -1) + 30, y = -env.fragHeight / 2 + rnd() * env.fragHeight;
      const Rm = (1 + Math.pow(rnd(), 2) * 3.5) * env.fragSize;
      if (isl.some((I) => Math.hypot(x - I.x, z - I.z) < I.R * 1.2 + Rm + 6 && y < I.y + 12 && y > I.y - I.H * 1.15 - 8)) continue;
      const ph = rnd() * 9;
      const P = { ...ISLE_DEFAULTS, depth: Rm * (1.4 + rnd() * 2), seed: 100 + n };
      geos.push(islandGeometry({
        cx: x, cz: z, y, Rmean: Rm,
        R: (aa) => Rm * (0.75 + 0.4 * (0.5 + 0.5 * N2(Math.cos(aa) * 1.4 + ph, P.seed, Math.sin(aa) * 1.4))),
        cap: (px, pz, s) => Rm * 0.22 * (1 - s * s),
        tip: [(rnd() - 0.5) * Rm, (rnd() - 0.5) * Rm], seg: 18, rings: 3, rows: 9,
      }, P));
      n++;
    }
    if (!geos.length) return;
    const mat = kit.makeRockMat();
    applyRockUniforms(mat, ISLE_DEFAULTS);
    fragMesh = new THREE.Mesh(mergeGeometries(geos), mat);
    fragMesh.userData.ed = { kind: 'env', id: 'env' };
    root.add(fragMesh);
  }

  // ---- Ciel nuageux et mer de nuages ----
  const cloudDomeMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.BackSide,
    uniforms: { uTime: kit.time, uNoise: { value: kit.detailTex }, uSun: { value: sunDir.clone().normalize() }, uCover: { value: 0.5 } },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: `
      uniform float uTime, uCover;
      uniform sampler2D uNoise;
      uniform vec3 uSun;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize( vDir );
        if ( d.y < 0.0 ) discard;
        vec2 uv = d.xz / ( d.y + 0.12 );
        float n = texture2D( uNoise, uv * 0.11 + vec2( uTime * 0.0015, 0.0 ) ).r * 0.6
                + texture2D( uNoise, uv * 0.31 - vec2( 0.0, uTime * 0.002 ) ).r * 0.3
                + texture2D( uNoise, uv * 0.9 + uTime * 0.003 ).r * 0.1;
        float th = mix( 0.78, 0.3, uCover );
        float cover = smoothstep( th, th + 0.26, n );
        float lit = 0.82 + 0.25 * smoothstep( 0.5, 0.85, n );
        float sun = pow( max( 0.0, dot( d, uSun ) ), 8.0 );
        vec3 col = vec3( 0.97, 0.97, 0.98 ) * lit + vec3( 0.3, 0.2, 0.08 ) * sun;
        gl_FragColor = vec4( col, cover * smoothstep( 0.02, 0.22, d.y ) * 0.92 );
      }`,
  });
  const cloudDome = new THREE.Mesh(new THREE.SphereGeometry(395, 40, 16), cloudDomeMat);
  cloudDome.renderOrder = -8;
  cloudDome.frustumCulled = false;
  root.add(cloudDome);
  const cloudMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uNoise: { value: null } }]),
    vertexShader: `
      #include <fog_pars_vertex>
      varying vec3 vWP;
      void main() {
        vec4 wp = modelMatrix * vec4( position, 1.0 );
        vWP = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uTime;
      uniform sampler2D uNoise;
      varying vec3 vWP;
      void main() {
        vec2 p = vWP.xz;
        float a = texture2D( uNoise, p * 0.0016 + vec2( uTime * 0.0012, 0.0 ) ).r;
        float b = texture2D( uNoise, p * 0.0047 - vec2( 0.0, uTime * 0.002 ) ).r;
        float c = texture2D( uNoise, p * 0.013 + vec2( uTime * 0.003 ) ).r;
        float d = a * 0.55 + b * 0.3 + c * 0.15;
        float cover = smoothstep( 0.32, 0.62, d );
        gl_FragColor = vec4( vec3( 0.9, 0.92, 0.95 ) * mix( 0.75, 1.05, smoothstep( 0.4, 0.8, d ) ), cover * 0.95 );
        #include <fog_fragment>
      }`,
  });
  cloudMat.uniforms.uTime = kit.time;
  cloudMat.uniforms.uNoise.value = kit.detailTex;
  const seaGeo = new THREE.PlaneGeometry(1100, 1100, 1, 1).rotateX(-Math.PI / 2);
  const cloudSea = new THREE.Mesh(seaGeo, cloudMat);
  cloudSea.renderOrder = -5;
  cloudSea.frustumCulled = false;
  const cloudSea2 = new THREE.Mesh(seaGeo, cloudMat);
  cloudSea2.scale.setScalar(0.8);
  cloudSea2.rotation.y = 1.3;
  cloudSea2.renderOrder = -4;
  cloudSea2.frustumCulled = false;
  root.add(cloudSea, cloudSea2);
  function applyEnv() {
    cloudDomeMat.uniforms.uCover.value = env.cloudCover;
    cloudSea.visible = cloudSea2.visible = !!env.cloudSea;
    cloudSea.position.y = env.cloudSeaY;
    cloudSea2.position.y = env.cloudSeaY + 35;
    kit.ambU.uAmbSky.value.set(env.ambSky);
    kit.ambU.uAmbGround.value.set(env.ambGround);
  }

  // ---- Flottement : les îles reliées flottent ensemble ----
  let bobGroups = [];
  function computeBob() {
    const parent = new Map();
    const find = (x) => { while (parent.get(x) !== x) x = parent.get(x); return x; };
    for (const id of items.keys()) parent.set(id, id);
    for (const { L } of links.values()) if (items.has(L.a) && items.has(L.b)) parent.set(find(L.a), find(L.b));
    const groups = new Map();
    for (const id of items.keys()) {
      const r = find(id);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(id);
    }
    bobGroups = [...groups.values()].map((ids) => {
      // The group bobs like its biggest island; never the gallery's.
      const its = ids.map((i) => items.get(i));
      const lead = its.reduce((a, b) => (b.Rm > a.Rm ? b : a));
      const still = its.some((it) => it.P.kind === 'gallery');
      return { ids, linkIds: [...links.values()].filter(({ L }) => ids.includes(L.a)).map(({ L }) => L.id), amp: still ? 0 : lead.P.bob, speed: lead.P.bobSpeed, ph: (lead.P.seed * 1.37) % 6.28 };
    });
  }

  // ---- API ----
  function setIsland(id, def) {
    const old = items.get(id);
    if (old) { root.remove(old.group); disposeGroup(old.group); items.delete(id); }
    if (def) {
      const it = buildIsland({ ...def, id });
      it.def = { ...def, id };
      items.set(id, it);
      root.add(it.group);
    }
    // Lianas touching this island follow it.
    for (const [lid, l] of [...links]) if (l.L.a === id || l.L.b === id) setLink(lid, l.def, true);
    computeBob();
  }
  // After a gizmo move: read the group's transform back into the def.
  function syncTransform(id) {
    const it = items.get(id);
    if (!it || it.P.kind === 'gallery') return;
    const p = it.group.position;
    Object.assign(it.def, { x: +p.x.toFixed(2), y: +(p.y - (it.bobY || 0)).toFixed(2), z: +p.z.toFixed(2), rotY: +it.group.rotation.y.toFixed(4) });
    Object.assign(it.P, it.def);
    for (const [lid, l] of [...links]) if (l.L.a === id || l.L.b === id) setLink(lid, l.def, true);
  }
  function setLink(id, def, quiet = false) {
    const old = links.get(id);
    if (old) { root.remove(old.group); disposeGroup(old.group); links.delete(id); }
    if (def) {
      const l = buildLink({ ...def, id });
      l.def = { ...def, id };
      links.set(id, l);
      root.add(l.group);
    }
    if (!quiet) computeBob();
  }
  function setEnv(patch, rebuildFrags = true) {
    env = { ...env, ...patch };
    applyEnv();
    if (rebuildFrags) buildFragments();
  }
  function load(d) {
    for (const id of [...links.keys()]) setLink(id, null, true);
    for (const id of [...items.keys()]) { const it = items.get(id); root.remove(it.group); disposeGroup(it.group); items.delete(id); }
    env = { ...ENV_DEFAULTS, ...(d.env || {}) };
    for (const def of d.islands || []) {
      const it = buildIsland(def);
      it.def = { ...def };
      items.set(def.id, it);
      root.add(it.group);
    }
    for (const def of d.links || []) {
      const l = buildLink(def);
      l.def = { ...def };
      links.set(def.id, l);
      root.add(l.group);
    }
    computeBob();
    applyEnv();
    buildFragments();
  }
  function getDoc() {
    return {
      islands: [...items.values()].map((it) => compactDef(it.def, ISLE_DEFAULTS)),
      links: [...links.values()].map((l) => compactDef(l.def, LINK_DEFAULTS)),
      env: compactDef(env, ENV_DEFAULTS, []),
    };
  }
  function update(t, camera) {
    kit.time.value = t;
    cloudDome.position.copy(camera.position);
    cloudSea.position.x = cloudSea2.position.x = camera.position.x;
    cloudSea.position.z = cloudSea2.position.z = camera.position.z;
    for (const bg of bobGroups) {
      const dy = bg.amp ? Math.sin(t * bg.speed * 2 * Math.PI * 0.25 + bg.ph) * bg.amp : 0;
      for (const id of bg.ids) {
        const it = items.get(id);
        if (!it || it.P.kind === 'gallery' || it.dragging) continue;
        it.bobY = dy;
        it.group.position.y = it.P.y + dy;
      }
      for (const lid of bg.linkIds) { const l = links.get(lid); if (l) l.group.position.y = dy; }
    }
    for (const it of items.values()) for (const c of it.group.children) {
      const m = c.userData.mist;
      if (!m) continue;
      c.position.x = m.base.x + Math.sin(t * m.sp + m.ph) * 6;
      c.position.z = m.base.z + Math.cos(t * m.sp * 0.8 + m.ph) * 4;
    }
  }
  if (doc) load(doc);
  return {
    root, groundAt, update, load, getDoc, setIsland, setLink, setEnv, syncTransform,
    get env() { return env; },
    items, links, kit,
    // Island ids reached by lianas from a given island.
    linksOf: (id) => [...links.values()].filter(({ L }) => L.a === id || L.b === id).map(({ L }) => L.id),
  };
}

// ---- Monde par défaut (la galerie) ---------------------------------------------
// The archipelago around the gallery, as hand-tuned before the editor existed.
export function defaultHallDoc() {
  const islands = [{ id: 'galerie', kind: 'gallery', name: 'Île de la galerie', depth: 118, fall: true, fallAngle: 18, fallWidth: 2.6, fallLength: 95 }];
  const LAYOUT = [
    ['Grande île de la baie', 78, 16, 96, 34, 100, -0.35], ['Haute île ouest', -62, 42, 128, 22, 62], ['Île basse', -18, -38, 162, 27, 84, 0.3], ['Île haute lointaine', 34, 66, 214, 18, 56],
    ['Île ouest lointaine', -132, 6, 205, 38, 112, -0.2], ['Île est basse', 142, -58, 188, 30, 92], ['Île du fond', 8, 28, 305, 46, 125], ['Petite île basse', -46, -82, 86, 14, 44],
    ['Île haute est', 112, 72, 124, 12, 36], ['Île très haute', -92, 96, 92, 10, 30],
    ['Île est', 124, 10, -12, 40, 112], ['Île ouest', -118, -16, 22, 36, 102, 0.4], ['Île sud-ouest', -62, 30, -124, 30, 84], ['Île sud-est', 92, -42, -112, 34, 92],
    ['Île sud', 0, 52, -205, 50, 132], ['Île est lointaine', 206, 22, 64, 40, 104], ['Île ouest très lointaine', -214, 40, 92, 45, 112], ['Île sud-est lointaine', 180, 60, -150, 32, 90],
    ['Île sud-ouest lointaine', -190, -30, -60, 40, 108], ['Petite île haute', 60, 90, -60, 14, 40],
  ];
  LAYOUT.forEach(([name, x, y, z, radius, depth, fall], i) => {
    const seed = 10 + i;
    const rnd = mulberry32(seed * 7919);
    const def = { id: 'i' + (i + 1), name, x, y, z, radius, depth, seed, ellipse: +(0.75 + rnd() * 0.5).toFixed(2), rotY: +(rnd() * Math.PI).toFixed(3) };
    if (fall !== undefined) Object.assign(def, { fall: true, fallAngle: Math.round(((Math.atan2(-z, -x) + fall + def.rotY) * 180 / Math.PI + 720) % 360), fallWidth: 4 + (i % 2), fallLength: 100 + (i % 3) * 20 });
    islands.push(def);
  });
  const SATS = [
    [0, 0.42, 11, 3, 7], [0, Math.PI - 0.35, 9, -5, 6], [0, 0.95, 20, 12, 4.5],
    [1, Math.PI + 0.25, 9, 9, 8], [1, -Math.PI / 2 - 0.3, 11, -11, 5],
    [2, -0.1, 8, -6, 6], [2, -1.3, 13, 7, 4],
    [3, -1.7, 9, 12, 7], [5, Math.PI - 0.3, 10, 8, 6],
    [11, Math.PI - 0.45, 11, 6, 9], [12, -0.25, 9, 8, 8], [12, 0.9, 14, -9, 5],
    [14, 0.6, 10, -7, 7],
  ];
  const links = [];
  SATS.forEach(([pi, a, gap, dy, Rs], i) => {
    const par = islands[pi];
    const pr = pi === 0 ? 30 : par.radius;
    const px = pi === 0 ? 0 : par.x, pz = pi === 0 ? 0.76 : par.z, py = pi === 0 ? -1.62 : par.y;
    const d = pr + gap + Rs;
    const id = 's' + (i + 1);
    islands.push({ id, name: 'Satellite ' + (i + 1), x: +(px + Math.cos(a) * d).toFixed(2), y: py + dy, z: +(pz + Math.sin(a) * d).toFixed(2), radius: Rs, depth: +(Rs * (2.2 + (i % 3) * 0.5)).toFixed(1), seed: 60 + i, taper: 1.7 });
    links.push({ id: 'l' + (i + 1), a: par.id, b: id, count: 3 + (i % 3), seed: 1 + i, thickness: pi === 0 ? 0.22 : 0.3 });
  });
  return { islands, links, env: {} };
}
// The island workshop: one island and a satellite tied to it, centred.
export function defaultLabDoc() {
  return {
    islands: [
      { id: 'modele', name: 'Modèle', x: 0, y: 0, z: 0, radius: 26, depth: 80, seed: 7, fall: true, fallAngle: 200, mist: 1 },
      { id: 'satellite', name: 'Satellite', x: 44, y: 6, z: 10, radius: 6, depth: 15, seed: 61, taper: 1.7 },
    ],
    links: [{ id: 'lien', a: 'modele', b: 'satellite', count: 4, seed: 3 }],
    env: { fragCount: 6, fragSpread: 160, fragHeight: 120 },
  };
}
