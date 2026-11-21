// ---- Béton : textures du sol et des murs ------------------------------------
// Le domaine BÉTON règle ici le sol (une seule coulée lisse, sans joint, avec
// ses imperfections) et les murs (grandes plaques de coffrage, trous de
// banche, à la manière de Tadao Ando). La galerie utilise exactement les
// mêmes matériaux : ce que l'on règle dans le domaine s'y voit aussitôt.
//
// - Les textures sont des photos de béton CC0 (ambientCG, Poly Haven), en
//   1024 px dans public/assets/beton/ (crédits dans LICENCE.txt).
// - Le reste est dessiné dans le shader d'après la position dans le monde,
//   net à toute distance et réglable en direct : plaques en colonnes et
//   rangées alternées (une grande, une étroite), joints fins avec leur
//   coulure, 2 ou 4 trous de banche en cône, pores semés en grappes, et des
//   marbrures à grande échelle qui cassent la répétition de la photo.
// - Réglages : brouillon dans le navigateur, « Enregistrer » les écrit dans
//   src/data/beton.json (serveur de dev), version partagée par le projet.
import * as THREE from 'three';

const PROJECT = import.meta.glob('./data/beton.json', { eager: true, import: 'default' });
const DRAFT_KEY = 'ingaBeton4';

export const BETON_LIB = [
  { id: 'concrete016', name: 'Clair à pores (ambientCG 016)' },
  { id: 'concrete_floor_worn_001', name: 'Sol lisse gris, marques (Poly Haven)' },
  { id: 'concrete034', name: 'Lisse très clair (ambientCG 034)' },
  { id: 'concrete030', name: 'Gris moyen, petits trous (ambientCG 030)' },
  { id: 'concrete014', name: 'Nuagé de coffrage (ambientCG 014)' },
  { id: 'concrete027', name: 'Coffrage à bulles (ambientCG 027)' },
  { id: 'concrete_wall_008', name: 'Mur lisse beige (Poly Haven)' },
];

export const BETON_DEFAULTS = {
  floor: { tex: 'concrete034', scale: 3.5, tint: '#efeeea', bright: 1.35, rough: 0.7, relief: 0.35, shine: 0.06, reflect: 0.12, mottle: 0.45, pores: 0.3 },
  wall: {
    tex: 'concrete016', scale: 3, tint: '#e6e4df', bright: 1.5, rough: 0.95, relief: 0.6,
    // Grandes plaques verticales, comme sur les photos de référence :
    // colonnes d'une grande plaque (2,4 m) puis d'une étroite (0,7 m) ;
    // une rangée basse (2,6 m) au pied du mur, puis une haute (4,8 m) —
    // 7,4 m, la hauteur des murs du hall : un seul joint horizontal.
    panelW: 2.4, panelW2: 0.7, panelH: 4.8, panelH2: 2.6,
    // 4 trous dans les grandes plaques (2 × 2), 2 dans les étroites.
    holesX: 2, holesY: 2, holeR: 0.021, insetX: 0.35, insetY: 0.45, holeDepth: 1,
    joint: 0.004, jointDark: 0.45, bleed: 0.5, panelVar: 0.08, mottle: 0.5, pores: 0.6, poreSize: 1,
  },
};

const clone = (o) => JSON.parse(JSON.stringify(o));
function merge(base, src) {
  const out = clone(base);
  for (const part of ['floor', 'wall']) for (const k in out[part]) {
    const v = src?.[part]?.[k];
    if (typeof v === typeof out[part][k]) out[part][k] = v;
  }
  return out;
}
export const projectBeton = () => merge(BETON_DEFAULTS, PROJECT['./data/beton.json']);
// Pièces construites avec l'avatar (X), enregistrées avec les réglages.
export const projectPieces = () => PROJECT['./data/beton.json']?.pieces || [];
export function loadBeton() {
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch { /* brouillon illisible */ }
  return merge(projectBeton(), draft);
}
export function saveDraft(state) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(state)); } catch { /* quota */ } }
export function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* stockage indisponible */ } }
export function hasDraft() { try { return !!localStorage.getItem(DRAFT_KEY); } catch { return false; } }
// Écrit les réglages dans src/data/beton.json (serveur de dev seulement).
export async function saveProject(state) {
  const r = await fetch('/__inga/save?file=beton', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-inga-editor': '1' }, body: JSON.stringify(state),
  });
  if (!r.ok) throw new Error(r.status === 404 ? 'possible seulement avec le serveur local (npm run dev)' : await r.text());
  clearDraft();
}

