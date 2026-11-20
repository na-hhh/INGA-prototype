// ---- Objets posés (éditeur) ----------------------------------------------------
// Things placed by hand with the editor: bushes, trees, boulders, lights,
// falls, mist veils, hanging lianas. Each is a plain def { id, type, name, x,
// y, z, rotY, scale, …params } rendered as one group; the editor moves,
// turns and scales the group, and rebuilds it when a parameter changes.
// Materials and geometries come from the islands' shared kit, so placed
// vegetation matches the islands exactly.
import * as THREE from 'three';
import { islandGeometry, ISLE_DEFAULTS } from './skyIsles.js';

const leafFields = [
  { k: 'hue', label: 'Teinte', min: 0.1, max: 0.45, step: 0.002 },
  { k: 'sat', label: 'Saturation', min: 0, max: 1, step: 0.01 },
  { k: 'light', label: 'Clarté', min: 0.1, max: 0.8, step: 0.01 },
];
export const PROP_TYPES = {
  bush: {
    label: 'Buisson', icon: '❀',
    schema: [{ title: 'Buisson', fields: [{ k: 'count', label: 'Touffes (massif)', min: 1, max: 40, step: 1 }, { k: 'spread', label: 'Étalement (m)', min: 0, max: 12, step: 0.1 }, ...leafFields, { k: 'seed', label: 'Graine', min: 1, max: 9999, step: 1, dice: true }] }],
    defaults: { count: 1, spread: 2, hue: 0.25, sat: 0.32, light: 0.43, seed: 1, scale: 2 },
  },
  tree: {
    label: 'Arbre', icon: '♣',
    schema: [{ title: 'Arbre', fields: [{ k: 'count', label: 'Arbres (bosquet)', min: 1, max: 30, step: 1 }, { k: 'spread', label: 'Étalement (m)', min: 0, max: 20, step: 0.1 }, ...leafFields, { k: 'seed', label: 'Graine', min: 1, max: 9999, step: 1, dice: true }] }],
    defaults: { count: 1, spread: 4, hue: 0.25, sat: 0.3, light: 0.4, seed: 1, scale: 8 },
  },
  rock: {
    label: 'Rocher', icon: '◆',
    schema: [{ title: 'Rocher', fields: [
      { k: 'depth', label: 'Hauteur relative', min: 0.3, max: 4, step: 0.05 },
      { k: 'flutes', label: 'Cannelures', min: 0, max: 3, step: 0.05 },
      { k: 'ledges', label: 'Corniches', min: 0, max: 4, step: 0.05 },
      { k: 'moss', label: 'Mousse', min: 0, max: 2, step: 0.02 },
      { k: 'rockTint', label: 'Teinte', type: 'color' },
      { k: 'seed', label: 'Graine', min: 1, max: 9999, step: 1, dice: true },
    ] }],
    defaults: { depth: 1.2, flutes: 1, ledges: 1, moss: 1, rockTint: '#ffffff', seed: 1, scale: 1.5 },
  },
  light: {
    label: 'Lumière', icon: '✦',
    schema: [{ title: 'Lumière', fields: [
      { k: 'color', label: 'Couleur', type: 'color' },
      { k: 'intensity', label: 'Intensité', min: 0, max: 200, step: 0.5 },
      { k: 'range', label: 'Portée (m)', min: 1, max: 80, step: 0.5 },
    ] }],
    defaults: { color: '#ffd9a0', intensity: 20, range: 12, scale: 1 },
  },
  fall: {
    label: 'Cascade', icon: '≋',
    schema: [{ title: 'Cascade', fields: [
      { k: 'width', label: 'Largeur (m)', min: 0.3, max: 30, step: 0.1 },
      { k: 'length', label: 'Hauteur (m)', min: 2, max: 300, step: 1 },
    ] }],
    defaults: { width: 3, length: 60, scale: 1 },
  },
  mist: {
    label: 'Brume', icon: '☁',
    schema: [{ title: 'Brume', fields: [
      { k: 'width', label: 'Largeur (m)', min: 2, max: 300, step: 1 },
      { k: 'flat', label: 'Aplatissement', min: 0.1, max: 1, step: 0.01 },
      { k: 'opacity', label: 'Opacité', min: 0, max: 1, step: 0.01 },
    ] }],
    defaults: { width: 40, flat: 0.3, opacity: 0.4, scale: 1 },
  },
  vines: {
    label: 'Lianes pendantes', icon: '⌇',
    schema: [{ title: 'Lianes pendantes', fields: [
      { k: 'count', label: 'Nombre', min: 1, max: 200, step: 1 },
      { k: 'spread', label: 'Étalement (m)', min: 0, max: 20, step: 0.1 },
      { k: 'length', label: 'Longueur (m)', min: 0.3, max: 40, step: 0.1 },
      { k: 'color', label: 'Couleur', type: 'color' },
      { k: 'seed', label: 'Graine', min: 1, max: 9999, step: 1, dice: true },
    ] }],
    defaults: { count: 20, spread: 2, length: 4, color: '#5d7a33', seed: 1, scale: 1 },
  },
};
export const PROP_BASE = { name: '', x: 0, y: 0, z: 0, rotY: 0, scale: 1 };

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createProps({ kit, root }) {
  const items = new Map(); // id → { def, group }
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), E = new THREE.Euler();
  const col = new THREE.Color();
  const helperMat = new THREE.MeshBasicMaterial({ color: '#ffd27a', fog: false });
  const helperGeo = new THREE.OctahedronGeometry(0.25);

  // Several copies of one geometry scattered in a disc (count / spread).
  function cluster(geo, mat, d, size, cast) {
    const rnd = mulberry32(d.seed * 131 + 7);
    const im = new THREE.InstancedMesh(geo, mat, d.count);
    for (let i = 0; i < d.count; i++) {
      const a = rnd() * 6.28, r = i === 0 ? 0 : Math.sqrt(rnd()) * d.spread / d.scale;
      const s = size * (0.7 + rnd() * 0.6);
      E.set((rnd() - 0.5) * 0.15, rnd() * 6.28, (rnd() - 0.5) * 0.15);
      M.compose(P.set(Math.cos(a) * r, 0, Math.sin(a) * r), Q.setFromEuler(E), S.set(s * (1 + rnd() * 0.4), s, s * (1 + rnd() * 0.4)));
      im.setMatrixAt(i, M);
      col.setHSL(d.hue + (rnd() - 0.5) * 0.06, d.sat, d.light + (rnd() - 0.4) * 0.1).multiplyScalar(1.25);
      im.setColorAt(i, col);
    }
    im.castShadow = cast;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    return im;
  }
  const BUILD = {
    bush: (d) => cluster(kit.nearBush, kit.leafMat, d, 1, true),
    tree: (d) => cluster(kit.tree, kit.leafMat, d, 1, true),
    rock(d) {
      const P2 = { ...ISLE_DEFAULTS, depth: d.depth, flutes: d.flutes, ledges: d.ledges, seed: d.seed, taper: 1.6, belly: 0.6 };
      const rnd = mulberry32(d.seed);
      const ph = rnd() * 9;
      const geo = islandGeometry({
        cx: 0, cz: 0, y: 0, Rmean: 1,
        R: (a) => 0.8 + 0.4 * (0.5 + 0.5 * Math.sin(a * 3 + ph) * Math.cos(a * 2 - ph)),
        cap: (x, z, s) => 0.35 * (1 - s * s), tip: [(rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.5], seg: 40, rings: 6, rows: 16,
      }, P2);
      geo.translate(0, d.depth * 0.75, 0); // sits on its base
      const mat = kit.makeRockMat();
      const U = mat.userData.U;
      U.uStrata.value.set(6, 0.05, 1);
      U.uTint.value.set(d.rockTint);
      U.uGrey.value.set(0.9, 0);
      U.uMossK.value.set(d.moss, d.moss);
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true; m.receiveShadow = true;
      return m;
    },
    light(d) {
      const g = new THREE.Group();
      const l = new THREE.PointLight(d.color, d.intensity, d.range, 2);
      g.add(l);
      const h = new THREE.Mesh(helperGeo, helperMat);
      h.userData.editorOnly = true;
      h.visible = false;
      g.add(h);
      return g;
    },
    fall(d) {
      const g = new THREE.PlaneGeometry(d.width, d.length, 1, 24);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const f = (d.length / 2 - p.getY(k)) / d.length;
        p.setXYZ(k, p.getX(k) * (1 + f * 1.8), -f * d.length, Math.sqrt(f) * d.length * 0.09);
      }
      const uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setY(k, 1 - uv.getY(k));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, kit.fallMat);
      m.renderOrder = 3;
      return m;
    },
    mist(d) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: kit.mistTex, color: '#f1f3f4', transparent: true, opacity: d.opacity, depthWrite: false, fog: true }));
      sp.scale.set(d.width, d.width * d.flat, 1);
      sp.renderOrder = 2;
      return sp;
    },
    vines(d) {
      const rnd = mulberry32(d.seed * 53 + 1);
      const im = new THREE.InstancedMesh(kit.strandGeo, kit.strandMat, d.count);
      const c = new THREE.Color(d.color);
      for (let i = 0; i < d.count; i++) {
        const a = rnd() * 6.28, r = Math.sqrt(rnd()) * d.spread / d.scale;
        M.compose(P.set(Math.cos(a) * r, 0, Math.sin(a) * r), Q.identity(), S.set(0.8 + rnd(), d.length * (0.4 + rnd() * 0.9) / d.scale, 0.8 + rnd()));
        im.setMatrixAt(i, M);
        im.setColorAt(i, c.clone().multiplyScalar(0.8 + rnd() * 0.4));
      }
      im.computeBoundingSphere();
      return im;
    },
  };

  function full(def) {
    const T = PROP_TYPES[def.type];
    return { ...PROP_BASE, ...T.defaults, ...def };
  }
  function build(def) {
    const d = full(def);
    const group = new THREE.Group();
    group.name = d.name || PROP_TYPES[d.type].label;
    group.position.set(d.x, d.y, d.z);
    group.rotation.y = d.rotY;
    group.scale.setScalar(d.scale);
    const obj = BUILD[d.type](d);
    group.add(obj);
    // Pick target: a mesh tagged for the editor (lights get their marker).
    group.traverse((o) => { if (o.isMesh || o.isSprite) o.userData.ed = { kind: 'prop', id: d.id }; });
    return group;
  }
  function dispose(group) {
    group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      else if (o.isMesh && o.geometry !== helperGeo && o.geometry !== kit.strandGeo && o.geometry !== kit.nearBush && o.geometry !== kit.tree) {
        o.geometry.dispose();
        if (o.material !== helperMat && o.material !== kit.fallMat && o.material !== kit.leafMat) o.material.dispose();
      }
      if (o.isSprite) o.material.dispose();
      if (o.isLight) o.dispose?.();
    });
  }
  function set(id, def) {
    const old = items.get(id);
    if (old) { root.remove(old.group); dispose(old.group); items.delete(id); }
    if (def) {
      const group = build({ ...def, id });
      items.set(id, { def: { ...def, id }, group });
      root.add(group);
    }
  }
  function syncTransform(id) {
    const it = items.get(id);
    if (!it) return;
    const g = it.group;
    Object.assign(it.def, { x: +g.position.x.toFixed(3), y: +g.position.y.toFixed(3), z: +g.position.z.toFixed(3), rotY: +g.rotation.y.toFixed(4), scale: +g.scale.x.toFixed(3) });
  }
  function load(list) {
    for (const id of [...items.keys()]) set(id, null);
    for (const d of list || []) if (PROP_TYPES[d.type]) set(d.id, d);
  }
  function getDoc() {
    return [...items.values()].map(({ def }) => {
      const T = PROP_TYPES[def.type], base = { ...PROP_BASE, ...T.defaults };
      const o = {};
      for (const [k, v] of Object.entries(def)) if (['id', 'type', 'name'].includes(k) || base[k] !== v) o[k] = v;
      return o;
    });
  }
  // Editor-only markers (light bulbs) shown while editing.
  function showHelpers(on) {
    for (const { group } of items.values()) group.traverse((o) => { if (o.userData.editorOnly) o.visible = on; });
  }
  return { items, set, load, getDoc, syncTransform, showHelpers, full };
}
