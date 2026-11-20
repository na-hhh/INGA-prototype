// ---- Mondes éditables -----------------------------------------------------------
// Glue between the editor and a level's content: a "world" facade over one
// island world (skyIsles) + its placed objects (props) + optional level
// settings (atmosphere). Also the island model library ("modèles"), shared by
// every level and saved in the project (src/data/isle-presets.json).
import { ISLE_SCHEMA, ISLE_DEFAULTS, LINK_SCHEMA, LINK_DEFAULTS, ENV_SCHEMA, ENV_DEFAULTS } from './skyIsles.js';
import { PROP_TYPES } from './props.js';

const PROJECT = import.meta.glob('./data/*.json', { eager: true, import: 'default' });
export function projectFile(name) {
  const d = PROJECT['./data/' + name + '.json'];
  return d ? JSON.parse(JSON.stringify(d)) : null;
}
export function readDraft(key) {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch { return null; }
}
async function saveToProject(file, data) {
  const r = await fetch('/__inga/save?file=' + file, { method: 'POST', headers: { 'content-type': 'application/json', 'x-inga-editor': '1' }, body: JSON.stringify(data) });
  if (!r.ok) throw new Error(await r.text());
}

// ---- Modèles d'îles ----
// A model is an island's parameters minus its identity and placement.
const PLACEMENT = ['id', 'name', 'kind', 'x', 'y', 'z', 'rotY'];
const BUILTIN_PRESETS = [
  { name: 'Grande île à strates', params: { radius: 34, depth: 100, ledges: 1.6, strataScale: 22 } },
  { name: 'Pilier haut', params: { radius: 14, depth: 120, taper: 3.4, belly: 1.1, columns: 1.6, jungle: 1.2 } },
  { name: 'Petite île satellite', params: { radius: 6, depth: 15, taper: 1.7 } },
  { name: 'Île ronde moussue', params: { radius: 20, depth: 34, taper: 1.5, belly: 0.5, ledges: 0.4, moss: 1.8, mossRuns: 1.6, beards: 2.5, beardLength: 1.6 } },
  { name: 'Éclat rocheux nu', params: { radius: 9, depth: 40, jungle: 0.25, trees: 0, beards: 0.3, flutes: 2.2, columns: 2.2, greyFrom: 0.15 } },
];
export function createPresetStore() {
  const KEY = 'ingaIslePresets';
  let list = readDraft(KEY)?.list || projectFile('isle-presets')?.list || BUILTIN_PRESETS.map((p) => ({ ...p }));
  const persist = () => {
    try { localStorage.setItem(KEY, JSON.stringify({ list })); } catch { /* quota */ }
    return saveToProject('isle-presets', { list }).then(() => true, () => false);
  };
  return {
    get list() { return list; },
    add(name, def) {
      const params = {};
      for (const [k, v] of Object.entries(def)) if (!PLACEMENT.includes(k) && ISLE_DEFAULTS[k] !== v) params[k] = v;
      list = list.filter((p) => p.name !== name).concat([{ name, params }]);
      return persist();
    },
    remove(name) { list = list.filter((p) => p.name !== name); return persist(); },
  };
}

let uid = 0;
const newId = (prefix, taken) => {
  let id;
  do { id = prefix + (Date.now() % 1e6).toString(36) + (uid++).toString(36); } while (taken(id));
  return id;
};