// ---- Qualité : LÉGER (petites machines), MOYEN, COMPLET (grosse carte) ----
//   léger   : textures 1K, filtrage faible, ni pores ni coulures ni relief
//             des trous dans le shader, sol sans vernis ni reflets ;
//   moyen   : tous les effets, textures 1K ;
//   complet : tous les effets, textures 2K (quand elles existent),
//             filtrage maximal.
// Par défaut, la qualité générale de la page (?q=low|medium|high).
export const BETON_QUALITIES = [
  ['leger', 'LÉGER', 'Portable, petite carte graphique'],
  ['moyen', 'MOYEN', 'Tous les effets, textures 1K'],
  ['complet', 'COMPLET', 'Textures 2K, filtrage maximal'],
];
const Q_INDEX = { leger: 0, moyen: 1, complet: 2 };
const HAS_2K = new Set(['concrete016', 'concrete034']);
let quality = 'moyen';
export function initBetonQuality(pageQuality) {
  let q = { low: 'leger', medium: 'moyen', high: 'complet' }[pageQuality] || 'moyen';
  try { const v = localStorage.getItem('ingaBetonQ'); if (v in Q_INDEX) q = v; } catch { /* stockage indisponible */ }
  quality = q;
  return q;
}
export const betonQuality = () => quality;
export function setBetonQuality(q) {
  if (!(q in Q_INDEX)) return;
  quality = q;
  try { localStorage.setItem('ingaBetonQ', q); } catch { /* quota */ }
}
const hooked = new Set(); // matériaux dont le shader dépend de la qualité

