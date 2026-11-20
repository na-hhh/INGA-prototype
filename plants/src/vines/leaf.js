import * as THREE from 'three/webgpu';

// A vine leaf, made from nothing but a few numbers: lobes fanning out from
// where the stalk joins, a toothed edge, and veins that follow the lobes.
// The same description produces both the mesh and its textures, so the
// veins in the normal map run exactly where the lobes of the mesh are.

const DEG = Math.PI / 180;
const EXTENT = 1.15; // the blade fits in a square this far each way from the stalk joint

// Each lobe: the direction it points (0 = straight ahead) and how long it is.
// No two real leaves match, so each variant is knocked off true: lobes a
// little long or short, swung to one side, wider or narrower.
export function lobeAxes(lobes, rng) {
  const n = Math.max(1, Math.round(lobes));
  const axes = [];
  const spacing = n > 1 ? 232 / (n - 1) : 0;
  const r = () => (rng ? rng() * 2 - 1 : 0);
  for (let i = 0; i < n; i++) {
    const ideal = n > 1 ? (-116 + i * spacing) * DEG : 0;
    axes.push({
      angle: ideal + r() * 7 * DEG,
      length: (1 - 0.36 * Math.pow(Math.abs(ideal) / (116 * DEG), 1.5)) * (1 + r() * 0.1),
      halfWidth: Math.max(40, spacing * 1.05) * DEG * (1 + r() * 0.12),
      bend: r() * 0.12, // how much its vein curves
    });
  }
  return axes;
}

// Distance from the stalk joint to the leaf edge in a given direction
// (before the teeth are cut).
export function outline(theta, axes, depth) {
  let r = 0.74 * (1 - depth * 0.5); // the body between the lobes
  for (const lobe of axes) {
    const d = Math.abs(theta - lobe.angle);
    if (d >= lobe.halfWidth) continue;
    // Each lobe comes to a point: rounded at its shoulders, straight-sided
    // towards the tip.
    const t = d / lobe.halfWidth;
    const reach = lobe.length * (0.45 * Math.pow(Math.cos(t * (Math.PI / 2)), 0.5) + 0.55 * (1 - Math.pow(t, 0.9 - depth * 0.5)));
    if (reach > r) r = reach;
  }
  // The notch where the stalk comes in.
  const fromBack = Math.PI - Math.abs(theta);
  return r * Math.pow(Math.min(1, fromBack / (30 * DEG)), 0.55);
}

const toUv = (bx, bz) => [(bx + EXTENT) / (2 * EXTENT), (bz + EXTENT) / (2 * EXTENT)];
const TOOTH = [-1, 0.25, 0.5, 1.5, 1, 0.5]; // each tooth rises gently and drops sharply
const GAP = 5 * DEG; // half-width of the slit where the stalk comes in

// The blade as a sheet of triangles, in its own flat frame: x and z across
// the blade from the stalk joint, y its relief. Rings of points run from
// the joint out to the edge, each ring with more points than the one
// inside it, so triangles are about the same size everywhere. `rim` is the
// number of points around the edge, `rings` how many rings.
export function bladeMesh({ lobeDepth, teeth }, axes, seed = 0, { rim = 144, rings = 6, fill = 0.8 } = {}) {
  const counts = [];
  let count = 1;
  for (let k = 1; k <= rings; k++) {
    counts.push(k === rings ? rim : Math.max(6, 6 * Math.round((rim * (k / rings) * fill) / 6)));
    count += counts[k - 1] + 1;
  }
  const x = new Float32Array(count), y = new Float32Array(count), z = new Float32Array(count);
  const reach = new Float32Array(count); // 0 at the joint, 1 at the edge
  const tris = [];
  const starts = [];
  let n = 1;
  for (let k = 1; k <= rings; k++) {
    const f = k / rings, around = counts[k - 1];
    starts.push(n);
    for (let q = 0; q <= around; q++, n++) {
      const theta = -Math.PI + GAP + (q / around) * 2 * (Math.PI - GAP);
      // The edge wanders in and out a little, differently for each variant.
      let edge = outline(theta, axes, lobeDepth) * (0.94 + 0.12 * noise(theta * 2.2 + seed * 13.7, seed * 3.1));
      // Teeth: coarse, with a smaller tooth between; no two the same size.
      if (k === rings) {
        const u = (q / around) * 144, base = Math.floor(u), part = u - base;
        const tooth = TOOTH[base % 6] + (TOOTH[(base + 1) % 6] - TOOTH[base % 6]) * part;
        edge *= 1 + teeth * tooth * (0.6 + 0.8 * hash(Math.floor(u / 6), seed));
      }
      const r = edge * f;
      const bx = Math.cos(theta) * r, bz = Math.sin(theta) * r;
      x[n] = bx;
      z[n] = bz;
      // Relief: the blade funnels a little at the stalk, its lobes arch
      // over and droop at the tips, and the rim ripples.
      y[n] = 0.07 * Math.sin(Math.min(1, r * 2.2) * Math.PI * 0.5) - 0.16 * r * r + 0.03 * f * f * Math.sin(theta * 9 + seed) + 0.05 * f * Math.cos(theta * 2.5 + seed * 2.3) + 0.09 * f * (noise(bx * 2.5 + seed * 7, bz * 2.5) - 0.5);
      reach[n] = f;
    }
    const outer = starts[k - 1], no = around;
    if (k === 1) {
      for (let q = 0; q < no; q++) tris.push(0, outer + q + 1, outer + q);
      continue;
    }
    // Zip this ring to the one inside it, taking whichever next point comes
    // first going round.
    const inner = starts[k - 2], ni = counts[k - 2];
    let i = 0, j = 0;
    while (i < ni || j < no) {
      if (j >= no || (i < ni && (i + 1) / ni < (j + 1) / no)) {
        tris.push(inner + i, inner + i + 1, outer + j);
        i++;
      } else {
        tris.push(inner + i, outer + j + 1, outer + j);
        j++;
      }
    }
  }
  return { count, x, y, z, reach, tris: new Uint32Array(tris), rimStart: starts[rings - 1], rimCount: rim + 1 };
}

