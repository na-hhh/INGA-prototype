// Outil de construction (touche B) : murs, sols, plafonds et lumières colorées
// posés dans la pièce, plus le soleil (couleur, intensité, direction). Tout
// est en boîtes alignées sur les axes : c'est ce que la fumée sait contourner
// (les mêmes boîtes partent au solveur et aux shaders comme obstacles).
// Chaque niveau garde sa propre construction dans le navigateur.
import * as THREE from 'three';

const MAX_BOXES = 24, MAX_LIGHTS = 8;
const KINDS = {
  wall: { name: 'MUR', color: '#8d8a84' },
  floor: { name: 'SOL', color: '#6f6c66' },
  ceil: { name: 'PLAFOND', color: '#77746e' },
  light: { name: 'LUMIÈRE' },
};
const snap = (v, s = 0.25) => Math.round(v / s) * s;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function createBuilder({ root, camera, renderer, lo, hi, sunDefaults, canUse, canAimSun, levelKey, onChange, releaseMouse, floor = null }) {
  const ui = { open: false };
  let data = { boxes: [], lights: [], sun: { ...sunDefaults } };
  let key = null, place = 'wall', sel = null; // sel : { type: 'box' | 'light', i }
  let dist = 5, ceilH = 3.2;
  const group = new THREE.Group();
  root.add(group);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const bulbGeo = new THREE.SphereGeometry(0.09, 14, 10);
  const pointLights = [];
  const ghost = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0x9fd0ff, wireframe: true, transparent: true, opacity: 0.6, fog: false }));
  ghost.visible = false;
  root.add(ghost);

  const save = () => { if (key) try { localStorage.setItem('ingaBuild:' + key, JSON.stringify(data)); } catch { /* quota */ } };
  function load(k) {
    key = k;
    data = { boxes: [], lights: [], sun: { ...sunDefaults } };
    try {
      const s = JSON.parse(localStorage.getItem('ingaBuild:' + k));
      if (s) {
        const num = (v, d) => (Number.isFinite(v) ? v : d);
        for (const b of (s.boxes || []).slice(0, MAX_BOXES)) if ([b.x, b.y, b.z, b.sx, b.sy, b.sz].every(Number.isFinite)) data.boxes.push({ kind: KINDS[b.kind] ? b.kind : 'wall', x: b.x, y: b.y, z: b.z, sx: b.sx, sy: b.sy, sz: b.sz, color: typeof b.color === 'string' ? b.color : KINDS.wall.color });
        for (const l of (s.lights || []).slice(0, MAX_LIGHTS)) if ([l.x, l.y, l.z].every(Number.isFinite)) data.lights.push({ x: l.x, y: l.y, z: l.z, color: typeof l.color === 'string' ? l.color : '#ffd27a', intensity: num(l.intensity, 14), range: num(l.range, 9) });
        if (s.sun) data.sun = { color: typeof s.sun.color === 'string' ? s.sun.color : sunDefaults.color, intensity: num(s.sun.intensity, sunDefaults.intensity), az: num(s.sun.az, sunDefaults.az), el: num(s.sun.el, sunDefaults.el) };
      }
    } catch { /* données illisibles : construction vide */ }
    sel = null;
    rebuild();
    refresh();
    onChange(data, true);
  }
  function rebuild() {
    for (const c of [...group.children]) {
      group.remove(c);
      if (c.isMesh) c.material.dispose();
    }
    pointLights.length = 0;
    data.boxes.forEach((b, i) => {
      const m = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.92, emissive: ui.open && sel?.type === 'box' && sel.i === i ? 0x2a4a66 : 0x000000 }));
      m.position.set(b.x, b.y, b.z);
      m.scale.set(b.sx, b.sy, b.sz);
      m.castShadow = true; m.receiveShadow = true;
      group.add(m);
    });
    data.lights.forEach((l, i) => {
      const pl = new THREE.PointLight(l.color, l.intensity, l.range, 2);
      pl.position.set(l.x, l.y, l.z);
      group.add(pl);
      pointLights.push(pl);
      const bulb = new THREE.Mesh(bulbGeo, new THREE.MeshBasicMaterial({ color: l.color, fog: false }));
      bulb.position.copy(pl.position);
      bulb.scale.setScalar(ui.open && sel?.type === 'light' && sel.i === i ? 1.8 : 1);
      group.add(bulb);
    });
  }
  const changed = (geometry) => { rebuild(); save(); onChange(data, geometry); };

  // ---- Panneau
  const fp = document.createElement('div');
  fp.style.cssText = 'position:fixed;top:64px;left:18px;width:270px;max-height:calc(100vh - 90px);overflow:auto;background:#101512cc;color:#e4e8de;font:11px "DM Sans",sans-serif;padding:14px 16px;border:1px solid #ffffff2a;border-radius:10px;z-index:9;display:none;backdrop-filter:blur(12px)';
  fp.innerHTML = '<div style="letter-spacing:.16em;font-size:10px;margin-bottom:4px">CONSTRUCTION</div>'
    + '<div style="opacity:.6;margin-bottom:8px">B pour fermer · Clic gauche : poser au repère<br>Clic droit : retirer l\'élément visé · Molette : distance<br>Échap libère la souris pour les réglages</div>';
  document.body.append(fp);
  const el = (parent, css, txt) => { const d = document.createElement('div'); d.style.cssText = css; if (txt) d.textContent = txt; parent.append(d); return d; };
  const heading = (parent, txt) => el(parent, 'letter-spacing:.16em;font-size:10px;opacity:.7;margin:13px 0 5px', txt);
  const button = (parent, label, on) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'margin:0 6px 6px 0;background:#f5f0e916;border:1px solid #ffffff44;color:#e4e8de;padding:6px 9px;border-radius:5px;cursor:pointer;font:11px "DM Sans",sans-serif';
    b.addEventListener('click', on);
    parent.append(b);
    return b;
  };
  const hl = (b, on) => { b.style.background = on ? '#6fb8c540' : '#f5f0e916'; };
  // Curseur lié à un objet courant (get renvoie undefined → curseur masqué).
  // range : bornes relues à chaque rafraîchissement (l'emprise peut changer).
  function slider(parent, label, min, max, step, get, set, geometry = true, range = null) {
    const w = el(parent, 'margin:7px 0 2px');
    const lab = el(w, 'display:flex;justify-content:space-between;letter-spacing:.05em');
    const nameEl = document.createElement('span'); nameEl.textContent = label;
    const valEl = document.createElement('span'); valEl.style.opacity = '.7';
    lab.append(nameEl, valEl);
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step;
    inp.style.cssText = 'width:100%;accent-color:#6fb8c5';
    inp.addEventListener('input', () => { valEl.textContent = (+inp.value).toFixed(2); set(+inp.value); changed(geometry); });
    w.append(inp);
    return () => { const v = get(); w.style.display = v === undefined ? 'none' : 'block'; if (range) { const [a, b] = range(); inp.min = a; inp.max = b; } if (v !== undefined) { inp.value = v; valEl.textContent = (+v).toFixed(2); } };
  }
  function colour(parent, label, get, set) {
    const w = el(parent, 'display:flex;align-items:center;gap:10px;margin:8px 0 2px;letter-spacing:.05em');
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.style.cssText = 'width:42px;height:24px;border:1px solid #ffffff44;border-radius:4px;background:none;padding:0;cursor:pointer';
    inp.addEventListener('input', () => { set(inp.value); changed(false); });
    w.append(inp, document.createTextNode(label));
    return () => { const v = get(); w.style.display = v === undefined ? 'none' : 'flex'; if (v !== undefined) inp.value = v; };
  }
  const refs = [];
  heading(fp, 'LE CLIC POSE');
  const modeRow = el(fp, '');
  const modeBtns = {};
  for (const k in KINDS) modeBtns[k] = button(modeRow, KINDS[k].name, () => { place = k; refresh(); });
  refs.push(slider(fp, 'Hauteur des plafonds (m)', 2, 7, 0.25, () => ceilH, (v) => { ceilH = v; }, false));

  const selTitle = heading(fp, '');
  const list = el(fp, '');
  const box = () => (sel?.type === 'box' ? data.boxes[sel.i] : null);
  const lig = () => (sel?.type === 'light' ? data.lights[sel.i] : null);
  const bs = (label, k, min, max, ax) => refs.push(slider(fp, label, min, max, 0.05, () => box()?.[k], (v) => { box()[k] = v; }, true, ax ? () => [lo[ax], hi[ax]] : null));
  bs('Position X', 'x', lo.x, hi.x, 'x'); bs('Position Y', 'y', lo.y, hi.y, 'y'); bs('Position Z', 'z', lo.z, hi.z, 'z');
  bs('Taille X', 'sx', 0.15, 24); bs('Taille Y (hauteur)', 'sy', 0.15, 7.4); bs('Taille Z', 'sz', 0.15, 24);
  refs.push(colour(fp, 'Couleur', () => box()?.color, (v) => { box().color = v; }));
  const ls = (label, k, min, max, step = 0.05, ax = null) => refs.push(slider(fp, label, min, max, step, () => lig()?.[k], (v) => { lig()[k] = v; }, false, ax ? () => [lo[ax], hi[ax]] : null));
  ls('Position X', 'x', lo.x, hi.x, 0.05, 'x'); ls('Position Y', 'y', lo.y, hi.y, 0.05, 'y'); ls('Position Z', 'z', lo.z, hi.z, 0.05, 'z');
  ls('Intensité', 'intensity', 0, 80, 0.5); ls('Portée (m)', 'range', 1, 25, 0.25);
  refs.push(colour(fp, 'Couleur de la lumière', () => lig()?.color, (v) => { lig().color = v; }));
  const selBtns = el(fp, '');
  button(selBtns, 'Supprimer', () => { if (sel) removeAt(sel); });
  button(selBtns, 'Tout effacer', () => { data.boxes.length = 0; data.lights.length = 0; sel = null; refresh(); changed(true); });

  // Couleur du sol du niveau (l'atelier) : visible seulement là où elle existe.
  if (floor) {
    const fh = heading(fp, 'SOL');
    const fr = colour(fp, 'Couleur du sol', () => floor.get(), (v) => floor.set(v));
    refs.push(() => { fh.style.display = floor.get() === undefined ? 'none' : 'block'; fr(); });
  }
  heading(fp, 'SOLEIL');
  refs.push(colour(fp, 'Couleur du soleil', () => data.sun.color, (v) => { data.sun.color = v; }));
  refs.push(slider(fp, 'Intensité', 0, 8, 0.05, () => data.sun.intensity, (v) => { data.sun.intensity = v; }, false));
  refs.push(slider(fp, 'Azimut (°)', 0, 360, 1, () => (canAimSun() ? data.sun.az : undefined), (v) => { data.sun.az = v; }, false));
  refs.push(slider(fp, 'Élévation (°)', 5, 90, 1, () => (canAimSun() ? data.sun.el : undefined), (v) => { data.sun.el = v; }, false));
  const sunNote = el(fp, 'opacity:.6;margin-top:4px', 'La direction du soleil se règle dans les niveaux ATELIER et BRUTALISME (dans la galerie, les rais et la poussière sont calés sur le soleil d\'origine).');
  button(el(fp, 'margin-top:8px'), 'Soleil d\'origine', () => { data.sun = { ...sunDefaults }; refresh(); changed(false); });

  function refresh() {
    for (const k in modeBtns) hl(modeBtns[k], k === place);
    selTitle.textContent = box() ? `${KINDS[box().kind].name} ${sel.i + 1}` : lig() ? `LUMIÈRE ${sel.i + 1}` : 'RIEN DE SÉLECTIONNÉ';
    list.textContent = '';
    data.boxes.forEach((b, i) => hl(button(list, `${KINDS[b.kind].name[0]}${i + 1}`, () => { sel = sel?.type === 'box' && sel.i === i ? null : { type: 'box', i }; refresh(); rebuild(); }), sel?.type === 'box' && sel.i === i));
    data.lights.forEach((l, i) => hl(button(list, `L${i + 1}`, () => { sel = sel?.type === 'light' && sel.i === i ? null : { type: 'light', i }; refresh(); rebuild(); }), sel?.type === 'light' && sel.i === i));
    selBtns.style.display = 'block';
    sunNote.style.display = canAimSun() ? 'none' : 'block';
    for (const r of refs) r();
  }
  function removeAt(s) {
    (s.type === 'box' ? data.boxes : data.lights).splice(s.i, 1);
    sel = null;
    refresh();
    changed(s.type === 'box');
  }

  // ---- Pose au repère
  const _dir = new THREE.Vector3(), _pt = new THREE.Vector3(), _to = new THREE.Vector3();
  function aim() {
    camera.getWorldDirection(_dir);
    const p = camera.position;
    let t = dist;
    if (p.x > lo.x && p.x < hi.x && p.y > lo.y && p.y < hi.y && p.z > lo.z && p.z < hi.z) {
      for (const a of ['x', 'y', 'z']) {
        if (_dir[a] > 1e-5) t = Math.min(t, (hi[a] - p[a]) / _dir[a]);
        else if (_dir[a] < -1e-5) t = Math.min(t, (lo[a] - p[a]) / _dir[a]);
      }
    }
    return _pt.copy(p).addScaledVector(_dir, t).clamp(lo, hi);
  }
  // Boîte que poserait le clic, selon le mode et la direction du regard.
  function proposal() {
    const a = aim();
    const x = snap(a.x), z = snap(a.z);
    if (place === 'wall') {
      const alongX = Math.abs(_dir.z) >= Math.abs(_dir.x); // le mur fait face au joueur
      return { kind: 'wall', x, y: 1.5, z, sx: alongX ? 4 : 0.3, sy: 3, sz: alongX ? 0.3 : 4, color: KINDS.wall.color };
    }
    if (place === 'floor') { const top = Math.max(0.3, snap(a.y)); return { kind: 'floor', x, y: top - 0.15, z, sx: 4, sy: 0.3, sz: 4, color: KINDS.floor.color }; }
    if (place === 'ceil') return { kind: 'ceil', x, y: Math.min(hi.y - 0.15, ceilH + 0.15), z, sx: 4, sy: 0.3, sz: 4, color: KINDS.ceil.color };
    return null;
  }
  const locked = () => document.pointerLockElement === renderer.domElement;
  function setOpen(open) {
    if (open === ui.open) return;
    ui.open = open;
    fp.style.display = open ? 'block' : 'none';
    ghost.visible = false;
    if (open) { refresh(); releaseMouse(); }
    rebuild();
  }
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyB' || e.repeat || e.target instanceof HTMLInputElement) return;
    if (!ui.open && !canUse()) return;
    setOpen(!ui.open);
  });
  window.addEventListener('mousedown', (e) => {
    if (!ui.open || !locked()) return;
    if (e.button === 0) {
      if (place === 'light') {
        if (data.lights.length >= MAX_LIGHTS) return;
        const a = aim();
        const prev = data.lights[data.lights.length - 1];
        data.lights.push({ x: a.x, y: a.y, z: a.z, color: prev ? prev.color : '#ffd27a', intensity: prev ? prev.intensity : 14, range: prev ? prev.range : 9 });
        sel = { type: 'light', i: data.lights.length - 1 };
        refresh(); changed(false);
      } else {
        if (data.boxes.length >= MAX_BOXES) return;
        data.boxes.push(proposal());
        sel = { type: 'box', i: data.boxes.length - 1 };
        refresh(); changed(true);
      }
    } else if (e.button === 2) {
      camera.getWorldDirection(_dir);
      let best = null, bestCos = Math.cos(9 * Math.PI / 180);
      const scan = (arr, type) => arr.forEach((o, i) => {
        const c = _to.set(o.x, o.y, o.z).sub(camera.position).normalize().dot(_dir);
        if (c > bestCos) { bestCos = c; best = { type, i }; }
      });
      scan(data.boxes, 'box'); scan(data.lights, 'light');
      if (best) removeAt(best);
    }
  });
  window.addEventListener('wheel', (e) => { if (ui.open && locked()) dist = clamp(dist * (e.deltaY > 0 ? 0.9 : 1.1), 1, 25); });

  return {
    ui, load,
    get data() { return data; },
    get lights() { return pointLights; },
    close: () => setOpen(false),
    // Le joueur peut-il se tenir en (x, z) ? Faux dans une boîte qui coupe
    // sa hauteur (entre 20 cm et 1,7 m du sol).
    // Le joueur (pieds à la hauteur `feet`) peut-il se tenir en (x, z) ?
    // Faux dans une boîte qui coupe son corps, de 20 cm à 1,7 m au-dessus des pieds.
    blocked(x, z, feet = 0) {
      for (const b of data.boxes) {
        if (b.y - b.sy / 2 > feet + 1.7 || b.y + b.sy / 2 < feet + 0.2) continue;
        if (Math.abs(x - b.x) < b.sx / 2 + 0.3 && Math.abs(z - b.z) < b.sz / 2 + 0.3) return true;
      }
      return false;
    },
    // Dessus de boîte le plus haut sous (x, z) que les pieds peuvent atteindre
    // (jusqu'à 45 cm au-dessus d'eux) : on peut marcher sur les constructions.
    floorAt(x, z, feet = 0) {
      let top = -Infinity;
      for (const b of data.boxes) {
        const t = b.y + b.sy / 2;
        if (t > feet + 0.45 || t <= top) continue;
        if (Math.abs(x - b.x) < b.sx / 2 && Math.abs(z - b.z) < b.sz / 2) top = t;
      }
      return top;
    },
    update() {
      if (!ui.open) return;
      const p = locked() ? proposal() : null;
      ghost.visible = !!p || (locked() && place === 'light');
      if (p) { ghost.position.set(p.x, p.y, p.z); ghost.scale.set(p.sx, p.sy, p.sz); }
      else if (ghost.visible) { ghost.position.copy(aim()); ghost.scale.setScalar(0.25); }
    },
  };
}
