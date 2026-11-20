// ---- Îles flottantes ----------------------------------------------------------
// The outside of the gallery: rock islands hanging in a blue sky, after the
// user's references — warm layered sandstone/limestone walls (cream, tan,
// ochre, grey bands), a pale crown, a dark columnar pendant underside, the top
// buried under a dense, cauliflower-like jungle that spills over the rim,
// beards of moss and roots hanging below, falls pouring into nothing.
// Small satellite islands float close to the big ones, tied to them by sagging
// vine cables. Mist drifts between them; a sea of cloud lies far below.
// The gallery is bedded on the largest island; its north cliff stops just
// short of the terrace edge, so past the balustrade there is only void.
//
// Everything is procedural and deterministic (fixed seeds): the same sky on
// every load. createSkyIsles() returns
//   root       — the group holding everything
//   groundAt   — top of the gallery's island at (x, z), or null over the void
//   update     — per-frame animation (vines, falls, mist, clouds)
//   instanced  — instanced meshes (the caller splits them into zones)
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

// ---- Matériaux -----------------------------------------------------------------
// The hall's ambient is kept dim on purpose, so everything outside gets its
// own sky / ground ambient on top of the sun.
const AMB = { sky: new THREE.Color('#9fb3c9'), ground: new THREE.Color('#6a5a44') };
function ambientChunk(scale = 1) {
  return [
    '{',
    '  vec3 ambN = inverseTransformDirection( normal, viewMatrix );',
    `  outgoingLight += diffuseColor.rgb * mix( uAmbGround, uAmbSky, ambN.y * 0.5 + 0.5 ) * ${scale.toFixed(2)};`,
    '}',
    '#include <opaque_fragment>',
  ].join('\n');
}
// Whiteout-blended triplanar normal mapping (world space), shared by the
// rock and the foliage. Expects wn (world normal), bw (blend weights) and
// three tangent-space normals nX (zy), nY (xz), nZ (xy).
const TRIPLANAR_NORMAL = [
  '  nX = vec3( nX.xy + wn.zy, abs( nX.z ) * wn.x );',
  '  nY = vec3( nY.xy + wn.xz, abs( nY.z ) * wn.y );',
  '  nZ = vec3( nZ.xy + wn.xy, abs( nZ.z ) * wn.z );',
  '  vec3 wn2 = normalize( nX.zyx * bw.x + nY.xzy * bw.y + nZ.xyz * bw.z );',
  '  normal = normalize( ( viewMatrix * vec4( wn2, 0.0 ) ).xyz );',
].join('\n');
const WORLD_POS_VERTEX = [
  '#include <project_vertex>',
  '{',
  '  vec4 wp = vec4( transformed, 1.0 );',
  '  #ifdef USE_INSTANCING',
  '  wp = instanceMatrix * wp;',
  '  #endif',
  '  vIsleWP = ( modelMatrix * wp ).xyz;',
  '}',
].join('\n');

