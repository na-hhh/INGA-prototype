// ---- Temps du monde : jour, nuit, soleil, lune, planète ---------------------
// Un cycle complet passe en quelques minutes (18 par défaut) pour qu'un
// visiteur de 10 à 20 minutes voie la galerie sous plusieurs lumières, sans
// que le mouvement saute aux yeux : la lumière glisse, les ombres tournent
// doucement. La nuit passe plus vite que le jour (réglable).
//
// Le soleil se lève côté +x, passe au-dessus de la baie (+z) et se couche
// côté −x ; la lune suit le même chemin, décalée ; la géante gazeuse (dans
// l'esprit de Polyphème, la planète du ciel d'Avatar) reste haut au-dessus
// de la baie et dérive lentement avec les étoiles.
import * as THREE from 'three';

const STORE = 'ingaWorldTime';
export const SUNRISE = 6, SUNSET = 20;
// On entre dans la galerie à l'aube : le jour se lève, lumière dorée et douce.
export const DAWN_HOUR = 6.25;

export function createClock() {
  const c = { hour: 16.5, cycleMin: 18, nightFast: 1.8, playing: true };
  try { Object.assign(c, JSON.parse(localStorage.getItem(STORE)) || {}); } catch { /* illisible */ }
  let saveT = 0;
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(c)); } catch { /* quota */ } };
  // Heures par seconde réelle : le jour (14 h) au rythme r, la nuit (10 h)
  // au rythme r × nightFast, le tout en cycleMin minutes.
  const rate = () => (SUNSET - SUNRISE + (24 - SUNSET + SUNRISE) / c.nightFast) / (c.cycleMin * 60);
  const isNight = (h) => h < SUNRISE || h >= SUNSET;
  return {
    state: c,
    tick(dt) {
      // Le matin s'étire un peu (×0,65) : on a le temps de le voir.
      const morning = c.hour > 5.5 && c.hour < 9.5 ? 0.65 : 1;
      if (c.playing) c.hour = (c.hour + dt * rate() * (isNight(c.hour) ? c.nightFast : 1) * morning) % 24;
      saveT += dt;
      if (saveT > 2) { saveT = 0; save(); }
    },
    set(k, v) { c[k] = v; save(); },
  };
}

// Angle de course : 0 au lever, π au coucher, 2π au lever suivant.
function courseAngle(h) {
  if (h >= SUNRISE && h < SUNSET) return (h - SUNRISE) / (SUNSET - SUNRISE) * Math.PI;
  const n = (h - SUNSET + 24) % 24; // heures depuis le coucher
  return Math.PI + n / (24 - SUNSET + SUNRISE) * Math.PI;
}
function pathDir(theta, maxEl, out) {
  const s = Math.sin(theta);
  const el = Math.asin(s * Math.sin(maxEl));
  const hx = Math.cos(theta), hz = 0.45 + 0.55 * Math.abs(s);
  const k = Math.cos(el) / Math.hypot(hx, hz);
  return out.set(hx * k, Math.sin(el), hz * k);
}