// ---- Textures ----
const loader = new THREE.TextureLoader();
const texCache = new Map();
// Une instance par rôle (sol / mur) et par résolution : chacun a sa répétition.
function texture(id, kind, role, renderer) {
  const res = quality === 'complet' && HAS_2K.has(id) ? '_2k' : '';
  const aniso = Math.min([2, 4, 16][Q_INDEX[quality]], renderer.capabilities.getMaxAnisotropy());
  const key = `${id}/${kind}${res}/${role}`;
  let t = texCache.get(key);
  if (!t) {
    t = loader.load(`${import.meta.env.BASE_URL}assets/beton/${id}/${kind}${res}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (kind === 'color') t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    texCache.set(key, t);
  } else if (t.anisotropy !== aniso) {
    t.anisotropy = aniso;
    if (t.image) t.needsUpdate = true; // renvoyée une fois, pas à chaque curseur
  }
  return t;
}
// Les UV des boîtes valent 0,4 par mètre (TEX_DENSITY de main.js).
const UV_PER_M = 0.4;
function setMaps(mat, p, role, renderer) {
  const rep = 1 / (p.scale * UV_PER_M);
  mat.map = texture(p.tex, 'color', role, renderer);
  mat.normalMap = texture(p.tex, 'normal', role, renderer);
  mat.roughnessMap = texture(p.tex, 'rough', role, renderer);
  for (const t of [mat.map, mat.normalMap, mat.roughnessMap]) t.repeat.set(rep, rep);
  mat.color.set(p.tint).multiplyScalar(p.bright);
  mat.roughness = p.rough;
  mat.normalScale.set(p.relief, p.relief);
  mat.needsUpdate = true;
}

// ---- GLSL commun : bruit, pores, marbrures ----
const COMMON_GLSL = `
varying vec3 vBtWP; varying vec3 vBtWN;
float btHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float btNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( btHash( i ), btHash( i + vec2( 1, 0 ) ), f.x ), mix( btHash( i + vec2( 0, 1 ) ), btHash( i + vec2( 1, 1 ) ), f.x ), f.y );
}
// Marbrures : taches claires et sombres de 0,5 à 3 m (cassent la répétition).
float btMottle( vec2 p ) { return ( btNoise( p * 0.35 ) - 0.5 ) * 0.6 + ( btNoise( p * 1.3 + 7.0 ) - 0.5 ) * 0.3 + ( btNoise( p * 4.1 + 3.0 ) - 0.5 ) * 0.1; }
// Pores (bulles d'air du coffrage) : un au plus par cellule de 3,5 cm,
// semés en grappes. Ils s'effacent au loin plutôt que de scintiller.
float btPores( vec2 p, float dens, float size ) {
  vec2 g = p / 0.035; vec2 c = floor( g );
  float cluster = 0.25 + 1.5 * btNoise( p * 0.9 + 11.0 );
  if ( btHash( c ) > dens * cluster * 0.22 ) return 0.0;
  vec2 o = c + 0.25 + 0.5 * vec2( btHash( c + 7.1 ), btHash( c + 3.3 ) );
  float r = ( 0.035 + 0.11 * pow( btHash( c + 9.7 ), 2.0 ) ) * size;
  float aa = max( fwidth( g.x ), 1e-4 );
  float pore = 1.0 - smoothstep( r - aa, r + aa, length( g - o ) );
  return pore * ( 1.0 - smoothstep( 0.08, 0.3, aa ) );
}
`;
const VERT_INJECT = [
  ['#include <common>', '#include <common>\nvarying vec3 vBtWP; varying vec3 vBtWN;'],
  ['#include <project_vertex>', 'vBtWP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvBtWN = normalize( mat3( modelMatrix ) * objectNormal );\n#include <project_vertex>'],
];
function hook(mat, key, uniforms, fragCommon, mapCode, normalCode, roughCode) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(mat, sh, r);
    Object.assign(sh.uniforms, uniforms);
    for (const [a, b] of VERT_INJECT) sh.vertexShader = sh.vertexShader.replace(a, b);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + COMMON_GLSL + fragCommon)
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + mapCode)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + (roughCode || ''))
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + (normalCode || ''));
  };
  mat.customProgramCacheKey = () => prevKey() + '|beton-' + key + '-q' + Q_INDEX[quality];
  mat.defines = { ...(mat.defines || {}), BT_Q: Q_INDEX[quality] };
  hooked.add(mat);
  mat.needsUpdate = true;
}
// Après un changement de qualité : les shaders se recompilent.
export function refreshQualityDefines() {
  for (const m of hooked) { m.defines = { ...(m.defines || {}), BT_Q: Q_INDEX[quality] }; m.needsUpdate = true; }
}

// ---- Sol : une seule coulée, marbrures et rares pores ----
export const floorUniforms = { uFMottle: { value: 0 }, uFPores: { value: 0 } };
export function applyFloor(mat, p, renderer) {
  setMaps(mat, p, 'floor', renderer);
  if ('clearcoat' in mat) { mat.clearcoat = quality === 'leger' ? 0 : p.shine; mat.clearcoatRoughness = 0.35; }
  floorUniforms.uFMottle.value = p.mottle;
  floorUniforms.uFPores.value = p.pores;
}
export function installFloor(mat) {
  hook(mat, 'floor', floorUniforms, 'uniform float uFMottle; uniform float uFPores;\n', `{
  vec2 p = vBtWP.xz;
  diffuseColor.rgb *= 1.0 + btMottle( p ) * uFMottle;
#if BT_Q > 0
  diffuseColor.rgb *= 1.0 - 0.6 * btPores( p, uFPores, 0.8 );
#endif
}`, '', `{
  // Le ciré s'use par plages : un peu plus mat ici et là.
  roughnessFactor = clamp( roughnessFactor + ( btNoise( vBtWP.xz * 0.5 + 5.0 ) - 0.5 ) * 0.25 * uFMottle, 0.04, 1.0 );
}`);
}

// ---- Murs : plaques, joints, trous de banche ----
// Uniforms partagés : un curseur bouge, le mur suit sans recompiler.
export const wallUniforms = {
  uColA: { value: 1 }, uColB: { value: 0 }, uRowA: { value: 1 }, uRowB: { value: 0 },
  uHoles: { value: new THREE.Vector2() }, uInset: { value: new THREE.Vector2() },
  uHoleR: { value: 0 }, uHoleDepth: { value: 1 }, uJoint: { value: 0 }, uJointDark: { value: 0 }, uBleed: { value: 0 },
  uPanelVar: { value: 0 }, uMottle: { value: 0 }, uPores: { value: 0 }, uPoreSize: { value: 1 },
};
export function applyWall(mats, p, renderer) {
  for (const m of mats) setMaps(m, p, 'wall', renderer);
  const u = wallUniforms;
  u.uColA.value = p.panelW; u.uColB.value = p.panelW2;
  // Rangées : la basse au pied du mur, puis la haute.
  if (p.panelH2 > 0.01) { u.uRowA.value = p.panelH2; u.uRowB.value = p.panelH; } else { u.uRowA.value = p.panelH; u.uRowB.value = 0; }
  u.uHoles.value.set(Math.round(p.holesX), Math.round(p.holesY));
  u.uInset.value.set(p.insetX, p.insetY);
  u.uHoleR.value = p.holeR; u.uHoleDepth.value = p.holeDepth;
  u.uJoint.value = p.joint; u.uJointDark.value = p.jointDark; u.uBleed.value = p.bleed;
  u.uPanelVar.value = p.panelVar; u.uMottle.value = p.mottle; u.uPores.value = p.pores; u.uPoreSize.value = p.poreSize;
}
const WALL_GLSL = `
uniform float uColA; uniform float uColB; uniform float uRowA; uniform float uRowB;
uniform vec2 uHoles; uniform vec2 uInset;
uniform float uHoleR; uniform float uHoleDepth; uniform float uJoint; uniform float uJointDark; uniform float uBleed;
uniform float uPanelVar; uniform float uMottle; uniform float uPores; uniform float uPoreSize;
// Coordonnées dans le plan du mur (m), et ses deux axes dans le monde.
vec2 btPlane( out vec3 U, out vec3 V ) {
  vec3 a = abs( vBtWN );
  if ( a.y > a.x && a.y > a.z ) { U = vec3( 1, 0, 0 ); V = vec3( 0, 0, 1 ); return vBtWP.xz; }
  if ( a.x > a.z ) { U = vec3( 0, 0, 1 ); V = vec3( 0, 1, 0 ); return vBtWP.zy; }
  U = vec3( 1, 0, 0 ); V = vec3( 0, 1, 0 ); return vBtWP.xy;
}
// Un axe découpé en segments alternés a, b (b = 0 : tous égaux) :
// début, taille et numéro du segment.
vec3 btSeg( float x, float a, float b ) {
  if ( b < 0.01 ) { float i = floor( x / a ); return vec3( i * a, a, i ); }
  float P = a + b; float k = floor( x / P ); float r = x - k * P;
  return r < a ? vec3( k * P, a, k * 2.0 ) : vec3( k * P + a, b, k * 2.0 + 1.0 );
}
// Plaque sous le point : position dans la plaque, taille, identifiant.
void btCell( vec2 p, out vec2 f, out vec2 size, out vec2 id ) {
  vec3 sx = btSeg( p.x, uColA, uColB ), sy = btSeg( p.y, uRowA, uRowB );
  f = p - vec2( sx.x, sy.x ); size = vec2( sx.y, sy.y ); id = vec2( sx.z, sy.z );
}
// Distance au trou le plus proche : grandes plaques 2 colonnes, étroites 1.
float btHoleDist( vec2 f, vec2 size ) {
  if ( uHoles.x < 0.5 || uHoles.y < 0.5 ) return 1e3;
  vec2 n = vec2( size.x > 1.5 ? uHoles.x : max( 1.0, uHoles.x - 1.0 ), uHoles.y );
  vec2 ins = min( uInset, size * 0.45 );
  vec2 span = size - 2.0 * ins;
  vec2 k = clamp( floor( ( f - ins ) / max( span, vec2( 1e-3 ) ) * ( n - 1.0 ) + 0.5 ), vec2( 0.0 ), n - 1.0 );
  vec2 c = mix( size * 0.5, ins + k / max( n - 1.0, vec2( 1.0 ) ) * span, step( 1.5, n ) );
  return length( f - c );
}
float btJointDist( vec2 f, vec2 size ) { vec2 d = min( f, size - f ); return min( d.x, d.y ); }
// Relief : creux du joint et cône peu profond du trou de banche.
float btHeight( vec2 p ) {
  vec2 f, size, id; btCell( p, f, size, id );
  float h = -uHoleDepth * ( 1.0 - smoothstep( uHoleR * 0.35, uHoleR, btHoleDist( f, size ) ) );
  h -= 0.5 * ( 1.0 - smoothstep( uJoint * 0.5, uJoint * 0.5 + 0.002, btJointDist( f, size ) ) );
  return h;
}
`;
export function installPanels(mat, key = 'wall') {
  hook(mat, key, wallUniforms, WALL_GLSL, `{
  vec3 U, V; vec2 p = btPlane( U, V );
  vec2 f, size, id; btCell( p, f, size, id );
  // Chaque plaque a sa coulée : teinte propre, laitance plus claire en haut.
  float tone = 1.0 + ( btHash( id ) - 0.5 ) * uPanelVar;
  tone *= 1.0 + ( smoothstep( 0.7, 1.0, f.y / size.y ) * 0.4 - 0.2 * smoothstep( 0.25, 0.0, f.y / size.y ) ) * uPanelVar;
  diffuseColor.rgb *= tone * ( 1.0 + btMottle( p + id * 3.7 ) * uMottle );
  // Joint fin et sa coulure sombre, irrégulière le long du joint.
  vec2 dd = min( f, size - f );
  float jd = min( dd.x, dd.y );
#if BT_Q > 0
  float along = dd.x < dd.y ? p.y : p.x;
  float w = uJoint * 0.5 + 0.03 * uBleed * btNoise( vec2( along * 1.7, id.x + id.y * 5.0 ) );
  float bleed = ( 1.0 - smoothstep( uJoint * 0.5, w, jd ) ) * uBleed * ( 0.3 + 0.7 * btNoise( vec2( along * 7.0, 3.0 ) ) );
  diffuseColor.rgb *= 1.0 - 0.35 * bleed;
#endif
  diffuseColor.rgb *= 1.0 - uJointDark * ( 1.0 - smoothstep( uJoint * 0.5, uJoint * 0.5 + 0.002, jd ) );
  // Trou de banche : fond gris un peu plus sombre (le relief fait le croissant).
  diffuseColor.rgb *= 1.0 - 0.22 * ( 1.0 - smoothstep( uHoleR * 0.6, uHoleR, btHoleDist( f, size ) ) );
#if BT_Q > 0
  diffuseColor.rgb *= 1.0 - 0.75 * btPores( p, uPores, uPoreSize );
#endif
}`, `{
#if BT_Q > 0
  vec3 U, V; vec2 p = btPlane( U, V );
  float e = 0.0015;
  float h0 = btHeight( p );
  vec2 g = vec2( btHeight( p + vec2( e, 0.0 ) ) - h0, btHeight( p + vec2( 0.0, e ) ) - h0 ) / e;
  vec3 dw = ( U * g.x + V * g.y ) * 0.012;
  normal = normalize( normal - ( viewMatrix * vec4( dw, 0.0 ) ).xyz );
#endif
}`);
}

// ---- Panneau du domaine BÉTON ----
export function createBetonPanel({ getState, onChange, onGallery, extra = () => ({}), onClose }) {
  const el = document.createElement('div');
  el.className = 'beton';
  el.style.display = 'none';
  document.body.append(el);
  const mk = (tag, cls, parent, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; parent.append(e); return e; };
  let status;
  function render() {
    const s = getState();
    el.innerHTML = '';
    const hd = mk('div', 'bt-h', el, '<b>BÉTON · RÉGLAGES</b><span>Le sol et les murs de la galerie · <kbd>P</kbd> fermer</span>');
    const x = mk('button', 'bt-x', hd, '×');
    x.type = 'button'; x.title = 'Fermer (P)';
    x.addEventListener('click', () => onClose?.());
    // Qualité : agit aussi sur la galerie (mêmes matériaux).
    const qs = mk('div', 'bt-q', el);
    for (const [id, name, desc] of BETON_QUALITIES) {
      const qb = mk('button', 'bt-qb' + (id === quality ? ' on' : ''), qs, `<b>${name}</b><span>${desc}</span>`);
      qb.type = 'button';
      qb.addEventListener('click', () => { setBetonQuality(id); refreshQualityDefines(); onChange(s); render(); });
    }
    const changed = () => { saveDraft(s); onChange(s); status.textContent = '● Brouillon (pas encore enregistré dans le projet)'; };
    const sec = (t) => mk('div', 'bt-sec', el, t);
    const select = (label, part, key) => {
      const w = mk('label', 'bt-row', el, `<span>${label}</span>`);
      const sel = mk('select', '', w);
      for (const t of BETON_LIB) { const o = mk('option', '', sel, t.name); o.value = t.id; }
      sel.value = s[part][key];
      sel.addEventListener('change', () => { s[part][key] = sel.value; changed(); });
    };
    const slider = (label, part, key, min, max, step, unit = '') => {
      const w = mk('label', 'bt-sl', el);
      const top = mk('div', '', w, `<span>${label}</span>`);
      const val = mk('span', '', top);
      const inp = mk('input', '', w);
      inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = s[part][key];
      const show = () => { val.textContent = (+inp.value).toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 0) + unit; };
      show();
      inp.addEventListener('input', () => { s[part][key] = +inp.value; show(); changed(); });
    };
    const color = (label, part, key) => {
      const w = mk('label', 'bt-row', el, `<span>${label}</span>`);
      const inp = mk('input', '', w);
      inp.type = 'color'; inp.value = s[part][key];
      inp.addEventListener('input', () => { s[part][key] = inp.value; changed(); });
    };
    sec('SOL · UNE SEULE COULÉE');
    select('Texture', 'floor', 'tex');
    slider('Taille du motif', 'floor', 'scale', 0.6, 8, 0.1, ' m');
    color('Teinte', 'floor', 'tint');
    slider('Luminosité', 'floor', 'bright', 0.5, 1.6, 0.01);
    slider('Marbrures', 'floor', 'mottle', 0, 1.2, 0.01);
    slider('Pores', 'floor', 'pores', 0, 1.5, 0.01);
    slider('Rugosité', 'floor', 'rough', 0.2, 1, 0.01);
    slider('Relief', 'floor', 'relief', 0, 2, 0.05);
    slider('Brillant (ciré)', 'floor', 'shine', 0, 0.6, 0.01);
    slider('Reflets (murs, plafond)', 'floor', 'reflect', 0, 0.6, 0.01);
    sec('MURS · BÉTON');
    select('Texture', 'wall', 'tex');
    slider('Taille du motif', 'wall', 'scale', 0.6, 8, 0.1, ' m');
    color('Teinte', 'wall', 'tint');
    slider('Luminosité', 'wall', 'bright', 0.5, 1.6, 0.01);
    slider('Marbrures', 'wall', 'mottle', 0, 1.2, 0.01);
    slider('Pores', 'wall', 'pores', 0, 2, 0.01);
    slider('Taille des pores', 'wall', 'poreSize', 0.3, 2.5, 0.05);
    slider('Rugosité', 'wall', 'rough', 0.3, 1, 0.01);
    slider('Relief', 'wall', 'relief', 0, 2, 0.05);
    sec('MURS · PLAQUES');
    slider('Grande plaque : largeur', 'wall', 'panelW', 0.6, 4.8, 0.05, ' m');
    slider('Plaque étroite : largeur (0 = aucune)', 'wall', 'panelW2', 0, 2.4, 0.05, ' m');
    slider('Rangée haute : hauteur', 'wall', 'panelH', 0.6, 7.4, 0.05, ' m');
    slider('Rangée basse : hauteur (0 = aucune)', 'wall', 'panelH2', 0, 4, 0.05, ' m');
    slider('Joints : largeur', 'wall', 'joint', 0, 0.02, 0.001, ' m');
    slider('Joints : sombres', 'wall', 'jointDark', 0, 0.9, 0.01);
    slider('Joints : coulures', 'wall', 'bleed', 0, 1.5, 0.01);
    slider('Variation entre plaques', 'wall', 'panelVar', 0, 0.4, 0.01);
    sec('MURS · TROUS DE BANCHE');
    slider('Colonnes (grandes plaques)', 'wall', 'holesX', 0, 4, 1);
    slider('Rangées', 'wall', 'holesY', 0, 4, 1);
    slider('Rayon', 'wall', 'holeR', 0.005, 0.04, 0.001, ' m');
    slider('Distance aux joints (côtés)', 'wall', 'insetX', 0.05, 1.2, 0.01, ' m');
    slider('Distance aux joints (haut, bas)', 'wall', 'insetY', 0.05, 1.2, 0.01, ' m');
    slider('Profondeur', 'wall', 'holeDepth', 0, 3, 0.05);
    const row = mk('div', 'bt-btns', el);
    const b = (label, cls, on) => { const x = mk('button', 'bt-btn ' + cls, row, label); x.type = 'button'; x.addEventListener('click', on); return x; };
    b('Voir dans la galerie', 'prim', onGallery);
    b('Enregistrer', '', async () => {
      try { await saveProject({ ...s, ...extra() }); status.textContent = '✓ Enregistré dans src/data/beton.json (réglages et pièces construites)'; } catch (e) { status.textContent = 'Échec : ' + e.message; }
    });
    b('Revenir au projet', '', () => {
      if (!confirm('Abandonner le brouillon et revenir aux réglages enregistrés dans le projet ?')) return;
      clearDraft(); Object.assign(s, projectBeton()); onChange(s); render();
    });
    b('Valeurs d\'origine', '', () => {
      if (!confirm('Remettre toutes les valeurs d\'origine ?')) return;
      Object.assign(s, clone(BETON_DEFAULTS)); saveDraft(s); onChange(s); render();
    });
    status = mk('div', 'bt-status', el, hasDraft() ? '● Brouillon (pas encore enregistré dans le projet)' : '✓ Réglages du projet');
    mk('div', 'bt-note', el, 'Les changements s\'appliquent aussi à la galerie. P : fermer ce panneau · X : construire · T : caméra / avatar.');
  }
  // Les touches du jeu ne doivent pas réagir pendant qu'on règle.
  el.addEventListener('keydown', (e) => e.stopPropagation());
  let visible = false;
  return {
    el,
    get visible() { return visible; },
    show(on) { visible = on; if (on) render(); el.style.display = on ? 'block' : 'none'; },
  };
}