export function createSkyIsles({ lite = false, sunDir, gallery }) {
  const root = new THREE.Group();
  root.name = 'îles flottantes';
  const time = { value: 0 };
  const detailTex = noiseTex(256, 8, 5, 77);
  const ROCK = rockTextures(lite ? 512 : 1024);
  const GRASS = grassTextures(512);
  const LEAF = leafTextures(256);
  const ambU = { uAmbSky: { value: AMB.sky }, uAmbGround: { value: AMB.ground } };

  // ---- Roche ----
  // Sides: strata texture (two scales against tiling); tops and ledges:
  // grass/moss; the pendant underside turns to dark grey columns (aIsle.x);
  // the cap is grass (aIsle.y). Green moss runs down some cracks.
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  rockMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, ambU, {
      uRockMap: { value: ROCK.map }, uRockNrm: { value: ROCK.normal },
      uGrassMap: { value: GRASS.map }, uGrassNrm: { value: GRASS.normal }, uDetail: { value: detailTex },
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vIsleWP;\nattribute vec2 aIsle;\nvarying vec2 vIsle;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvIsle = aIsle;')
      .replace('#include <project_vertex>', WORLD_POS_VERTEX);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', [
        '#include <common>',
        'varying vec3 vIsleWP; varying vec2 vIsle;',
        'uniform sampler2D uRockMap, uRockNrm, uGrassMap, uGrassNrm, uDetail;',
        'uniform vec3 uAmbSky, uAmbGround;',
      ].join('\n'))
      .replace('#include <normal_fragment_begin>', [
        '#include <normal_fragment_begin>',
        '{',
        '  vec3 wn = inverseTransformDirection( normal, viewMatrix );',
        '  vec3 bw = pow( abs( wn ), vec3( 5.0 ) ); bw /= bw.x + bw.y + bw.z;',
        '  vec3 p = vIsleWP;',
        '  vec2 uvX = vec2( p.z, p.y + p.z * 0.06 ) / 26.0, uvZ = vec2( p.x, p.y - p.x * 0.05 ) / 26.0, uvY = p.xz / 7.0;',
        '  float macro = texture2D( uDetail, p.xz * 0.004 + p.y * 0.002 ).r;',
        '  vec3 cX = mix( texture2D( uRockMap, uvX ).rgb, texture2D( uRockMap, uvX * 0.31 + 0.17 ).rgb, 0.35 );',
        '  vec3 cZ = mix( texture2D( uRockMap, uvZ ).rgb, texture2D( uRockMap, uvZ * 0.31 + 0.53 ).rgb, 0.35 );',
        '  vec3 cY = texture2D( uGrassMap, uvY ).rgb * mix( 0.8, 1.15, texture2D( uDetail, p.xz * 0.03 ).r );',
        '  float sideW = bw.x + bw.z;',
        '  vec3 rock = ( cX * bw.x + cZ * bw.z ) / max( sideW, 1e-3 );',
        // Columnar grey underside (photo 3); pale crown just under the rim.
        '  float lum = dot( rock, vec3( 0.3, 0.59, 0.11 ) );',
        '  rock = mix( rock, vec3( lum ) * vec3( 0.86, 0.87, 0.9 ) * 0.85, vIsle.x * 0.85 );',
        '  rock *= 0.8 + 0.4 * macro;',
        // Moss: on ledges (normal up), down some cracks, and the whole cap.
        '  float n1 = texture2D( uDetail, vec2( ( p.x + p.z ) * 0.05, p.y * 0.006 ) ).r;',
        '  float runs = smoothstep( 0.6, 0.78, n1 ) * ( 1.0 - vIsle.x ) * smoothstep( 0.9, 0.3, abs( wn.y ) );',
        '  float ledge = smoothstep( 0.42, 0.78, wn.y + ( texture2D( uDetail, p.xz * 0.11 + p.y * 0.05 ).r - 0.5 ) * 0.8 );',
        '  float g = clamp( max( max( ledge, vIsle.y ), runs * 0.9 ), 0.0, 1.0 );',
        '  vec3 albedo = mix( rock, cY, g );',
        '  diffuseColor.rgb *= albedo;',
        '  vec3 nX = texture2D( uRockNrm, uvX ).xyz * 2.0 - 1.0;',
        '  vec3 nZ = texture2D( uRockNrm, uvZ ).xyz * 2.0 - 1.0;',
        '  vec3 nY = texture2D( uGrassNrm, uvY ).xyz * 2.0 - 1.0;',
        TRIPLANAR_NORMAL,
        '}',
      ].join('\n'))
      .replace('#include <opaque_fragment>', ambientChunk(1));
  };
  rockMat.customProgramCacheKey = () => 'inga-isle-rock-v2';

  // ---- Feuillage ----
  // Bushes and tree crowns: lumpy blobs with a triplanar leaf texture and
  // leafy normals; vertex colour darkens the inside / underside, instance
  // colour shifts the hue between yellow-green and blue-green.
  const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 });
  leafMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, ambU, { uLeafMap: { value: LEAF.map }, uLeafNrm: { value: LEAF.normal } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vIsleWP;')
      .replace('#include <project_vertex>', WORLD_POS_VERTEX);
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
      // Light through the leaves: a soft wrap term so shaded crowns stay green.
      .replace('#include <opaque_fragment>', ambientChunk(1.15));
  };
  leafMat.customProgramCacheKey = () => 'inga-isle-leaf-v2';

  // Hanging roots and moss beards: thin tapered strands that sway a little.
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
  strandMat.customProgramCacheKey = () => 'inga-isle-strand-v2';

  // Vine cables between islands: twisted dark green-brown ropes.
  const cableMat = new THREE.MeshStandardMaterial({ color: '#59603c', roughness: 0.95 });
  cableMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, ambU);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uAmbSky, uAmbGround;')
      .replace('#include <opaque_fragment>', ambientChunk(0.9));
  };
  cableMat.customProgramCacheKey = () => 'inga-isle-cable';

  // ---- Générateur d'une île ----
  // Polar grid: a centre vertex, cap rings out to the rim, side rows down the
  // cliff to a pendant tip. Indexed and closed (the seam wraps), so normals
  // are smooth everywhere.
  // opt: cx, cz, y (rim height), H (depth below the rim), R(θ) rim radius,
  //      Rmean, cap(x, z, s) height above the rim, tip [dx, dz], seg, rings,
  //      rows, seed, dispMul(θ, t).
  function islandGeometry(opt) {
    const { cx, cz, y: rimY, H, R, cap, seg, rings, rows } = opt;
    const tip = opt.tip || [0, 0];
    const sd = opt.seed * 13.7;
    const sz = opt.Rmean / 30; // scale of the features
    const verts = 1 + rings * seg + rows * seg + 1;
    const pos = new Float32Array(verts * 3);
    const tArr = new Float32Array(verts); // 0 on the cap, 0..1 down the side
    const capArr = new Uint8Array(verts);
    const ang = Array.from({ length: seg }, (_, i) => (i / seg) * Math.PI * 2);
    const rimR = ang.map((a) => R(a));
    const mul = opt.dispMul || (() => 1);
    // Horizontal (outward) displacement shared by the cap rim and the side:
    // buttresses, vertical fluting, strata ledges (photo 2) and, lower down,
    // sharp vertical columns (photo 3).
    const dispRaw = (x, y, z, t) => {
      const f = 0.075 / sz, g = 0.018 / sz;
      const flutes = fbm(N1, x * f + sd, y * f * 0.16, z * f, 4) + 0.45 * (ridged(N3, x * f * 2.6, y * f * 0.25 + sd, z * f * 2.6, 2) - 0.6);
      const bulge = fbm(N2, x * g, y * g * 0.7 + sd, z * g, 3);
      const sp = 5.5 * sz;
      const ph = ((y / sp + 0.5 * N3(x * 0.04, sd, z * 0.04)) % 1 + 1) % 1;
      const strata = smooth(0.7, 0.95, ph) - 0.35 * smooth(0, 0.3, ph) * (1 - t); // lip + undercut
      const cols = t > 0.25 ? Math.pow(ridged(N2, x * f * 3.4 + sd, y * f * 0.03, z * f * 3.4, 1), 3) * smooth(0.25, 0.6, t) : 0;
      return (flutes * 3.6 + bulge * 9 + strata * 0.8 * (1 - 0.6 * t) + cols * 4.5) * sz * (1 + 1.2 * t * t);
    };
    const disp = (x, y, z, t, a) => mul(a, t) * dispRaw(x, y, z, t);
    // Profile: sheer upper walls, then a ragged inverted cone.
    const prof = (t) => Math.pow(Math.max(0, 1 - Math.pow(t, opt.taper || 2.1)), 0.78);
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
        // The top's edge curls down slightly into the cliff.
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
        // Pendant chunks: the lower part hangs further in places.
        y -= tt * t * H * 0.35 * Math.max(0, ridged(N2, x * 0.05 / sz, sd, z * 0.05 / sz) - 0.45);
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
    // Vertex colour = large-scale light: runoff streaks darker, a damp,
    // darker belly; aIsle = (grey underside, cap) for the shader.
    const col = new Float32Array(verts * 3);
    const isle = new Float32Array(verts * 2);
    for (let v = 0; v < verts; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2], t = tArr[v];
      const streak = smooth(0.15, 0.55, fbm(N1, x * 0.11 / sz, y * 0.006 + sd, z * 0.11 / sz, 3)) * (0.3 + 0.7 * Math.exp(-t * 3));
      const b = (0.92 + 0.2 * fbm(N3, x * 0.02, y * 0.02, z * 0.02, 3)) * (1 - 0.35 * streak) * (1 - 0.3 * smooth(0.4, 1, t));
      col[v * 3] = b; col[v * 3 + 1] = b; col[v * 3 + 2] = b;
      isle[v * 2] = smooth(0.32, 0.62, t + 0.12 * N2(x * 0.03, y * 0.03, z * 0.03));
      isle[v * 2 + 1] = capArr[v];
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aIsle', new THREE.BufferAttribute(isle, 2));
    geo.userData = { tArr, rimY, cx, cz, seg, rings, rows, rimR };
    geo.computeBoundingSphere();
    return geo;
  }

  // ---- Végétation : géométries ----
  // A bush is one lumpy blob (cauliflower); a tree is a thin trunk under a
  // cluster of blobs. Vertex colour: dark inside and below, light on top.
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
    return mergeGeometries(parts);
  }
  function treeGeometry(detail, blobs, seed) {
    const rnd = mulberry32(seed);
    const t = new THREE.CylinderGeometry(0.02, 0.045, 0.72, 6, 1).translate(0, 0.36, 0);
    t.deleteAttribute('uv');
    const tc = new Float32Array(t.attributes.position.count * 3).fill(0.28);
    t.setAttribute('color', new THREE.BufferAttribute(tc, 3));
    const parts = [t];
    for (let b = 0; b < blobs; b++) {
      const a = rnd() * 6.28, r = b === 0 ? 0 : 0.12 + rnd() * 0.18;
      parts.push(blob(detail, seed * 3 + b, 0.2 + rnd() * 0.12, 0.13 + rnd() * 0.06, Math.cos(a) * r, 0.74 + rnd() * 0.14 - r * 0.2, Math.sin(a) * r));
    }
    const g = mergeGeometries(parts);
    g.computeBoundingSphere();
    return g;
  }

  const bushes = [], nearBushes = [], trees = [], strands = [];
  const M = new THREE.Matrix4(), Qn = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), E = new THREE.Euler();
  const hue = new THREE.Color();
  // Instance colour: hue between yellow-green and blue-green, brightness.
  const leafTint = (rnd, b = 1) => hue.setHSL(0.25 + (rnd() - 0.5) * 0.1, 0.22 + rnd() * 0.2, 0.36 + rnd() * 0.14).multiplyScalar(b * 1.25).clone();
  const pushInst = (list, rnd, x, y, z, h, w, tint, tilt = 0.12) => {
    E.set((rnd() - 0.5) * tilt, rnd() * 6.28, (rnd() - 0.5) * tilt);
    M.compose(P.set(x, y, z), Qn.setFromEuler(E), S.set(w, h, w));
    list.push([M.clone(), tint]);
  };

  // ---- L'île de la galerie ----
  const G = gallery;
  // Distance outside the building's footprint (union of rectangles).
  const outside = (x, z) => {
    let d = Infinity;
    for (const [x0, x1, z0, z1] of G.rects) {
      const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
      d = Math.min(d, Math.hypot(dx, dz));
    }
    return d;
  };
  const GI = { cx: 0, cz: G.northEdge - 26, ax: 41, az: 26, y: G.bedY, H: 118 };
  // Squircle outline, the north side kept straight under the terrace.
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
    // Low near the building and towards the north edge (the terrace view).
    const hills = 0.6 + 3.2 * (0.5 + 0.5 * fbm(N1, x * 0.035, 3.3, z * 0.035, 4));
    return smooth(0.8, 16, d) * hills * (1 - 0.75 * smooth(G.northEdge - 18, G.northEdge - 2, z));
  };
  const galleryGeo = islandGeometry({
    cx: GI.cx, cz: GI.cz, y: GI.y, H: GI.H, R: galleryR, Rmean: 32,
    cap: (x, z, s) => galleryCapH(x, z) * (1 - smooth(0.82, 1, s)),
    // Straight, quiet cliff right under the terrace; ragged further down.
    dispMul: (a, t) => { const n = Math.sin(a) > 0 ? smooth(0.5, 0.85, Math.sin(a)) : 0; return 1 - n * (1 - 0.12 - 0.88 * smooth(0.04, 0.35, t)); },
    tip: [7, -12], seg: lite ? 220 : 320, rings: lite ? 30 : 44, rows: lite ? 70 : 96, seed: 1,
  });
  const galleryMesh = new THREE.Mesh(galleryGeo, rockMat);
  galleryMesh.receiveShadow = true;
  root.add(galleryMesh);
  function groundAt(x, z) {
    const r = Math.hypot(x - GI.cx, z - GI.cz);
    const rr = galleryR(Math.atan2(z - GI.cz, x - GI.cx));
    if (r > rr) return null;
    return GI.y + galleryCapH(x, z) * (1 - smooth(0.82, 1, r / rr));
  }

  // ---- Les autres îles ----
  // Big islands, hand-placed for the view through the bay (north, +z), then
  // the rest of the sky all around. [x, rim y, z, mean radius, depth]
  const LAYOUT = [
    [78, 16, 96, 34, 100], [-62, 42, 128, 22, 62], [-18, -38, 162, 27, 84], [34, 66, 214, 18, 56],
    [-132, 6, 205, 38, 112], [142, -58, 188, 30, 92], [8, 28, 305, 46, 125], [-46, -82, 86, 14, 44],
    [112, 72, 124, 12, 36], [-92, 96, 92, 10, 30],
    [124, 10, -12, 40, 112], [-118, -16, 22, 36, 102], [-62, 30, -124, 30, 84], [92, -42, -112, 34, 92],
    [0, 52, -205, 50, 132], [206, 22, 64, 40, 104], [-214, 40, 92, 45, 112], [180, 60, -150, 32, 90],
    [-190, -30, -60, 40, 108], [60, 90, -60, 14, 40],
  ];
  // Satellites: small islands floating close to a bigger one, tied to it by
  // vine cables. [parent index (0 = gallery), angle from the parent's centre,
  // gap between rims, height offset, radius]
  const SATS = [
    [0, 0.42, 11, 3, 7], [0, Math.PI - 0.35, 9, -5, 6], [0, 0.95, 20, 12, 4.5],
    [1, Math.PI + 0.25, 9, 9, 8], [1, -Math.PI / 2 - 0.3, 11, -11, 5],
    [2, -0.1, 8, -6, 6], [2, -1.3, 13, 7, 4],
    [3, -1.7, 9, 12, 7], [5, Math.PI - 0.3, 10, 8, 6],
    [11, Math.PI - 0.45, 11, 6, 9], [12, -0.25, 9, 8, 8], [12, 0.9, 14, -9, 5],
    [14, 0.6, 10, -7, 7],
  ];
  const islands = [{ x: GI.cx, z: GI.cz, y: GI.y, R: 40, H: GI.H, Rof: galleryR }];
  const rocks = [galleryMesh];
  const addIsland = (x, y, z, Rm, H, seed, extra = {}) => {
    const rnd = mulberry32(seed * 7919);
    const e = 0.75 + rnd() * 0.5; // ellipse ratio
    const rot = rnd() * Math.PI;
    const ph = rnd() * 10;
    const R = (a) => {
      const c = Math.cos(a - rot), s = Math.sin(a - rot);
      const base = Rm / Math.sqrt(c * c * e + (s * s) / e);
      return base * (0.82 + 0.3 * (0.5 + 0.5 * fbm(N2, Math.cos(a) * 1.6 + ph, seed, Math.sin(a) * 1.6, 3)));
    };
    const dist = Math.hypot(x, z);
    const fine = Math.max(0.35, Math.min(1, 140 / dist)) * (lite ? 0.8 : 1);
    const seg = Math.round(Math.max(36, Math.min(200, Rm * 4.4 * fine + 16)));
    const geo = islandGeometry({
      cx: x, cz: z, y, H, R, Rmean: Rm, seed, taper: extra.taper,
      cap: (px, pz, s) => Rm * (0.08 + 0.12 * fbm(N1, px * 0.04 + seed, 1, pz * 0.04, 3)) * (1 - s * s) + Rm * 0.04 * fbm(N3, px * 0.2, seed, pz * 0.2, 2) * (1 - s),
      tip: [(rnd() - 0.5) * Rm * 0.6, (rnd() - 0.5) * Rm * 0.6],
      seg, rings: Math.max(5, Math.round(seg / 9)), rows: Math.round(Math.max(18, Math.min(110, H * 0.8 * fine))),
    });
    const m = new THREE.Mesh(geo, rockMat);
    root.add(m);
    rocks.push(m);
    islands.push({ x, z, y, R: Rm, H, Rof: R, dist, ...extra });
    return islands.length - 1;
  };
  LAYOUT.forEach(([x, y, z, Rm, H], i) => addIsland(x, y, z, Rm, H, 10 + i));
  const satLinks = [];
  SATS.forEach(([pi, a, gap, dy, Rs], i) => {
    const Pa = islands[pi];
    const rp = Pa.Rof(a);
    const d = rp + gap + Rs;
    const x = Pa.x + Math.cos(a) * d, z = Pa.z + Math.sin(a) * d;
    const si = addIsland(x, Pa.y + dy, z, Rs, Rs * (2.2 + (i % 3) * 0.5), 60 + i, { sat: true, taper: 1.7 });
    satLinks.push([pi, si]);
  });

  // Small fragments drifting between the islands, merged into one mesh.
  {
    const rnd = mulberry32(4242);
    const geos = [];
    for (let n = 0, tries = 0; n < 34 && tries < 2000; tries++) {
      const a = rnd() * Math.PI * 2, d = 60 + Math.pow(rnd(), 0.8) * 220;
      const x = Math.cos(a) * d, z = Math.sin(a) * d * (rnd() < 0.6 ? 1 : -1) + 30, y = -80 + rnd() * 160;
      const Rm = 1 + Math.pow(rnd(), 2) * 3.5;
      if (islands.some((I) => Math.hypot(x - I.x, z - I.z) < I.R * 1.2 + Rm + 6 && y < I.y + 12 && y > I.y - I.H * 1.15 - 8)) continue;
      const ph = rnd() * 9;
      const seed = 100 + n;
      geos.push(islandGeometry({
        cx: x, cz: z, y, H: Rm * (1.4 + rnd() * 2), Rmean: Rm, seed,
        R: (aa) => Rm * (0.75 + 0.4 * (0.5 + 0.5 * N2(Math.cos(aa) * 1.4 + ph, seed, Math.sin(aa) * 1.4))),
        cap: (px, pz, s) => Rm * 0.22 * (1 - s * s),
        tip: [(rnd() - 0.5) * Rm, (rnd() - 0.5) * Rm], seg: 18, rings: 3, rows: 9,
      }));
      islands.push({ x, z, y, R: Rm, H: Rm * 2, small: true });
      n++;
    }
    const fg = mergeGeometries(geos);
    const tArr = new Float32Array(fg.attributes.position.count);
    let o = 0;
    for (const g of geos) { tArr.set(g.userData.tArr, o); o += g.userData.tArr.length; }
    fg.userData = { tArr, rings: 0, seg: 0 };
    fg.computeBoundingSphere();
    const frag = new THREE.Mesh(fg, rockMat);
    root.add(frag);
    rocks.push(frag);
  }

  // ---- Végétation : placement ----
  {
    const rnd = mulberry32(99);
    const tmpN = new THREE.Vector3();
    rocks.forEach((m, mi) => {
      const g = m.geometry, ud = g.userData;
      const pos = g.attributes.position, nor = g.attributes.normal;
      const isGallery = m === galleryMesh;
      const I = islands[mi];
      const scale = isGallery ? 1 : !ud.rings ? 0.6 : Math.max(0.5, Math.min(1.5, g.boundingSphere.radius / 40));
      const farK = isGallery ? 1 : 1 + Math.max(0, (I?.dist || 100) - 120) / 220; // sparser, bigger far away
      if (ud.rings) {
        // A dense jungle over the whole top: bushes on a jittered grid, a few
        // emergent trees, and big bushes spilling over the rim.
        const Rm = isGallery ? 40 : I.R;
        const sp = (isGallery ? 3.2 : Math.max(2.4, Rm * 0.15) * farK) * (lite ? 1.1 : 1);
        for (let gx = -Rm * 1.4; gx <= Rm * 1.4; gx += sp) {
          for (let gz = -Rm * 1.4; gz <= Rm * 1.4; gz += sp) {
            const x = ud.cx + gx + (rnd() - 0.5) * sp, z = ud.cz + gz + (rnd() - 0.5) * sp;
            const a = Math.atan2(z - ud.cz, x - ud.cx);
            const rr = isGallery ? galleryR(a) : I.Rof(a);
            const s = Math.hypot(x - ud.cx, z - ud.cz) / rr;
            if (s > 0.97) continue;
            let y;
            if (isGallery) {
              const d = outside(x, z);
              if (d < 1.6) continue;
              y = groundAt(x, z);
              if (y == null) continue;
              const tall = d > 4 && rnd() < 0.18;
              const h = tall ? 5 + rnd() * 6 : (1.2 + rnd() * 2.2) * Math.min(1, 0.45 + d * 0.12);
              if (tall) pushInst(trees, rnd, x, y - 0.1, z, h, h * (0.9 + rnd() * 0.5), leafTint(rnd));
              else pushInst(nearBushes, rnd, x, y - 0.2, z, h, h * (1.3 + rnd() * 0.7), leafTint(rnd));
              continue;
            }
            // Height of the cap under this point: nearest cap vertex.
            const ring = Math.max(1, Math.min(ud.rings, Math.round(s * ud.rings)));
            const vi = 1 + (ring - 1) * ud.seg + ((Math.round((a / (Math.PI * 2)) * ud.seg) % ud.seg) + ud.seg) % ud.seg;
            y = pos.getY(vi);
            if (rnd() < 0.06) {
              const h = (6 + rnd() * 8) * Math.min(1.3, scale) * Math.sqrt(farK);
              pushInst(trees, rnd, x, y - 0.3, z, h, h * (0.9 + rnd() * 0.6), leafTint(rnd));
            }
            const h = sp * (0.9 + rnd() * 0.8);
            pushInst(bushes, rnd, x, y - h * 0.15, z, h, sp * (1.2 + rnd() * 0.6), leafTint(rnd));
          }
        }
        // Overhang: bushes on the rim, pushed out and down so the jungle
        // spills over the edge (photos 2 and 3).
        const step = Math.max(1, Math.round(ud.seg / (Rm * 2 * Math.PI / (sp * 1.1))));
        const rimStart = 1 + (ud.rings - 1) * ud.seg;
        for (let i = 0; i < ud.seg; i += step) {
          const v = rimStart + i;
          const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
          if (isGallery && (outside(x, z) < 2 || (z > G.northEdge - 4 && Math.abs(x) < G.terraceHalfW + 3))) continue;
          tmpN.set(x - ud.cx, 0, z - ud.cz).normalize();
          const h = sp * (0.9 + rnd() * 0.7);
          pushInst(isGallery ? nearBushes : bushes, rnd, x + tmpN.x * h * 0.25, y - h * 0.35, z + tmpN.z * h * 0.25, h, sp * (1.3 + rnd() * 0.6), leafTint(rnd, 0.95), 0.5);
        }
      }
      // Cliffs: clumps on ledges. Rim and belly: moss beards and roots.
      const n0 = ud.rings ? 1 + ud.rings * ud.seg : 0;
      const sideCount = pos.count - n0;
      const clumpWant = Math.round(sideCount * (isGallery ? 0.02 : 0.012 / farK) * (lite ? 0.75 : 1));
      for (let n = 0; n < clumpWant; n++) {
        const v = n0 + Math.floor(rnd() * sideCount);
        const t = ud.tArr[v];
        if (t > 0.55 || nor.getY(v) < 0.05) continue;
        tmpN.set(nor.getX(v), 0, nor.getZ(v)).normalize();
        const h = (1.2 + rnd() * 2.5) * scale;
        pushInst(bushes, rnd, pos.getX(v) + tmpN.x * 0.3, pos.getY(v) - h * 0.3, pos.getZ(v) + tmpN.z * 0.3, h, h * 1.4, leafTint(rnd, 0.85), 0.4);
      }
      const strandWant = Math.round(sideCount * (isGallery ? 0.03 : 0.025 / farK) * (lite ? 0.75 : 1));
      const moss = new THREE.Color('#5d7a33'), root_ = new THREE.Color('#5a4c38');
      for (let n = 0; n < strandWant; n++) {
        const v = n0 + Math.floor(rnd() * sideCount);
        const t = ud.tArr[v];
        const ny = nor.getY(v);
        const rim = t < 0.06;
        if (!rim && ny > -0.15) continue;
        if (isGallery && pos.getZ(v) > G.northEdge - 3 && Math.abs(pos.getX(v)) < G.terraceHalfW + 2 && pos.getY(v) > GI.y - 6) continue; // keep the terrace view clear
        const L = (rim ? 2 + rnd() * 9 : 2 + Math.pow(rnd(), 1.5) * 18) * Math.max(0.6, scale);
        const w = (0.8 + rnd() * 1.4) * (isGallery ? 1 : 1.5);
        M.compose(P.set(pos.getX(v), pos.getY(v) + 0.3, pos.getZ(v)), Qn.identity(), S.set(w, L, w));
        // Beards of moss under the rim, bare roots under the belly.
        const c = (rim || t < 0.35 ? moss : root_).clone().multiplyScalar(0.8 + rnd() * 0.5);
        strands.push([M.clone(), c]);
      }
    });
  }

  // ---- Lianes entre les îles ----
  // Each satellite hangs on 3–5 sagging cables to its parent. Anchors are
  // picked on the facing sides near the top; each cable is a tube along a
  // catenary-like curve, dressed with moss tufts and short hanging strands.
  {
    const rnd = mulberry32(777);
    const cables = [];
    const anchors = (mi, toward, n) => {
      const g = rocks[mi].geometry, ud = g.userData, pos = g.attributes.position;
      const n0 = 1 + ud.rings * ud.seg, rowsTop = Math.max(2, Math.round(ud.rows * 0.3));
      const cand = [];
      for (let j = 0; j < rowsTop; j++) for (let i = 0; i < ud.seg; i++) {
        const v = n0 + j * ud.seg + i;
        const dx = pos.getX(v) - ud.cx, dz = pos.getZ(v) - ud.cz, l = Math.hypot(dx, dz) || 1;
        const score = (dx * toward.x + dz * toward.z) / l;
        if (score > 0.86) cand.push(v);
      }
      const out = [];
      for (let k = 0; k < n && cand.length; k++) {
        const v = cand[Math.floor(rnd() * cand.length)];
        out.push(new THREE.Vector3(pos.getX(v), pos.getY(v), pos.getZ(v)));
      }
      return out;
    };
    for (const [pi, si] of satLinks) {
      const A = islands[pi], B = islands[si];
      const dir = new THREE.Vector3(B.x - A.x, 0, B.z - A.z).normalize();
      const n = 3 + Math.floor(rnd() * 3);
      const pa = anchors(pi, dir, n), pb = anchors(si, dir.clone().negate(), n);
      for (let k = 0; k < Math.min(pa.length, pb.length); k++) {
        const a = pa[k], b = pb[k];
        if (pi === 0 && a.z > G.northEdge - 4 && Math.abs(a.x) < G.terraceHalfW + 3) continue;
        const span = a.distanceTo(b);
        const sag = span * (0.12 + rnd() * 0.22);
        const pts = [];
        for (let s = 0; s <= 20; s++) {
          const u = s / 20;
          const p = a.clone().lerp(b, u);
          p.y -= sag * 4 * u * (1 - u) * (1 + 0.15 * Math.sin(u * 9 + k));
          pts.push(p);
        }
        const curve = new THREE.CatmullRomCurve3(pts);
        const r = (0.14 + rnd() * 0.18) * (B.sat && pi === 0 ? 1 : 1.4);
        cables.push(new THREE.TubeGeometry(curve, 40, r, 5, false));
        // Moss tufts and dangling strands along the cable.
        const tufts = Math.round(span / 2.2);
        for (let q = 0; q < tufts; q++) {
          const u = 0.04 + rnd() * 0.92, p = curve.getPoint(u);
          if (rnd() < 0.55) pushInst(bushes, rnd, p.x, p.y - r, p.z, 0.5 + rnd() * 0.7, 0.6 + rnd() * 0.9, leafTint(rnd, 0.9), 1.2);
          const L = 0.5 + Math.pow(rnd(), 1.6) * 5;
          M.compose(P.set(p.x, p.y, p.z), Qn.identity(), S.set(0.7, L, 0.7));
          strands.push([M.clone(), new THREE.Color('#5d7a33').multiplyScalar(0.8 + rnd() * 0.4)]);
        }
      }
    }
    if (cables.length) {
      const cm = new THREE.Mesh(mergeGeometries(cables), cableMat);
      cm.castShadow = false;
      root.add(cm);
    }
  }

  const instanced = [];
  const makeInst = (geo, mat, list, shadow) => {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach(([m, tint], i) => { im.setMatrixAt(i, m); im.setColorAt(i, tint); });
    im.castShadow = shadow;
    im.receiveShadow = shadow;
    im.computeBoundingSphere();
    root.add(im);
    instanced.push(im);
    return im;
  };
  makeInst(bushGeometry(1, 3), leafMat, nearBushes, true);
  makeInst(bushGeometry(1, 5), leafMat, bushes, false);
  makeInst(treeGeometry(1, 5, 8), leafMat, trees, false);
  makeInst(strandGeo, strandMat, strands, false);

  // ---- Cascades ----
  // Ribbons of water pouring off a rim, thinning into spray as they fall.
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
        float fall = vUv.y; // 0 at the lip, 1 at the bottom
        float n = texture2D( uNoise, vec2( vUv.x * 0.9, fall * 2.2 - uTime * 0.55 ) ).r;
        float n2 = texture2D( uNoise, vec2( vUv.x * 2.3 + 0.3, fall * 5.0 - uTime * 1.1 ) ).r;
        float edge = smoothstep( 0.0, 0.25, vUv.x ) * smoothstep( 1.0, 0.75, vUv.x );
        float a = smoothstep( 0.3, 0.75, n * 0.6 + n2 * 0.5 ) * edge;
        a *= smoothstep( 0.0, 0.04, fall ) * ( 1.0 - smoothstep( 0.35, 1.0, fall ) );
        a = max( a, edge * 0.35 * smoothstep( 0.25, 0.9, fall ) * ( 1.0 - smoothstep( 0.7, 1.0, fall ) ) * n ); // spray
        gl_FragColor = vec4( vec3( 0.93, 0.96, 0.98 ), a * 0.88 );
        #include <fog_fragment>
      }`,
  });
  fallMat.uniforms.uTime = time;
  fallMat.uniforms.uNoise.value = detailTex;
  // The fall leaves the rim on the side facing the gallery (+ an offset).
  const addFall = (islandIdx, offset, width, length) => {
    const I = islands[islandIdx], m = rocks[islandIdx];
    const angle = ((islandIdx ? Math.atan2(-I.z, -I.x) : 0) + offset + Math.PI * 4) % (Math.PI * 2);
    const ud = m.geometry.userData, pos = m.geometry.attributes.position;
    const i = Math.round((angle / (Math.PI * 2)) * ud.seg) % ud.seg;
    const v = 1 + (ud.rings - 1) * ud.seg + i;
    const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
    const ox = Math.cos(angle), oz = Math.sin(angle);
    const g = new THREE.PlaneGeometry(width, length, 1, 24);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const f = (length / 2 - p.getY(k)) / length; // 0 top → 1 bottom
      const out = 1.5 + Math.sqrt(f) * length * 0.09; // leaves the lip, then drops
      p.setXYZ(k, p.getX(k) * (1 + f * 1.8), -f * length, out);
    }
    g.computeBoundingSphere();
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setY(k, 1 - uv.getY(k));
    const mesh = new THREE.Mesh(g, fallMat);
    mesh.position.set(x, y + 0.4, z);
    mesh.rotation.y = Math.atan2(ox, oz);
    mesh.renderOrder = 3;
    root.add(mesh);
  };
  addFall(1, -0.35, 4.5, 120);   // big island, right of the bay
  addFall(3, 0.3, 3, 90);
  addFall(5, -0.2, 5, 140);
  addFall(12, 0.4, 4, 110);
  addFall(0, 0.32, 2.6, 95);     // off the gallery's own island, east of the terrace

  // ---- Ciel nuageux, mer de nuages et brume ----
  // Fair-weather clouds on the sky (a cloud layer projected on a dome that
  // follows the camera), a slow sea of cloud far below, drifting veils.
  const cloudDomeMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.BackSide,
    uniforms: { uTime: time, uNoise: { value: detailTex }, uSun: { value: sunDir.clone().normalize() } },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: `
      uniform float uTime;
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
        float cover = smoothstep( 0.46, 0.72, n );
        float lit = 0.82 + 0.25 * smoothstep( 0.5, 0.85, n );
        float sun = pow( max( 0.0, dot( d, uSun ) ), 8.0 );
        vec3 col = vec3( 0.97, 0.97, 0.98 ) * lit + vec3( 0.3, 0.2, 0.08 ) * sun;
        float a = cover * smoothstep( 0.02, 0.22, d.y ) * 0.92;
        gl_FragColor = vec4( col, a );
      }`,
  });
  const cloudDome = new THREE.Mesh(new THREE.SphereGeometry(395, 40, 16), cloudDomeMat);
  cloudDome.renderOrder = -8;
  cloudDome.frustumCulled = false;
  root.add(cloudDome);

  const cloudMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uNoise: { value: null }, uSun: { value: new THREE.Vector3() } }]),
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
      uniform vec3 uSun;
      varying vec3 vWP;
      void main() {
        vec2 p = vWP.xz;
        float a = texture2D( uNoise, p * 0.0016 + vec2( uTime * 0.0012, 0.0 ) ).r;
        float b = texture2D( uNoise, p * 0.0047 - vec2( 0.0, uTime * 0.002 ) ).r;
        float c = texture2D( uNoise, p * 0.013 + vec2( uTime * 0.003 ) ).r;
        float d = a * 0.55 + b * 0.3 + c * 0.15;
        float cover = smoothstep( 0.32, 0.62, d );
        float shade = mix( 0.75, 1.05, smoothstep( 0.4, 0.8, d ) );
        vec3 col = vec3( 0.9, 0.92, 0.95 ) * shade;
        gl_FragColor = vec4( col, cover * 0.95 );
        #include <fog_fragment>
      }`,
  });
  cloudMat.uniforms.uTime = time;
  cloudMat.uniforms.uNoise.value = detailTex;
  const cloudSea = new THREE.Mesh(new THREE.PlaneGeometry(1100, 1100, 1, 1).rotateX(-Math.PI / 2), cloudMat);
  cloudSea.position.y = -175;
  cloudSea.renderOrder = -5;
  cloudSea.frustumCulled = false;
  root.add(cloudSea);
  const cloudSea2 = new THREE.Mesh(cloudSea.geometry, cloudMat);
  cloudSea2.position.y = -140;
  cloudSea2.scale.setScalar(0.8);
  cloudSea2.rotation.y = 1.3;
  cloudSea2.renderOrder = -4;
  cloudSea2.frustumCulled = false;
  root.add(cloudSea2);

  // Veils of mist: soft sprites hugging the islands' flanks (photo 1).
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
  const mists = [];
  {
    const rnd = mulberry32(606);
    const big = islands.filter((I, i) => i > 0 && !I.small && !I.sat);
    for (let n = 0; n < (lite ? 18 : 30); n++) {
      const I = big[Math.floor(rnd() * big.length)];
      const a = rnd() * Math.PI * 2;
      const w = I.R * (2 + rnd() * 2.5);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: mistTex, color: '#f1f3f4', transparent: true, opacity: 0.2 + rnd() * 0.25, depthWrite: false, fog: true }));
      sp.position.set(I.x + Math.cos(a) * I.R * 0.9, I.y - I.H * (0.05 + rnd() * 0.6), I.z + Math.sin(a) * I.R * 0.9);
      sp.scale.set(w, w * 0.3, 1);
      sp.renderOrder = 2;
      sp.userData = { base: sp.position.clone(), ph: rnd() * 6.28, sp: 0.03 + rnd() * 0.05 };
      root.add(sp);
      mists.push(sp);
    }
  }

  function update(t, camera) {
    time.value = t;
    for (const s of mists) {
      const u = s.userData;
      s.position.x = u.base.x + Math.sin(t * u.sp + u.ph) * 6;
      s.position.z = u.base.z + Math.cos(t * u.sp * 0.8 + u.ph) * 4;
    }
    // Clouds follow the camera so their edge never shows.
    cloudDome.position.copy(camera.position);
    cloudSea.position.x = camera.position.x; cloudSea.position.z = camera.position.z;
    cloudSea2.position.x = camera.position.x; cloudSea2.position.z = camera.position.z;
  }

  return { root, groundAt, update, instanced, islands, galleryMesh };
}
