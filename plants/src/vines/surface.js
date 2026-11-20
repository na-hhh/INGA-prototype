import * as THREE from 'three/webgpu';
import { surfaceMapUrl } from './scans.js';
import { abs, float, mix, normalWorld, positionWorld, texture, transformNormalToView, uniform, vec3 } from 'three/tsl';

// Scanned surfaces (rock, concrete, metal from Poly Haven, CC0; fetched by
// plants/scripts/fetch-assets.mjs, or loaded from Poly Haven; see scans.js)
// and a material that lays one onto any shape.

const loader = new THREE.TextureLoader();
const cache = new Map();

export function loadMap(url, colorSpace = THREE.NoColorSpace) {
  if (!cache.has(url)) {
    cache.set(url, loader.loadAsync(url).then((t) => {
      t.colorSpace = colorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 16;
      return t;
    }));
  }
  return cache.get(url);
}

// Colour, normal and "arm" (r: openness to the sky, g: roughness, b: metal).
export async function loadSurface(name) {
  const [diffuse, normal, arm] = await Promise.all([
    surfaceMapUrl(name, 'Diffuse').then((u) => loadMap(u, THREE.SRGBColorSpace)),
    surfaceMapUrl(name, 'nor_gl').then((u) => loadMap(u)),
    surfaceMapUrl(name, 'arm').then((u) => loadMap(u)),
  ]);
  return { diffuse, normal, arm };
}

// Which way the surface faces decides which of three flat projections of a
// map it mostly gets, so nothing is ever stretched.
const facing = () => {
  const w = abs(normalWorld).pow(vec3(6));
  return w.div(w.x.add(w.y).add(w.z));
};
export const tri = (map, scale) => {
  const p = positionWorld.mul(scale), w = facing();
  return texture(map, p.zy).mul(w.x).add(texture(map, p.xz).mul(w.y)).add(texture(map, p.xy).mul(w.z));
};
// The same for a normal map, as a tilt to add to the surface's own normal
// (in world space).
export const triTilt = (map, scale, strength) => {
  const p = positionWorld.mul(scale), w = facing();
  const a = texture(map, p.zy).xy.mul(2).sub(1).mul(strength), b = texture(map, p.xz).xy.mul(2).sub(1).mul(strength), c = texture(map, p.xy).xy.mul(2).sub(1).mul(strength);
  return vec3(0, a.y, a.x).mul(w.x).add(vec3(b.x, 0, b.y).mul(w.y)).add(vec3(c.x, c.y, 0).mul(w.z));
};

// A material made of one scanned surface repeated every `tile` units, with
// a finer copy of its bumps for close up and a much larger copy of its
// colour so the repeat does not show from afar. `userData.wet` (0 to 1)
// darkens it and gives it a sheen.
export function surfaceMaterial(maps, { tile = 6, strength = 1.2, metal = false, tint = '#ffffff' } = {}) {
  const wet = uniform(0);
  const material = new THREE.MeshStandardNodeMaterial();
  const scale = float(1 / tile);
  const arm = tri(maps.arm, scale);
  const far = tri(maps.diffuse, float(1 / (tile * 4.7))).g.mul(1.2).add(0.55);
  material.colorNode = tri(maps.diffuse, scale).rgb.mul(far).mul(arm.r).mul(uniform(new THREE.Color(tint))).mul(mix(float(1), float(0.6), wet));
  const tilt = triTilt(maps.normal, scale, strength).add(triTilt(maps.normal, float(4.3 / tile), strength * 0.5));
  material.normalNode = transformNormalToView(normalWorld.add(tilt).normalize());
  const rough = arm.g.clamp(0.08, 1);
  material.roughnessNode = mix(rough, rough.mul(0.45), wet.mul(0.85));
  material.metalnessNode = metal ? arm.b : float(0);
  material.userData.wet = wet;
  return material;
}
