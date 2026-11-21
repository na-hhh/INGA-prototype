// ---- Construction avec l'avatar (domaine BÉTON, touche X) --------------------
// L'avatar pose et retire des pièces de béton là où il vise : murs en grandes
// plaques, voiles, blocs, bancs, piliers, dalles, plafonds, marches. Elles
// prennent les matériaux de la galerie (plaques et trous de banche pour les
// murs, béton lisse pour les dalles) et deviennent aussitôt des obstacles
// sur lesquels on peut monter. Un fantôme montre où la pièce va se poser
// (vert : possible, rouge : hors de la pièce ou sur l'avatar). On peut poser
// une pièce sur une autre pour empiler.
//   1–9 ou molette : pièce · Clic : poser · Clic droit : retirer · R : tourner
import * as THREE from 'three';

const STORE = 'ingaBetonCraft';

// Dimensions en mètres (largeur, hauteur, profondeur) ; base posée au sol.
export const PIECES = [
  { id: 'wall', group: 'MURS', name: 'GRANDE PLAQUE', w: 2.4, h: 4.8, d: 0.3, mat: 'wall' },
  { id: 'wallLow', group: 'MURS', name: 'MUR BAS', w: 2.4, h: 2.6, d: 0.3, mat: 'wall' },
  { id: 'veil', group: 'MURS', name: 'VOILE ÉTROIT', w: 0.7, h: 4.8, d: 0.3, mat: 'wall' },
  { id: 'block', group: 'VOLUMES', name: 'BLOC', w: 1.2, h: 0.9, d: 1.2, mat: 'wall' },
  { id: 'bench', group: 'VOLUMES', name: 'BANC', w: 2.4, h: 0.45, d: 0.6, mat: 'wall' },
  { id: 'pillar', group: 'VOLUMES', name: 'PILIER', w: 0.6, h: 4.8, d: 0.6, mat: 'wall' },
  { id: 'slab', group: 'DALLES', name: 'DALLE', w: 2.4, h: 0.2, d: 2.4, mat: 'floor' },
  { id: 'roof', group: 'DALLES', name: 'PLAFOND', w: 4.8, h: 0.35, d: 2.4, mat: 'wall' },
  { id: 'step', group: 'DALLES', name: 'MARCHE', w: 1.2, h: 0.3, d: 0.45, mat: 'floor' },
];
const GROUPS = ['MURS', 'VOLUMES', 'DALLES'];
const GRID = 0.15;
const snap = (v) => Math.round(v / GRID) * GRID;

