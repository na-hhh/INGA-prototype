// ---- Roches scannées (les mêmes que la liane des plantes) --------------------
// Blocs et pierres photoscannés de Poly Haven (CC0) : boulder_01,
// namaqualand_boulder_03/06, rock_07, rock_09. Ils viennent de
// public/assets/rock/ s'ils y sont (npm run fetch-scans), sinon directement
// de Poly Haven. La liste et le choix de la source sont partagés avec la
// liane : plants/src/vines/scans.js.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { modelSource } from '../plants/src/vines/scans.js';

// Du plus léger au plus lourd ; les îles lointaines et le mode LÉGER ne
// prennent que les premiers.
export const SCAN_ROCKS = ['rock_09', 'rock_07', 'namaqualand_boulder_03', 'boulder_01', 'namaqualand_boulder_06'];
export const LIGHT_ROCKS = 2;

const cache = new Map();
// { geometry (centrée, base à y = 0, taille max 1), material }
export function loadScanRock(name) {
  if (!cache.has(name)) {
    cache.set(name, (async () => {
      const src = await modelSource(name);
      const manager = new THREE.LoadingManager();
      if (src.files) manager.setURLModifier((u) => src.files[Object.keys(src.files).find((rel) => u.endsWith(rel))] ?? u);
      const scene = (await new GLTFLoader(manager).loadAsync(src.url)).scene;
      let mesh = null;
      scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
      scene.updateMatrixWorld(true);
      const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      geometry.computeBoundingBox();
      const b = geometry.boundingBox, c = b.getCenter(new THREE.Vector3());
      const size = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
      geometry.translate(-c.x, -b.min.y, -c.z).scale(1 / size, 1 / size, 1 / size);
      geometry.computeBoundingSphere();
      const material = mesh.material;
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) if (material[k]) material[k].anisotropy = 8;
      return { geometry, material };
    })().catch((e) => { console.warn('roche scannée indisponible :', name, e.message || e); return null; }));
  }
  return cache.get(name);
}

// Pose `list` = [{ rock (indice dans SCAN_ROCKS), matrix }] dans `group`, un
// InstancedMesh par modèle, dès que les modèles sont arrivés.
export function placeScanRocks(group, list, { shadow = false } = {}) {
  const by = new Map();
  for (const it of list) (by.get(it.rock) ?? by.set(it.rock, []).get(it.rock)).push(it.matrix);
  for (const [i, mats] of by) {
    loadScanRock(SCAN_ROCKS[i]).then((m) => {
      if (!m) return;
      const im = new THREE.InstancedMesh(m.geometry, m.material, mats.length);
      mats.forEach((mt, k) => im.setMatrixAt(k, mt));
      im.castShadow = im.receiveShadow = shadow;
      im.computeBoundingSphere();
      im.name = 'roches scannées';
      group.add(im);
    });
  }
}
