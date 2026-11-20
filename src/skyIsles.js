// ---- Îles flottantes ----------------------------------------------------------
// The outside of the gallery: karst pillars torn from the ground and hanging
// in the sky. Sheer fluted limestone walls, a forested top, a ragged pendant
// underside trailing roots and vines, a few falls pouring off the rim into
// nothing, mist between the islands and a sea of cloud far below.
// The gallery itself is bedded on the largest island; its north cliff stops
// just short of the terrace edge, so past the balustrade there is only void.
//
// Everything is procedural and deterministic (fixed seeds): the same sky on
// every load. createSkyIsles() builds it all and returns
//   root       — the group holding everything
//   groundAt   — top of the gallery's island at (x, z), or null over the void
//   update     — per-frame animation (vines, falls, mist, clouds)
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

// Tileable grey noise, used by the shaders for fine rock detail, falls and clouds.
function tileNoiseTexture(size, cells, oct, seed) {
  const rnd = mulberry32(seed);
  const data = new Uint8Array(size * size * 4);
  const layers = [];
  for (let o = 0; o < oct; o++) {
    const c = cells << o;
    const g = new Float32Array(c * c);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    layers.push([c, g]);
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0, a = 0.5, tot = 0;
      for (const [c, g] of layers) {
        const fx = (x / size) * c, fy = (y / size) * c;
        const ix = Math.floor(fx), iy = Math.floor(fy);
        let tx = fx - ix, ty = fy - iy;
        tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
        const x1 = (ix + 1) % c, y1 = (iy + 1) % c;
        const a0 = g[iy * c + ix], b0 = g[iy * c + x1], c0 = g[y1 * c + ix], d0 = g[y1 * c + x1];
        v += a * (a0 + (b0 - a0) * tx + (c0 - a0) * ty + (a0 - b0 - c0 + d0) * tx * ty);
        tot += a; a *= 0.55;
      }
      const k = (y * size + x) * 4, b = Math.round((v / tot) * 255);
      data[k] = data[k + 1] = data[k + 2] = b; data[k + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// ---- Couleurs ----------------------------------------------------------------
const C = {
  lime: new THREE.Color('#87877f'),     // weathered grey limestone
  limeWarm: new THREE.Color('#978f80'),
  limeDark: new THREE.Color('#44463f'), // wet streaks
  under: new THREE.Color('#3b3e36'),    // damp underside
  moss: new THREE.Color('#4f6034'),
  mossLight: new THREE.Color('#71803f'),
  ground: new THREE.Color('#3f4d2a'),
};

// Lighting help for everything outside: the hall's ambient is kept dim on
// purpose, so the islands get their own sky/ground ambient (soft, cool from
// above, faint warm bounce from below) on top of the sun.
function addAmbient(mat, sky, ground, extra = {}) {
  const U = { uAmbSky: { value: new THREE.Color(sky) }, uAmbGround: { value: new THREE.Color(ground) } };
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    Object.assign(sh.uniforms, U);
    if (prev) prev(sh, r);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uAmbSky;\nuniform vec3 uAmbGround;')
      .replace('#include <opaque_fragment>', [
        '{',
        '  vec3 ambN = inverseTransformDirection( normal, viewMatrix );',
        '  outgoingLight += diffuseColor.rgb * mix( uAmbGround, uAmbSky, ambN.y * 0.5 + 0.5 );',
        '}',
        '#include <opaque_fragment>',
      ].join('\n'));
  };
  const key = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  mat.customProgramCacheKey = () => key() + '|isleAmb' + (extra.key || '');
  return U;
}

export function createSkyIsles({ lite = false, sunDir, gallery }) {
  const root = new THREE.Group();
  root.name = 'îles flottantes';
  const detailTex = tileNoiseTexture(256, 8, 5, 77);
  const time = { value: 0 };

  // ---- Matière de la roche ----
  // Vertex colours carry the large-scale story (pale walls, dark wet streaks,
  // damp underside, green top); the shader adds triplanar detail stretched
  // vertically (karst fluting and runoff stains) and moss on every ledge.
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
  rockMat.onBeforeCompile = (sh) => {
    sh.uniforms.uDetail = { value: detailTex };
    sh.uniforms.uMoss = { value: C.moss };
    sh.uniforms.uMossLight = { value: C.mossLight };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vIsleWP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvIsleWP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vIsleWP;\nuniform sampler2D uDetail;\nuniform vec3 uMoss;\nuniform vec3 uMossLight;')
      .replace('#include <normal_fragment_begin>', [
        '#include <normal_fragment_begin>',
        '{',
        '  vec3 wn = inverseTransformDirection( normal, viewMatrix );',
        '  vec3 bw = pow( abs( wn ), vec3( 4.0 ) ); bw /= bw.x + bw.y + bw.z;',
        '  vec3 p = vIsleWP;',
        // Side projections: fine across, long down → vertical flutes / stains.
        '  float sx = texture2D( uDetail, vec2( p.z * 0.09, p.y * 0.011 ) ).r * 0.6 + texture2D( uDetail, vec2( p.z * 0.41, p.y * 0.06 ) ).r * 0.4;',
        '  float sz = texture2D( uDetail, vec2( p.x * 0.09, p.y * 0.011 ) ).r * 0.6 + texture2D( uDetail, vec2( p.x * 0.41, p.y * 0.06 ) ).r * 0.4;',
        '  float sy = texture2D( uDetail, p.xz * 0.045 ).r * 0.5 + texture2D( uDetail, p.xz * 0.31 ).r * 0.5;',
        '  float d = sx * bw.x + sy * bw.y + sz * bw.z;',
        '  float grain = texture2D( uDetail, p.xz * 1.7 + p.y * 0.9 ).r;',
        '  diffuseColor.rgb *= 0.55 + 0.85 * d * (0.85 + 0.3 * grain);',
        // Dark crevices between the flutes, pale weathered ribs.
        '  diffuseColor.rgb *= mix( 0.62, 1.12, smoothstep( 0.38, 0.62, d ) );',
        // Moss on anything facing up: ledges, the strata lips, the top.
        '  float hang = smoothstep( 0.55, 0.8, texture2D( uDetail, vec2( ( p.x + p.z ) * 0.035, p.y * 0.004 ) ).r ) * smoothstep( 0.2, -0.1, abs( wn.y ) - 0.25 );',
        '  float up = max( smoothstep( 0.2, 0.65, wn.y + ( d - 0.5 ) * 0.7 ), hang * 0.8 );',
        '  vec3 moss = mix( uMoss, uMossLight, smoothstep( 0.35, 0.75, d ) ) * ( 0.75 + 0.5 * grain );',
        '  diffuseColor.rgb = mix( diffuseColor.rgb, moss * ( 0.6 + 0.6 * vColor.g / max( vColor.r, 0.01 ) ), up * 0.85 );',
        '}',
      ].join('\n'));
  };
  rockMat.customProgramCacheKey = () => 'inga-isle-rock';
  addAmbient(rockMat, '#5d6670', '#2f2c28', { key: 'rock' });

  // ---- Générateur d'une île ----
  // Polar grid: a centre vertex, cap rings out to the rim, side rows down the
  // cliff to a pendant tip. Indexed and closed (the seam wraps), so normals
  // are smooth everywhere.
  // opt: cx, cz, y (rim height), H (depth below the rim), R(θ) rim radius,
  //      cap(x, z, s) height above the rim, tip [dx, dz], seg, rings, rows,
  //      seed, onTop (fills `tops` for trees).
  function islandGeometry(opt) {
    const { cx, cz, y: rimY, H, R, cap, seg, rings, rows } = opt;
    const tip = opt.tip || [0, 0];
    const sd = opt.seed * 13.7;
    const Rm = opt.Rmean;
    const sz = Rm / 30; // scale of the features
    const verts = 1 + rings * seg + rows * seg + 1;
    const pos = new Float32Array(verts * 3);
    const tArr = new Float32Array(verts); // 0 on the cap, 0..1 down the side
    const ang = Array.from({ length: seg }, (_, i) => (i / seg) * Math.PI * 2);
    const rimR = ang.map((a) => R(a));
    // Horizontal (outward) displacement shared by the cap rim and the side.
    const mul = opt.dispMul || (() => 1);
    const disp = (x, y, z, t, a) => mul(a, t) * dispRaw(x, y, z, t);
    const dispRaw = (x, y, z, t) => {
      const f = 0.075 / sz, g = 0.018 / sz;
      const flutes = fbm(N1, x * f + sd, y * f * 0.16, z * f, 4)            // vertical columns
        + 0.45 * (ridged(N3, x * f * 2.6, y * f * 0.25 + sd, z * f * 2.6, 2) - 0.6); // sharp ribs
      const bulge = fbm(N2, x * g, y * g * 0.7 + sd, z * g, 3);              // big buttresses
      const strata = smooth(0.78, 0.97, ((y / (6.5 * sz) + 0.6 * N3(x * 0.05, sd, z * 0.05)) % 1 + 1) % 1); // ledges
      return (flutes * 4.2 + bulge * 9 + strata * 1.1) * sz * (1 + 1.4 * t * t);
    };
    // Profile: sheer upper walls, then a ragged inverted cone.
    const prof = (t) => Math.pow(Math.max(0, 1 - Math.pow(t, 2.1)), 0.78);
    let k = 0;
    const put = (x, y, z, t) => { pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z; tArr[k] = t; k++; };
    put(cx, rimY + cap(cx, cz, 0), cz, 0);
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
        put(x, y, z, 0);
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
        put(x, y, z, t);
      }
    }
    put(cx + tip[0], rimY - H * 1.12, cz + tip[1], 1);
    const idx = [];
    for (let i = 0; i < seg; i++) idx.push(0, 1 + ((i + 1) % seg), 1 + i);
    const ringStart = (r) => 1 + (r - 1) * seg; // r = 1..rings+rows
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
    // Vertex colours.
    const nor = geo.attributes.normal;
    const col = new Float32Array(verts * 3);
    const c = new THREE.Color(), c2 = new THREE.Color();
    for (let v = 0; v < verts; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2], t = tArr[v];
      const ny = nor.getY(v);
      const n = fbm(N3, x * 0.02, y * 0.02, z * 0.02, 3);
      c.copy(C.lime).lerp(C.limeWarm, smooth(-0.3, 0.4, n));
      // Runoff streaks: long vertical dark stripes, strongest under the rim.
      const streak = smooth(0.1, 0.5, fbm(N1, x * 0.11 / sz, y * 0.006 + sd, z * 0.11 / sz, 3)) * (0.35 + 0.65 * Math.exp(-t * 3));
      c.lerp(C.limeDark, streak * 0.7);
      c.lerp(C.under, smooth(0.35, 0.9, t) * 0.75);
      if (ny > 0.55 && t === 0) {
        c2.copy(C.ground).lerp(C.mossLight, smooth(-0.3, 0.5, fbm(N2, x * 0.06, 0, z * 0.06, 3)) * 0.6);
        c.lerp(c2, smooth(0.55, 0.85, ny));
      }
      col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.userData = { tArr, rimY, cx, cz, seg, rings, rows, rimR };
    geo.computeBoundingSphere();
    return geo;
  }

  // ---- Végétation ----
  // Umbrella-crowned trees (a few lumpy blobs on a thin trunk) and shrubs.
  // Two levels of detail: smooth crowns near the gallery, light ones far off.
  function treeGeometry(detail, blobs, seed, trunk = true) {
    const rnd = mulberry32(seed);
    const parts = [];
    const colorize = (g, fn) => {
      const p = g.attributes.position, a = new Float32Array(p.count * 3), cc = new THREE.Color();
      for (let i = 0; i < p.count; i++) { fn(cc, p.getX(i), p.getY(i), p.getZ(i)); a[i * 3] = cc.r; a[i * 3 + 1] = cc.g; a[i * 3 + 2] = cc.b; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      return g;
    };
    if (trunk) {
      const t = new THREE.CylinderGeometry(0.022, 0.05, 0.7, 6, 1).translate(0, 0.35, 0);
      t.deleteAttribute('uv');
      parts.push(colorize(t, (cc) => cc.set('#3b3229')));
    }
    const dark = new THREE.Color('#18231a'), light = new THREE.Color('#41592c');
    for (let b = 0; b < blobs; b++) {
      let g = new THREE.IcosahedronGeometry(1, detail);
      g.deleteAttribute('uv'); g.deleteAttribute('normal');
      g = mergeVertices(g);
      const a = rnd() * Math.PI * 2, r = b === 0 ? 0 : 0.12 + rnd() * 0.2;
      const sx = 0.2 + rnd() * 0.14, sy = 0.11 + rnd() * 0.07;
      const ox = Math.cos(a) * r, oz = Math.sin(a) * r, oy = (trunk ? 0.72 : 0.25) + rnd() * 0.16 - r * 0.25;
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const l = 1 + 0.28 * N1(x * 2.1 + b * 7, y * 2.1, z * 2.1 + seed);
        p.setXYZ(i, ox + x * sx * l, oy + y * sy * l * (y < 0 ? 0.6 : 1), oz + z * sx * l);
      }
      g.computeVertexNormals();
      parts.push(colorize(g, (cc, x, y) => cc.copy(dark).lerp(light, smooth(oy - sy, oy + sy, y))));
    }
    const g = mergeGeometries(parts);
    g.computeBoundingSphere();
    return g;
  }
  const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  addAmbient(leafMat, '#4c5a4a', '#262a20', { key: 'leaf' });

  // Hanging roots / vines: thin tapered strands that sway a little.
  const vineGeo = new THREE.CylinderGeometry(0.06, 0.02, 1, 4, 8, true).translate(0, -0.5, 0);
  vineGeo.deleteAttribute('uv');
  const vineMat = new THREE.MeshStandardMaterial({ color: '#4a4a34', roughness: 1, side: THREE.DoubleSide });
  vineMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        '{',
        '  float ph = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.07;',
        '  float h = -position.y; float k = h * h * 0.035 * instanceMatrix[1].y;',
        '  transformed.x += sin( uTime * 0.6 + ph ) * k;',
        '  transformed.z += cos( uTime * 0.47 + ph * 1.3 ) * k;',
        '}',
      ].join('\n'));
  };
  vineMat.customProgramCacheKey = () => 'inga-isle-vine';
  addAmbient(vineMat, '#4a4f44', '#24221d', { key: 'vine' });

  const nearTrees = [], farTrees = [], shrubs = [], vines = [];
  const M = new THREE.Matrix4(), Qn = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), E = new THREE.Euler();
  const pushInst = (list, x, y, z, h, w, yaw, tint) => {
    E.set((Math.random() - 0.5) * 0.12, yaw, (Math.random() - 0.5) * 0.12);
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
  // Ground height on the gallery's island (null outside it: void).
  const galleryRim = (x, z) => {
    const a = Math.atan2(z - GI.cz, x - GI.cx);
    return galleryR(a);
  };
  function groundAt(x, z) {
    const r = Math.hypot(x - GI.cx, z - GI.cz);
    const rr = galleryRim(x, z);
    if (r > rr) return null;
    return GI.y + galleryCapH(x, z) * (1 - smooth(0.82, 1, r / rr));
  }

  // Trees and bushes on the gallery's island, clear of the building.
  {
    const rnd = mulberry32(5);
    for (let n = 0, tries = 0; n < (lite ? 260 : 400) && tries < 9000; tries++) {
      const a = rnd() * Math.PI * 2, s = Math.sqrt(rnd()) * 0.96;
      const rr = galleryR(a) * s;
      const x = GI.cx + Math.cos(a) * rr, z = GI.cz + Math.sin(a) * rr;
      const d = outside(x, z);
      if (d < 2.2) continue;
      const y = groundAt(x, z);
      if (y == null) continue;
      const big = d > 5 && rnd() < 0.7;
      const h = big ? 4 + rnd() * 6 : 1.4 + rnd() * 2;
      pushInst(big ? nearTrees : shrubs, x, y - 0.15, z, h, h * (0.9 + rnd() * 0.5), rnd() * 6.28, 0.75 + rnd() * 0.45);
      n++;
    }
  }

  // ---- Les autres îles ----
  // Hand-placed for the view through the bay (north, +z), then the rest of
  // the sky all around. [x, rim y, z, mean radius, depth]
  const LAYOUT = [
    [78, 16, 96, 34, 100], [-62, 42, 128, 22, 62], [-18, -38, 162, 27, 84], [34, 66, 214, 18, 56],
    [-132, 6, 205, 38, 112], [142, -58, 188, 30, 92], [8, 28, 305, 46, 125], [-46, -82, 86, 14, 44],
    [42, -24, 62, 6, 17], [-27, 13, 72, 5, 14], [112, 72, 124, 12, 36], [-92, 96, 92, 10, 30],
    [124, 10, -12, 40, 112], [-118, -16, 22, 36, 102], [-62, 30, -124, 30, 84], [92, -42, -112, 34, 92],
    [0, 52, -205, 50, 132], [206, 22, 64, 40, 104], [-214, 40, 92, 45, 112], [180, 60, -150, 32, 90],
    [-190, -30, -60, 40, 108], [60, 90, -60, 14, 40],
  ];
  const islands = [{ x: GI.cx, z: GI.cz, y: GI.y, R: 40, H: GI.H }];
  const rocks = [galleryMesh];
  LAYOUT.forEach(([x, y, z, Rm, H], i) => {
    const seed = 10 + i;
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
    const fine = Math.max(0.35, Math.min(1, 140 / dist)) * (lite ? 0.75 : 1);
    const seg = Math.round(Math.max(40, Math.min(200, Rm * 4.2 * fine)));
    const geo = islandGeometry({
      cx: x, cz: z, y, H, R, Rmean: Rm, seed,
      cap: (px, pz, s) => Rm * (0.1 + 0.16 * fbm(N1, px * 0.04 + seed, 1, pz * 0.04, 3)) * (1 - s * s) + Rm * 0.04 * fbm(N3, px * 0.2, seed, pz * 0.2, 2) * (1 - s),
      tip: [(rnd() - 0.5) * Rm * 0.6, (rnd() - 0.5) * Rm * 0.6],
      seg, rings: Math.max(6, Math.round(seg / 9)), rows: Math.round(Math.max(24, Math.min(110, H * 0.75 * fine))),
    });
    const m = new THREE.Mesh(geo, rockMat);
    root.add(m);
    rocks.push(m);
    islands.push({ x, z, y, R: Rm, H });
  });

  // Small fragments drifting between the islands, merged into one mesh.
  {
    const rnd = mulberry32(4242);
    const geos = [];
    for (let n = 0, tries = 0; n < 46 && tries < 2000; tries++) {
      const a = rnd() * Math.PI * 2, d = 55 + Math.pow(rnd(), 0.8) * 230;
      const x = Math.cos(a) * d, z = Math.sin(a) * d * (rnd() < 0.6 ? 1 : -1) + 30, y = -90 + rnd() * 170;
      const Rm = 1.2 + Math.pow(rnd(), 2) * 6;
      if (islands.some((I) => Math.hypot(x - I.x, z - I.z) < I.R * 1.15 + Rm + 6 && y < I.y + 12 && y > I.y - I.H * 1.15 - 8)) continue;
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

  // Trees on every top, shrubs on cliff ledges, vines under rims and bellies.
  {
    const rnd = mulberry32(99);
    const tmpN = new THREE.Vector3();
    for (const m of rocks) {
      const g = m.geometry, ud = g.userData;
      const pos = g.attributes.position, nor = g.attributes.normal;
      const isGallery = m === galleryMesh;
      const far = !isGallery;
      const scale = isGallery ? 1 : Math.max(0.6, Math.min(1.6, (g.boundingSphere.radius / 40)));
      if (ud.tArr && !isGallery && ud.rings > 3) {
        // Trees: sample cap vertices (rings), thicker at the rim.
        const capCount = 1 + ud.rings * ud.seg;
        const want = Math.min(lite ? 320 : 520, Math.round(capCount * 0.3));
        for (let n = 0; n < want; n++) {
          const r = ud.rings - Math.floor(Math.pow(rnd(), 1.6) * (ud.rings - 1)) ; // bias to the rim
          const v = 1 + (r - 1) * ud.seg + Math.floor(rnd() * ud.seg);
          if (nor.getY(v) < 0.6) continue;
          const jx = (rnd() - 0.5) * 2, jz = (rnd() - 0.5) * 2;
          const h = (3 + rnd() * 5) * Math.min(1.3, scale);
          pushInst(farTrees, pos.getX(v) + jx, pos.getY(v) - 0.3, pos.getZ(v) + jz, h, h * (0.9 + rnd() * 0.6), rnd() * 6.28, 0.7 + rnd() * 0.5);
        }
      }
      // Ledges on the cliffs: shrubs. Undersides and the rim: hanging strands.
      const n0 = ud.rings ? 1 + ud.rings * ud.seg : 0;
      const sideCount = pos.count - n0;
      const shrubWant = Math.round(sideCount * (isGallery ? 0.04 : 0.06) * (lite ? 0.7 : 1));
      for (let n = 0; n < shrubWant; n++) {
        const v = n0 + Math.floor(rnd() * sideCount);
        const t = ud.tArr[v];
        if (t > 0.75 || nor.getY(v) < 0.1) continue;
        tmpN.set(nor.getX(v), 0, nor.getZ(v)).normalize();
        const h = (1.5 + rnd() * 3) * scale;
        pushInst(shrubs, pos.getX(v) + tmpN.x * 0.3, pos.getY(v) - 0.4, pos.getZ(v) + tmpN.z * 0.3, h, h * 1.3, rnd() * 6.28, 0.6 + rnd() * 0.5);
      }
      const vineWant = Math.round(sideCount * (isGallery ? 0.03 : 0.035) * (lite ? 0.7 : 1));
      for (let n = 0; n < vineWant; n++) {
        const v = n0 + Math.floor(rnd() * sideCount);
        const t = ud.tArr[v];
        const ny = nor.getY(v);
        const rim = t < 0.06;
        if (!rim && ny > -0.2) continue;
        if (isGallery && pos.getZ(v) > G.northEdge - 3 && Math.abs(pos.getX(v)) < G.terraceHalfW + 2 && pos.getY(v) > GI.y - 6) continue; // keep the terrace view clear
        const L = (rim ? 3 + rnd() * 12 : 2 + Math.pow(rnd(), 1.5) * 22) * Math.max(0.7, scale);
        const w = (0.8 + rnd() * 1.2) * (far ? 1.6 : 1);
        M.compose(P.set(pos.getX(v), pos.getY(v) + 0.3, pos.getZ(v)), Qn.identity(), S.set(w, L, w));
        vines.push([M.clone(), 0.65 + rnd() * 0.5]);
      }
    }
  }
  const instanced = [];
  const makeInst = (geo, mat, list, shadow) => {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const c = new THREE.Color();
    list.forEach(([m, tint], i) => { im.setMatrixAt(i, m); im.setColorAt(i, c.setScalar(tint)); });
    im.castShadow = shadow;
    im.receiveShadow = shadow;
    im.computeBoundingSphere();
    root.add(im);
    instanced.push(im);
    return im;
  };
  makeInst(treeGeometry(1, 6, 3), leafMat, nearTrees, true);
  makeInst(treeGeometry(0, 4, 8), leafMat, farTrees, false);
  makeInst(treeGeometry(0, 3, 12, false), leafMat, shrubs, false);
  makeInst(vineGeo, vineMat, vines, false);

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
        gl_FragColor = vec4( vec3( 0.93, 0.95, 0.96 ), a * 0.85 );
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
    // Rim vertex nearest that angle.
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
  addFall(14, 0.4, 4, 110);
  addFall(0, 0.32, 2.6, 95);     // off the gallery's own island, east of the terrace

  // ---- Mer de nuages et brume ----
  // Far below, a slow sea of cloud; between the islands, drifting veils.
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
        float shade = mix( 0.72, 1.05, smoothstep( 0.4, 0.8, d ) );
        vec3 col = vec3( 0.86, 0.87, 0.88 ) * shade + vec3( 0.12, 0.08, 0.03 ) * pow( max( 0.0, dot( normalize( vec3( p.x, 0.0, p.y ) + 1e-3 ), uSun ) ), 4.0 ) * cover;
        gl_FragColor = vec4( col, cover * 0.95 );
        #include <fog_fragment>
      }`,
  });
  cloudMat.uniforms.uTime = time;
  cloudMat.uniforms.uNoise.value = detailTex;
  cloudMat.uniforms.uSun.value.set(sunDir.x, 0, sunDir.z).normalize();
  const cloudSea = new THREE.Mesh(new THREE.PlaneGeometry(1100, 1100, 1, 1).rotateX(-Math.PI / 2), cloudMat);
  cloudSea.position.y = -175;
  cloudSea.renderOrder = -5;
  cloudSea.frustumCulled = false;
  root.add(cloudSea);
  // Second, thinner layer a little higher, for depth.
  const cloudSea2 = new THREE.Mesh(cloudSea.geometry, cloudMat);
  cloudSea2.position.y = -140;
  cloudSea2.scale.setScalar(0.8);
  cloudSea2.rotation.y = 1.3;
  cloudSea2.renderOrder = -4;
  cloudSea2.frustumCulled = false;
  root.add(cloudSea2);

  // Veils of mist: soft sprites hugging the islands' flanks and bellies.
  const mistTex = (() => {
    const s = 128, cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const x = cv.getContext('2d'), img = x.createImageData(s, s);
    const n = perlin3(31);
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
      const u = i / s - 0.5, v = j / s - 0.5;
      const r = Math.hypot(u, v * 1.7) * 2;
      const f = Math.max(0, 1 - r) ** 1.6 * (0.6 + 0.4 * fbm(n, u * 5, v * 5, 0.5, 4) * 1.6);
      const k = (j * s + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = Math.max(0, Math.min(255, f * 255));
    }
    x.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const mists = [];
  {
    const rnd = mulberry32(606);
    const big = islands.filter((I) => !I.small);
    for (let n = 0; n < (lite ? 20 : 34); n++) {
      const I = big[1 + Math.floor(rnd() * (big.length - 1))];
      const a = rnd() * Math.PI * 2;
      const w = I.R * (2 + rnd() * 2.5);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: mistTex, color: '#e9e8e4', transparent: true, opacity: 0.22 + rnd() * 0.25, depthWrite: false, fog: true }));
      sp.position.set(I.x + Math.cos(a) * I.R * 0.9, I.y - I.H * (0.2 + rnd() * 0.7), I.z + Math.sin(a) * I.R * 0.9);
      sp.scale.set(w, w * 0.32, 1);
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
    // The cloud sea follows the camera so its edge never shows.
    cloudSea.position.x = camera.position.x; cloudSea.position.z = camera.position.z;
    cloudSea2.position.x = camera.position.x; cloudSea2.position.z = camera.position.z;
  }

  return { root, groundAt, update, instanced, islands, galleryMesh };
}