export function createCraft({ root, makeMesh, aim, isInside, playerFeet, onChange, onAct }) {
  let active = false, sel = 0, rot = 0;
  const pieces = []; // { mesh, p: id, x, y, z, r }

  // Fantôme : boîte translucide aux dimensions de la pièce.
  const ghostMat = new THREE.MeshBasicMaterial({ color: '#8ea566', transparent: true, opacity: 0.32, depthWrite: false });
  const ghostEdge = new THREE.LineBasicMaterial({ color: '#f3f2ec', transparent: true, opacity: 0.85 });
  const ghost = new THREE.Group();
  const ghostBox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), ghostMat);
  const ghostLines = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)), ghostEdge);
  ghost.add(ghostBox, ghostLines);
  ghost.visible = false;
  ghost.renderOrder = 5;
  root.add(ghost);
  let target = null; // { x, y, z, ok }

  // ---- Barre des pièces ----
  const bar = document.createElement('div');
  bar.className = 'craftbar';
  bar.style.display = 'none';
  document.body.append(bar);
  function renderBar() {
    const groups = GROUPS.map((g) => `<div class="cb-g"><small>${g}</small><div>${PIECES.map((p, i) => (p.group === g ? `<div class="cb${i === sel ? ' on' : ''}"><kbd>${i + 1}</kbd><span>${p.name}</span></div>` : '')).join('')}</div></div>`).join('');
    bar.innerHTML = `<div class="cb-tip"><kbd>Clic</kbd> poser · <kbd>Clic droit</kbd> retirer · <kbd>R</kbd> tourner · <kbd>Molette</kbd> pièce · <kbd>X</kbd> terminer</div>${groups}`;
  }

  function dims(p, r) { return r % 2 ? [p.d, p.h, p.w] : [p.w, p.h, p.d]; }
  function build(p, x, y, z, r) {
    const piece = PIECES.find((q) => q.id === p);
    if (!piece) return null;
    const mesh = makeMesh(piece);
    mesh.position.set(x, y, z);
    mesh.rotation.y = r * Math.PI / 2;
    mesh.userData.craft = true;
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
    const rec = { mesh, p, x, y, z, r };
    pieces.push(rec);
    return rec;
  }
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(api.list())); } catch { /* quota */ } };

  const api = {
    get active() { return active; },
    get count() { return pieces.length; },
    setActive(on) {
      active = on;
      ghost.visible = false;
      bar.style.display = on ? 'flex' : 'none';
      if (on) renderBar();
    },
    select(i) { sel = (i + PIECES.length) % PIECES.length; if (active) renderBar(); },
    next(dir) { api.select(sel + dir); },
    rotate() { rot = (rot + 1) % 4; },
    // À chaque image : où la pièce se poserait.
    update() {
      if (!active) { ghost.visible = false; return; }
      const piece = PIECES[sel];
      const [w, h, d] = dims(piece, rot);
      const hit = aim(14);
      if (!hit) { ghost.visible = false; target = null; return; }
      let { x, z } = hit.point;
      const y = hit.point.y;
      // Visé sur une paroi verticale : la pièce se colle contre, sans la traverser.
      if (hit.normal && Math.abs(hit.normal.y) < 0.5) { x += hit.normal.x * w / 2; z += hit.normal.z * d / 2; }
      x = snap(x); z = snap(z);
      const feet = playerFeet();
      const onPlayer = Math.abs(feet.x - x) < w / 2 + 0.35 && Math.abs(feet.z - z) < d / 2 + 0.35 && feet.y < y + h && feet.y + 1.8 > y;
      const ok = isInside(x, z, w, d) && !onPlayer;
      target = { x, y, z, ok };
      ghost.position.set(x, y + 0.002, z);
      ghost.scale.set(w, h, d);
      ghostMat.color.set(ok ? '#8ea566' : '#b4543c');
      ghost.visible = true;
    },
    place() {
      if (!active || !target?.ok) return false;
      build(PIECES[sel].id, target.x, target.y, target.z, rot);
      save(); onChange?.(); onAct?.('place');
      return true;
    },
    // Retire la pièce construite visée.
    remove() {
      if (!active) return false;
      const hit = aim(14);
      const rec = hit && pieces.find((q) => q.mesh === hit.object);
      if (!rec) return false;
      root.remove(rec.mesh);
      rec.mesh.geometry.dispose();
      pieces.splice(pieces.indexOf(rec), 1);
      save(); onChange?.(); onAct?.('remove');
      return true;
    },
    clear() {
      for (const q of pieces) { root.remove(q.mesh); q.mesh.geometry.dispose(); }
      pieces.length = 0;
      save(); onChange?.();
    },
    list() { return pieces.map(({ p, x, y, z, r }) => ({ p, x: +x.toFixed(3), y: +y.toFixed(3), z: +z.toFixed(3), r })); },
    load(list) {
      for (const q of pieces) { root.remove(q.mesh); q.mesh.geometry.dispose(); }
      pieces.length = 0;
      for (const q of list || []) build(q.p, q.x, q.y, q.z, q.r || 0);
      onChange?.();
    },
  };
  // Brouillon du navigateur, sinon la version du projet (beton.json).
  api.restore = (projectList) => {
    let list = null;
    try { list = JSON.parse(localStorage.getItem(STORE)); } catch { /* illisible */ }
    api.load(Array.isArray(list) ? list : projectList);
  };
  return api;
}