// opts: title, fileName, storageKey, isles, props, propsRoot, defaultDoc(),
//       atmos? { schema, get(), set(patch) }, presets, surfaces?(),
//       extraIslandActions?(id, api, world), camSpeed
export function makeWorld(opts) {
  const { isles, props, presets } = opts;
  let project = projectFile(opts.fileName);
  const W = {
    title: opts.title,
    fileName: opts.fileName,
    storageKey: opts.storageKey,
    camSpeed: opts.camSpeed || 20,
    restoreCamera: opts.restoreCamera !== false,
    defaultDoc: opts.defaultDoc,
    projectDoc: () => project && JSON.parse(JSON.stringify(project)),
    hasDraft: () => !!readDraft(opts.storageKey),
    onSaved(doc) { project = JSON.parse(JSON.stringify(doc)); },
    // Initial content: the draft if any, else the project file, else defaults.
    initialDoc() { return readDraft(opts.storageKey) || W.projectDoc() || opts.defaultDoc(); },
    doc() {
      const d = { version: 1, isles: isles.getDoc(), props: props.getDoc() };
      if (opts.atmos) d.atmos = opts.atmos.get();
      return d;
    },
    load(doc) {
      isles.load(doc.isles || { islands: doc.islands || [], links: doc.links || [], env: doc.env || {} });
      props.load(doc.props || []);
      if (opts.atmos && doc.atmos) opts.atmos.set(doc.atmos);
    },
    list() {
      const out = [{ kind: 'env', id: 'env', label: 'Environnement', group: 'Réglages', icon: '☼' }];
      const isl = [...isles.items.values()].sort((a, b) => (a.P.kind === 'gallery' ? -1 : b.P.kind === 'gallery' ? 1 : (a.def.name || '').localeCompare(b.def.name || '')));
      for (const it of isl) out.push({ kind: 'island', id: it.def.id, label: it.def.name || it.def.id, group: 'Îles', icon: it.P.kind === 'gallery' ? '⌂' : '▲' });
      for (const l of isles.links.values()) {
        const a = isles.items.get(l.L.a), b = isles.items.get(l.L.b);
        out.push({ kind: 'link', id: l.L.id, label: `${a?.def.name || l.L.a} ⟷ ${b?.def.name || l.L.b}`, group: 'Lianes', icon: '⌒' });
      }
      for (const p of props.items.values()) out.push({ kind: 'prop', id: p.def.id, label: p.def.name || PROP_TYPES[p.def.type].label, group: 'Objets posés', icon: PROP_TYPES[p.def.type].icon });
      return out;
    },
    schema(kind, id) {
      if (kind === 'env') return [...ENV_SCHEMA, ...(opts.atmos?.schema || [])];
      if (kind === 'island') {
        const gal = isles.items.get(id)?.P.kind === 'gallery';
        return ISLE_SCHEMA.map((s) => ({ ...s, open: s.title === 'Forme' || s.title === 'Végétation', fields: s.fields.filter((f) => !(gal && f.gallery === false)) }));
      }
      if (kind === 'link') return LINK_SCHEMA;
      if (kind === 'prop') return PROP_TYPES[props.items.get(id)?.def.type]?.schema || [];
      return [];
    },
    get(kind, id) {
      if (kind === 'env') return { ...ENV_DEFAULTS, ...isles.env, ...(opts.atmos?.get() || {}) };
      if (kind === 'island') { const it = isles.items.get(id); return it ? { ...ISLE_DEFAULTS, ...it.def } : null; }
      if (kind === 'link') { const l = isles.links.get(id); return l ? { ...LINK_DEFAULTS, ...l.def } : null; }
      if (kind === 'prop') { const p = props.items.get(id); return p ? props.full(p.def) : null; }
      return null;
    },
    set(kind, id, def) {
      if (kind === 'env') {
        if (!def) return;
        const envPatch = {}, atPatch = {};
        for (const [k, v] of Object.entries(def)) (k in ENV_DEFAULTS ? envPatch : atPatch)[k] = v;
        const frag = ['fragCount', 'fragSize', 'fragSpread', 'fragHeight', 'fragSeed'].some((k) => k in envPatch && envPatch[k] !== isles.env[k]);
        isles.setEnv(envPatch, frag);
        opts.atmos?.set(atPatch);
      } else if (kind === 'island') isles.setIsland(id, def);
      else if (kind === 'link') isles.setLink(id, def);
      else if (kind === 'prop') props.set(id, def);
    },
    object(kind, id) {
      if (kind === 'island') return isles.items.get(id)?.group || null;
      if (kind === 'link') return isles.links.get(id)?.group || null;
      if (kind === 'prop') return props.items.get(id)?.group || null;
      return null;
    },
    xform(kind, id) {
      if (kind === 'island') return isles.items.get(id)?.P.kind === 'gallery' ? null : { move: true, rot: true, scale: false };
      if (kind === 'prop') return { move: true, rot: true, scale: true };
      return null;
    },
    sync(kind, id) {
      if (kind === 'island') isles.syncTransform(id);
      if (kind === 'prop') props.syncTransform(id);
      return W.get(kind, id);
    },
    // What the selection box and « cadrer » measure (the rock, not its mist).
    boundsObject(kind, id) { return kind === 'island' ? isles.items.get(id)?.rock || null : W.object(kind, id); },
    live(kind, id) { if (kind === 'island') isles.syncTransform(id); },
    setDragging(kind, id, v) { if (kind === 'island') { const it = isles.items.get(id); if (it) it.dragging = v; } },
    pickables() {
      const out = [];
      const walk = (o) => { if (!o.visible) return; if ((o.isMesh || o.isSprite) && o.userData.ed) out.push(o); for (const c of o.children) walk(c); };
      walk(isles.root);
      walk(opts.propsRoot);
      return out;
    },
    surfaces: () => opts.surfaces?.() || [],
    palette() {
      const p = [];
      for (const [type, T] of Object.entries(PROP_TYPES)) p.push({ group: 'Objets', label: T.label, icon: T.icon, kind: 'prop', dist: 12, make: (at) => ({ type, name: '', x: +at.x.toFixed(2), y: +at.y.toFixed(2), z: +at.z.toFixed(2) }) });
      const isle = (label, params, icon = '▲') => ({ group: 'Îles', label, icon, kind: 'island', free: true, dist: 30 + (params.radius || ISLE_DEFAULTS.radius) * 3, make: (at) => ({ name: label, x: +at.x.toFixed(1), y: +at.y.toFixed(1), z: +at.z.toFixed(1), seed: 1 + Math.floor(Math.random() * 9998), ...params }) });
      p.push(isle('Île', {}));
      for (const pr of presets.list) p.push({ ...isle(pr.name, pr.params, '★'), group: 'Modèles d\'îles' });
      p.push({ group: 'Lianes', label: 'Lianes entre deux îles', icon: '⌒', link: true });
      return p;
    },
    newId(kind) {
      const taken = (x) => isles.items.has(x) || isles.links.has(x) || props.items.has(x);
      return newId(kind === 'island' ? 'i' : kind === 'link' ? 'l' : 'o', taken);
    },
    canDelete: (kind, id) => (kind === 'island' ? isles.items.get(id)?.P.kind !== 'gallery' : kind === 'link' || kind === 'prop'),
    canDuplicate: (kind, id) => (kind === 'island' ? isles.items.get(id)?.P.kind !== 'gallery' : kind === 'prop'),
    duplicate(kind, id) {
      const d = W.get(kind, id);
      delete d.id;
      if (kind === 'island') { d.x += d.radius * 2.6; d.name = (d.name || 'Île') + ' (copie)'; }
      else { d.x += 2; }
      return d;
    },
    dependents: (kind, id) => (kind === 'island' ? isles.linksOf(id).map((l) => ['link', l]) : []),
    makeLink: (a, b) => ({ a, b, seed: 1 + Math.floor(Math.random() * 9998) }),
    info(kind, id) {
      if (kind === 'island' && isles.items.get(id)?.P.kind === 'gallery') return 'L\'île de la galerie : son contour suit le bâtiment, elle ne se déplace pas. Tout le reste se règle.';
      if (kind === 'link') { const l = isles.links.get(id); return l ? `Relie « ${isles.items.get(l.L.a)?.def.name} » et « ${isles.items.get(l.L.b)?.def.name} ».` : ''; }
      if (kind === 'env') return 'Réglages communs au niveau : ciel, nuages, lumière des îles, fragments flottants.';
      return '';
    },
    actions(kind, id) {
      const acts = [];
      if (kind === 'island') {
        acts.push({ label: '⌒ Relier à une île…', title: 'Créer des lianes vers une autre île', run: (api) => api.startLinking(id) });
        acts.push({ label: '★ Enregistrer comme modèle', run: async (api) => {
          const name = prompt('Nom du modèle d\'île :', W.get(kind, id).name || 'Mon île');
          if (!name) return;
          const ok = await presets.add(name, W.get(kind, id));
          api.toast(ok ? `Modèle « ${name} » enregistré dans le projet` : `Modèle « ${name} » gardé dans le navigateur`);
          api.world && api.refresh();
        } });
        if (presets.list.length) acts.push({ label: '★ Appliquer un modèle…', run: (api) => {
          const names = presets.list.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
          const n = +prompt('Quel modèle appliquer ? (numéro)\n' + names, '1');
          const pr = presets.list[n - 1];
          if (!pr) return;
          const before = W.get(kind, id);
          W.set(kind, id, { ...ISLE_DEFAULTS, ...Object.fromEntries(Object.entries(before).filter(([k]) => PLACEMENT.includes(k))), ...pr.params });
          api.push({ kind, id, before, after: W.get(kind, id) });
          api.select(kind, id);
          api.toast(`Modèle « ${pr.name} » appliqué`);
        } });
        for (const a of opts.extraIslandActions?.(id, W) || []) acts.push(a);
      }
      if (kind === 'link' || kind === 'prop') {
        acts.push({ label: '🎲 Nouvelle variante', run: (api) => {
          const before = W.get(kind, id);
          if (!('seed' in before)) return;
          W.set(kind, id, { ...before, seed: 1 + Math.floor(Math.random() * 9998) });
          api.push({ kind, id, before, after: W.get(kind, id) });
          api.select(kind, id);
        } });
      }
      return acts;
    },
    showHelpers: (on) => props.showHelpers(on),
  };
  return W;
}