// Couleurs du ciel selon la hauteur du soleil (sinus de l'élévation) :
// nuit profonde, heure bleue, coucher, heure dorée, plein jour. Le plein jour
// reprend les couleurs de l'atmosphère réglées dans l'éditeur.
const KEYS = [
  [-0.4, '#010309', '#05091a', '#000000'],
  [-0.2, '#040a1e', '#101634', '#120a1a'],
  [-0.09, '#101d44', '#3c3a66', '#7a3f5c'],
  [-0.02, '#223f78', '#b9707a', '#e0623a'],
  [0.04, '#33599a', '#eea677', '#ff8c45'],
  [0.14, '#4673b4', '#f0cda0', '#ffbe78'],
  [0.32, '#4f82c2', '#dfd9cc', '#ffe2b8'],
  [0.6, null, null, '#fff3dc'],
].map(([e, z, h, g]) => ({ e, z: z && new THREE.Color(z), h: h && new THREE.Color(h), g: new THREE.Color(g) }));
const _a = new THREE.Color(), _b = new THREE.Color();
function paletteAt(e, day, out) {
  const last = KEYS[KEYS.length - 1];
  last.z = day.zenith; last.h = day.horizon;
  let i = 0;
  while (i < KEYS.length - 2 && e > KEYS[i + 1].e) i++;
  const A = KEYS[i], B = KEYS[i + 1];
  const t = THREE.MathUtils.clamp((e - A.e) / (B.e - A.e), 0, 1);
  out.zenith.copy(A.z).lerp(B.z, t);
  out.horizon.copy(A.h).lerp(B.h, t);
  out.glow.copy(A.g).lerp(B.g, t);
}
// Couleur du soleil : rouge orangé au ras de l'horizon, blanc chaud à midi.
const SUN_LOW = new THREE.Color('#ff8f4a'), SUN_MID = new THREE.Color('#ffd2a0'), SUN_HIGH = new THREE.Color('#fff1e0');
const MORNING_H = new THREE.Color('#f1d9c4'), MORNING_G = new THREE.Color('#ffd7ad'), MORNING_SUN = new THREE.Color('#ffd9b4');
const smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Tout ce qu'il faut pour éclairer et peindre le ciel à l'heure h.
export function skyState(h, day, out) {
  const theta = courseAngle(h);
  pathDir(theta, THREE.MathUtils.degToRad(62), out.sunDir);
  pathDir(theta + Math.PI - 0.45, THREE.MathUtils.degToRad(52), out.moonDir);
  const drift = Math.sin(h / 24 * Math.PI * 2) * 0.22;
  out.planetDir.set(0.3 + drift, 0.4, 0.88).normalize();
  const e = out.sunDir.y;
  paletteAt(e, day, out);
  out.sunElev = e;
  out.night = smooth(0.02, -0.22, e); // 1 en pleine nuit
  out.day = smooth(-0.04, 0.2, e);
  out.sunCol.copy(e < 0.25 ? _a.copy(SUN_LOW).lerp(SUN_MID, smooth(0, 0.25, e)) : _b.copy(SUN_MID).lerp(SUN_HIGH, smooth(0.25, 0.75, e)));
  out.sunI = smooth(-0.03, 0.16, e) * (0.85 + 0.3 * smooth(0.2, 0.8, e));
  // Matin paisible : le même or que l'heure dorée, mais plus doux et plus
  // clair que le soir — tons pêche et crème, soleil moins orangé.
  // L'aube est une vraie heure dorée (les couleurs viennent de la hauteur du
  // soleil, comme le soir) ; le matin garde un peu d'or, sans plus ; midi est
  // plein soleil. Seul un voile très léger adoucit le matin.
  const m = smooth(7, 8, h) * (1 - smooth(9.5, 11, h));
  if (m > 0) {
    out.horizon.lerp(MORNING_H, m * 0.12);
    out.glow.lerp(MORNING_G, m * 0.12);
    out.sunCol.lerp(MORNING_SUN, m * 0.1);
  }
  out.moonI = smooth(-0.05, 0.18, out.moonDir.y) * out.night;
  out.starAngle = h / 24 * Math.PI * 2;
  return out;
}
export function newSkyState() {
  return {
    sunDir: new THREE.Vector3(), moonDir: new THREE.Vector3(), planetDir: new THREE.Vector3(),
    zenith: new THREE.Color(), horizon: new THREE.Color(), glow: new THREE.Color(), sunCol: new THREE.Color(),
    sunElev: 0, night: 0, day: 1, sunI: 1, moonI: 0, starAngle: 0,
  };
}
export const hourLabel = (h) => {
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  const part = h < 5 ? 'nuit' : h < 7 ? 'aube' : h < 11 ? 'matin' : h < 14 ? 'midi' : h < 18 ? 'après-midi' : h < 20.3 ? 'coucher' : h < 21.5 ? 'heure bleue' : 'nuit';
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · ${part}`;
};
