// ---- Éditeur de niveau INGA ------------------------------------------------------
// A small in-game level editor, Unity/Blender-style:
//   • a free camera (right-drag to look, ZQSD/WASD to fly, wheel to advance,
//     middle-drag to pan, Alt+drag to orbit, F to frame the selection);
//   • click to select, gizmo to move / turn / scale (1–4 or the toolbar);
//   • a scene list on the left, an inspector on the right built from each
//     object's parameter schema (sliders apply live);
//   • a palette to place new things, lianas between two islands;
//   • undo / redo, duplicate, delete;
//   • autosaved drafts, "Enregistrer" writes the level into the project
//     (src/data/<file>.json, through the dev server), export / import JSON.
// The editor knows nothing about islands or props: each level hands it a
// "world" facade (list / schema / get / set / object / palette / doc…).
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

const CSS = `
.ied{position:fixed;inset:0;z-index:40;pointer-events:none;font:12px/1.35 "DM Sans",system-ui,sans-serif;color:#e6e9e3;--bg:#121614ee;--bg2:#1b201dee;--line:#ffffff1c;--acc:#7cc4cf;--acc2:#7cc4cf33;--warn:#e9b467}
.ied *{box-sizing:border-box}
.ied-view{position:absolute;inset:0;pointer-events:auto;cursor:default}
.ied-view.place{cursor:crosshair}
.ied-top{position:absolute;left:0;right:0;top:0;height:44px;display:flex;align-items:center;gap:6px;padding:0 10px;background:var(--bg);border-bottom:1px solid var(--line);pointer-events:auto;backdrop-filter:blur(8px)}
.ied-title{letter-spacing:.18em;font-size:11px;margin-right:10px;white-space:nowrap}
.ied-title b{color:var(--acc);font-weight:600}
.ied-sep{width:1px;height:22px;background:var(--line);margin:0 4px}
.ied-btn{background:#ffffff0d;border:1px solid var(--line);color:inherit;border-radius:6px;padding:6px 9px;cursor:pointer;font:inherit;white-space:nowrap;display:inline-flex;align-items:center;gap:5px}
.ied-btn:hover{background:#ffffff1c}
.ied-btn.on{background:var(--acc2);border-color:var(--acc)}
.ied-btn.prim{background:var(--acc);color:#0d1514;border-color:var(--acc);font-weight:600}
.ied-btn:disabled{opacity:.35;cursor:default}
.ied-btn kbd{font:10px inherit;opacity:.55}
.ied-status{margin-left:auto;font-size:11px;opacity:.75;white-space:nowrap}
.ied-status.dirty{color:var(--warn);opacity:1}
.ied-left,.ied-right{position:absolute;top:44px;bottom:30px;background:var(--bg);pointer-events:auto;display:flex;flex-direction:column;backdrop-filter:blur(8px)}
.ied{--lw:220px;--rw:min(320px,42vw)}
.ied-left{left:0;width:var(--lw);border-right:1px solid var(--line)}
.ied-right{right:0;width:var(--rw);border-left:1px solid var(--line)}
.ied.noleft .ied-left,.ied.noright .ied-right{display:none}
.ied-head{padding:10px 12px 8px;letter-spacing:.16em;font-size:10px;opacity:.7;display:flex;align-items:center;gap:8px}
.ied-scroll{overflow:auto;flex:1;padding:0 8px 12px}
.ied-search{margin:0 8px 8px;padding:6px 8px;background:#00000040;border:1px solid var(--line);border-radius:6px;color:inherit;font:inherit}
.ied-grp{margin:10px 4px 4px;font-size:10px;letter-spacing:.14em;opacity:.55}
.ied-item{padding:5px 8px;border-radius:5px;cursor:pointer;display:flex;gap:7px;align-items:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ied-item:hover{background:#ffffff10}
.ied-item.sel{background:var(--acc2);outline:1px solid var(--acc)}
.ied-item i{font-style:normal;opacity:.6;width:14px;text-align:center}
.ied-sec{border-top:1px solid var(--line);margin-top:6px}
.ied-sec>summary{cursor:pointer;padding:9px 4px 7px;letter-spacing:.12em;font-size:10px;opacity:.85;list-style:none}
.ied-sec>summary::before{content:'▸ ';opacity:.6}
.ied-sec[open]>summary::before{content:'▾ '}
.ied-row{display:grid;grid-template-columns:1fr 64px;gap:4px 8px;align-items:center;margin:5px 4px}
.ied-row label{opacity:.85;font-size:11.5px}
.ied-row input[type=range]{grid-column:1/3;width:100%;accent-color:var(--acc);margin:0}
.ied-num{width:64px;background:#00000040;border:1px solid var(--line);border-radius:4px;color:inherit;font:11px inherit;padding:3px 5px;text-align:right}
.ied-row .dice{grid-column:2;justify-self:end}
.ied-txt{width:100%;background:#00000040;border:1px solid var(--line);border-radius:5px;color:inherit;font:13px inherit;padding:6px 8px}
.ied-xf{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:6px 4px}
.ied-xf label{font-size:10px;opacity:.6;display:block;margin-bottom:2px}
.ied-xf input{width:100%}
.ied-actions{display:flex;flex-wrap:wrap;gap:6px;margin:10px 4px}
.ied-empty{opacity:.55;padding:16px 8px;line-height:1.6}
.ied-bottom{position:absolute;left:var(--lw);right:var(--rw);bottom:0;height:30px;display:flex;align-items:center;padding:0 12px;gap:14px;background:var(--bg);border-top:1px solid var(--line);font-size:11px;opacity:.85;pointer-events:auto;white-space:nowrap;overflow:hidden}
.ied-bottom b{color:var(--acc);font-weight:500}
.ied-menu{position:absolute;top:40px;background:var(--bg2);border:1px solid var(--line);border-radius:8px;padding:6px;min-width:230px;pointer-events:auto;box-shadow:0 12px 40px #0008;display:none;max-height:70vh;overflow:auto;z-index:2}
.ied-menu.open{display:block}
.ied-menu .grp{font-size:10px;letter-spacing:.14em;opacity:.5;padding:8px 8px 4px}
.ied-menu button{display:flex;width:100%;gap:8px;text-align:left;background:none;border:0;color:inherit;padding:6px 8px;border-radius:5px;cursor:pointer;font:inherit}
.ied-menu button:hover{background:#ffffff14}
.ied-toast{position:absolute;left:50%;top:56px;transform:translateX(-50%);background:var(--bg2);border:1px solid var(--line);padding:8px 14px;border-radius:20px;pointer-events:none;opacity:0;transition:opacity .2s}
.ied-toast.show{opacity:1}
.ied-banner{position:absolute;left:50%;top:56px;transform:translateX(-50%);background:var(--acc);color:#0d1514;padding:7px 14px;border-radius:20px;pointer-events:none;font-weight:600;display:none}
.ied-help{position:absolute;right:calc(var(--rw) + 10px);top:54px;width:330px;background:var(--bg2);border:1px solid var(--line);border-radius:10px;padding:12px 14px;pointer-events:auto;display:none;line-height:1.7}
.ied-help.open{display:block}
.ied.noleft .ied-bottom{left:0}
.ied.noright .ied-bottom{right:0}
.ied.noright .ied-help{right:10px}
.ied-top{overflow-x:auto;scrollbar-width:none}
.ied-top::-webkit-scrollbar{display:none}
.ied-head .x{margin-left:auto;background:none;border:0;color:inherit;opacity:.6;cursor:pointer;font:14px inherit;padding:0 2px}
.ied-head .x:hover{opacity:1}
.ied-menu button.here{background:var(--acc2)}
.ied-menu button kbd{margin-left:auto;font:10px inherit;opacity:.55}
@media (max-width:1150px){.ied-btn:not(.nav) .lbl,.ied-title{display:none}.ied-btn{padding:6px 8px}}
.ied-help kbd{background:#ffffff18;border-radius:3px;padding:0 4px;font:11px inherit}
`;