export function leafGeometry({ lobeDepth, teeth }, axes, seed = 0, detail = undefined) {
  const position = [], color = [], uv = [], index = [];
  const push = (x, y, z, u, v, r = 1, g = 1, b = 1) => {
    position.push(x, y, z);
    uv.push(u, v);
    color.push(r, g, b);
    return position.length / 3 - 1;
  };
  // Stalk: a thin four-sided tube with a gentle arc, tinted red-brown.
  const STALK = 0.5;
  const stalkRings = 4;
  for (let i = 0; i <= stalkRings; i++) {
    const t = i / stalkRings;
    const x = t * STALK, y = 0.06 * Math.sin(t * Math.PI * 0.5), r = 0.018 * (1 - 0.3 * t);
    for (let q = 0; q < 4; q++) {
      const a = (q / 4) * Math.PI * 2;
      push(x, y + Math.cos(a) * r, Math.sin(a) * r, 0.5, 0.5, 1.9, 0.75, 0.55);
    }
    if (i > 0) {
      const b = (i - 1) * 4, c = i * 4;
      for (let q = 0; q < 4; q++) {
        const q1 = (q + 1) % 4;
        index.push(b + q, c + q, b + q1, b + q1, c + q, c + q1);
      }
    }
  }
  // Blade: rings of points from the joint out to the edge (see bladeMesh).
  const jx = STALK, jy = 0.06;
  const blade = bladeMesh({ lobeDepth, teeth }, axes, seed, detail);
  const offset = position.length / 3;
  for (let v = 0; v < blade.count; v++) push(jx + blade.x[v], jy + blade.y[v], blade.z[v], ...toUv(blade.x[v], blade.z[v]));
  for (let t = 0; t < blade.tris.length; t++) index.push(offset + blade.tris[t]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  // Where the blade's vertices sit in this geometry, for anything that reshapes it.
  geometry.userData.blade = { offset, mesh: blade };
  return geometry;
}

// Cheap repeatable noise.
export function hash(x, y) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// The veins at a point of the blade: how strongly a main vein or a side
// vein runs through it, how far the tissue between veins puffs up, and
// which way the nearest main vein runs.
const VEIN = { main: 0, side: 0, puff: 0, wx: 0, wz: 0, angle: 0 };
export function veinsAt(bx, bz, axes, seed = 0) {
  // Nothing in a leaf runs dead straight: look the veins up slightly
  // off from where this point really is, by an amount that drifts.
  const wx = bx + 0.045 * (noise(bx * 3.1 + seed * 11, bz * 3.1) - 0.5) + 0.012 * (noise(bx * 14 + seed, bz * 14) - 0.5);
  const wz = bz + 0.045 * (noise(bx * 3.1, bz * 3.1 + seed * 17) - 0.5) + 0.012 * (noise(bx * 14, bz * 14 + seed) - 0.5);
  const rho = Math.hypot(wx, wz), theta = Math.atan2(wz, wx);
  let main = 0, side = 0, puff = 0, nearest = Infinity, angle = theta;
  for (let v = 0; v < axes.length; v++) {
    const lobe = axes[v];
    const d = theta - lobe.angle - lobe.bend * rho; // the vein curves as it goes
    const along = rho * Math.cos(d), signed = rho * Math.sin(d), across = Math.abs(signed);
    if (along <= 0) continue;
    const width = 0.006 + 0.02 * Math.max(0, 1 - along / lobe.length);
    if (along < lobe.length * 1.05) main = Math.max(main, Math.exp(-((across / width) ** 2)));
    if (across < nearest) {
      nearest = across;
      angle = lobe.angle + lobe.bend * rho;
      // Side veins: unevenly spaced, the two sides of a main vein out of
      // step, some faint and some strong, a few missing altogether.
      const flank = signed > 0 ? 1 : 2;
      const density = 6.2 + 2.6 * hash(v, flank + seed * 5);
      const t = (along - across * (0.7 + 0.35 * hash(v + 9, flank + seed))) * density + hash(v + 3, flank) + 0.35 * (noise(along * 5 + v * 9, seed + flank) - 0.5);
      const which = Math.round(t);
      const off = Math.abs(t - which) / density;
      const vigour = hash(which + v * 31, flank + seed * 7);
      side = Math.exp(-((off / (0.005 + 0.006 * vigour)) ** 2)) * Math.min(1, across * 14) * Math.max(0, 1 - across * 1.6) * (vigour < 0.12 ? 0 : 0.45 + 0.75 * vigour);
      puff = Math.min(1, off * density * 2) * Math.min(1, across * 9);
    }
  }
  VEIN.main = main; VEIN.side = side; VEIN.puff = puff; VEIN.wx = wx; VEIN.wz = wz; VEIN.angle = angle;
  return VEIN;
}

// Colour and normal maps for the blade. Height is worked out per pixel from
// the vein network: main veins along the lobes, side veins branching off
// them in chevrons, a fine net between, and tissue that puffs up in the
// gaps. The normal map is the slope of that height.
export function leafTextures(axes, lobeDepth, seed = 0, size = 512) {
  const height = new Float32Array(size * size);
  const colorData = new Uint8Array(size * size * 4);
  const frontData = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const bx = ((i + 0.5) / size) * 2 * EXTENT - EXTENT;
      const bz = ((j + 0.5) / size) * 2 * EXTENT - EXTENT;
      const { main, side, puff, wx, wz } = veinsAt(bx, bz, axes, seed);
      const net = Math.max(0, 1 - Math.abs(noise(wx * 46 + seed * 5, wz * 46) - 0.5) * 16) * (0.4 + 1.2 * noise(bx * 6, bz * 6 + seed * 9));
      const mottle = noise(bx * 9 + 40 + seed * 3, bz * 9 + 40);
      const blotch = noise(bx * 2.4 + seed * 21, bz * 2.4 + 5);
      // Dimples, blisters and the odd scar.
      const pock = Math.max(0, noise(bx * 23 + seed * 2, bz * 23 + 70) - 0.72) * 3;
      // Deep relief: veins are cut well into the upper face and the tissue
      // between them stands up in pillows.
      height[i + j * size] = 0.6 * puff * (0.5 + blotch) - 1.7 * main - 0.7 * side - 0.2 * net + 0.16 * mottle + 0.35 * (blotch - 0.5) - 0.5 * pock;
      const vein = Math.min(1, main + side * 0.55 + net * 0.12);
      const o = (i + j * size) * 4;
      // Mostly neutral, so the leaf's own colour shows; veins paler and
      // yellower, the tissue slightly uneven.
      const tone = 0.9 + 0.06 * (blotch - 0.5) - 0.1 * pock;
      colorData[o] = 255 * Math.min(1, (0.8 + 0.04 * mottle + 0.2 * vein) * tone);
      colorData[o + 1] = 255 * Math.min(1, (0.86 + 0.03 * mottle + 0.12 * vein) * tone);
      colorData[o + 2] = 255 * Math.min(1, (0.74 + 0.04 * mottle + 0.02 * vein) * tone);
      colorData[o + 3] = 255;
      // When this spot comes into being. A leaf grows at its edge: tissue
      // near the stalk exists first and the margin advances outwards from
      // there, raggedly, further along the veins than between them.
      const edge = outline(Math.atan2(bz, bx), axes, lobeDepth) || 1e-3;
      const reach = Math.hypot(bx, bz) / edge;
      const when = reach * 0.7 + 0.2 * noise(bx * 7 + seed * 4, bz * 7 + 9) + 0.08 * noise(bx * 31, bz * 31 + seed) - 0.1 * main * (1 - reach);
      frontData[o] = frontData[o + 1] = frontData[o + 2] = 255 * Math.min(1, Math.max(0, when));
      frontData[o + 3] = 255;
    }
  }
  const normalData = new Uint8Array(size * size * 4);
  const strength = (2.6 * size) / 512;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const at = (x, y) => height[Math.min(size - 1, Math.max(0, x)) + Math.min(size - 1, Math.max(0, y)) * size];
      let nx = (at(i - 1, j) - at(i + 1, j)) * strength, ny = (at(i, j - 1) - at(i, j + 1)) * strength;
      const l = Math.hypot(nx, ny, 1);
      const o = (i + j * size) * 4;
      normalData[o] = 255 * (nx / l * 0.5 + 0.5);
      normalData[o + 1] = 255 * (ny / l * 0.5 + 0.5);
      normalData[o + 2] = 255 * (1 / l * 0.5 + 0.5);
      normalData[o + 3] = 255;
    }
  }
  const make = (data, colorSpace) => {
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.colorSpace = colorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  };
  return { map: make(colorData, THREE.SRGBColorSpace), normalMap: make(normalData, THREE.NoColorSpace), frontMap: make(frontData, THREE.NoColorSpace), height, size };
}
