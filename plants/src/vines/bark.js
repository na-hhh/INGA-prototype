import * as THREE from 'three/webgpu';

// Surface detail for stems, generated rather than photographed. Two looks:
// a young green shoot (fine ribs running along it, a few raised pores) and
// old wood (stringy bark in long strips, split by cracks). Both wrap
// seamlessly around the stem and repeat along it.

function hash(x, y) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Noise that repeats every (px, py) cells, so textures tile.
function tile(x, y, px, py) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const m = (a, p) => ((a % p) + p) % p;
  const a = hash(m(xi, px), m(yi, py)), b = hash(m(xi + 1, px), m(yi, py));
  const c = hash(m(xi, px), m(yi + 1, py)), d = hash(m(xi + 1, px), m(yi + 1, py));
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function build(size, heightAt, colorAt, strength) {
  const height = new Float32Array(size * size);
  const colorData = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size, v = j / size;
      const h = heightAt(u, v);
      height[i + j * size] = h;
      const c = colorAt(u, v, h);
      const o = (i + j * size) * 4;
      colorData[o] = 255 * Math.min(1, c[0]);
      colorData[o + 1] = 255 * Math.min(1, c[1]);
      colorData[o + 2] = 255 * Math.min(1, c[2]);
      colorData[o + 3] = 255;
    }
  }
  const normalData = new Uint8Array(size * size * 4);
  const at = (x, y) => height[((x + size) % size) + ((y + size) % size) * size];
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const nx = (at(i - 1, j) - at(i + 1, j)) * strength, ny = (at(i, j - 1) - at(i, j + 1)) * strength;
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
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  };
  return { map: make(colorData, THREE.SRGBColorSpace), normalMap: make(normalData, THREE.NoColorSpace) };
}

export function stemTextures(size = 256) {
  // u runs around the stem, v along it.
  const shoot = build(
    size,
    (u, v) => {
      const ribs = 0.5 + 0.5 * Math.sin((u * 9 + 0.25 * tile(u * 4, v * 3, 4, 3)) * 2 * Math.PI);
      // Pores: a scattering of small bumps, longer than they are wide.
      const pores = Math.max(0, tile(u * 24, v * 9, 24, 9) - 0.78) * 4;
      return 0.22 * ribs + 0.5 * pores + 0.1 * tile(u * 40, v * 40, 40, 40);
    },
    (u, v, h) => {
      const k = 0.92 + 0.12 * h;
      return [k, k, k * 0.96];
    },
    1.6,
  );
  const wood = build(
    size,
    (u, v) => {
      // Strips of bark: ridges drawn out along the stem, wandering a little.
      const wander = 0.6 * tile(u * 3, v * 2, 3, 2);
      const strips = 1 - Math.abs(tile(u * 11 + wander, v * 1.5, 11, 3) - 0.5) * 2;
      const fibres = tile(u * 46, v * 5, 46, 5);
      // Cracks where the strips have split apart.
      const crack = Math.max(0, 1 - Math.abs(tile(u * 5 + wander * 0.5, v * 1, 5, 2) - 0.5) * 9);
      const flakes = Math.max(0, tile(u * 9, v * 4, 9, 4) - 0.6) * 1.5;
      return 0.75 * strips + 0.3 * fibres + 0.35 * flakes - 1.2 * crack;
    },
    (u, v, h) => {
      // Dark in the cracks, pale and grey on the raised fibres.
      const k = Math.max(0.35, Math.min(1.25, 0.8 + 0.4 * h));
      return [k, k * 0.97, k * 0.93];
    },
    2.4,
  );
  return { shoot, wood };
}