export function createEditor({ renderer, camera, scene, onOpen, onClose, stations }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const el = (tag, cls, parent, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    if (parent) parent.append(e);
    return e;
  };
  const ui = el('div', 'ied');
  ui.style.display = 'none';
  document.body.append(ui);
  const view = el('div', 'ied-view', ui);
  const top = el('div', 'ied-top', ui);
  const left = el('div', 'ied-left', ui);
  const right = el('div', 'ied-right', ui);
  const bottom = el('div', 'ied-bottom', ui);
  const toastEl = el('div', 'ied-toast', ui);
  const banner = el('div', 'ied-banner', ui);
  const help = el('div', 'ied-help', ui, `
    <b>Caméra</b><br>
    <kbd>Glisser</kbd> dans le vide (clic gauche ou droit), <kbd>deux doigts ← →</kbd> ou <kbd>flèches</kbd> : tourner la vue<br>
    <kbd>Z Q S D</kbd> / <kbd>W A S D</kbd> : voler<br>
    <kbd>E</kbd> / <kbd>Espace</kbd> monter · <kbd>A</kbd> / <kbd>C</kbd> descendre · <kbd>Maj</kbd> rapide<br>
    <kbd>Molette</kbd> avancer · <kbd>Clic milieu</kbd> glisser · <kbd>Alt</kbd>+glisser : orbiter<br>
    <kbd>F</kbd> cadrer la sélection<br>
    <b>Objets</b><br>
    <kbd>Clic</kbd> sélectionner · <kbd>1</kbd> sélection · <kbd>2</kbd> déplacer · <kbd>3</kbd> tourner · <kbd>4</kbd> échelle<br>
    <kbd>X</kbd> grille magnétique · <kbd>Suppr</kbd> effacer · <kbd>Ctrl/⌘ D</kbd> dupliquer<br>
    <kbd>Ctrl/⌘ Z</kbd> annuler · <kbd>Ctrl/⌘ Maj Z</kbd> / <kbd>Ctrl/⌘ Y</kbd> rétablir<br>
    <kbd>Ctrl/⌘ S</kbd> enregistrer dans le projet · <kbd>F2</kbd> quitter l'éditeur`);

  // ---- État ----
  let world = null;
  let isOpen = false;
  let sel = null; // { kind, id }
  let mode = 'translate'; // 'select' | 'translate' | 'rotate' | 'scale'
  let snap = false;
  let placing = null; // palette entry waiting for a click
  let linking = null; // { from: id } waiting for the second island
  const undo = [], redo = [];
  let dirty = false, savedOnce = false;

  // ---- Barre du haut ----
  const btn = (parent, label, title, on, cls = '') => {
    const b = el('button', 'ied-btn ' + cls, parent, label);
    if (title) b.title = title;
    b.addEventListener('click', on);
    return b;
  };
  // Stations : revenir à la galerie ou aller ailleurs sans chercher.
  const navBtn = stations ? btn(top, '⌂ <span class="lbl">Stations</span> <kbd>Tab</kbd>', 'Changer de station (Tab)', () => { fillStations(); toggleMenu(navMenu, navBtn); }, 'nav') : null;
  const titleEl = el('div', 'ied-title', top);
  // Panneau Scène repliable ; l'inspecteur n'apparaît qu'avec une sélection.
  let showLeft = innerWidth >= 1150;
  try { const v = localStorage.getItem('ingaEdLeft'); if (v !== null) showLeft = v === '1'; } catch { /* stockage indisponible */ }
  const leftBtn = btn(top, '▤ <span class="lbl">Scène</span>', 'Afficher / masquer la liste de la scène', () => setLeft(!showLeft));
  function setLeft(on) {
    showLeft = on;
    ui.classList.toggle('noleft', !on);
    leftBtn.classList.toggle('on', on);
    try { localStorage.setItem('ingaEdLeft', on ? '1' : '0'); } catch { /* quota */ }
  }
  setLeft(showLeft);
  el('div', 'ied-sep', top);
  const modeBtns = {
    select: btn(top, '⬚ <kbd>1</kbd>', 'Sélection seule (1)', () => setMode('select')),
    translate: btn(top, '✥ <span class="lbl">Déplacer</span> <kbd>2</kbd>', 'Déplacer (2)', () => setMode('translate')),
    rotate: btn(top, '⟳ <span class="lbl">Tourner</span> <kbd>3</kbd>', 'Tourner (3)', () => setMode('rotate')),
    scale: btn(top, '⤢ <span class="lbl">Échelle</span> <kbd>4</kbd>', 'Mettre à l\'échelle (4)', () => setMode('scale')),
  };
  const snapBtn = btn(top, '# <span class="lbl">Grille</span> <kbd>X</kbd>', 'Grille magnétique (1 m, 15°)', () => setSnap(!snap));
  el('div', 'ied-sep', top);
  const addBtn = btn(top, '＋ Ajouter', 'Placer un nouvel objet', () => { fillAddMenu(); toggleMenu(addMenu, addBtn); }, 'prim');
  const undoBtn = btn(top, '↶', 'Annuler (Ctrl/⌘ Z)', () => doUndo());
  const redoBtn = btn(top, '↷', 'Rétablir (Ctrl/⌘ Maj Z)', () => doRedo());
  el('div', 'ied-sep', top);
  const saveBtn = btn(top, '⤓ <span class="lbl">Enregistrer</span>', 'Enregistrer dans le projet (Ctrl/⌘ S)', () => saveProject());
  const moreBtn = btn(top, '⋯', 'Plus', () => toggleMenu(moreMenu, moreBtn));
  const statusEl = el('div', 'ied-status', top);
  btn(top, '?', 'Raccourcis', () => help.classList.toggle('open'));
  btn(top, '✕ <span class="lbl">Quitter</span> <kbd>F2</kbd>', 'Fermer l\'éditeur (F2)', () => close());
  const addMenu = el('div', 'ied-menu', ui);
  const moreMenu = el('div', 'ied-menu', ui);
  const navMenu = el('div', 'ied-menu', ui);
  function fillStations() {
    navMenu.innerHTML = '<div class="grp">ALLER À</div>';
    stations().forEach((st, i) => {
      const b = el('button', st.here ? 'here' : '', navMenu, `${st.label}${st.here ? ' · ici' : ''}<kbd>${i + 1}</kbd>`);
      b.addEventListener('click', () => { navMenu.classList.remove('open'); st.go(); });
    });
  }
  function toggleMenu(m, anchor) {
    const open = !m.classList.contains('open');
    for (const x of [addMenu, moreMenu, navMenu]) x.classList.remove('open');
    if (open) {
      m.style.left = Math.max(8, anchor.getBoundingClientRect().left) + 'px';
      m.classList.add('open');
    }
  }
  function fillMoreMenu() {
    moreMenu.innerHTML = '';
    const item = (label, on) => { const b = el('button', '', moreMenu, label); b.addEventListener('click', () => { moreMenu.classList.remove('open'); on(); }); };
    item('⇩ Exporter le niveau (JSON)…', exportJSON);
    item('⇧ Importer un niveau (JSON)…', importJSON);
    item('↺ Revenir à la version du projet', () => {
      if (!confirm('Abandonner le brouillon et recharger la version enregistrée dans le projet ?')) return;
      world.load(world.projectDoc() || world.defaultDoc());
      clearDraft(); resetHistory(); refreshAll(); toast('Version du projet rechargée');
    });
    item('⟲ Réinitialiser (monde par défaut)', () => {
      if (!confirm('Remplacer tout le niveau par le monde par défaut ?')) return;
      world.load(world.defaultDoc());
      markDirty(); resetHistory(); refreshAll(); toast('Monde par défaut chargé');
    });
  }

  // ---- Panneau gauche : scène ----
  const lh = el('div', 'ied-head', left, 'SCÈNE');
  void lh;
  const search = el('input', 'ied-search', left);
  search.placeholder = 'Filtrer…';
  search.addEventListener('input', () => refreshList());
  const listEl = el('div', 'ied-scroll', left);

  // ---- Panneau droit : inspecteur ----
  const rh = el('div', 'ied-head', right, 'INSPECTEUR');
  const rx = el('button', 'x', rh, '×');
  rx.title = 'Fermer (Échap : ne rien sélectionner)';
  rx.addEventListener('click', () => select(null));
  const insp = el('div', 'ied-scroll', right);

  // ---- Bas : aide contextuelle ----
  function setBottom(html) { bottom.innerHTML = html; }
  const DEFAULT_BOTTOM = '<span><b>Glisser</b> tourner la vue</span><span><b>ZQSD</b> voler</span><span><b>Molette</b> avancer</span><span><b>Alt</b>+glisser orbiter</span><span><b>F</b> cadrer</span><span><b>Suppr</b> effacer</span><span><b>⌘D</b> dupliquer</span><span><b>?</b> tous les raccourcis</span>';

  let toastT = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }
  function setBanner(msg) {
    banner.textContent = msg || '';
    banner.style.display = msg ? 'block' : 'none';
  }

  // ---- Gizmo et surbrillance ----
  const tc = new TransformControls(camera, view);
  const tcHelper = tc.getHelper();
  tcHelper.traverse((o) => { if (o.material) { o.material.fog = false; } });
  let tcDragging = false, dragBefore = null, lastLive = 0;
  tc.addEventListener('dragging-changed', (e) => {
    tcDragging = e.value;
    if (!sel) return;
    if (e.value) {
      dragBefore = world.get(sel.kind, sel.id);
      world.setDragging?.(sel.kind, sel.id, true);
    } else {
      world.setDragging?.(sel.kind, sel.id, false);
      const after = world.sync(sel.kind, sel.id);
      if (dragBefore && after) push({ kind: sel.kind, id: sel.id, before: dragBefore, after });
      dragBefore = null;
      refreshInspector();
    }
  });
  tc.addEventListener('objectChange', () => {
    if (!sel) return;
    const o = tc.object;
    if (o && mode === 'scale') { const s = Math.max(0.01, (o.scale.x + o.scale.y + o.scale.z) / 3); o.scale.setScalar(s); }
    const now = performance.now();
    if (now - lastLive > 120) { lastLive = now; world.live?.(sel.kind, sel.id); }
  });
  const box = new THREE.Box3();
  const boxHelper = new THREE.Box3Helper(box, 0x7cc4cf);
  boxHelper.material.depthTest = false;
  boxHelper.material.fog = false;
  boxHelper.material.transparent = true;
  boxHelper.renderOrder = 999;
  boxHelper.visible = false;

  function setMode(m) {
    mode = m;
    for (const [k, b] of Object.entries(modeBtns)) b.classList.toggle('on', k === m);
    attachGizmo();
  }
  function setSnap(on) {
    snap = on;
    snapBtn.classList.toggle('on', on);
    tc.setTranslationSnap(on ? 1 : null);
    tc.setRotationSnap(on ? THREE.MathUtils.degToRad(15) : null);
    tc.setScaleSnap(on ? 0.1 : null);
  }
  function attachGizmo() {
    tc.detach();
    if (!sel || mode === 'select') return;
    const o = world.object(sel.kind, sel.id);
    const xf = world.xform(sel.kind, sel.id);
    if (!o || !xf) return;
    if (mode === 'rotate' && !xf.rot) return;
    if (mode === 'scale' && !xf.scale) return;
    if (mode === 'translate' && !xf.move) return;
    tc.setMode(mode);
    tc.showX = tc.showZ = mode !== 'rotate';
    tc.showY = true;
    tc.attach(o);
  }

  // ---- Sélection ----
  function select(kind, id, { frame = false } = {}) {
    sel = kind ? { kind, id } : null;
    attachGizmo();
    refreshList();
    refreshInspector();
    if (frame && sel) frameSelection();
  }

  // ---- Historique ----
  // Entry: { kind, id, before, after } (before null = created, after null =
  // deleted) or an array of entries applied together.
  function push(entry) {
    undo.push(entry);
    if (undo.length > 200) undo.shift();
    redo.length = 0;
    markDirty();
    refreshHistoryBtns();
  }
  function applyEntry(entry, dir) {
    const list = Array.isArray(entry) ? entry : [entry];
    const seq = dir < 0 ? [...list].reverse() : list;
    for (const e of seq) world.set(e.kind, e.id, dir < 0 ? e.before : e.after);
    const last = seq[seq.length - 1];
    const exists = world.get(last.kind, last.id);
    select(exists ? last.kind : null, exists ? last.id : null);
    markDirty();
  }
  function doUndo() { const e = undo.pop(); if (!e) return; applyEntry(e, -1); redo.push(e); refreshHistoryBtns(); toast('Annulé'); }
  function doRedo() { const e = redo.pop(); if (!e) return; applyEntry(e, 1); undo.push(e); refreshHistoryBtns(); toast('Rétabli'); }
  function resetHistory() { undo.length = 0; redo.length = 0; refreshHistoryBtns(); }
  function refreshHistoryBtns() { undoBtn.disabled = !undo.length; redoBtn.disabled = !redo.length; }

  // ---- Brouillon et enregistrement ----
  let draftT = 0;
  function markDirty() {
    dirty = true;
    refreshStatus();
    clearTimeout(draftT);
    draftT = setTimeout(() => {
      try { localStorage.setItem(world.storageKey, JSON.stringify(world.doc())); } catch { /* quota */ }
    }, 500);
  }
  function clearDraft() {
    try { localStorage.removeItem(world.storageKey); } catch { /* stockage indisponible */ }
    dirty = false;
    refreshStatus();
  }
  function refreshStatus() {
    statusEl.classList.toggle('dirty', dirty);
    statusEl.textContent = dirty ? '● Brouillon (pas encore dans le projet)' : savedOnce ? '✓ Enregistré dans le projet' : (world?.hasDraft?.() ? '● Brouillon' : '✓ À jour');
  }
  async function saveProject() {
    const doc = world.doc();
    try {
      const r = await fetch('/__inga/save?file=' + world.fileName, { method: 'POST', headers: { 'content-type': 'application/json', 'x-inga-editor': '1' }, body: JSON.stringify(doc) });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      world.onSaved?.(doc);
      clearDraft();
      savedOnce = true;
      refreshStatus();
      toast('Enregistré · ' + j.file);
    } catch (e) {
      // Without the dev server (build / preview), fall back to a download.
      toast('Serveur de dev absent : export du fichier à la place');
      exportJSON();
      void e;
    }
  }
  function exportJSON() {
    const blob = new Blob([JSON.stringify(world.doc(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = world.fileName + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function importJSON() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json,.json';
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      try {
        const doc = JSON.parse(await f.text());
        world.load(doc);
        resetHistory();
        markDirty();
        select(null);
        refreshAll();
        toast('Niveau importé');
      } catch (e) { alert('Fichier illisible : ' + e.message); }
    };
    inp.click();
  }

  // ---- Liste de la scène ----
  function refreshList() {
    listEl.innerHTML = '';
    const q = search.value.trim().toLowerCase();
    const items = world.list().filter((it) => !q || it.label.toLowerCase().includes(q));
    let grp = null;
    for (const it of items) {
      if (it.group !== grp) { grp = it.group; el('div', 'ied-grp', listEl, grp.toUpperCase()); }
      const row = el('div', 'ied-item', listEl, `<i>${it.icon || '•'}</i>`);
      row.append(document.createTextNode(it.label));
      if (sel && sel.kind === it.kind && sel.id === it.id) row.classList.add('sel');
      row.addEventListener('click', () => select(it.kind, it.id));
      row.addEventListener('dblclick', () => select(it.kind, it.id, { frame: true }));
    }
    if (!items.length) el('div', 'ied-empty', listEl, 'Rien ici.');
  }

  // ---- Inspecteur ----
  // Live edits: sliders apply at most every ~110 ms while dragged, then once
  // more on release, which also records the undo step.
  let pendingBefore = null, liveT = 0, liveQueued = null;
  function liveApply(patch, final) {
    if (!sel) return;
    const { kind, id } = sel;
    if (!pendingBefore) pendingBefore = world.get(kind, id);
    const next = { ...world.get(kind, id), ...patch };
    const run = () => { world.set(kind, id, next); liveQueued = null; liveT = performance.now(); if (sel) tc.object && attachGizmo(); };
    if (final) {
      clearTimeout(liveQueued);
      liveApply.acc = null;
      run();
      push({ kind, id, before: pendingBefore, after: world.get(kind, id) });
      pendingBefore = null;
      refreshList();
    } else {
      // Keep the latest value; apply now if enough time passed, else soon.
      Object.assign(liveApply.acc || (liveApply.acc = {}), patch);
      const wait = 110 - (performance.now() - liveT);
      clearTimeout(liveQueued);
      liveQueued = setTimeout(() => { const p = liveApply.acc; liveApply.acc = null; world.set(kind, id, { ...world.get(kind, id), ...p }); liveT = performance.now(); attachGizmo(); }, Math.max(0, wait));
    }
  }
  const fmt = (v, step) => (step >= 1 ? String(Math.round(v)) : (+v).toFixed(step >= 0.1 ? 1 : step >= 0.01 ? 2 : step >= 0.001 ? 3 : 4));
  function field(parent, f, def) {
    const v = def[f.k];
    if (f.type === 'bool') {
      const row = el('div', 'ied-row', parent);
      const lab = el('label', '', row, f.label);
      const cb = el('input', '', row);
      cb.type = 'checkbox';
      cb.checked = !!v;
      cb.style.justifySelf = 'end';
      cb.style.accentColor = '#7cc4cf';
      cb.addEventListener('change', () => liveApply({ [f.k]: cb.checked }, true));
      void lab;
      return;
    }
    if (f.type === 'color') {
      const row = el('div', 'ied-row', parent);
      el('label', '', row, f.label);
      const c = el('input', '', row);
      c.type = 'color';
      c.value = v || '#ffffff';
      c.style.cssText = 'width:64px;height:24px;border:0;background:none;padding:0;cursor:pointer';
      c.addEventListener('input', () => liveApply({ [f.k]: c.value }, false));
      c.addEventListener('change', () => liveApply({ [f.k]: c.value }, true));
      return;
    }
    if (f.type === 'select') {
      const row = el('div', 'ied-row', parent);
      el('label', '', row, f.label);
      const s = el('select', 'ied-num', row);
      s.style.width = '120px';
      for (const [val, lab] of f.options) { const o = el('option', '', s, lab); o.value = val; if (val === v) o.selected = true; }
      s.addEventListener('change', () => liveApply({ [f.k]: s.value }, true));
      return;
    }
    const row = el('div', 'ied-row', parent);
    el('label', '', row, f.label);
    const num = el('input', 'ied-num', row);
    num.type = 'number';
    num.step = f.step;
    num.value = fmt(v, f.step);
    const rng = el('input', '', row);
    rng.type = 'range';
    rng.min = f.min; rng.max = f.max; rng.step = f.step;
    rng.value = v;
    rng.addEventListener('input', () => { num.value = fmt(+rng.value, f.step); liveApply({ [f.k]: +rng.value }, false); });
    rng.addEventListener('change', () => liveApply({ [f.k]: +rng.value }, true));
    num.addEventListener('change', () => { const x = +num.value; if (!Number.isFinite(x)) return; rng.value = x; liveApply({ [f.k]: x }, true); });
    if (f.dice) {
      const d = el('button', 'ied-btn dice', row, '🎲 Au hasard');
      d.style.gridColumn = '1 / 3';
      d.addEventListener('click', () => { const x = 1 + Math.floor(Math.random() * 9998); num.value = x; rng.value = x; liveApply({ [f.k]: x }, true); });
    }
  }
  function refreshInspector() {
    insp.innerHTML = '';
    ui.classList.toggle('noright', !sel);
    if (!sel) {
      el('div', 'ied-empty', insp, 'Sélectionnez un objet dans la vue ou dans la liste.<br><br>« ＋ Ajouter » pour placer quelque chose de nouveau.');
      return;
    }
    const def = world.get(sel.kind, sel.id);
    if (!def) { el('div', 'ied-empty', insp, 'Objet introuvable.'); return; }
    // Name.
    if ('name' in def) {
      const n = el('input', 'ied-txt', insp);
      n.value = def.name || '';
      n.placeholder = 'Nom';
      n.addEventListener('change', () => liveApply({ name: n.value }, true));
    }
    const info = world.info?.(sel.kind, sel.id);
    if (info) el('div', 'ied-empty', insp, info).style.padding = '6px 4px';
    // Transform.
    const xf = world.xform(sel.kind, sel.id);
    if (xf) {
      const det = el('details', 'ied-sec', insp);
      det.open = true;
      el('summary', '', det, 'POSITION');
      const g = el('div', 'ied-xf', det);
      const numIn = (label, key, conv = (x) => x, back = (x) => x, step = 0.1) => {
        const w = el('div', '', g);
        el('label', '', w, label);
        const i = el('input', 'ied-num', w);
        i.type = 'number'; i.step = step;
        i.value = (+conv(def[key])).toFixed(step < 1 ? 2 : 0);
        i.addEventListener('change', () => { const x = +i.value; if (Number.isFinite(x)) liveApply({ [key]: back(x) }, true); });
      };
      if (xf.move) { numIn('X', 'x'); numIn('Y (hauteur)', 'y'); numIn('Z', 'z'); }
      if (xf.rot) numIn('Rotation (°)', 'rotY', (r) => r * 180 / Math.PI, (d) => d * Math.PI / 180, 1);
      if (xf.scale) numIn('Échelle', 'scale', (x) => x, (x) => Math.max(0.01, x), 0.05);
    }
    for (const sec of world.schema(sel.kind, sel.id)) {
      const det = el('details', 'ied-sec', insp);
      det.open = sec.open !== false;
      el('summary', '', det, sec.title.toUpperCase());
      for (const f of sec.fields) field(det, f, def);
    }
    const acts = world.actions?.(sel.kind, sel.id) || [];
    const ar = el('div', 'ied-actions', insp);
    for (const a of acts) btn(ar, a.label, a.title || '', () => a.run(api));
    if (world.canDelete?.(sel.kind, sel.id)) btn(ar, '🗑 Supprimer', 'Suppr', () => deleteSel());
    if (world.canDuplicate?.(sel.kind, sel.id)) btn(ar, '⧉ Dupliquer', 'Ctrl/⌘ D', () => duplicateSel());
  }
  function refreshAll() {
    titleEl.innerHTML = `ÉDITEUR · <b>${world.title}</b>`;
    fillAddMenu();
    fillMoreMenu();
    refreshList();
    refreshInspector();
    refreshStatus();
    refreshHistoryBtns();
  }
  function fillAddMenu() {
    addMenu.innerHTML = '';
    let grp = null;
    for (const p of world.palette()) {
      if (p.group !== grp) { grp = p.group; el('div', 'grp', addMenu, grp.toUpperCase()); }
      const b = el('button', '', addMenu, `<span style="opacity:.6;width:16px">${p.icon || '+'}</span>${p.label}`);
      b.addEventListener('click', () => { addMenu.classList.remove('open'); startPlacing(p); });
    }
  }

  // ---- Création, suppression, duplication ----
  function startPlacing(p) {
    if (p.link) { startLinking(null); return; }
    placing = p;
    linking = null;
    view.classList.add('place');
    setBanner(`Cliquez dans la vue pour poser : ${p.label} · Échap pour annuler`);
  }
  function startLinking(from) {
    linking = { from };
    placing = null;
    view.classList.add('place');
    setBanner(from ? 'Cliquez sur la deuxième île à relier · Échap pour annuler' : 'Cliquez sur la première île à relier · Échap pour annuler');
  }
  function stopModes() {
    placing = null; linking = null;
    view.classList.remove('place');
    setBanner('');
  }
  function create(kind, def) {
    const id = world.newId(kind);
    world.set(kind, id, def);
    push({ kind, id, before: null, after: world.get(kind, id) });
    select(kind, id);
    refreshList();
    return id;
  }
  function deleteSel() {
    if (!sel || !world.canDelete?.(sel.kind, sel.id)) return;
    // Deleting an island also deletes its lianas (one undo step).
    const entries = (world.dependents?.(sel.kind, sel.id) || []).map(([k, i]) => ({ kind: k, id: i, before: world.get(k, i), after: null }));
    entries.push({ kind: sel.kind, id: sel.id, before: world.get(sel.kind, sel.id), after: null });
    for (const e of entries) world.set(e.kind, e.id, null);
    undo.push(entries); redo.length = 0; markDirty(); refreshHistoryBtns();
    select(null);
    toast('Supprimé');
  }
  function duplicateSel() {
    if (!sel || !world.canDuplicate?.(sel.kind, sel.id)) return;
    const d = world.duplicate(sel.kind, sel.id);
    create(sel.kind, d);
    toast('Dupliqué');
  }

  // ---- Caméra libre ----
  // Fluide même à bas régime : le regard rejoint sa cible en douceur, la
  // vitesse accélère et freine au lieu de sauter, la molette donne une
  // poussée qui s'amortit, F glisse jusqu'à la sélection. Le temps vient de
  // l'horloge réelle (pas du pas plafonné du jeu), pour garder la vitesse
  // annoncée quand les images par seconde baissent.
  const cam = { yaw: 0, pitch: 0, tYaw: 0, tPitch: 0, speed: 20 };
  const vel = new THREE.Vector3(), wantV = new THREE.Vector3();
  let flyTo = null; // { from, to, t } : glissé vers la sélection
  let lastT = 0;
  const setLook = (yaw, pitch) => { cam.yaw = cam.tYaw = yaw; cam.pitch = cam.tPitch = pitch; };
  const keys = {};
  let rmb = false, mmb = false, orbit = false, lmbLook = false, lx = 0, ly = 0, downX = 0, downY = 0, downBtn = -1;
  const pivot = new THREE.Vector3();
  const fwd = new THREE.Vector3(), rightV = new THREE.Vector3(), upV = new THREE.Vector3(0, 1, 0);
  function camDirs() {
    fwd.set(-Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), -Math.cos(cam.yaw) * Math.cos(cam.pitch));
    rightV.set(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
  }
  function applyCam() { camera.rotation.set(cam.pitch, cam.yaw, 0, 'YXZ'); }
  function frameSelection() {
    if (!sel) return;
    const o = world.boundsObject?.(sel.kind, sel.id) || world.object(sel.kind, sel.id);
    if (!o) return;
    box.setFromObject(o);
    const s = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(1.5, Math.min(s.radius, 400));
    camDirs();
    flyTo = { from: camera.position.clone(), to: s.center.clone().addScaledVector(fwd, -r * 2.2), t: 0 };
    vel.set(0, 0, 0);
    pivot.copy(s.center);
  }
  view.addEventListener('contextmenu', (e) => e.preventDefault());
  view.addEventListener('pointerdown', (e) => {
    downX = lx = e.clientX; downY = ly = e.clientY; downBtn = e.button;
    if (e.button === 2) { rmb = true; view.setPointerCapture(e.pointerId); }
    else if (e.button === 1) { mmb = true; e.preventDefault(); view.setPointerCapture(e.pointerId); }
    // Clic gauche glissé dans le vide (pas sur le gizmo) : tourner la vue.
    // Indispensable au trackpad, où le clic droit maintenu est malcommode.
    // Un clic sans glisser sélectionne toujours.
    else if (e.button === 0 && !e.altKey && !placing && !linking && !tc.axis) { lmbLook = true; view.setPointerCapture(e.pointerId); }
    else if (e.button === 0 && e.altKey) {
      orbit = true;
      view.setPointerCapture(e.pointerId);
      const bo = sel && (world.boundsObject?.(sel.kind, sel.id) || world.object(sel.kind, sel.id));
      if (bo) { box.setFromObject(bo); box.getCenter(pivot); }
      else { camDirs(); pivot.copy(camera.position).addScaledVector(fwd, 40); }
    }
  });
  view.addEventListener('pointermove', (e) => {
    const dx = e.clientX - lx, dy = e.clientY - ly;
    lx = e.clientX; ly = e.clientY;
    if (rmb || (lmbLook && Math.hypot(e.clientX - downX, e.clientY - downY) > 4)) {
      cam.tYaw -= dx * 0.0032;
      cam.tPitch = Math.max(-1.55, Math.min(1.55, cam.tPitch - dy * 0.0032));
    } else if (mmb) {
      camDirs();
      const k = cam.speed * 0.004;
      upV.crossVectors(rightV, fwd).normalize();
      camera.position.addScaledVector(rightV, -dx * k).addScaledVector(upV, dy * k);
    } else if (orbit) {
      const off = camera.position.clone().sub(pivot);
      const sph = new THREE.Spherical().setFromVector3(off);
      sph.theta -= dx * 0.005;
      sph.phi = Math.max(0.05, Math.min(Math.PI - 0.05, sph.phi - dy * 0.005));
      camera.position.copy(pivot).add(new THREE.Vector3().setFromSpherical(sph));
      const d = pivot.clone().sub(camera.position).normalize();
      // Continuité du lacet (pas de saut de 2π vers la cible).
      let yw = Math.atan2(-d.x, -d.z);
      yw += Math.round((cam.yaw - yw) / (2 * Math.PI)) * 2 * Math.PI;
      setLook(yw, Math.asin(Math.max(-1, Math.min(1, d.y))));
      flyTo = null;
      applyCam();
    }
  });
  view.addEventListener('pointerup', (e) => {
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY) > 4;
    if (e.button === 2) rmb = false;
    if (e.button === 1) mmb = false;
    if (e.button === 0) lmbLook = false;
    if (e.button === 0 && orbit) { orbit = false; return; }
    if (e.button !== 0 || downBtn !== 0 || moved || tcDragging || tc.axis) return;
    onClick(e);
  });
  view.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (rmb) { cam.speed = Math.max(1, Math.min(400, cam.speed * (e.deltaY > 0 ? 0.85 : 1.18))); toast('Vitesse ' + cam.speed.toFixed(0) + ' m/s'); return; }
    camDirs();
    // Trackpad : deux doigts à gauche / à droite tournent la vue.
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * unit, dy = e.deltaY * unit;
    if (Math.abs(dx) > Math.abs(dy)) { cam.tYaw -= dx * 0.004; return; }
    // Avance proportionnelle au geste : un cran de molette (~100) ≈ 6 m à
    // 25 m/s, un frôlement de trackpad quelques centimètres, sans à-coups.
    const dist = Math.min(cam.speed * 0.48, cam.speed * 0.12 * Math.abs(dy) / 50);
    vel.addScaledVector(fwd, -Math.sign(dy) * dist / COAST);
    flyTo = null;
  }, { passive: false });

  // ---- Clic dans la vue : poser, relier, sélectionner ----
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function rayFrom(e) {
    const r = view.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray;
  }
  function pick(e) {
    rayFrom(e);
    const hits = ray.intersectObjects(world.pickables(), false);
    for (const h of hits) { const ed = h.object.userData.ed; if (ed) return { ...ed, point: h.point }; }
    return null;
  }
  function onClick(e) {
    if (placing) {
      const p = placing;
      rayFrom(e);
      let at = null;
      if (!p.free) {
        const hits = ray.intersectObjects([...world.pickables(), ...(world.surfaces?.() || [])], false);
        if (hits.length) at = hits[0].point.clone();
      }
      if (!at) at = ray.ray.at(p.dist || 30, new THREE.Vector3());
      if (!e.shiftKey) stopModes(); // Maj : poser plusieurs
      create(p.kind, p.make(at));
      return;
    }
    if (linking) {
      const h = pick(e);
      if (!h || h.kind !== 'island') { toast('Cliquez sur une île'); return; }
      if (!linking.from) { linking.from = h.id; setBanner('Cliquez sur la deuxième île à relier · Échap pour annuler'); return; }
      if (h.id === linking.from) { toast('Choisissez une autre île'); return; }
      const from = linking.from;
      stopModes();
      create('link', world.makeLink(from, h.id));
      toast('Lianes créées');
      return;
    }
    const h = pick(e);
    select(h ? h.kind : null, h ? h.id : null);
  }

  // ---- Clavier (capturé : le jeu ne voit rien tant que l'éditeur est ouvert) ----
  const typing = (e) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
  function onKey(e) {
    if (!isOpen) return;
    if (e.type === 'keyup') { keys[e.code] = false; e.stopImmediatePropagation(); return; }
    if (e.code === 'F2') { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    if (typing(e)) { e.stopImmediatePropagation(); if (e.code === 'Escape') e.target.blur(); return; }
    e.stopImmediatePropagation();
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.code === 'KeyS') { e.preventDefault(); saveProject(); return; }
    if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
    if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); doRedo(); return; }
    if (mod && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); duplicateSel(); return; }
    if (mod) return;
    // Menu des stations ouvert : 1–9 choisit, Tab / Échap referme.
    if (navMenu.classList.contains('open') && !e.repeat) {
      const d = /^(Digit|Numpad)([1-9])$/.exec(e.code);
      const list = stations ? stations() : [];
      if (d && list[+d[2] - 1]) { navMenu.classList.remove('open'); list[+d[2] - 1].go(); return; }
      if (e.code === 'Tab' || e.code === 'Escape') { e.preventDefault(); navMenu.classList.remove('open'); return; }
    }
    if (e.code === 'Tab' && navBtn) { e.preventDefault(); if (!e.repeat) { fillStations(); toggleMenu(navMenu, navBtn); } return; }
    keys[e.code] = true;
    if (e.repeat) return;
    if (e.code === 'Escape') { if (placing || linking) stopModes(); else if (addMenu.classList.contains('open') || moreMenu.classList.contains('open')) { addMenu.classList.remove('open'); moreMenu.classList.remove('open'); } else select(null); return; }
    if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); deleteSel(); return; }
    if (e.code === 'KeyF') { frameSelection(); return; }
    if (e.code === 'Digit1') setMode('select');
    if (e.code === 'Digit2') setMode('translate');
    if (e.code === 'Digit3') setMode('rotate');
    if (e.code === 'Digit4') setMode('scale');
    if (e.key === 'x' || e.key === 'X') setSnap(!snap);
  }
  for (const t of ['keydown', 'keyup']) window.addEventListener(t, onKey, true);
  // Mouse events outside the editor's own UI never reach the game either.
  for (const t of ['mousedown', 'wheel']) window.addEventListener(t, (e) => { if (isOpen && !ui.contains(e.target)) e.stopImmediatePropagation(); }, true);
  for (const t of ['mousedown', 'mouseup', 'click', 'wheel', 'pointerdown']) ui.addEventListener(t, (e) => { if (isOpen) e.stopPropagation(); });
  // Close floating menus on any click elsewhere.
  ui.addEventListener('pointerdown', (e) => {
    if (!addMenu.contains(e.target) && e.target !== addBtn && !addBtn.contains(e.target)) addMenu.classList.remove('open');
    if (!moreMenu.contains(e.target) && e.target !== moreBtn) moreMenu.classList.remove('open');
    if (!navMenu.contains(e.target) && navBtn && e.target !== navBtn && !navBtn.contains(e.target)) navMenu.classList.remove('open');
  }, true);

  // ---- Boucle ----
  const COAST = 0.15; // amortissement de la glisse (s)
  function update(dt) {
    if (!isOpen) return;
    const now = performance.now();
    const rdt = lastT ? Math.min(0.1, (now - lastT) / 1000) : dt;
    lastT = now;
    // Regard : rejoint la cible en ~40 ms.
    // Flèches : tourner la vue au clavier.
    const turn = (keys.ArrowLeft ? 1 : 0) - (keys.ArrowRight ? 1 : 0);
    const tilt = (keys.ArrowUp ? 1 : 0) - (keys.ArrowDown ? 1 : 0);
    if (turn) cam.tYaw += turn * 1.6 * rdt;
    if (tilt) cam.tPitch = Math.max(-1.55, Math.min(1.55, cam.tPitch + tilt * 1.1 * rdt));
    const kl = 1 - Math.exp(-rdt / 0.04);
    cam.yaw += (cam.tYaw - cam.yaw) * kl;
    cam.pitch += (cam.tPitch - cam.pitch) * kl;
    camDirs();
    const f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    const s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    const u = (keys.KeyE || keys.Space ? 1 : 0) - (keys.KeyQ || keys.KeyC ? 1 : 0);
    if (f || s || u) {
      flyTo = null;
      wantV.set(0, 0, 0).addScaledVector(fwd, f).addScaledVector(rightV, s).addScaledVector(upV.set(0, 1, 0), u);
      if (wantV.lengthSq() > 1) wantV.normalize();
      wantV.multiplyScalar(cam.speed * (keys.ShiftLeft || keys.ShiftRight ? 3 : 1));
      vel.lerp(wantV, 1 - Math.exp(-rdt / 0.1)); // accélère en ~0,1 s
    } else vel.multiplyScalar(Math.exp(-rdt / COAST)); // freine en glissant
    if (vel.lengthSq() < 1e-6) vel.set(0, 0, 0);
    camera.position.addScaledVector(vel, rdt);
    if (flyTo) {
      flyTo.t = Math.min(1, flyTo.t + rdt / 0.4);
      const e = flyTo.t * flyTo.t * (3 - 2 * flyTo.t);
      camera.position.lerpVectors(flyTo.from, flyTo.to, e);
      if (flyTo.t >= 1) flyTo = null;
    }
    applyCam();
    const o = sel && world.object(sel.kind, sel.id);
    if (o) { box.setFromObject(world.boundsObject?.(sel.kind, sel.id) || o); boxHelper.visible = !box.isEmpty(); } else boxHelper.visible = false;
  }

  // ---- Ouvrir / fermer ----
  const saved = { pos: new THREE.Vector3(), rot: new THREE.Euler() };
  let hud = null;
  const api = { select, toast, refresh: () => { refreshList(); refreshInspector(); }, startLinking, markDirty, push, create, get world() { return world; }, frame: frameSelection };
  function open(w) {
    if (w) world = w;
    if (!world) return;
    if (isOpen) { refreshAll(); return; }
    isOpen = true;
    saved.pos.copy(camera.position);
    saved.rot.copy(camera.rotation);
    // Rotation lue dans l'ordre du regard (YXZ), sinon un léger saut.
    const eul = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    setLook(eul.y, eul.x);
    vel.set(0, 0, 0);
    flyTo = null;
    lastT = 0;
    cam.speed = world.camSpeed || 20;
    for (const k in keys) keys[k] = false;
    ui.style.display = 'block';
    hud = document.querySelector('#hud');
    if (hud) hud.style.visibility = 'hidden';
    scene.add(tcHelper, boxHelper);
    world.showHelpers?.(true);
    setMode(mode);
    setSnap(snap);
    setBottom(DEFAULT_BOTTOM);
    document.exitPointerLock?.();
    refreshAll();
    onOpen?.();
  }
  function close({ restoreCamera = world?.restoreCamera !== false } = {}) {
    if (!isOpen) return;
    isOpen = false;
    stopModes();
    tc.detach();
    scene.remove(tcHelper, boxHelper);
    world?.showHelpers?.(false);
    ui.style.display = 'none';
    if (hud) hud.style.visibility = '';
    help.classList.remove('open');
    if (restoreCamera) { camera.position.copy(saved.pos); camera.rotation.copy(saved.rot); }
    onClose?.();
  }
  function setWorld(w) {
    if (world === w) return;
    tc.detach();
    sel = null;
    world = w;
    resetHistory();
    savedOnce = false;
    dirty = false;
    if (isOpen) refreshAll();
  }
  refreshHistoryBtns();
  return {
    open, close, update, setWorld,
    get isOpen() { return isOpen; },
    get world() { return world; },
    toast,
  };
}
