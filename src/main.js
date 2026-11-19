import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SSRPass } from 'three/examples/jsm/postprocessing/SSRPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import './style.css';

const isCoarse = matchMedia('(pointer:coarse)').matches;

// ---- Qualité graphique ----------------------------------------------------
// 'low'    : machines modestes (puces Intel intégrées, mobiles). Pas de SSR,
//            GTAO, brouillard raymarché ni bloom ; géométrie allégée ;
//            résolution interne réduite et ajustée en continu.
// 'medium' : même géométrie légère, bloom + antialiasing, résolution 1x.
// 'high'   : la version complète (SSR, GTAO, god rays raymarchés…).
// Forçable avec ?q=low|medium|high dans l'URL ; mémorisé dans le navigateur.
const QUALITIES = ['low', 'medium', 'high'];
const QUALITY = (() => {
  const fromUrl = new URLSearchParams(location.search).get('q');
  if (QUALITIES.includes(fromUrl)) {
    try { localStorage.setItem('inga-quality', fromUrl); } catch (e) { /* stockage indisponible */ }
    return fromUrl;
  }
  try {
    const saved = localStorage.getItem('inga-quality');
    if (QUALITIES.includes(saved)) return saved;
  } catch (e) { /* stockage indisponible */ }
  if (isCoarse) return 'low';
  // Détection du GPU : les puces intégrées (Intel Iris/UHD, rendu logiciel)
  // partent en 'low', le reste en 'high'.
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    if (/intel|iris|uhd|hd graphics|swiftshader|llvmpipe|software|mali|adreno/i.test(gpu)) return 'low';
  } catch (e) { /* pas d'info GPU */ }
  if ((navigator.hardwareConcurrency || 8) <= 4) return 'medium';
  return 'high';
})();
const LITE = QUALITY !== 'high';
const Q = {
  low:    { minScale: 0.45, maxScale: 0.8,  shadowMap: 1024, softShadows: false, bloom: false, smaa: false, shadowEvery: 3 },
  medium: { minScale: 0.6,  maxScale: 1.0,  shadowMap: 2048, softShadows: true,  bloom: true,  smaa: true,  shadowEvery: 2 },
  high:   { minScale: 0.75, maxScale: 2.0,  shadowMap: 4096, softShadows: true,  bloom: true,  smaa: true,  shadowEvery: 1 },
}[QUALITY];
// Résolution interne = taille CSS × renderScale (≤ devicePixelRatio).
let renderScale = Math.min(devicePixelRatio, Q.maxScale);

const app = document.querySelector('#app');
app.innerHTML = `<div id="hud"><div id="brand">INGA</div><div id="subtitle">LÉANDRE · A LIVING SPACE</div><div id="help">ZQSD / WASD · se déplacer<br>SOURIS · regarder autour<br>ESPACE · léviter &nbsp; · &nbsp; E · découvrir une œuvre</div><div id="hint"></div><div id="mobile"><div id="joystick"><div id="knob"></div></div><button id="jump">↑</button><div id="looknote">Glisser à droite pour regarder</div></div></div><div id="intro"><div class="intro-top"><span></span><span>Galerie d'art</span></div><div class="intro-center"><div id="wordmark"><span class="word">I<span id="nLetter">N</span>GA</span><div id="strike"><div id="track"></div><div id="strikeBar"></div><button id="unlock" type="button" aria-label="Glisser vers la gauche pour entrer dans la galerie"><svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true"><path d="M14.5 6.5 9 12l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="square"/></svg></button></div></div><div class="intro-name">LÉANDRE</div><svg id="cracks" aria-hidden="true"></svg></div><div class="intro-bottom"><span></span><span class="discreet">Son non facultatif</span></div></div><div id="artPanel"><button id="close">FERMER ×</button><div class="eyebrow">INGA / COLLECTION 01</div><h2 id="artTitle"></h2><p id="artText"></p><p style="font-size:11px;opacity:.6">Œuvre provisoire — à remplacer par une création originale.</p></div>`;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#dde6ec');
scene.fog = new THREE.FogExp2('#393834', LITE ? 0.0075 : 0.0042);

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(renderScale);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = Q.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
// Shadows are rendered once per frame (flagged in animate), not once per
// internal pass — SSR/GTAO re-render the scene several times.
renderer.shadowMap.autoUpdate = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.22;
app.prepend(renderer.domElement);

const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.08, 450);
camera.position.set(-0.4, 1.58, -16.3); // in the threshold (ENTRY.z0 + 1.3)
camera.rotation.order = 'YXZ';

{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.08;
  pmrem.dispose();
}

const composer = new EffectComposer(renderer);
// SSR = screen-space ray tracing of reflections; replaces the plain RenderPass
// on desktop. The reflective meshes are registered in ssrSelects after creation.
const ssrSelects = [];
let ssrPass = null;
if (!LITE) {
  ssrPass = new SSRPass({
    renderer,
    scene,
    camera,
    width: innerWidth,
    height: innerHeight,
    groundReflector: null,
    selects: ssrSelects,
  });
  ssrPass.maxDistance = 14;
  ssrPass.thickness = 0.02;
  ssrPass.opacity = 0.38;
  composer.addPass(ssrPass);
} else {
  composer.addPass(new RenderPass(scene, camera));
}
let gtaoPass = null;
if (!LITE) {
  gtaoPass = new GTAOPass(scene, camera, innerWidth, innerHeight);
  gtaoPass.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.6, thickness: 0.6, scale: 1.1 });
  gtaoPass.blendIntensity = 0.85;
  composer.addPass(gtaoPass);
}
// ---- Lumière d'aube en montagne ----
// An early-morning sun (~43° high) over the valley, i.e. from the
// glass-bay side (+z), slightly from the west. It rakes in through the bay
// down the centre of the gallery and through the ceiling slots. Everything
// that follows the sun (shadows, god rays, dust, light blades) reads this.
const SUN_DIR = new THREE.Vector3(-0.16, 0.68, 0.72).normalize(); // ~43° high
const SUN_COLOR = '#ffd6a8';
const SUN_SLOPE_X = SUN_DIR.x / SUN_DIR.y;
const SUN_SLOPE_Z = SUN_DIR.z / SUN_DIR.y;
// Raymarched volumetric fog: height fog + animated 3D noise + real god rays
// traced against the ceiling slot geometry, lit with a Henyey-Greenstein phase.
let fogPass = null;
if (!LITE) {
  const VolumetricFogShader = {
    uniforms: {
      tDiffuse: { value: null },
      tDepth: { value: null },
      tHoles: { value: null },
      uProjInv: { value: new THREE.Matrix4() },
      uViewInv: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uSunDir: { value: SUN_DIR.clone() },
      uCeilRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uRoom: { value: new THREE.Vector4(0, 0, 0, 100) },
      uTime: { value: 0 },
    },
    vertexShader: `varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform sampler2D tDepth;
      uniform sampler2D tHoles;
      uniform mat4 uProjInv;
      uniform mat4 uViewInv;
      uniform vec3 uCamPos;
      uniform vec3 uSunDir;
      uniform vec4 uCeilRect;
      uniform vec4 uRoom;
      uniform float uTime;
      varying vec2 vUv;

      float hash13(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }
      float noise3(vec3 x) {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x),
              mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
          mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
              mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y),
          f.z);
      }
      // Project the sample along the sun direction onto the ceiling plane and
      // look up the Cahn-Hilliard hole mask: lit only under an actual opening.
      float holeLight(vec3 p) {
        if (abs(p.x) > uRoom.x || p.z < uRoom.y || p.z > uRoom.z || p.y > uRoom.w || p.y < -0.3) return 0.0;
        float drop = uRoom.w - p.y;
        vec2 cpos = p.xz + (uSunDir.xz / uSunDir.y) * drop;
        vec2 huv = (cpos - uCeilRect.xy) * uCeilRect.zw;
        if (huv.x < 0.0 || huv.x > 1.0 || huv.y < 0.0 || huv.y > 1.0) return 0.0;
        return texture2D(tHoles, huv).r;
      }
      void main() {
        vec4 sceneCol = texture2D(tDiffuse, vUv);
        float depth = texture2D(tDepth, vUv).x;
        vec4 ndc = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
        vec4 view = uProjInv * ndc;
        view /= view.w;
        vec3 world = (uViewInv * vec4(view.xyz, 1.0)).xyz;
        vec3 ro = uCamPos;
        vec3 rd = world - ro;
        float dist = min(length(rd), 95.0);
        rd = normalize(rd);
        const int STEPS = 26;
        float stepLen = dist / float(STEPS);
        vec3 p = ro + rd * stepLen * hash13(vec3(vUv * 913.7, fract(uTime)));
        vec3 trans = vec3(1.0);
        vec3 inscatter = vec3(0.0);
        float cosT = dot(rd, uSunDir);
        float g = 0.45;
        float phase = (1.0 - g * g) / (12.566 * pow(1.0 + g * g - 2.0 * g * cosT, 1.5));
        vec3 fogCol = vec3(0.115, 0.112, 0.102);
        vec3 sunCol = vec3(1.0, 0.92, 0.78) * 2.6;
        // Chromatic extinction: blue dies first, so light crossing enough fog
        // comes out warmed and stained by the medium.
        vec3 sigma = vec3(0.8, 1.0, 1.45);
        for (int i = 0; i < STEPS; i++) {
          float n = noise3(p * 0.33 + vec3(uTime * 0.045, uTime * 0.012, uTime * 0.02));
          float density = 0.016 * (0.55 + 0.9 * n) * exp(-max(p.y, 0.0) * 0.05);
          float lit = holeLight(p);
          float d = density * (1.0 + lit * 2.2);
          vec3 absorb = exp(-d * sigma * stepLen);
          vec3 S = fogCol * 0.5 + sunCol * phase * (lit * 1.7 + 0.012);
          inscatter += trans * (1.0 - absorb) * S;
          trans *= absorb;
          p += rd * stepLen;
        }
        gl_FragColor = vec4(sceneCol.rgb * trans + inscatter, sceneCol.a);
      }`,
  };
  fogPass = new ShaderPass(VolumetricFogShader);
  // Reuse the depth buffer SSRPass already renders — no extra scene pass.
  fogPass.uniforms.tDepth.value = ssrPass.beautyRenderTarget.depthTexture;
  composer.addPass(fogPass);
}
composer.setPixelRatio(renderScale);
composer.setSize(innerWidth, innerHeight);
let bloomPass = null;
if (Q.bloom) {
  bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.55, 0.82);
  composer.addPass(bloomPass);
}
composer.addPass(new OutputPass());
if (Q.smaa) composer.addPass(new SMAAPass());

// The only daylight enters through the ceiling holes: a faint sky remainder,
// one hard sun blocked by the real ceiling/wall geometry, a whisper of bounce.
scene.add(new THREE.HemisphereLight('#dfe8f2', '#4e4a44', 0.14));
const sun = new THREE.DirectionalLight(SUN_COLOR, 3.6);
sun.target.position.set(0, 2, 9);
sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 45);
scene.add(sun.target);
sun.castShadow = true;
sun.shadow.mapSize.set(Q.shadowMap, Q.shadowMap);
sun.shadow.camera.left = -30;
sun.shadow.camera.right = 30;
sun.shadow.camera.top = 33;
sun.shadow.camera.bottom = -33;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 100;
sun.shadow.bias = -0.00035;
sun.shadow.normalBias = 0.045;
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun);
const bounce = new THREE.DirectionalLight('#e1eaf4', 0.09);
bounce.position.set(5, 8, 9);
scene.add(bounce);
// Soft daylight spilling in through the glass bay: a cool-warm fill from the
// valley side, no shadows (the bay is open to the whole sky).
const bayFill = new THREE.DirectionalLight('#efe6da', 0.42);
bayFill.position.set(0, 14, 40);
bayFill.target.position.set(0, 1, 6);
scene.add(bayFill, bayFill.target);

function hash2(ix, iy, period) {
  const x = ((ix % period) + period) % period;
  const y = ((iy % period) + period) % period;
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function valueNoise(u, v, freq) {
  const x = u * freq;
  const y = v * freq;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, freq);
  const b = hash2(ix + 1, iy, freq);
  const c2 = hash2(ix, iy + 1, freq);
  const d2 = hash2(ix + 1, iy + 1, freq);
  return a + (b - a) * fx + (c2 - a) * fy + (a - b - c2 + d2) * fx * fy;
}
function fbmField(seed, size) {
  const field = new Float32Array(size * size);
  const octaves = size > 256 ? 5 : 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = px / size + seed;
      const v = py / size + seed * 1.7;
      let n = 0, amp = 1, freq = 6, tot = 0;
      for (let o = 0; o < octaves; o++) {
        n += amp * valueNoise(u, v, freq);
        tot += amp;
        amp *= 0.55;
        freq *= 2;
      }
      field[py * size + px] = n / tot;
    }
  }
  return field;
}
let surfaceSeed = 0;
function surface(base = '#bdbab1', variation = 16, bump = 1, NOISE_SIZE = 256) {
  const field = fbmField(surfaceSeed += 3, NOISE_SIZE);
  const c = document.createElement('canvas');
  c.width = c.height = NOISE_SIZE;
  const x = c.getContext('2d');
  x.fillStyle = base;
  x.fillRect(0, 0, NOISE_SIZE, NOISE_SIZE);
  const d = x.getImageData(0, 0, NOISE_SIZE, NOISE_SIZE);
  for (let i = 0, p = 0; i < d.data.length; i += 4, p++) {
    const n = (field[p] - 0.5) * 2 * variation;
    // Cavity bake: recessed grain reads darker, so relief shows even without AO.
    const cavity = 0.82 + 0.18 * Math.min(1, field[p] * 1.6);
    d.data[i] = (d.data[i] + n) * cavity;
    d.data[i + 1] = (d.data[i + 1] + n) * cavity;
    d.data[i + 2] = (d.data[i + 2] + n) * cavity;
  }
  x.putImageData(d, 0, 0);
  for (let i = 0; i < 18; i++) {
    x.strokeStyle = 'rgba(70,68,64,.03)';
    x.lineWidth = Math.random() * 1.4;
    x.beginPath();
    x.moveTo(Math.random() * NOISE_SIZE, Math.random() * NOISE_SIZE);
    x.lineTo(Math.random() * NOISE_SIZE, Math.random() * NOISE_SIZE);
    x.stroke();
  }
  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const nc = document.createElement('canvas');
  nc.width = nc.height = NOISE_SIZE;
  const nx = nc.getContext('2d');
  const nd = nx.createImageData(NOISE_SIZE, NOISE_SIZE);
  const S = NOISE_SIZE;
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const l = field[py * S + ((px - 1 + S) % S)];
      const r = field[py * S + ((px + 1) % S)];
      const u2 = field[((py - 1 + S) % S) * S + px];
      const d3 = field[((py + 1) % S) * S + px];
      let dx = (l - r) * bump * 2.4;
      let dy = (u2 - d3) * bump * 2.4;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const o = (py * S + px) * 4;
      nd.data[o] = (dx * inv * 0.5 + 0.5) * 255;
      nd.data[o + 1] = (dy * inv * 0.5 + 0.5) * 255;
      nd.data[o + 2] = (inv * 0.5 + 0.5) * 255;
      nd.data[o + 3] = 255;
    }
  }
  nx.putImageData(nd, 0, 0);
  const normalMap = new THREE.CanvasTexture(nc);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.anisotropy = renderer.capabilities.getMaxAnisotropy();

  // Roughness map from the same height field: crevices stay matte, high grain
  // catches the light with a slight sheen.
  const rc = document.createElement('canvas');
  rc.width = rc.height = NOISE_SIZE;
  const rx = rc.getContext('2d');
  const rd2 = rx.createImageData(NOISE_SIZE, NOISE_SIZE);
  for (let p = 0; p < field.length; p++) {
    const v = (1 - field[p] * 0.45) * 255;
    const o = p * 4;
    rd2.data[o] = v;
    rd2.data[o + 1] = v;
    rd2.data[o + 2] = v;
    rd2.data[o + 3] = 255;
  }
  rx.putImageData(rd2, 0, 0);
  const roughnessMap = new THREE.CanvasTexture(rc);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return { map, normalMap, roughnessMap };
}
function noiseTexture(base, variation) {
  return surface(base, variation).map;
}

// Procedural marble: fbm-warped sine bands collapse into thin veins.
function marbleSurface(size = 1024) {
  const warp1 = fbmField(surfaceSeed += 3, size);
  const warp2 = fbmField(surfaceSeed += 3, size);
  const height = new Float32Array(size * size);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const img = x.createImageData(size, size);
  // All vein families share the same diagonal (integer direction vectors keep
  // the texture tileable), so the grain reads as one coherent flow.
  // Warm honed stone (pierre chaude / minéral), veins discreet and warm.
  const base = [236, 232, 224];
  const cloud = [221, 216, 205];
  const veinCol = [160, 148, 132];
  const bigCol = [196, 188, 175];
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const p = py * size + px;
      const u = px / size;
      const v = py / size;
      const w1 = warp1[p];
      const w2 = warp2[p];
      const band1 = Math.abs(Math.sin(Math.PI * 2 * (u * 2 + v + w1 * 2.6)));
      const band2 = Math.abs(Math.sin(Math.PI * 2 * (u * 3 + v * 2 + w2 * 3.0)));
      const bandBig = Math.abs(Math.sin(Math.PI * 2 * (u + v + w1 * 1.6)));
      const vein = Math.pow(1 - band1, 14) + Math.pow(1 - band2, 24) * 0.45;
      const vm = Math.min(1, vein);
      const big = Math.pow(1 - bandBig, 3.5) * 0.55;
      const cl = (w2 - 0.5) * 0.55 + 0.5;
      height[p] = 1 - vm * 0.55 - big * 0.18;
      const o = p * 4;
      for (let ch = 0; ch < 3; ch++) {
        let col = base[ch] + (cloud[ch] - base[ch]) * cl * 0.6;
        col += (bigCol[ch] - col) * big;
        col += (veinCol[ch] - col) * vm * 0.55;
        img.data[o + ch] = col;
      }
      img.data[o + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const nc = document.createElement('canvas');
  nc.width = nc.height = size;
  const nx = nc.getContext('2d');
  const nd = nx.createImageData(size, size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const l = height[py * size + ((px - 1 + size) % size)];
      const r = height[py * size + ((px + 1) % size)];
      const u2 = height[((py - 1 + size) % size) * size + px];
      const d3 = height[((py + 1) % size) * size + px];
      const dx = (l - r) * 1.2;
      const dy = (u2 - d3) * 1.2;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const o = (py * size + px) * 4;
      nd.data[o] = (dx * inv * 0.5 + 0.5) * 255;
      nd.data[o + 1] = (dy * inv * 0.5 + 0.5) * 255;
      nd.data[o + 2] = (inv * 0.5 + 0.5) * 255;
      nd.data[o + 3] = 255;
    }
  }
  nx.putImageData(nd, 0, 0);
  const normalMap = new THREE.CanvasTexture(nc);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const rc = document.createElement('canvas');
  rc.width = rc.height = size;
  const rx = rc.getContext('2d');
  const rd2 = rx.createImageData(size, size);
  for (let p = 0; p < height.length; p++) {
    // Veins read slightly glossier than the polished field around them.
    const vm = 1 - height[p];
    const rough = (0.95 - vm * 0.45 + (warp1[p] - 0.5) * 0.12) * 255;
    const o = p * 4;
    rd2.data[o] = rough;
    rd2.data[o + 1] = rough;
    rd2.data[o + 2] = rough;
    rd2.data[o + 3] = 255;
  }
  rx.putImageData(rd2, 0, 0);
  const roughnessMap = new THREE.CanvasTexture(rc);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return { map, normalMap, roughnessMap };
}

// Board-formed concrete (béton banché): horizontal board marks, faint wood
// grain and tie holes, all baked into height -> albedo/normal/roughness.
function hash2d(ix, iy, pu, pv) {
  const x = ((ix % pu) + pu) % pu;
  const y = ((iy % pv) + pv) % pv;
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function anisoNoise(u, v, fu, fv) {
  const x = u * fu;
  const y = v * fv;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash2d(ix, iy, fu, fv);
  const b = hash2d(ix + 1, iy, fu, fv);
  const c = hash2d(ix, iy + 1, fu, fv);
  const d = hash2d(ix + 1, iy + 1, fu, fv);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function boardConcreteSurface(size = 512) {
  const BOARDS = 3;
  const field = fbmField(surfaceSeed += 3, size);
  const height = new Float32Array(size * size);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const img = x.createImageData(size, size);
  for (let py = 0; py < size; py++) {
    const v = py / size;
    const boardIdx = Math.floor(v * BOARDS);
    const boardTone = hash2d(boardIdx, 3, BOARDS, 97) - 0.5;
    const frac = v * BOARDS - boardIdx;
    const seam = Math.max(0, 1 - frac / 0.035) + Math.max(0, 1 - (1 - frac) / 0.035);
    for (let px = 0; px < size; px++) {
      const p = py * size + px;
      const u = px / size;
      const grain =
        anisoNoise(u, v, 36, BOARDS * 2) * 0.6 +
        anisoNoise(u, v, 90, BOARDS * 5) * 0.4;
      let h = 0.5 + (field[p] - 0.5) * 0.55 + boardTone * 0.14 + (grain - 0.5) * 0.22;
      h -= Math.min(1, seam) * 0.3;
      height[p] = h;
      const shade = 148 + (h - 0.5) * 72;
      const o = p * 4;
      img.data[o] = shade * 1.24;
      img.data[o + 1] = shade * 1.22;
      img.data[o + 2] = shade * 1.16;
      img.data[o + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const nc = document.createElement('canvas');
  nc.width = nc.height = size;
  const nx = nc.getContext('2d');
  const nd = nx.createImageData(size, size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const l = height[py * size + ((px - 1 + size) % size)];
      const r = height[py * size + ((px + 1) % size)];
      const u2 = height[((py - 1 + size) % size) * size + px];
      const d3 = height[((py + 1) % size) * size + px];
      const dx = (l - r) * 2.0;
      const dy = (u2 - d3) * 2.0;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const o = (py * size + px) * 4;
      nd.data[o] = (dx * inv * 0.5 + 0.5) * 255;
      nd.data[o + 1] = (dy * inv * 0.5 + 0.5) * 255;
      nd.data[o + 2] = (inv * 0.5 + 0.5) * 255;
      nd.data[o + 3] = 255;
    }
  }
  nx.putImageData(nd, 0, 0);
  const normalMap = new THREE.CanvasTexture(nc);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const rc = document.createElement('canvas');
  rc.width = rc.height = size;
  const rx = rc.getContext('2d');
  const rd2 = rx.createImageData(size, size);
  for (let p = 0; p < height.length; p++) {
    const v2 = (0.82 + (0.55 - height[p]) * 0.5) * 255;
    const o = p * 4;
    rd2.data[o] = v2;
    rd2.data[o + 1] = v2;
    rd2.data[o + 2] = v2;
    rd2.data[o + 3] = 255;
  }
  rx.putImageData(rd2, 0, 0);
  const roughnessMap = new THREE.CanvasTexture(rc);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return { map, normalMap, roughnessMap };
}

const concreteSurf = surface('#b5b3ac', 26, 1.4);
const concrete = new THREE.MeshStandardMaterial({
  map: concreteSurf.map,
  normalMap: concreteSurf.normalMap,
  normalScale: new THREE.Vector2(0.85, 0.85),
  roughnessMap: concreteSurf.roughnessMap,
  roughness: 1,
});
const floorSurf = surface('#c9c6bd', 15, 0.7);
const floorMat = new THREE.MeshStandardMaterial({
  map: floorSurf.map,
  normalMap: floorSurf.normalMap,
  normalScale: new THREE.Vector2(0.45, 0.45),
  roughnessMap: floorSurf.roughnessMap,
  roughness: 0.85,
});
const wood = new THREE.MeshStandardMaterial({ color: '#655044', roughness: 0.86 });
const linen = new THREE.MeshStandardMaterial({ color: '#bcb4a5', roughness: 1, side: THREE.DoubleSide });
const moss = new THREE.MeshStandardMaterial({ color: '#51643b', roughness: 1 });
const black = new THREE.MeshStandardMaterial({ color: '#292b29', roughness: 0.9 });

// Polished marble floor: veined, glossy, reflective (SSR picks it up).
const hallFloorSurf = marbleSurface(1024);
const hallFloorMat = new THREE.MeshPhysicalMaterial({
  map: hallFloorSurf.map,
  normalMap: hallFloorSurf.normalMap,
  normalScale: new THREE.Vector2(0.25, 0.25),
  roughnessMap: hallFloorSurf.roughnessMap,
  roughness: 0.5,
  metalness: 0,
  // En 'low', pas de vernis (clearcoat) : une passe d'éclairage en moins sur tout le sol.
  clearcoat: QUALITY === 'low' ? 0 : 0.15,
  clearcoatRoughness: 0.22,
  envMapIntensity: 0.9,
});
// 1024 px over a 1.25 m repeat (world UVs x2): the grain holds up close-to.
const hallWallSurf = boardConcreteSurface(1024);
hallWallSurf.map.repeat.set(2, 2);
hallWallSurf.normalMap.repeat.set(2, 2);
hallWallSurf.roughnessMap.repeat.set(2, 2);
const hallConcrete = new THREE.MeshStandardMaterial({
  map: hallWallSurf.map,
  normalMap: hallWallSurf.normalMap,
  normalScale: new THREE.Vector2(1.35, 1.35),
  roughnessMap: hallWallSurf.roughnessMap,
  roughness: 1,
});
const bedTex = noiseTexture('#4b4c47', 26);
bedTex.repeat.set(14, 14);
const bedMat = new THREE.MeshStandardMaterial({ map: bedTex, color: '#6e675b', roughness: 1, side: THREE.DoubleSide });
// ---- Ruisseau intérieur ----
const CANAL_BED_Y = -0.6; // ~50 cm of water
const CANAL_WATER_Y = -0.09;
const DOOR_HALF_GUESS = 2.4; // centre bay half-width (the door is built later)
// Light caustics dancing on anything under the water (bed, pebbles, walls'
// feet): thin bright filaments from layered, warped sines — cheap, no maps.
const causticUniforms = { uCausticTime: { value: 0 } };
function addCaustics(mat, strength = 0.45) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(mat, sh, r);
    sh.uniforms.uCausticTime = causticUniforms.uCausticTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCauWP;')
      .replace('#include <project_vertex>', ['vec4 cauWP = vec4( transformed, 1.0 );', '#ifdef USE_INSTANCING', 'cauWP = instanceMatrix * cauWP;', '#endif', 'vCauWP = ( modelMatrix * cauWP ).xyz;', '#include <project_vertex>'].join('\n'));
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', ['#include <common>', 'varying vec3 vCauWP;', 'uniform float uCausticTime;',
        'float ingaCaustic( vec2 p, float t ) {',
        '  vec2 q = p * 4.6;',
        '  float c = sin( q.x * 1.7 + sin( q.y * 1.3 + t * 0.9 ) * 1.3 + t * 0.6 );',
        '  c += sin( q.y * 1.9 + sin( q.x * 1.1 - t * 0.7 ) * 1.5 - t * 0.5 );',
        '  c += 0.6 * sin( ( q.x + q.y ) * 2.3 + t * 0.8 );',
        '  return pow( 1.0 - clamp( abs( c ) * 0.5, 0.0, 1.0 ), 14.0 );',
        '}'].join('\n'))
      .replace('#include <emissivemap_fragment>', ['#include <emissivemap_fragment>',
        `{ float under = smoothstep( ${(CANAL_WATER_Y - 0.03).toFixed(2)}, ${(CANAL_WATER_Y - 0.12).toFixed(2)}, vCauWP.y );`,
        `  totalEmissiveRadiance += vec3( 1.0, 0.95, 0.84 ) * ingaCaustic( vCauWP.xz, uCausticTime ) * under * ${strength.toFixed(2)}; }`].join('\n'));
  };
  mat.customProgramCacheKey = () => prevKey() + '|caustic';
}
addCaustics(bedMat, 0.12);
// Light bounced off the canal surface, wavering on the foot of the walls.
{
  const prev = hallConcrete.onBeforeCompile;
  hallConcrete.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(hallConcrete, sh, r);
    sh.uniforms.uShimmerTime = causticUniforms.uCausticTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vShWP;')
      .replace('#include <project_vertex>', 'vShWP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n#include <project_vertex>');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vShWP;\nuniform float uShimmerTime;')
      // Weathering: concrete darkens and greys toward the floor and water.
      .replace('#include <map_fragment>', [
        '#include <map_fragment>',
        'diffuseColor.rgb *= mix( 0.78, 1.0, smoothstep( -0.3, 0.8, vShWP.y ) );',
        // Concrete colonised by moss where it meets the water: irregular
        // damp green that climbs a little up the foot of the hall walls.
        '{',
        `  bool wetWall = ( abs( vShWP.x ) > ${(HALL.x - 0.15).toFixed(2)} && abs( vShWP.x ) < ${(HALL.x + 0.3).toFixed(2)} ) || ( vShWP.z < ${(HALL.doorZ + 0.2).toFixed(2)} && vShWP.z > ${(HALL.doorZ - 0.3).toFixed(2)} );`,
        '  if ( wetWall && vShWP.y < 1.4 ) {',
        '    float along = abs( vShWP.x ) > 13.0 ? vShWP.z : vShWP.x;',
        '    float n = 0.5 + 0.25 * sin( along * 1.7 + sin( along * 0.43 ) * 2.0 ) + 0.25 * sin( along * 4.9 + vShWP.y * 3.0 );',
        '    float reach = -0.05 + 0.9 * n * n;',
        '    float moss = 1.0 - smoothstep( reach - 0.25, reach, vShWP.y );',
        '    float speck = step( 0.55, fract( sin( dot( floor( vec2( along, vShWP.y ) * 26.0 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) );',
        '    moss *= 0.65 + 0.35 * speck;',
        '    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.25, 0.32, 0.15 ), clamp( moss, 0.0, 1.0 ) * 0.75 );',
        '  }',
        '}',
      ].join('\n'))
      .replace('#include <emissivemap_fragment>', [
        '#include <emissivemap_fragment>',
        '{',
        `  bool sideW = abs( vShWP.x ) > ${(HALL.x - 0.15).toFixed(2)} && abs( vShWP.x ) < ${(HALL.x + 0.3).toFixed(2)} && vShWP.z > ${HALL.doorZ.toFixed(2)} && vShWP.z < ${HALL.north.toFixed(2)};`,
        `  bool southW = vShWP.z < ${(HALL.doorZ + 0.2).toFixed(2)} && vShWP.z > ${(HALL.doorZ - 0.3).toFixed(2)} && abs( vShWP.x ) < ${HALL.x.toFixed(2)};`,
        '  if ( ( sideW || southW ) && vShWP.y > -0.1 && vShWP.y < 1.1 ) {',
        '    vec2 q = vec2( sideW ? vShWP.z : vShWP.x, vShWP.y * 2.2 ) * 3.0;',
        '    float t = uShimmerTime;',
        '    float c = sin( q.x * 1.3 + sin( q.y * 1.7 + t * 1.1 ) * 1.6 + t * 0.8 ) + sin( q.x * 0.9 - q.y * 0.6 - t * 0.9 );',
        '    float sh = pow( 1.0 - clamp( abs( c ) * 0.5, 0.0, 1.0 ), 9.0 );',
        '    float fade = pow( 1.0 - clamp( ( vShWP.y + 0.1 ) / 1.2, 0.0, 1.0 ), 2.0 );',
        '    totalEmissiveRadiance += vec3( 0.95, 0.93, 0.86 ) * sh * fade * 0.05;',
        '  }',
        '}',
      ].join('\n'));
  };
  hallConcrete.customProgramCacheKey = () => 'inga-hall-concrete-shimmer';
}
const bridgeMat = new THREE.MeshStandardMaterial({ map: noiseTexture('#c3bfb5', 12), roughness: 0.7 });

function softWaterEnv() {
  const envScene = new THREE.Scene();
  envScene.add(new THREE.HemisphereLight('#f6f3ea', '#8a8478', 1.15));
  envScene.add(new THREE.Mesh(
    new THREE.SphereGeometry(6, 24, 16),
    new THREE.MeshBasicMaterial({ color: '#d4cfc4', side: THREE.BackSide })
  ));
  envScene.add(new THREE.Mesh(
    new THREE.SphereGeometry(5.2, 20, 12, 0, Math.PI * 2, 0, 0.52),
    new THREE.MeshBasicMaterial({ color: '#f8f5ee', side: THREE.BackSide })
  ));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(envScene, 0.14);
  pmrem.dispose();
  return target.texture;
}

function waterNormalTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  const img = x.createImageData(S, S);
  const h = (px, py) => {
    const u = (px / S) * Math.PI * 2;
    const v = (py / S) * Math.PI * 2;
    return Math.sin(u * 3 + v) * 0.5 + Math.sin(v * 4 - u * 2) * 0.35 + Math.sin(u * 7 + v * 5) * 0.2;
  };
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const dx = (h(px - 1, py) - h(px + 1, py)) * 1.5;
      const dy = (h(px, py - 1) - h(px, py + 1)) * 1.5;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const o = (py * S + px) * 4;
      img.data[o] = (dx * inv * 0.5 + 0.5) * 255;
      img.data[o + 1] = (dy * inv * 0.5 + 0.5) * 255;
      img.data[o + 2] = (inv * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 14);
  return t;
}
const waterNormal = waterNormalTexture();
let streamNormalTex = null; // valley stream ripples, scrolled downstream each frame
const waterMat = new THREE.MeshPhysicalMaterial({
  color: '#7e918b',
  metalness: 0.02,
  roughness: 0.1,
  transparent: true,
  opacity: 0.62,
  clearcoat: 0.85,
  clearcoatRoughness: 0.2,
  envMap: softWaterEnv(),
  envMapIntensity: 0.95,
  normalMap: waterNormal,
  normalScale: new THREE.Vector2(0.14, 0.14),
  side: THREE.DoubleSide,
  depthWrite: false,
});

// World-space UVs: every box tiles its textures at the same density (tiles/metre),
// so nothing stretches regardless of the box dimensions.
const TEX_DENSITY = 0.4;
function worldUVs(geo, w, h, d) {
  const uv = geo.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[f][0] * TEX_DENSITY, uv.getY(i) * dims[f][1] * TEX_DENSITY);
    }
  }
  return geo;
}
function box(w, h, d, x, y, z, mat = concrete, shadow = true) {
  const m = new THREE.Mesh(worldUVs(new THREE.BoxGeometry(w, h, d), w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  scene.add(m);
  return m;
}
function sphere(r, x, y, z, mat, seg = 16) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, 12), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  scene.add(m);
  return m;
}

// Hall: ~27 m wide, ~23 m deep, ceiling at 7.4 m.
// The narrow canal is a recess at the foot of the walls, following the whole
// perimeter. It never crosses the floor.
const HALL = {
  x: 13.5,
  doorZ: -4.85,
  north: 18.4,
  channel: 0.88,
  wallT: 0.46,
  wallTop: 7.4,
  wallBottom: -0.8,
};
const CHANNEL = {
  x0: -HALL.x,
  x1: HALL.x,
  z0: HALL.doorZ,
  z1: HALL.north,
  ix0: -HALL.x + HALL.channel,
  ix1: HALL.x - HALL.channel,
  iz0: HALL.doorZ + HALL.channel,
  iz1: HALL.north - HALL.channel,
};
// Two side corridors: narrow, very tall, leaving from the south-west and
// south-east corners of the hall straight west and east (rooms later).
const CORR = (() => {
  const w = 1.7, zc = HALL.doorZ + HALL.channel + 0.3 + w / 2;
  return { w, zc, z0: zc - w / 2, z1: zc + w / 2, len: 14, height: 11 };
})();
// Cross canal: the stream also runs straight across the middle of the
// hall, joining the west and east canals (same width as the ring).
const CROSS = (() => {
  const zc = (HALL.doorZ + HALL.north) / 2;
  return { zc, z0: zc - HALL.channel / 2, z1: zc + HALL.channel / 2 };
})();
// ---- Le seuil (entry) ----
// A long, calm threshold before the hall: deposit (bench, linen, shoes),
// a walk along a thin stream under light slots, then stepping slabs over
// the canal through a curtain of vines.
const ENTRY = { x0: -2.7, x1: 2.7, z0: -17.6, z1: HALL.doorZ - HALL.wallT, ceil: 4.2, chX0: 1.8, chX1: 2.55 };
// Bridge decks: walking out of the water you can't pass through them.
const BRIDGE_DECKS = [];
// The small brutalist bridge over it on the central path.
const MIDBRIDGE = { half: 1.3, z0: CROSS.z0 - 0.32, z1: CROSS.z1 + 0.32, top: 0.07 };
const inCross = (x, z) => z > CROSS.z0 && z < CROSS.z1 && Math.abs(x) <= CHANNEL.ix1;
// Covered terrace beyond the glass bay: depth, and how far its brutalist
// roof oversails it. (Used by the bay dust before the terrace is built.)
const TERRACE = { depth: 9, roofOver: 0.7, roofT: 0.35, edgeBeam: 0.55 };
const TERRACE_ROOF_EDGE_Z = HALL.north + HALL.wallT + TERRACE.depth + TERRACE.roofOver;
// Moss/rock islands either side of the central path. A marble walkway runs
// all around each island (between it and the canal, and at both ends), so
// visitors can circulate around the moss.
const ISLAND_WALK = 1.8;
const ISLAND = {
  x1: CHANNEL.ix1 - ISLAND_WALK,
  z0: CHANNEL.iz0 + 2.2,
  z1: CHANNEL.iz1 - 2.2,
};

function ringGeometry(outer, inner) {
  const position = [];
  const normal = [];
  const uv = [];
  const index = [];
  const step = 1.6;
  function edge(a, b) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(len / step));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      pts.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
    }
    return pts;
  }
  const outerLoop = [
    edge([outer.x0, outer.z0], [outer.x1, outer.z0]),
    edge([outer.x1, outer.z0], [outer.x1, outer.z1]),
    edge([outer.x1, outer.z1], [outer.x0, outer.z1]),
    edge([outer.x0, outer.z1], [outer.x0, outer.z0]),
  ];
  const innerLoop = [
    edge([inner.ix0, inner.iz0], [inner.ix1, inner.iz0]),
    edge([inner.ix1, inner.iz0], [inner.ix1, inner.iz1]),
    edge([inner.ix1, inner.iz1], [inner.ix0, inner.iz1]),
    edge([inner.ix0, inner.iz1], [inner.ix0, inner.iz0]),
  ];
  for (let s = 0; s < 4; s++) {
    const oPts = outerLoop[s];
    const iPts = innerLoop[s];
    const count = Math.min(oPts.length, iPts.length);
    const base = position.length / 3;
    for (let i = 0; i < count; i++) {
      position.push(oPts[i][0], 0, oPts[i][1], iPts[i][0], 0, iPts[i][1]);
      normal.push(0, 1, 0, 0, 1, 0);
      uv.push(oPts[i][0] * 0.08, oPts[i][1] * 0.08, iPts[i][0] * 0.08, iPts[i][1] * 0.08);
    }
    const cols = count;
    for (let i = 0; i < cols - 1; i++) {
      const o0 = base + i * 2;
      const i0 = o0 + 1;
      const o1 = base + (i + 1) * 2;
      const i1 = o1 + 1;
      index.push(o0, i1, i0, o0, o1, i1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  return geo;
}

waterMat.onBeforeCompile = (shader) => {
  shader.uniforms.uTime = { value: 0 };
  shader.vertexShader = `uniform float uTime;\n${shader.vertexShader.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
     transformed.y += sin(position.x * 0.55 + uTime * 0.45) * 0.008
                    + sin(position.z * 0.37 + uTime * 0.32) * 0.006;`
  )}`;
  waterMat.userData.shader = shader;
};
waterMat.customProgramCacheKey = () => 'inga-still-water';

// ---- Le seuil : architecture ----
{
  const { x0, x1, z0, z1, ceil, chX0 } = ENTRY;
  const L = z1 - z0, zm = (z0 + z1) / 2;
  const wT = 0.3;
  // Floor (stops at the stream on the right).
  box(chX0 - x0, 0.25, L, (x0 + chX0) / 2, -0.165, zm, floorMat);
  // Left wall, end wall.
  box(wT, ceil + 0.8, L + wT, x0 - wT / 2, (ceil - 0.8) / 2, zm - wT / 2, hallConcrete);
  box(x1 - x0 + wT * 2, ceil + 0.8, wT, 0, (ceil - 0.8) / 2, z0 - wT / 2, hallConcrete);
  // Right wall above the stream, with three niches (vase + dry branch).
  const niches = [-14.2, -11.0, -7.9];
  const nW = 0.95, nB = 0.95, nT = 1.95, nD = 0.24;
  let zc = z0;
  for (const nz of niches) {
    box(wT, ceil + 0.8, nz - nW / 2 - zc, x1 + wT / 2, (ceil - 0.8) / 2, (zc + nz - nW / 2) / 2, hallConcrete);
    box(wT, nB + 0.8, nW, x1 + wT / 2, (nB - 0.8) / 2, nz, hallConcrete);
    box(wT, ceil - nT, nW, x1 + wT / 2, (ceil + nT) / 2, nz, hallConcrete);
    box(0.08, nT - nB, nW, x1 + nD + 0.04, (nB + nT) / 2, nz, hallConcrete);
    zc = nz + nW / 2;
  }
  box(wT, ceil + 0.8, z1 - zc, x1 + wT / 2, (ceil - 0.8) / 2, (zc + z1) / 2, hallConcrete);
  // Vases and branches in the niches.
  const vaseProf = [];
  for (let i = 0; i <= 12; i++) { const u = i / 12; vaseProf.push(new THREE.Vector2(0.02 + 0.1 * Math.sin(Math.PI * Math.min(1, u * 1.15)) * (u < 0.85 ? 1 : 0.5) + (u > 0.85 ? 0.03 : 0), u * 0.42)); }
  const vaseGeo = new THREE.LatheGeometry(vaseProf, 20);
  const vaseTones = ['#cdbba0', '#b8a58a', '#dcd9cf'];
  const branchMat = new THREE.MeshStandardMaterial({ color: '#5a4636', roughness: 0.9 });
  niches.forEach((nz, i) => {
    const v = new THREE.Mesh(vaseGeo, new THREE.MeshStandardMaterial({ color: vaseTones[i], roughness: 0.85 }));
    v.scale.setScalar(0.85 + i * 0.12);
    v.position.set(x1 + nD * 0.55, nB, nz);
    v.castShadow = true;
    scene.add(v);
    // A dry branch: a few thin twigs.
    let px = x1 + nD * 0.55, py = nB + 0.36, pz = nz;
    const tg = [], tmpO = new THREE.Object3D();
    for (let k = 0; k < 5; k++) {
      const len = 0.18 + Math.random() * 0.22;
      const ax = (Math.random() - 0.5) * 0.9, az = (Math.random() - 0.5) * 0.9;
      tmpO.position.set(px + Math.sin(ax) * len / 2 * 0.3, py + len / 2, pz + Math.sin(az) * len / 2);
      tmpO.rotation.set(az, 0, -ax * 0.3); tmpO.updateMatrix();
      tg.push(new THREE.CylinderGeometry(0.004, 0.007, len, 5).applyMatrix4(tmpO.matrix));
      if (k === 1) { py += len * 0.8; pz += Math.sin(az) * len * 0.5; }
    }
    scene.add(new THREE.Mesh(mergeGeometries(tg), branchMat));
  });
  // Ceiling with fine transverse light slots (bands of dawn light).
  const slab = 0.28;
  let zs = z0;
  for (let k = 0; k < 9; k++) {
    const sz0 = z0 + 1.4 + k * 1.28, sz1 = sz0 + 0.2;
    if (sz1 > z1 - 0.8) break;
    box(x1 - x0, slab, sz0 - zs, 0, ceil + slab / 2, (zs + sz0) / 2, hallConcrete);
    // slot ends (the slot doesn't reach the walls)
    box(0.5, slab, 0.2, x0 + 0.25, ceil + slab / 2, (sz0 + sz1) / 2, hallConcrete);
    box(0.5, slab, 0.2, x1 - 0.25, ceil + slab / 2, (sz0 + sz1) / 2, hallConcrete);
    zs = sz1;
  }
  box(x1 - x0, slab, z1 - zs, 0, ceil + slab / 2, (zs + z1) / 2, hallConcrete);
  // Long low stone bench, linen draped over one end.
  const stoneMat = new THREE.MeshStandardMaterial({ map: noiseTexture('#d9d4c7', 12), color: '#ecebe2', roughness: 0.85 });
  box(0.55, 0.42, 3.6, x0 + 0.42, 0.21, -12.4, stoneMat);
  const drape = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.1, 14, 16), linen);
  { const dp = drape.geometry.attributes.position; for (let i = 0; i < dp.count; i++) { const x = dp.getX(i), y = dp.getY(i); dp.setZ(i, Math.sin(x * 11 + y * 7) * 0.025 + (y < -0.2 ? (y + 0.2) * 0.9 : 0)); } drape.geometry.computeVertexNormals(); }
  drape.rotation.set(-Math.PI / 2 + 0.05, 0, 0.1);
  drape.position.set(x0 + 0.44, 0.43, -13.6);
  scene.add(drape);
  // Shoes left at the foot of the bench: you walk on in slippers.
  const shoeMat = new THREE.MeshStandardMaterial({ color: '#3a3029', roughness: 0.73 });
  for (const [sx, sz] of [[-1.88, -11.7], [-1.62, -11.62]]) {
    const sh = sphere(0.15, sx, 0.07, sz, shoeMat);
    sh.scale.set(0.62, 0.42, 1.55);
  }
  // Two tall hangings on the left wall: pale linen, then a dark one.
  for (const [hz, col] of [[-15.6, '#ecebe2'], [-8.8, '#4f5550']]) {
    const g = new THREE.PlaneGeometry(1.3, 2.7, 16, 24);
    const hp = g.attributes.position;
    for (let i = 0; i < hp.count; i++) hp.setZ(i, Math.sin(hp.getX(i) * 9) * 0.03 + Math.sin(hp.getY(i) * 3 + hp.getX(i) * 2) * 0.012);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: col, roughness: 1, side: THREE.DoubleSide }));
    m.rotation.y = Math.PI / 2;
    m.position.set(x0 + 0.05, 1.75, hz);
    m.castShadow = true;
    scene.add(m);
  }
  // A warm glow at the foot of the walls (fake light: emissive line + soft
  // additive wash up the wall — no real lights, light on the GPU).
  const gc = document.createElement('canvas'); gc.width = 8; gc.height = 128;
  { const x = gc.getContext('2d'); const gr = x.createLinearGradient(0, 128, 0, 0); gr.addColorStop(0, 'rgba(255,214,160,0.9)'); gr.addColorStop(0.35, 'rgba(255,214,160,0.25)'); gr.addColorStop(1, 'rgba(255,214,160,0)'); x.fillStyle = gr; x.fillRect(0, 0, 8, 128); }
  const glowTex = new THREE.CanvasTexture(gc); glowTex.colorSpace = THREE.SRGBColorSpace;
  const glowMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const lineMat = new THREE.MeshBasicMaterial({ color: '#ffe2bd' });
  const wash = (x, faceSign) => {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(L - 0.6, 1.3), glowMat);
    w.rotation.y = faceSign * Math.PI / 2;
    w.position.set(x, 0.65, zm);
    w.renderOrder = 2;
    scene.add(w);
  };
  wash(x0 + 0.02, 1);
  box(0.03, 0.02, L - 0.6, x0 + 0.03, 0.01, zm, lineMat, false);
}
const wallH = HALL.wallTop - HALL.wallBottom;
const wallY = (HALL.wallTop + HALL.wallBottom) / 2;
const sideZ0 = HALL.doorZ - HALL.wallT;
const sideZ1 = HALL.north + HALL.wallT;
const sideLen = sideZ1 - sideZ0;
const sideCenter = (sideZ0 + sideZ1) / 2;
const outerX = HALL.x + HALL.wallT / 2;
// Side walls, opened near the south corners for the two corridors.
for (const sx of [-1, 1]) {
  const za = sideZ0, zb = CORR.z0, zc2 = CORR.z1, zd = sideZ1;
  box(HALL.wallT, wallH, zb - za, sx * outerX, wallY, (za + zb) / 2, hallConcrete);
  box(HALL.wallT, wallH, zd - zc2, sx * outerX, wallY, (zc2 + zd) / 2, hallConcrete);
}
// ---- Couloirs : étroits, très hauts, une fente de lumière zénithale ----
for (const sx of [-1, 1]) {
  const xa = outerX + HALL.wallT / 2, xb = xa + CORR.len; // |x| from the hall's outer face to the end
  const xm = sx * (xa + xb) / 2, L = xb - xa, wt = 0.3, Hc = CORR.height;
  box(L, 0.25, CORR.w, xm, -0.125, CORR.zc, floorMat);
  box(L + wt, Hc + 1.4, wt, xm + sx * wt / 2, (Hc - 1.4) / 2, CORR.z0 - wt / 2, hallConcrete);
  box(L + wt, Hc + 1.4, wt, xm + sx * wt / 2, (Hc - 1.4) / 2, CORR.z1 + wt / 2, hallConcrete);
  box(wt, Hc + 1.4, CORR.w + wt * 2, sx * (xb + wt / 2), (Hc - 1.4) / 2, CORR.zc, hallConcrete);
  // Above the hall's wall top, the corridor's mouth is closed by a lintel.
  box(HALL.wallT, Hc - HALL.wallTop + 0.3, CORR.w, sx * outerX, HALL.wallTop + (Hc - HALL.wallTop + 0.3) / 2, CORR.zc, hallConcrete);
  // Roof with one long thin skylight slit down the middle.
  const slit = 0.14, rT = 0.3;
  const sideW = (CORR.w + wt * 2 - slit) / 2;
  for (const dz of [-1, 1]) box(L + wt, rT, sideW, xm + sx * wt / 2, Hc + rT / 2, CORR.zc + dz * (slit / 2 + sideW / 2), hallConcrete);
  box(0.8, rT, slit, sx * (xa + 0.4), Hc + rT / 2, CORR.zc, hallConcrete);
  box(0.8, rT, slit, sx * (xb - 0.4), Hc + rT / 2, CORR.zc, hallConcrete);
  // Underside and piers down to the valley.
  box(L, 1.1, CORR.w + wt * 2, xm, -0.8, CORR.zc, hallConcrete, false);
  for (const f of [0.3, 0.8]) {
    const x = sx * (xa + L * f), ph = -1.35 - (-20); // down past the valley floor (VALLEY.y − 6)
    box(1.0, ph, 1.0, x, -1.35 - ph / 2, CORR.zc, hallConcrete, false);
  }
}

// North wall replaced by a floor-to-ceiling glass bay (see "Baie vitrée"):
// only the concrete sill below floor level remains.
box(HALL.x * 2 + HALL.wallT, -0.02 - HALL.wallBottom, HALL.wallT, 0, (HALL.wallBottom - 0.02) / 2, HALL.north + HALL.wallT / 2, hallConcrete);

const opening = ENTRY.x1;
const southCenterZ = HALL.doorZ - HALL.wallT / 2;
const jambW = outerX - opening;
box(jambW, wallH, HALL.wallT, -(outerX + opening) / 2, wallY, southCenterZ, hallConcrete);
box(jambW, wallH, HALL.wallT, (outerX + opening) / 2, wallY, southCenterZ, hallConcrete);
const soffitH = HALL.wallTop - 3.6;
box(opening * 2, soffitH, HALL.wallT, 0, 3.6 + soffitH / 2, southCenterZ, hallConcrete);

// Formwork tie holes follow construction rules: aligned rows at pour heights,
// a regular bay along each wall, identical on every panel.
{
  const tieGeo = new THREE.CylinderGeometry(0.017, 0.017, 0.05, 10);
  tieGeo.rotateZ(Math.PI / 2);
  const tieMat = new THREE.MeshStandardMaterial({ color: '#39362f', roughness: 0.95 });
  const tieRows = [0.86, 2.28, 3.7, 5.12, 6.54];
  const tieBay = 1.76;
  const tiePos = [];
  for (const y of tieRows) {
    for (let z = HALL.doorZ + 0.9; z < HALL.north - 0.45; z += tieBay) {
      tiePos.push([-HALL.x + 0.004, y, z, 0], [HALL.x - 0.004, y, z, 0]);
    }
  }
  const tieMesh = new THREE.InstancedMesh(tieGeo, tieMat, tiePos.length);
  const td2 = new THREE.Object3D();
  let ti = 0;
  for (const [x, y, z, rot] of tiePos) {
    td2.position.set(x, y, z);
    td2.rotation.set(0, rot ? Math.PI / 2 : 0, 0);
    td2.updateMatrix();
    tieMesh.setMatrixAt(ti++, td2.matrix);
  }
  tieMesh.castShadow = false;
  tieMesh.receiveShadow = true;
  scene.add(tieMesh);
}

const floorW = CHANNEL.ix1 - CHANNEL.ix0;
const floorD = CHANNEL.iz1 - CHANNEL.iz0;
const floorCenterZ = (CHANNEL.iz0 + CHANNEL.iz1) / 2;

// Marble tiles float over a river-stone gravel bed: dark substrate, tile grid
// with open joints, and instanced round stones filling the joints.
const gravelBedMat = new THREE.MeshStandardMaterial({ map: noiseTexture('#4a4843', 14), roughness: 1 });
box(floorW, 0.1, CROSS.z0 - CHANNEL.iz0, 0, -0.17, (CHANNEL.iz0 + CROSS.z0) / 2, gravelBedMat, false);
box(floorW, 0.1, CHANNEL.iz1 - CROSS.z1, 0, -0.17, (CROSS.z1 + CHANNEL.iz1) / 2, gravelBedMat, false);

const TILE = 1.42;
const TILE_GAP = 0.055;
const nTx = Math.max(1, Math.round(floorW / TILE));
const nTz = Math.max(1, Math.round(floorD / TILE));
const tileW = floorW / nTx;
const tileD = floorD / nTz;
const tileGeos = [];
for (let i = 0; i < nTx; i++) {
  for (let j = 0; j < nTz; j++) {
    const x0 = CHANNEL.ix0 + i * tileW + (i === 0 ? 0 : TILE_GAP / 2);
    const x1 = CHANNEL.ix0 + (i + 1) * tileW - (i === nTx - 1 ? 0 : TILE_GAP / 2);
    const tz0 = CHANNEL.iz0 + j * tileD + (j === 0 ? 0 : TILE_GAP / 2);
    const tz1 = CHANNEL.iz0 + (j + 1) * tileD - (j === nTz - 1 ? 0 : TILE_GAP / 2);
    // Tiles stop at the cross canal (a tile crossing it is cut in two).
    const pieces = [];
    if (tz1 <= CROSS.z0 || tz0 >= CROSS.z1) pieces.push([tz0, tz1]);
    else { if (tz0 < CROSS.z0) pieces.push([tz0, CROSS.z0]); if (tz1 > CROSS.z1) pieces.push([CROSS.z1, tz1]); }
    for (const [z0, z1] of pieces) {
    const g = worldUVs(new THREE.BoxGeometry(x1 - x0, 0.08, z1 - z0), x1 - x0, 0.08, z1 - z0);
    // Each tile is cut from a different part of the slab: shift UVs, keep grain direction.
    const uv = g.attributes.uv;
    const ou = Math.random() * 7;
    const ov = Math.random() * 7;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) + ou, uv.getY(k) + ov);
    g.translate((x0 + x1) / 2, -0.08, (z0 + z1) / 2);
    tileGeos.push(g);
    }
  }
}
const tileMesh = new THREE.Mesh(mergeGeometries(tileGeos), hallFloorMat);
tileMesh.receiveShadow = true;
scene.add(tileMesh);
ssrSelects.push(tileMesh);

// River stones: instanced squashed ellipsoids, dry + wet (clearcoat) variants.
const stoneGeo = LITE ? new THREE.SphereGeometry(1, 6, 4) : new THREE.SphereGeometry(1, 9, 7);
const stoneDryMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
const stoneWetMat = new THREE.MeshPhysicalMaterial({
  roughness: 0.13,
  clearcoat: QUALITY === 'low' ? 0 : 1,
  clearcoatRoughness: 0.1,
  envMapIntensity: 1.15,
});
const stonePalette = [
  [0.63, 0.61, 0.58], [0.55, 0.52, 0.48], [0.69, 0.67, 0.61],
  [0.47, 0.46, 0.45], [0.61, 0.55, 0.47], [0.52, 0.55, 0.52], [0.72, 0.7, 0.66],
];
const dryXf = [];
const dryCol = [];
const wetXf = [];
const wetCol = [];
const stoneP = new THREE.Vector3();
const stoneQ = new THREE.Quaternion();
const stoneE = new THREE.Euler();
const stoneS = new THREE.Vector3();
function dropStone(x, groundY, z, rMin, rMax, wet) {
  const r = rMin + Math.random() * (rMax - rMin);
  stoneS.set(r * (0.85 + Math.random() * 0.5), r * 0.55, r * (0.95 + Math.random() * 0.6));
  stoneP.set(x, groundY + stoneS.y * (0.45 + Math.random() * 0.25), z);
  stoneE.set((Math.random() - 0.5) * 0.45, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.45);
  stoneQ.setFromEuler(stoneE);
  const m = new THREE.Matrix4().compose(stoneP, stoneQ, stoneS);
  const c = stonePalette[(Math.random() * stonePalette.length) | 0];
  if (wet) {
    wetXf.push(m);
    wetCol.push(c[0] * 0.52, c[1] * 0.52, c[2] * 0.56);
  } else {
    dryXf.push(m);
    dryCol.push(c[0], c[1], c[2]);
  }
}
// Gravel in the tile joints; stones near the canal stay wet from the splash.
const wetChance = (x, z) => {
  const dEdge = Math.min(x - CHANNEL.ix0, CHANNEL.ix1 - x, z - CHANNEL.iz0, CHANNEL.iz1 - z);
  return 0.1 + 0.65 * Math.exp(-dEdge / 2.2);
};
const GAP_STEP = LITE ? 0.13 : 0.06;
for (let i = 1; i < nTx; i++) {
  const gx = CHANNEL.ix0 + i * tileW;
  for (let z = CHANNEL.iz0 + 0.06; z < CHANNEL.iz1 - 0.06; z += GAP_STEP * (0.7 + Math.random() * 0.6)) {
    const x = gx + (Math.random() - 0.5) * TILE_GAP * 0.6;
    if (z > CROSS.z0 - 0.05 && z < CROSS.z1 + 0.05) continue;
    dropStone(x, -0.12, z, 0.016, 0.034, Math.random() < wetChance(x, z));
  }
}
for (let j = 1; j < nTz; j++) {
  const gz = CHANNEL.iz0 + j * tileD;
  if (gz > CROSS.z0 - 0.05 && gz < CROSS.z1 + 0.05) continue;
  for (let x = CHANNEL.ix0 + 0.06; x < CHANNEL.ix1 - 0.06; x += GAP_STEP * (0.7 + Math.random() * 0.6)) {
    const z = gz + (Math.random() - 0.5) * TILE_GAP * 0.6;
    dropStone(x, -0.12, z, 0.016, 0.034, Math.random() < wetChance(x, z));
  }
}
const mossCapXf = [];
// Canal bed: scattered pebbles (some, not too many), varied shapes and
// sizes, colours from the gallery palette with slight variation.
const BED_STEP = LITE ? 0.26 : 0.115;
const bedStrips = [
  [CHANNEL.ix0, CHANNEL.ix1, CROSS.z0, CROSS.z1],
  [CHANNEL.x0, CHANNEL.ix0, CHANNEL.z0, CHANNEL.z1],
  [CHANNEL.ix1, CHANNEL.x1, CHANNEL.z0, CHANNEL.z1],
  [CHANNEL.ix0, CHANNEL.ix1, CHANNEL.z0, CHANNEL.iz0],
  [CHANNEL.ix0, CHANNEL.ix1, CHANNEL.iz1, CHANNEL.z1],
];
{
  const PEBBLE_TONES = ['#c8c9ca', '#dcd9cf', '#ecebe2', '#a9a59b', '#8d8a82', '#76604f', '#353b37', '#b9b3a6'];
  const area = bedStrips.reduce((a, [x0, x1, z0, z1]) => a + (x1 - x0) * (z1 - z0), 0);
  const count = LITE ? 380 : 900;
  const c = new THREE.Color();
  for (let k = 0; k < count; k++) {
    let pick = Math.random() * area, st = bedStrips[0];
    for (const b of bedStrips) { const w = (b[1] - b[0]) * (b[3] - b[2]); if (pick <= w) { st = b; break; } pick -= w; }
    const x = st[0] + 0.08 + Math.random() * (st[1] - st[0] - 0.16);
    const z = st[2] + 0.08 + Math.random() * (st[3] - st[2] - 0.16);
    const big = Math.random() < 0.22;
    const r = big ? 0.08 + Math.random() * 0.08 : 0.03 + Math.pow(Math.random(), 1.4) * 0.06;
    stoneS.set(r * (0.7 + Math.random() * 0.9), r * (0.35 + Math.random() * 0.3), r * (0.7 + Math.random() * 0.9));
    stoneP.set(x, CANAL_BED_Y + stoneS.y * 0.55, z);
    stoneE.set((Math.random() - 0.5) * 0.3, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.3);
    stoneQ.setFromEuler(stoneE);
    wetXf.push(new THREE.Matrix4().compose(stoneP, stoneQ, stoneS));
    c.set(PEBBLE_TONES[(Math.random() * PEBBLE_TONES.length) | 0]).offsetHSL(0, 0, (Math.random() - 0.5) * 0.08);
    // Under water: a touch darker and cooler.
    wetCol.push(c.r * 0.82, c.g * 0.84, c.b * 0.86);
    // Some big pebbles carry a cap of aquatic moss.
    if (big && Math.random() < 0.45) {
      const capS = stoneS.clone().multiply(new THREE.Vector3(0.82, 0.55, 0.82));
      const capP = stoneP.clone(); capP.y += stoneS.y * 0.42;
      mossCapXf.push(new THREE.Matrix4().compose(capP, stoneQ.clone(), capS));
    }
  }
}
function buildStones(xf, col, mat) {
  const im = new THREE.InstancedMesh(stoneGeo, mat, xf.length);
  const tmp = new THREE.Color();
  for (let i = 0; i < xf.length; i++) {
    im.setMatrixAt(i, xf[i]);
    im.setColorAt(i, tmp.setRGB(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]));
  }
  im.castShadow = false;
  im.receiveShadow = true;
  scene.add(im);
}
buildStones(dryXf, dryCol, stoneDryMat);
addCaustics(stoneWetMat, 0.1);
buildStones(wetXf, wetCol, stoneWetMat);
if (mossCapXf.length) {
  const capMesh = new THREE.InstancedMesh(stoneGeo, new THREE.MeshStandardMaterial({ color: '#4f6a2c', roughness: 1 }), mossCapXf.length);
  mossCapXf.forEach((m, i) => capMesh.setMatrixAt(i, m));
  scene.add(capMesh);
}

// Rock fields flanking the central path, Death-Stranding style (Decima terrain
// rules): domain-warped ridged fBm gives wind-polished basalt forms, subtle
// terracing suggests layered volcanic flows, and moss grows only where the
// surface is flat or concave — steep faces stay bare rock, with noise breaking
// the border so it never reads as painted on.
const PATH_HALF = 3.85;
const rockHash = (ix, iz) => {
  const s = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
function rockValueNoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = rockHash(ix, iz), b = rockHash(ix + 1, iz);
  const c = rockHash(ix, iz + 1), d = rockHash(ix + 1, iz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
function rockFbm(x, z) {
  let v = 0, amp = 0.5, f = 1;
  for (let o = 0; o < 4; o++) {
    v += amp * rockValueNoise(x * f, z * f);
    amp *= 0.5;
    f *= 2.03;
  }
  return v;
}
function rockRidged(x, z) {
  let v = 0, amp = 0.55, f = 1;
  for (let o = 0; o < 4; o++) {
    const n = 1 - Math.abs(2 * rockValueNoise(x * f, z * f) - 1);
    v += amp * n * n;
    amp *= 0.5;
    f *= 2.11;
  }
  return v;
}
// Moss cushions (reference: soft, fully green hummocks lining a concrete
// wall). The island outline wobbles so the edge along the path meanders
// organically; the edge profile is a quarter-sine so each cushion rises with
// a rounded, bulging lip instead of a linear ramp.
// ---- Salon de mousse ----
// One long, flat moss floor on the west side of the gallery (replacing the
// west hummocks): slight undulations only. It runs the length of the hall,
// crosses the north canal on a thin slab, passes under the glass bay and
// carries on across the terrace around the big column.
const LOUNGE = { x0: -(13.5 - 0.88 - 1.8), x1: -3.85, z0: (-4.85 + 0.88) + 2.2, z1: 18.4 + 0.46 + 9 - 1.95 };
function loungeFade(x, z) {
  const dW = x - (LOUNGE.x0 + 0.5 * Math.max(0, rockFbm(z * 0.27 + 61, 5.1) - 0.3));
  const dE = (LOUNGE.x1 - 0.1 - 1.2 * Math.max(0, rockFbm(z * 0.3 + 47, 1.3) - 0.32)) - x;
  const dS = z - (LOUNGE.z0 + 0.8 * Math.max(0, rockFbm(x * 0.35 + 22, 9) - 0.3));
  const dN = LOUNGE.z1 - 0.6 * Math.max(0, rockFbm(x * 0.35 + 6, 7) - 0.3) - z;
  const dX = Math.abs(z - ((-4.85 + 18.4) / 2)) - (0.44 + 0.05 + 0.35 * Math.max(0, rockFbm(x * 0.4 + 12, 3) - 0.4));
  // The north canal along the bay stays open water: the moss stops at its
  // lip and starts again on the terrace, beyond the glass.
  const dC = Math.max((18.4 - 0.88 - 0.05) - z, z - (18.4 + 0.46 + 0.08));
  const dX2 = Math.min(dX, dC);
  const d = Math.min(dW, dE, dS, dN, dX2);
  if (d <= 0) return 0;
  // Softer, rounder lip where the moss meets the middle stream.
  return Math.sin(Math.min(1, d / (d === dX2 ? 0.22 : 0.45)) * Math.PI / 2);
}
function loungeHeight(x, z) {
  if (x < LOUNGE.x0 - 0.1 || x > LOUNGE.x1 + 0.1 || z < LOUNGE.z0 - 0.1 || z > LOUNGE.z1 + 0.1) return 0;
  const f = loungeFade(x, z);
  if (f <= 0) return 0;
  const t = rockFbm(x * 0.45 + 3, z * 0.45);
  return (0.03 + 0.045 * t * t * (3 - 2 * t) + 0.015 * (rockFbm(x * 1.8, z * 1.8 + 9) - 0.5)) * f;
}
function rockFade(x, z) {
  const ax = Math.abs(x);
  const side = x > 0 ? 40 : 0;
  const dPath = ax - (PATH_HALF + 0.1 + 2.4 * Math.max(0, rockFbm(z * 0.3 + 3.7 + side, 1.3) - 0.32));
  const dOut = ISLAND.x1 - 0.05 - 0.8 * Math.max(0, rockFbm(z * 0.27 + 11 + side, 5.1) - 0.3) - ax;
  const dS = z - (ISLAND.z0 + 0.9 * Math.max(0, rockFbm(ax * 0.35 + 2, 9) - 0.3));
  const dN = ISLAND.z1 - 0.9 * Math.max(0, rockFbm(ax * 0.35 + 6, 4) - 0.3) - z;
  // Keep clear of the cross canal (and its coping), with a soft wobble.
  const dX = Math.abs(z - CROSS.zc) - (HALL.channel / 2 + 0.34 + 0.6 * Math.max(0, rockFbm(ax * 0.4 + 12, 3) - 0.35));
  const d = Math.min(dPath, dOut, dS, dN, dX);
  if (d <= 0) return 0;
  return Math.sin(Math.min(1, d / 1.3) * Math.PI / 2);
}
function rockHeightBase(x, z) {
  const ax = Math.abs(x);
  return 0; // only the flat moss lounge (west / right-hand side) remains
  if (ax <= PATH_HALF || ax >= ISLAND.x1 || z <= ISLAND.z0 || z >= ISLAND.z1) return 0;
  const f = rockFade(x, z);
  if (f <= 0) return 0;
  // Domain-warped smooth fBm → separate rounded mounds with soft saddles.
  const wx = x + 1.4 * (rockFbm(x * 0.3 + 7.2, z * 0.3) - 0.5);
  const wz = z + 1.4 * (rockFbm(x * 0.3, z * 0.3 + 3.1) - 0.5);
  // Kept low and broad (max ~0.45 m) so the moss blends into the room
  // instead of drawing the eye.
  const t = Math.min(1, Math.max(0, (rockFbm(wx * 0.3, wz * 0.3) - 0.28) / 0.5));
  let h = 0.1 + 0.26 * t * t * (3 - 2 * t);
  // Gentle cushion-scale swells so it still reads as moss, not lawn.
  h += 0.22 * (rockFbm(x * 0.9 + 5, z * 0.9) - 0.5);
  // A touch higher against the wall.
  h += 0.1 * Math.min(1, Math.max(0, (ax - PATH_HALF) / (ISLAND.x1 - PATH_HALF)));
  return Math.max(0, h) * f;
}
// Gravity: a thermal-erosion pass over the base field. Material steeper than
// the talus angle slides to lower neighbours; where it lands is recorded in a
// deposition map (scree fans read as loose bare grit, not moss).
const ERO_GX = LITE ? 130 : 260;
const ERO_GZ = LITE ? 150 : 300;
const ERO_X0 = -ISLAND.x1, ERO_X1 = ISLAND.x1;
const ERO_Z0 = ISLAND.z0, ERO_Z1 = ISLAND.z1;
const eroH = new Float32Array(ERO_GX * ERO_GZ);
const eroDep = new Float32Array(ERO_GX * ERO_GZ);
{
  const cellX = (ERO_X1 - ERO_X0) / (ERO_GX - 1);
  for (let j = 0; j < ERO_GZ; j++)
    for (let i = 0; i < ERO_GX; i++)
      eroH[j * ERO_GX + i] = rockHeightBase(ERO_X0 + i * ((ERO_X1 - ERO_X0) / (ERO_GX - 1)), ERO_Z0 + j * ((ERO_Z1 - ERO_Z0) / (ERO_GZ - 1)));
  const talus = cellX * 1.1;
  // Erosion off: moss cushions keep their rounded shape (no scree fans).
  const iters = 0;
  for (let it = 0; it < iters; it++) {
    for (let j = 1; j < ERO_GZ - 1; j++) {
      for (let i = 1; i < ERO_GX - 1; i++) {
        const k = j * ERO_GX + i;
        const h0 = eroH[k];
        let total = 0;
        let d0 = 0, d1 = 0, d2 = 0, d3 = 0;
        const n0 = eroH[k - 1], n1 = eroH[k + 1], n2 = eroH[k - ERO_GX], n3 = eroH[k + ERO_GX];
        if (h0 - n0 > talus) { d0 = h0 - n0 - talus; total += d0; }
        if (h0 - n1 > talus) { d1 = h0 - n1 - talus; total += d1; }
        if (h0 - n2 > talus) { d2 = h0 - n2 - talus; total += d2; }
        if (h0 - n3 > talus) { d3 = h0 - n3 - talus; total += d3; }
        if (total <= 0) continue;
        const move = Math.min(total * 0.18, h0 * 0.5);
        eroH[k] -= move;
        if (d0) { eroH[k - 1] += move * d0 / total; eroDep[k - 1] += move * d0 / total; }
        if (d1) { eroH[k + 1] += move * d1 / total; eroDep[k + 1] += move * d1 / total; }
        if (d2) { eroH[k - ERO_GX] += move * d2 / total; eroDep[k - ERO_GX] += move * d2 / total; }
        if (d3) { eroH[k + ERO_GX] += move * d3 / total; eroDep[k + ERO_GX] += move * d3 / total; }
      }
    }
  }
  // Re-apply the envelope so slid material never creeps onto path or canal.
  if (iters > 0) for (let j = 0; j < ERO_GZ; j++)
    for (let i = 0; i < ERO_GX; i++) {
      const f = rockFade(ERO_X0 + i * ((ERO_X1 - ERO_X0) / (ERO_GX - 1)), ERO_Z0 + j * ((ERO_Z1 - ERO_Z0) / (ERO_GZ - 1)));
      eroH[j * ERO_GX + i] *= Math.min(1, f * 1.4);
    }
}
function eroSample(arr, x, z) {
  const gx = ((x - ERO_X0) / (ERO_X1 - ERO_X0)) * (ERO_GX - 1);
  const gz = ((z - ERO_Z0) / (ERO_Z1 - ERO_Z0)) * (ERO_GZ - 1);
  if (gx < 0 || gz < 0 || gx > ERO_GX - 1 || gz > ERO_GZ - 1) return 0;
  const i0 = Math.min(ERO_GX - 2, Math.floor(gx)), j0 = Math.min(ERO_GZ - 2, Math.floor(gz));
  const fx = gx - i0, fz = gz - j0;
  const a = arr[j0 * ERO_GX + i0], b = arr[j0 * ERO_GX + i0 + 1];
  const c = arr[(j0 + 1) * ERO_GX + i0], d = arr[(j0 + 1) * ERO_GX + i0 + 1];
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
const rockHeight = (x, z) => eroSample(eroH, x, z);
const rockDeposit = (x, z) => eroSample(eroDep, x, z);
const ROCK_BASE_Y = -0.03;

// ---- Level 2 : la vallée (Death Stranding) ----
// A 300 m Icelandic valley 600 m north of the gallery: mossy lower slopes,
// shattered grey crags, black gravel banks and a braided stream threading
// down from a gap in the rim, all fading into a white overcast sky.
// The valley IS the outside of the gallery: one continuous space. Its local
// origin is placed so that the gallery stands at local z ≈ -40 (upstream end
// of the bowl), straddling the stream, looking down-valley (+z) through the
// glass bay. Everything in the valley lives in valleyRoot, lowered by
// VALLEY.y so the gallery floor (y = 0) sits on piers well above the water.
const VALLEY_GALLERY_LOCAL_Z = -40;
const VALLEY = {
  x: -dsMeander(VALLEY_GALLERY_LOCAL_Z),
  z: 14 - VALLEY_GALLERY_LOCAL_Z,
  y: -14,
  radius: 142,
};
const valleyRoot = new THREE.Group();
valleyRoot.position.y = VALLEY.y;
scene.add(valleyRoot);
function dsMeander(z) {
  return Math.sin(z * 0.021) * 13 + (rockFbm(3.3, z * 0.012) - 0.5) * 34;
}
function dsHeight(x, z) {
  const mx = dsMeander(z);
  const d = Math.abs(x - mx);
  // U-valley cross-section, roughened.
  let h = Math.pow(Math.min(1, d / 95), 1.65) * 34;
  h *= 0.7 + 0.6 * rockFbm(x * 0.013 + 4, z * 0.013);
  // Ridged crags bite into the upper slopes only.
  const crag = rockRidged(x * 0.05 + 9, z * 0.05);
  h += crag * crag * Math.max(0, h - 7) * 0.75;
  // Rim mountains ringing the bowl, with a notch where the stream enters.
  const r = Math.hypot(x, z - 25);
  const rim = Math.min(1, Math.max(0, (r - 68) / 72));
  const notch = 1 - Math.exp(-(d * d) / (2 * 24 * 24)) * 0.88;
  h += rim * rim * 58 * (0.35 + 0.9 * rockRidged(x * 0.021, z * 0.021 + 5)) * notch;
  // North (away from spawn) sits higher, so the water runs toward you.
  h += Math.max(0, -z) * 0.05;
  h += rockFbm(x * 0.1, z * 0.1) * 2.4 - 1.2;
  // Stream channel.
  h -= Math.exp(-(d * d) / 40) * 2.6;
  return h;
}
// Dense clumpy moss texture: soft patches, thousands of tiny blobs, bright
// sporophyte tips and dark pores — the structure the vertex blend was missing.
function mossTexture(size = 512) {
  const cnv = document.createElement('canvas');
  cnv.width = cnv.height = size;
  const x = cnv.getContext('2d');
  x.fillStyle = '#2a401d';
  x.fillRect(0, 0, size, size);
  const tones = ['#1e3414', '#2f4a1e', '#3b5a22', '#273f16'];
  for (let i = 0; i < 260; i++) {
    const r = 14 + Math.random() * 40;
    const px = Math.random() * size;
    const py = Math.random() * size;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, tones[i % 4] + 'cc');
    g.addColorStop(1, tones[i % 4] + '00');
    x.fillStyle = g;
    x.fillRect(px - r, py - r, r * 2, r * 2);
  }
  for (let i = 0; i < 9000; i++) {
    x.fillStyle = `rgba(${(40 + Math.random() * 55) | 0},${(70 + Math.random() * 70) | 0},${(22 + Math.random() * 40) | 0},${0.25 + Math.random() * 0.5})`;
    x.beginPath();
    x.arc(Math.random() * size, Math.random() * size, 0.7 + Math.random() * 2.2, 0, Math.PI * 2);
    x.fill();
  }
  for (let i = 0; i < 2600; i++) {
    x.fillStyle = `rgba(${(120 + Math.random() * 60) | 0},${(150 + Math.random() * 60) | 0},${(60 + Math.random() * 40) | 0},${0.2 + Math.random() * 0.35})`;
    x.fillRect(Math.random() * size, Math.random() * size, 1, 1 + Math.random() * 2);
  }
  for (let i = 0; i < 2400; i++) {
    x.fillStyle = `rgba(10,20,8,${0.15 + Math.random() * 0.3})`;
    x.beginPath();
    x.arc(Math.random() * size, Math.random() * size, 0.5 + Math.random() * 1.4, 0, Math.PI * 2);
    x.fill();
  }
  const t = new THREE.CanvasTexture(cnv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
{
  const segX = LITE ? 70 : 180;
  const segZ = LITE ? 200 : 450;
  const stripW = ISLAND.x1 - PATH_HALF;
  const stripD = ISLAND.z1 - ISLAND.z0;
  const mossTex = mossTexture();
  const rockMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: noiseTexture('#b9b6b2', 26),
    roughness: 0.94,
  });
  // Per-vertex moss amount picks between the rock map and the moss map in the
  // fragment shader. ingaTex() hides texture repetition: each texture is
  // sampled twice (second sample rotated/offset) and blended by low-frequency
  // noise, plus a macro luminance wash at ~60 m scale.
  const mossUniform = { value: mossTex };
  const rockScaleU = { value: 1.0 };
  const mossScaleU = { value: 3.5 };
  const dispUniform = { value: rockMat.map };
  const dispAmtU = { value: LITE ? 0 : 0.12 };
  rockMat.onBeforeCompile = (sh) => {
    sh.uniforms.mossMap = mossUniform;
    sh.uniforms.uRockScale = rockScaleU;
    sh.uniforms.uMossScale = mossScaleU;
    sh.uniforms.dispMap = dispUniform;
    sh.uniforms.uDispM = dispAmtU;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float moss;\nvarying float vMoss;\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMoss = moss;')
      .replace('#include <project_vertex>', [
        'vec4 ingaWP = vec4( transformed, 1.0 );',
        'vec3 ingaWN = objectNormal;',
        '#ifdef USE_INSTANCING',
        'ingaWP = instanceMatrix * ingaWP;',
        'ingaWN = mat3( instanceMatrix ) * ingaWN;',
        '#endif',
        'vWorldPos = ( modelMatrix * ingaWP ).xyz;',
        'vWorldNormal = normalize( ( modelMatrix * vec4( ingaWN, 0.0 ) ).xyz );',
        '#include <project_vertex>',
      ].join('\n'));
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', [
        '#include <common>',
        'uniform sampler2D mossMap;',
        'uniform float uRockScale;',
        'uniform float uMossScale;',
        'varying float vMoss;',
        'float ingaHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }',
        'float ingaNoise( vec2 p ) {',
        '  vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );',
        '  return mix( mix( ingaHash( i ), ingaHash( i + vec2( 1.0, 0.0 ) ), f.x ),',
        '              mix( ingaHash( i + vec2( 0.0, 1.0 ) ), ingaHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );',
        '}',
        'vec4 ingaTex( sampler2D tex, vec2 uv ) {',
        '  float sel = smoothstep( 0.35, 0.65, ingaNoise( uv * 0.35 ) );',
        '  vec4 a = texture2D( tex, uv );',
        '  vec4 b = texture2D( tex, uv * mat2( -0.24, 0.31, -0.31, -0.24 ) + vec2( 5.3, 1.7 ) );',
        '  return mix( a, b, sel );',
        '}',
        'uniform sampler2D dispMap;',
        'uniform float uDispM;',
        'varying vec3 vWorldPos;',
        'varying vec3 vWorldNormal;',
        'float ingaHeight( vec2 uv ) { return ingaTex( dispMap, uv ).r; }',
        // Parallax occlusion: raymarch the height map so the ground has
        // real per-pixel relief, not just painted shading.
        'vec2 ingaPom( vec2 uv, float scl ) {',
        '  float att = clamp( vWorldNormal.y, 0.0, 1.0 ); att *= att;',
        '  float amt = uDispM * 0.85 * scl * att;',
        '  if ( amt < 0.0004 ) return uv;',
        '  vec3 v = normalize( cameraPosition - vWorldPos );',
        '  vec2 duv = ( v.xz / max( v.y, 0.35 ) ) * amt / 14.0;',
        '  float layer = 0.0;',
        '  float h = 1.0 - ingaHeight( uv );',
        '  for ( int i = 0; i < 14; i ++ ) {',
        '    if ( layer >= h ) break;',
        '    uv -= duv;',
        '    layer += 1.0 / 14.0;',
        '    h = 1.0 - ingaHeight( uv );',
        '  }',
        '  return uv;',
        '}',
      ].join('\n'))
      .replace('#include <map_fragment>', [
        'vec2 ingaUvR = ingaPom( vMapUv * uRockScale, uRockScale );',
        'vec2 ingaDeltaW = ingaUvR / max( uRockScale, 1e-5 ) - vMapUv;',
        'vec4 rockTexel = ingaTex( map, ingaUvR );',
        'vec4 mossTexel = ingaTex( mossMap, ( vMapUv + ingaDeltaW ) * uMossScale );',
        'float ingaMacro = 0.82 + 0.36 * ingaNoise( vMapUv * 0.016 );',
        'diffuseColor *= mix( rockTexel, mossTexel, vMoss );',
        'diffuseColor.rgb *= ingaMacro;',
      ].join('\n'));
  };
  rockMat.customProgramCacheKey = () => 'inga-rock-antitile';
  // Photogrammetry upgrade: prefer user-dropped Megascans exports in
  // public/assets/megascans/, else pull scanned CC0 sets from Polyhaven's CDN,
  // else keep the procedural canvases already in place.
  {
    const texLoader = new THREE.TextureLoader();
    const prep = (t, srgb) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      return t;
    };
    const phFiles = (name) =>
      fetch(`https://api.polyhaven.com/files/${name}`).then((r) => (r.ok ? r.json() : Promise.reject()));
    let dispLoaded = false;
    const applyRockDiffuse = (t) => {
      rockMat.map = prep(t, true);
      rockScaleU.value = 0.14;
      if (!dispLoaded) dispUniform.value = t;
      rockMat.needsUpdate = true;
    };
    const applyRockDisp = (t) => {
      dispLoaded = true;
      dispUniform.value = prep(t, false);
      if (!LITE) dispAmtU.value = 0.35;
    };
    const applyRockNormal = (t) => {
      rockMat.normalMap = prep(t, false);
      // Same scale as the rock colour map (0.14): unscaled it tiled every
      // ~1.2 m, a grid that the grazing dawn sun made plainly visible.
      rockMat.normalMap.repeat.set(0.14, 0.14);
      rockMat.normalScale.set(0.6, 0.6);
      rockMat.needsUpdate = true;
    };
    const applyMoss = (t) => {
      mossUniform.value = prep(t, true);
      mossScaleU.value = 0.45;
    };
    texLoader.load('/assets/megascans/rock_albedo.jpg', applyRockDiffuse, undefined, () => {
      phFiles('aerial_rocks_02')
        .then((f) => {
          const d = f.Diffuse?.['2k']?.jpg?.url;
          const n = f.nor_gl?.['2k']?.jpg?.url;
          const dp = f.Displacement?.['2k']?.jpg?.url || f.Displacement?.['2k']?.png?.url;
          if (d) texLoader.load(d, applyRockDiffuse);
          if (n) texLoader.load(n, applyRockNormal);
          if (dp) texLoader.load(dp, applyRockDisp);
        })
        .catch(() => {});
    });
    texLoader.load('/assets/megascans/rock_normal.jpg', applyRockNormal, undefined, () => {});
    texLoader.load('/assets/megascans/rock_disp.jpg', applyRockDisp, undefined, () => {});
    // Moss stays procedural (dense green) unless a real scan is dropped in:
    // Polyhaven's grass/rock scans read pale, almost white, at this scale.
    texLoader.load('/assets/megascans/moss_albedo.jpg', applyMoss, undefined, () => {});
  }
  const rockBase = new THREE.Color(0.4, 0.395, 0.4);
  const rockWarm = new THREE.Color(0.47, 0.44, 0.4);
  // The moss map carries the green; vertex color just modulates brightness.
  const mossCool = new THREE.Color(0.46, 0.68, 0.38);
  const mossWarm = new THREE.Color(0.78, 0.95, 0.46);
  // Hall moss cushions. The shared moss texture is dark (it also serves the
  // valley), so the hall brightens it through vertex colours (GAIN > 1).
  // Tuned toward the reference's olive / yellow-green, not lawn green.
  // Narrow range between the two tones: calm, even colour.
  const HALL_MOSS_DEEP = new THREE.Color(1.35, 0.82, 0.48);
  const HALL_MOSS_BRIGHT = new THREE.Color(2.2, 1.3, 0.75);
  const HALL_MOSS_GAIN = 3.6;
  const tmpA = new THREE.Color();
  const tmpB = new THREE.Color();
  for (const sideSign of [-1]) {
    const lounge = sideSign < 0;
    const hf = lounge ? loungeHeight : rockHeight;
    const dLen = lounge ? LOUNGE.z1 - LOUNGE.z0 : stripD;
    const geo = new THREE.PlaneGeometry(stripW, dLen, segX, Math.round(segZ * dLen / stripD));
    geo.rotateX(-Math.PI / 2);
    const cx = sideSign * (PATH_HALF + stripW / 2);
    const czm = lounge ? (LOUNGE.z0 + LOUNGE.z1) / 2 : (ISLAND.z0 + ISLAND.z1) / 2;
    const pos = geo.attributes.position;
    const uvA = geo.attributes.uv;
    const preX = new Float32Array(pos.count);
    const preZ = new Float32Array(pos.count);
    const eG = 0.16;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + cx;
      const z = pos.getZ(i) + czm;
      preX[i] = x;
      preZ[i] = z;
      let h = hf(x, z);
      // Clumpy moss surface: small lumps on top (finer and lower on the lounge).
      if (h > 0.002) {
        const grow = Math.min(1, h / 0.1);
        h += grow * (lounge ? 0.012 : 0.04) * (rockValueNoise(x * 2.2 + 13, z * 2.2) - 0.5) + grow * 0.008 * (rockValueNoise(x * 7.3, z * 7.3 + 21) - 0.5);
      }
      // Outside the cushion outline the sheet dips under the marble, so the
      // moss edge is a clean organic line on the floor.
      // Next to the outline: just below the tile top (-0.04) so the crossing
      // interpolates smoothly instead of stair-stepping. Further out: well
      // under the gravel so no green shows through the tile joints.
      let y = ROCK_BASE_Y + h;
      if (h <= 0.002) {
        const r = 0.16;
        const nearEdge = hf(x + r, z) + hf(x - r, z) + hf(x, z + r) + hf(x, z - r) > 0;
        y = nearEdge ? -0.055 : -0.3;
        // Under a canal: tuck the sheet below the canal bed; on the terrace, into the slab.
        if (Math.abs(z - CROSS.zc) < HALL.channel / 2 + 0.03 || (z > CHANNEL.iz1 - 0.1 && z < HALL.north + 0.1)) y = CANAL_BED_Y - 0.15;
        else if (z > HALL.north) y = -0.06;
      }
      pos.setXYZ(i, x, y, z);
      uvA.setXY(i, x * 0.85, z * 0.85);
    }
    geo.computeVertexNormals();
    const nor = geo.attributes.normal;
    const colArr = new Float32Array(pos.count * 3);
    const mossArr = new Float32Array(pos.count);
    const e = 0.14;
    for (let i = 0; i < pos.count; i++) {
      const x = preX[i];
      const h = pos.getY(i) - ROCK_BASE_Y;
      const z = preZ[i];
      const slope = 1 - nor.getY(i);
      const around = (hf(x + e, z) + hf(x - e, z) + hf(x, z + e) + hf(x, z - e)) / 4;
      const cav = Math.min(1, Math.max(0, (around - h) * 7));
      // Fully moss-covered: no bare rock. Colour varies between a deeper
      // green and a bright yellow-green; creases between cushions darken,
      // tops catch more light.
      mossArr[i] = 1;
      tmpA.copy(HALL_MOSS_DEEP).lerp(HALL_MOSS_BRIGHT, rockFbm(x * 0.9, z * 0.9 + 17));
      tmpA.multiplyScalar(HALL_MOSS_GAIN * (1 - cav * 0.3 - slope * 0.15) * (0.92 + 0.15 * Math.min(1, h / 0.4)));
      colArr[i * 3] = tmpA.r;
      colArr[i * 3 + 1] = tmpA.g;
      colArr[i * 3 + 2] = tmpA.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
    geo.setAttribute('moss', new THREE.BufferAttribute(mossArr, 1));
    const mesh = new THREE.Mesh(geo, rockMat);
    mesh.castShadow = !LITE;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // Wind-rounded boulders half sunk into the moss; yaw-only rotation keeps
  // the vertex-painted moss on their up-facing side.
  // Welded vertices → smooth normals (the raw icosahedron shades faceted).
  const bGeoRaw = new THREE.IcosahedronGeometry(1, LITE ? 3 : 4);
  bGeoRaw.deleteAttribute('normal');
  bGeoRaw.deleteAttribute('uv');
  const bGeo = mergeVertices(bGeoRaw);
  const bPos = bGeo.attributes.position;
  const bV = new THREE.Vector3();
  for (let i = 0; i < bPos.count; i++) {
    bV.set(bPos.getX(i), bPos.getY(i), bPos.getZ(i));
    bV.multiplyScalar(1 + (rockFbm(bV.x * 1.7 + 5, (bV.y + bV.z) * 1.7) - 0.5) * 0.52);
    bPos.setXYZ(i, bV.x, bV.y * 0.72, bV.z);
  }
  bGeo.computeVertexNormals();
  const bNor = bGeo.attributes.normal;
  const bCol = new Float32Array(bPos.count * 3);
  const bMoss = new Float32Array(bPos.count);
  // Small extra moss mounds sitting on the cushions (fully moss-covered).
  for (let i = 0; i < bPos.count; i++) {
    const up = Math.max(0, bNor.getY(i));
    bMoss[i] = 1;
    tmpA.copy(HALL_MOSS_DEEP).lerp(HALL_MOSS_BRIGHT, rockFbm(bPos.getX(i) * 2.4 + 9, bPos.getZ(i) * 2.4));
    tmpA.multiplyScalar(HALL_MOSS_GAIN * (0.9 + 0.35 * up));
    bCol[i * 3] = tmpA.r;
    bCol[i * 3 + 1] = tmpA.g;
    bCol[i * 3 + 2] = tmpA.b;
  }
  bGeo.setAttribute('color', new THREE.BufferAttribute(bCol, 3));
  bGeo.setAttribute('moss', new THREE.BufferAttribute(bMoss, 1));
  // Extra mounds removed: the flat moss bed reads calmer without them.
  const N_B = 0;
  const bMesh = new THREE.InstancedMesh(bGeo, rockMat, N_B);
  const bDummy = new THREE.Object3D();
  for (let i = 0; i < N_B; i++) {
    const sideSign = i % 2 ? 1 : -1;
    let x = 0, z = 0;
    for (let tries = 0; tries < 20; tries++) {
      x = sideSign * (PATH_HALF + 0.55 + Math.random() * (stripW - 1.1));
      z = ISLAND.z0 + 0.8 + Math.random() * (stripD - 1.6);
      if (rockHeight(x, z) > 0.35) break;
    }
    const s = 0.22 + Math.random() * 0.6;
    bDummy.position.set(x, ROCK_BASE_Y + rockHeight(x, z) - s * 0.15, z);
    bDummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
    bDummy.scale.set(s * (0.8 + Math.random() * 0.5), s, s * (0.8 + Math.random() * 0.5));
    bDummy.updateMatrix();
    bMesh.setMatrixAt(i, bDummy.matrix);
    bMesh.setColorAt(i, tmpA.setScalar(1.0 + Math.random() * 0.25));
  }
  bMesh.castShadow = !LITE;
  bMesh.receiveShadow = true;
  scene.add(bMesh);

  // Water flowing: rivulets traced by gradient descent over the eroded
  // field, widening as they drop, draining outward into the peripheral canal.
  // Off for now: water trickling over moss cushions read as wet rock.
  const HALL_RIVULETS = false;
  for (const sideSign of HALL_RIVULETS ? [-1, 1] : []) {
    for (let r = 0; r < 3; r++) {
      let sx = 0, sz = 0, sh = -1;
      for (let c = 0; c < 36; c++) {
        const x = sideSign * (PATH_HALF + 1.2 + Math.random() * (stripW - 2.4));
        const z = ISLAND.z0 + 2.5 + Math.random() * (stripD - 5);
        const h = rockHeight(x, z);
        if (h > sh) { sh = h; sx = x; sz = z; }
      }
      if (sh < 0.35) continue;
      const path = [[sx, sz, sh]];
      let px = sx, pz = sz;
      for (let stp = 0; stp < 90; stp++) {
        const eR = 0.12;
        const gx = (rockHeight(px + eR, pz) - rockHeight(px - eR, pz)) / (2 * eR);
        const gz = (rockHeight(px, pz + eR) - rockHeight(px, pz - eR)) / (2 * eR);
        const gm = Math.hypot(gx, gz);
        let dx = gm > 1e-4 ? -gx / gm : 0;
        let dz = gm > 1e-4 ? -gz / gm : 0;
        dx += sideSign * 0.4;
        const dm = Math.hypot(dx, dz) || 1;
        px += (dx / dm) * 0.22;
        pz += (dz / dm) * 0.22;
        const h = rockHeight(px, pz);
        path.push([px, pz, h]);
        if (Math.abs(px) >= ISLAND.x1 - 0.12 || h < 0.015) break;
      }
      if (path.length < 8) continue;
      const n = path.length;
      const vp = new Float32Array(n * 6);
      const vuv = new Float32Array(n * 4);
      const idx = [];
      let len = 0;
      for (let i = 0; i < n; i++) {
        const [x, z, h] = path[i];
        const nxt = path[Math.min(n - 1, i + 1)];
        const prv = path[Math.max(0, i - 1)];
        let tx = nxt[0] - prv[0], tz = nxt[1] - prv[1];
        const tm = Math.hypot(tx, tz) || 1;
        const half = 0.05 + 0.09 * (i / (n - 1));
        const ox = (-tz / tm) * half, oz = (tx / tm) * half;
        if (i) len += Math.hypot(x - prv[0], z - prv[1]);
        const y = ROCK_BASE_Y + h + 0.018;
        vp[i * 6] = x + ox; vp[i * 6 + 1] = y; vp[i * 6 + 2] = z + oz;
        vp[i * 6 + 3] = x - ox; vp[i * 6 + 4] = y; vp[i * 6 + 5] = z - oz;
        vuv[i * 4] = 0; vuv[i * 4 + 1] = len * 0.9;
        vuv[i * 4 + 2] = 0.3; vuv[i * 4 + 3] = len * 0.9;
        if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      }
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.BufferAttribute(vp, 3));
      rg.setAttribute('uv', new THREE.BufferAttribute(vuv, 2));
      rg.setIndex(idx);
      rg.computeVertexNormals();
      if (rg.attributes.normal.getY(0) < 0) {
        const ia = rg.index.array;
        for (let q = 0; q < ia.length; q += 3) { const sw = ia[q + 1]; ia[q + 1] = ia[q + 2]; ia[q + 2] = sw; }
        rg.computeVertexNormals();
      }
      const riv = new THREE.Mesh(rg, waterMat);
      riv.renderOrder = 1;
      scene.add(riv);
    }
  }

  // ---- Valley ground ----
  {
    const SEG = LITE ? 110 : 220;
    const geo = new THREE.PlaneGeometry(300, 300, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const uvA = geo.attributes.uv;
    const colArr = new Float32Array(pos.count * 3);
    const mossArr = new Float32Array(pos.count);
    // Acid-dirt palette: near-black volcanic soil, dark grey crags, basalt
    // stream bed. Moss carries all the colour.
    const soilDark = new THREE.Color(0.13, 0.125, 0.12);
    const soilWarm = new THREE.Color(0.2, 0.185, 0.16);
    const grey = new THREE.Color(0.34, 0.34, 0.33);
    const basalt = new THREE.Color(0.06, 0.06, 0.06);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = dsHeight(x, z);
      pos.setY(i, h);
      uvA.setXY(i, x * 0.85, z * 0.85);
      colArr[i * 3] = x; // stash local x for the colour pass
      colArr[i * 3 + 1] = h;
      colArr[i * 3 + 2] = z;
    }
    geo.computeVertexNormals();
    const nor = geo.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const x = colArr[i * 3];
      const h = colArr[i * 3 + 1];
      const z = colArr[i * 3 + 2];
      const d = Math.abs(x - dsMeander(z));
      const slope = 1 - nor.getY(i);
      const bas = Math.exp(-(d * d) / (2 * 7 * 7));
      const altRock = Math.min(1, Math.max(0, (h - 16) / 16));
      let m = Math.max(0, 1 - slope * 2.8) * (0.55 + 0.45 * rockFbm(x * 0.6 + 31, z * 0.6));
      m *= (1 - altRock * 0.85) * (1 - bas * 0.8);
      m = Math.min(1, Math.max(0, (m - 0.22) * 1.9));
      mossArr[i] = m;
      tmpA.copy(soilDark).lerp(soilWarm, rockFbm(x * 0.05 + 11, z * 0.05));
      tmpA.lerp(grey, altRock * 0.85 + slope * 0.3);
      tmpA.lerp(basalt, bas * 0.9 * (1 - m));
      tmpB.copy(mossCool).lerp(mossWarm, rockFbm(x * 0.13, z * 0.13 + 17));
      tmpA.lerp(tmpB, m);
      colArr[i * 3] = tmpA.r;
      colArr[i * 3 + 1] = tmpA.g;
      colArr[i * 3 + 2] = tmpA.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
    geo.setAttribute('moss', new THREE.BufferAttribute(mossArr, 1));
    const ground = new THREE.Mesh(geo, rockMat);
    ground.position.set(VALLEY.x, 0, VALLEY.z);
    ground.receiveShadow = true;
    valleyRoot.add(ground);

    // Strewn boulders, denser near the stream banks.
    const VB = LITE ? 130 : 340;
    // Valley boulders keep their own look (grey rock, moss only on the
    // up-facing side) — separate from the hall's all-moss mounds.
    // Original valley rock geometry (faceted, wind-rounded icosahedron).
    const vbGeo = new THREE.IcosahedronGeometry(1, LITE ? 2 : 4);
    {
      const p = vbGeo.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.set(p.getX(i), p.getY(i), p.getZ(i));
        v.multiplyScalar(1 + (rockFbm(v.x * 1.7 + 5, (v.y + v.z) * 1.7) - 0.5) * 0.52);
        p.setXYZ(i, v.x, v.y * 0.72, v.z);
      }
      vbGeo.computeVertexNormals();
    }
    {
      const p = vbGeo.attributes.position, nr = vbGeo.attributes.normal;
      const vc = new Float32Array(p.count * 3), vm = new Float32Array(p.count);
      for (let i = 0; i < p.count; i++) {
        const up = Math.max(0, nr.getY(i));
        const m = Math.min(1, Math.max(0, (up - 0.45) * 2.1)) * (0.4 + 0.6 * rockFbm(p.getX(i) * 2.4 + 9, p.getZ(i) * 2.4));
        vm[i] = m;
        tmpA.setRGB(0.44, 0.43, 0.43).lerp(tmpB.setRGB(0.8, 0.85, 0.65), m);
        vc[i * 3] = tmpA.r; vc[i * 3 + 1] = tmpA.g; vc[i * 3 + 2] = tmpA.b;
      }
      vbGeo.setAttribute('color', new THREE.BufferAttribute(vc, 3));
      vbGeo.setAttribute('moss', new THREE.BufferAttribute(vm, 1));
    }
    const vbMesh = new THREE.InstancedMesh(vbGeo, rockMat, VB);
    const vbD = new THREE.Object3D();
    const vbSites = [];
    for (let i = 0; i < VB; i++) {
      let x = 0, z = 0;
      for (let tries = 0; tries < 8; tries++) {
        z = (Math.random() - 0.5) * 250;
        const mx = dsMeander(z);
        x = mx + (Math.random() - 0.5) * (Math.random() < 0.55 ? 55 : 160);
        if (Math.abs(x - mx) > 3.5 && Math.hypot(x, z) < 140) break;
      }
      const s = 0.3 + Math.random() * Math.random() * 2.6;
      const by = dsHeight(x, z) + s * 0.22;
      vbD.position.set(VALLEY.x + x, by, VALLEY.z + z);
      vbD.rotation.set(0, Math.random() * Math.PI * 2, 0);
      vbD.scale.set(s * (0.8 + Math.random() * 0.5), s, s * (0.8 + Math.random() * 0.5));
      vbD.updateMatrix();
      vbMesh.setMatrixAt(i, vbD.matrix);
      vbMesh.setColorAt(i, tmpA.setScalar(0.4 + Math.random() * 0.3));
      vbSites.push({ x, z, top: by + s * 0.58, s });
    }
    valleyRoot.add(vbMesh);

    // ---- Procedural scatter: pebbles, stones, slabs, grass ----
    // Rejection-sampled sites weighted by slope, stream distance and the same
    // moss estimate the ground uses, so detail lands where the eye expects it.
    const slopeAt = (x, z) => {
      const e = 0.8;
      const gx = dsHeight(x + e, z) - dsHeight(x - e, z);
      const gz = dsHeight(x, z + e) - dsHeight(x, z - e);
      const g = Math.hypot(gx, gz) / (2 * e);
      return 1 - 1 / Math.sqrt(1 + g * g);
    };
    const mossAt = (x, z, h, sl) => {
      const d = Math.abs(x - dsMeander(z));
      const bas = Math.exp(-(d * d) / 98);
      const altRock = Math.min(1, Math.max(0, (h - 16) / 16));
      let m = Math.max(0, 1 - sl * 2.8) * (0.55 + 0.45 * rockFbm(x * 0.6 + 31, z * 0.6));
      m *= (1 - altRock * 0.85) * (1 - bas * 0.8);
      return Math.min(1, Math.max(0, (m - 0.22) * 1.9));
    };
    const equipRock = (g, mossTop) => {
      const cnt = g.attributes.position.count;
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cnt * 3).fill(0.82), 3));
      const ma = new Float32Array(cnt);
      const p = g.attributes.position;
      for (let i = 0; i < cnt; i++) ma[i] = Math.min(1, Math.max(0, p.getY(i)) * mossTop);
      g.setAttribute('moss', new THREE.BufferAttribute(ma, 1));
      return g;
    };
    const scatter = (geoS, matS, count, weight, pose, bri0 = 0.72, bri1 = 1.22) => {
      const mesh = new THREE.InstancedMesh(geoS, matS, count);
      const d3 = new THREE.Object3D();
      let i = 0;
      let guard = count * 30;
      while (i < count && guard-- > 0) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * 138;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const h = dsHeight(x, z);
        const sl = slopeAt(x, z);
        const d = Math.abs(x - dsMeander(z));
        if (Math.random() >= weight(x, z, h, sl, d)) continue;
        pose(d3, x, z, h, sl, d);
        d3.position.x += VALLEY.x;
        d3.position.z += VALLEY.z;
        d3.updateMatrix();
        mesh.setMatrixAt(i, d3.matrix);
        mesh.setColorAt(i, tmpA.setScalar(bri0 + Math.random() * (bri1 - bri0)));
        i++;
      }
      mesh.count = i;
      valleyRoot.add(mesh);
      return mesh;
    };
    const pebGeo = (() => {
      const g = new THREE.IcosahedronGeometry(1, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const j = 1 + (rockHash(p.getX(i) * 9.1, p.getZ(i) * 7.7) - 0.5) * 0.5;
        p.setXYZ(i, p.getX(i) * j, p.getY(i) * 0.62 * j, p.getZ(i) * j);
      }
      g.computeVertexNormals();
      return equipRock(g, 0.3);
    })();
    // Pebble banks hugging the stream.
    scatter(pebGeo, rockMat, LITE ? 1200 : 5000,
      (x, z, h, sl, d) => (d < 2.6 || d > 30 ? 0 : Math.exp(-((d - 8) * (d - 8)) / 130) * (1 - sl * 2.2)),
      (d3, x, z, h) => {
        const s = 0.05 + Math.random() * Math.random() * 0.18;
        d3.position.set(x, h + s * 0.3, z);
        d3.rotation.set(Math.random() * 0.6, Math.random() * Math.PI * 2, Math.random() * 0.6);
        d3.scale.setScalar(s);
      }, 0.28, 0.58);
    // Loose stones on the mid-slopes (own low-poly geo: bGeo is far too dense
    // to instance by the thousand).
    const stoneGeo = (() => {
      const g = new THREE.IcosahedronGeometry(1, 2);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const j = 1 + (rockFbm(p.getX(i) * 1.7 + 3, p.getZ(i) * 1.7) - 0.5) * 0.7;
        p.setXYZ(i, p.getX(i) * j, p.getY(i) * 0.75 * j, p.getZ(i) * j);
      }
      g.computeVertexNormals();
      return equipRock(g, 0.35);
    })();
    scatter(stoneGeo, rockMat, LITE ? 400 : 1500,
      (x, z, h, sl, d) => (d < 3 ? 0 : Math.min(1, 0.12 + sl * 2.4)),
      (d3, x, z, h) => {
        const s = 0.1 + Math.random() * Math.random() * 0.4;
        d3.position.set(x, h + s * 0.18, z);
        d3.rotation.set(0, Math.random() * Math.PI * 2, 0);
        d3.scale.set(s * (0.8 + Math.random() * 0.5), s, s * (0.8 + Math.random() * 0.5));
      }, 0.32, 0.62);
    // Shattered slab outcrops on the steep upper reaches.
    const slabGeo = equipRock(new THREE.IcosahedronGeometry(1, 1), 0.12);
    scatter(slabGeo, rockMat, LITE ? 60 : 220,
      (x, z, h, sl, d) => (d < 5 ? 0 : Math.min(1, Math.max(0, sl - 0.12) * 2.6 + Math.max(0, h - 14) * 0.02)),
      (d3, x, z, h) => {
        const s = 1.1 + Math.random() * 2.4;
        d3.position.set(x, h + s * 0.1, z);
        d3.rotation.set((Math.random() - 0.5) * 0.7, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.7);
        d3.scale.set(s * 1.6, s * 0.4, s);
      }, 0.38, 0.68);
    // Moss cushions: merged fbm-displaced blobs textured with the moss map —
    // low rounded pads, no triangle blades. Seeded on mossy flats, on convex
    // ground, and on the flatter boulder tops.
    const curvAt = (x, z) => {
      const e = 1.4;
      return dsHeight(x + e, z) + dsHeight(x - e, z) + dsHeight(x, z + e) + dsHeight(x, z - e) - 4 * dsHeight(x, z);
    };
    const tuftGeo = (() => {
      const parts = [];
      for (let b = 0; b < 6; b++) {
        const g = new THREE.IcosahedronGeometry(0.07 + Math.random() * 0.09, LITE ? 0 : 1);
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const j = 1 + (rockFbm(p.getX(i) * 14 + b * 7, p.getZ(i) * 14) - 0.5) * 0.9;
          p.setXYZ(i, p.getX(i) * j, p.getY(i) * 0.34 * j, p.getZ(i) * j);
        }
        g.translate((Math.random() - 0.5) * 0.24, 0, (Math.random() - 0.5) * 0.24);
        parts.push(g);
      }
      const g = mergeGeometries(parts);
      g.computeVertexNormals();
      return g;
    })();
    const tuftMat = new THREE.MeshStandardMaterial({ map: mossTex, color: '#79a44c', roughness: 1 });

    // Every moss knob in one place, driven by the in-game editor (press M).
    const MP = {
      density: 1, size: 1, flat: 1, sink: 0.02, cov: 0, clump: 0.47,
      bri: 1, scanH: 0.24, soil: 1,
    };
    const ML = { flats: null, bumps: null, rocks: null };
    let scanScene = null;
    let scanAsset = null;
    const normalizeGeo = (obj, targetH) => {
      let best = null;
      obj.traverse((o) => {
        if (o.isMesh && (!best || o.geometry.attributes.position.count > best.geometry.attributes.position.count)) best = o;
      });
      if (!best) return null;
      best.updateWorldMatrix(true, false);
      const g = best.geometry.clone().applyMatrix4(best.matrixWorld);
      g.computeBoundingBox();
      const s = targetH / Math.max(0.001, g.boundingBox.max.y - g.boundingBox.min.y);
      g.scale(s, s, s);
      g.computeBoundingBox();
      const bb = g.boundingBox;
      g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
      const mat = best.material;
      mat.side = THREE.DoubleSide;
      if (mat.map) { mat.alphaTest = Math.max(mat.alphaTest, 0.35); mat.transparent = false; }
      else mat.color.set('#4f7a34');
      return { geo: g, mat };
    };
    const applyScan = () => {
      if (!scanAsset) return;
      for (const k of ['flats', 'bumps', 'rocks']) {
        if (!ML[k]) continue;
        ML[k].geometry = scanAsset.geo;
        ML[k].material = scanAsset.mat;
      }
    };
    const covShift = (m) => Math.min(1, Math.max(0, m + MP.cov));
    const buildMossLayer = () => {
      for (const k of ['flats', 'bumps', 'rocks']) {
        if (ML[k]) { valleyRoot.remove(ML[k]); ML[k].dispose(); ML[k] = null; }
      }
      ML.flats = scatter(tuftGeo, tuftMat, Math.round((LITE ? 700 : 2600) * MP.density),
        (x, z, h, sl, d) => {
          if (d < 2.4) return 0;
          const m = covShift(mossAt(x, z, h, sl) * 1.3);
          const clump = rockFbm(x * 0.09, z * 0.09 + 7) > MP.clump ? 1 : 0.06;
          return m * clump;
        },
        (d3, x, z, h) => {
          const s = (0.7 + Math.random() * 0.9) * MP.size;
          d3.position.set(x, h - MP.sink, z);
          d3.rotation.set(0, Math.random() * Math.PI * 2, 0);
          d3.scale.set(s, s * MP.flat, s);
        }, 0.68 * MP.bri, 1.18 * MP.bri);
      ML.bumps = scatter(tuftGeo, tuftMat, Math.round((LITE ? 600 : 2200) * MP.density),
        (x, z, h, sl, d) => {
          if (d < 2.2) return 0;
          const m = covShift(mossAt(x, z, h, sl));
          const cv = Math.min(1, Math.max(0, -curvAt(x, z)) * 1.1);
          return Math.min(1, m * (0.12 + cv * 1.6));
        },
        (d3, x, z, h) => {
          const s = (0.5 + Math.random() * 0.8) * MP.size;
          d3.position.set(x, h - MP.sink, z);
          d3.rotation.set((Math.random() - 0.5) * 0.3, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.3);
          d3.scale.set(s, s * MP.flat, s);
        }, 0.68 * MP.bri, 1.18 * MP.bri);
      const mats = [];
      const rtD = new THREE.Object3D();
      for (const site of vbSites) {
        if (site.s < 0.7) continue;
        const m = covShift(mossAt(site.x, site.z, dsHeight(site.x, site.z), 0.1));
        if (m < 0.08 || Math.random() > 0.75 * MP.density) continue;
        const n = 1 + ((Math.random() * 2) | 0);
        for (let k = 0; k < n; k++) {
          rtD.position.set(
            VALLEY.x + site.x + (Math.random() - 0.5) * site.s * 0.55,
            site.top - site.s * 0.06 - MP.sink,
            VALLEY.z + site.z + (Math.random() - 0.5) * site.s * 0.55);
          rtD.rotation.set((Math.random() - 0.5) * 0.3, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.3);
          const s = (0.35 + Math.random() * 0.5 * Math.min(2, site.s)) * MP.size;
          rtD.scale.set(s, s * MP.flat, s);
          rtD.updateMatrix();
          mats.push(rtD.matrix.clone());
        }
      }
      ML.rocks = new THREE.InstancedMesh(tuftGeo, tuftMat, mats.length);
      mats.forEach((mtx, i) => ML.rocks.setMatrixAt(i, mtx));
      valleyRoot.add(ML.rocks);
      applyScan();
    };
    buildMossLayer();

    // Re-shade the valley ground in place (coverage / soil / moss tints).
    const recolorGround = () => {
      const posA = geo.attributes.position;
      const norA = geo.attributes.normal;
      const colA = geo.attributes.color;
      const mosA = geo.attributes.moss;
      for (let i = 0; i < posA.count; i++) {
        const x = posA.getX(i);
        const h = posA.getY(i);
        const z = posA.getZ(i);
        const d = Math.abs(x - dsMeander(z));
        const slope = 1 - norA.getY(i);
        const bas = Math.exp(-(d * d) / 98);
        const altRock = Math.min(1, Math.max(0, (h - 16) / 16));
        let m = Math.max(0, 1 - slope * 2.8) * (0.55 + 0.45 * rockFbm(x * 0.6 + 31, z * 0.6));
        m *= (1 - altRock * 0.85) * (1 - bas * 0.8);
        m = Math.min(1, Math.max(0, (m - 0.22 + MP.cov) * 1.9));
        mosA.setX(i, m);
        tmpA.copy(soilDark).lerp(soilWarm, rockFbm(x * 0.05 + 11, z * 0.05));
        tmpA.lerp(grey, altRock * 0.85 + slope * 0.3);
        tmpA.lerp(basalt, bas * 0.9 * (1 - m));
        tmpA.multiplyScalar(MP.soil);
        tmpB.copy(mossCool).lerp(mossWarm, rockFbm(x * 0.13, z * 0.13 + 17));
        tmpA.lerp(tmpB, m);
        colA.setXYZ(i, tmpA.r, tmpA.g, tmpA.b);
      }
      colA.needsUpdate = true;
      mosA.needsUpdate = true;
    };

    // Scanned moss: local Megascans exports win (public/assets/megascans/
    // plant_02.glb or plant_01.glb), else the first photoscanned moss/grass
    // model in Polyhaven's catalog, textures rerouted via the API file map.
    import('three/examples/jsm/loaders/GLTFLoader.js').then(({ GLTFLoader }) => {
      const urlMap = {};
      const mgr = new THREE.LoadingManager();
      mgr.setURLModifier((u) => urlMap[u.split('/').pop()] || u);
      const gl = new GLTFLoader(mgr);
      const setScanScene = (obj) => {
        scanScene = obj;
        scanAsset = normalizeGeo(obj, MP.scanH);
        applyScan();
      };
      const loadPolyhaven = () => {
        fetch('https://api.polyhaven.com/assets?type=models')
          .then((r) => (r.ok ? r.json() : Promise.reject()))
          .then((all) => {
            const slugs = Object.keys(all);
            const slug = slugs.find((s) => s.includes('moss')) || slugs.find((s) => s.includes('grass'));
            if (!slug) return;
            return fetch(`https://api.polyhaven.com/files/${slug}`)
              .then((r) => (r.ok ? r.json() : Promise.reject()))
              .then((f) => {
                const entry = f.gltf?.['1k']?.gltf || f.gltf?.['2k']?.gltf;
                if (!entry?.url) return;
                for (const k in entry.include || {}) urlMap[k.split('/').pop()] = entry.include[k].url;
                gl.load(entry.url, (g) => setScanScene(g.scene));
              });
          })
          .catch(() => {});
      };
      gl.load('/assets/megascans/plant_02.glb', (g) => setScanScene(g.scene), undefined, () => {
        gl.load('/assets/megascans/plant_01.glb', (g) => setScanScene(g.scene), undefined, loadPolyhaven);
      });
    });

    // ---- Moss editor (press M) ----
    {
      const panel = document.createElement('div');
      panel.style.cssText = 'position:fixed;top:64px;right:18px;width:270px;max-height:78vh;overflow:auto;background:#10151299;color:#e4e8de;font:11px "DM Sans",sans-serif;padding:14px 16px;border:1px solid #ffffff2a;border-radius:10px;z-index:9;display:none;backdrop-filter:blur(12px)';
      panel.innerHTML = '<div style="letter-spacing:.16em;font-size:10px;margin-bottom:4px">ÉDITEUR MOUSSE</div><div style="opacity:.6;margin-bottom:10px">M pour fermer · Échap libère la souris</div>';
      document.body.appendChild(panel);
      const addSlider = (label, min, max, step, value, oninput, onchange) => {
        const w = document.createElement('div');
        w.style.cssText = 'margin:8px 0 2px';
        const lab = document.createElement('div');
        lab.style.cssText = 'display:flex;justify-content:space-between;letter-spacing:.05em';
        const nameEl = document.createElement('span');
        nameEl.textContent = label;
        const valEl = document.createElement('span');
        valEl.style.opacity = '.7';
        valEl.textContent = (+value).toFixed(2);
        const inp = document.createElement('input');
        inp.type = 'range';
        inp.min = min; inp.max = max; inp.step = step; inp.value = value;
        inp.style.cssText = 'width:100%;accent-color:#9fc56f';
        inp.addEventListener('input', () => {
          valEl.textContent = (+inp.value).toFixed(2);
          if (oninput) oninput(+inp.value);
        });
        if (onchange) inp.addEventListener('change', () => onchange(+inp.value));
        lab.append(nameEl, valEl);
        w.append(lab, inp);
        panel.append(w);
      };
      const addColor = (label, value, on) => {
        const w = document.createElement('div');
        w.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin:8px 0 2px;letter-spacing:.05em';
        const nameEl = document.createElement('span');
        nameEl.textContent = label;
        const inp = document.createElement('input');
        inp.type = 'color';
        inp.value = value;
        inp.style.cssText = 'width:46px;height:24px;border:none;background:none;cursor:pointer';
        inp.addEventListener('input', () => on(inp.value));
        w.append(nameEl, inp);
        panel.append(w);
      };
      const addButton = (label, on) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = 'margin:10px 8px 0 0;background:#f5f0e916;border:1px solid #ffffff44;color:#e4e8de;padding:7px 11px;border-radius:5px;cursor:pointer;font:11px "DM Sans",sans-serif';
        b.addEventListener('click', on);
        panel.append(b);
      };
      const rebuild = () => buildMossLayer();
      addSlider('Densité', 0, 3, 0.05, MP.density, null, (v) => { MP.density = v; rebuild(); });
      addSlider('Taille', 0.3, 2.5, 0.05, MP.size, null, (v) => { MP.size = v; rebuild(); });
      addSlider('Aplatissement', 0.15, 1.5, 0.05, MP.flat, null, (v) => { MP.flat = v; rebuild(); });
      addSlider('Enfoncement', 0, 0.2, 0.005, MP.sink, null, (v) => { MP.sink = v; rebuild(); });
      addSlider('Couverture', -0.3, 0.4, 0.01, MP.cov, null, (v) => { MP.cov = v; rebuild(); recolorGround(); });
      addSlider('Groupement', 0.3, 0.75, 0.01, MP.clump, null, (v) => { MP.clump = v; rebuild(); });
      addSlider('Luminosité touffes', 0.3, 1.8, 0.05, MP.bri, null, (v) => { MP.bri = v; rebuild(); });
      addSlider('Taille du scan', 0.08, 0.6, 0.01, MP.scanH, null, (v) => {
        MP.scanH = v;
        if (scanScene) { scanAsset = normalizeGeo(scanScene, v); applyScan(); }
      });
      addSlider('Échelle texture mousse', 0.2, 6, 0.05, mossScaleU.value, (v) => { mossScaleU.value = v; });
      addSlider('Relief sol (POM)', 0, 0.6, 0.01, dispAmtU.value, (v) => { dispAmtU.value = v; });
      addSlider('Luminosité sol', 0.3, 2, 0.05, MP.soil, null, (v) => { MP.soil = v; recolorGround(); });
      addColor('Teinte touffes', '#79a44c', (v) => tuftMat.color.set(v));
      addColor('Mousse froide', '#75ad61', (v) => { mossCool.set(v); recolorGround(); });
      addColor('Mousse chaude', '#c7f275', (v) => { mossWarm.set(v); recolorGround(); });
      addButton('Capturer PNG', () => { window.__ingaShot = true; });
      addButton('Copier réglages', () => {
        navigator.clipboard?.writeText(JSON.stringify({
          ...MP, mossScale: mossScaleU.value, pom: dispAmtU.value,
          tint: '#' + tuftMat.color.getHexString(),
          cool: '#' + mossCool.getHexString(),
          warm: '#' + mossWarm.getHexString(),
        }, null, 1));
      });
      window.addEventListener('keydown', (e) => {
        if (e.code !== 'KeyM' || e.target instanceof HTMLInputElement) return;
        const open = panel.style.display === 'none';
        panel.style.display = open ? 'block' : 'none';
        if (open) document.exitPointerLock?.();
      });
    }

    // The stream: a monotonically descending ribbon along the meander,
    // widening into the foreground pool.
    const sPts = [];
    let prevY = Infinity;
    for (let z = -148; z <= 126; z += 2.5) {
      const mx = dsMeander(z);
      // Water sits just above the bed everywhere. (A strict downhill clamp
      // used to bury it under the flat lower valley, leaving the bed dry.)
      // Fuller stream: the water stands ~0.8 m over the bed, filling the
      // carved channel; the ribbon is wider than the water so the banks
      // (terrain cutting through it) draw a natural shoreline.
      const y = dsHeight(mx, z) + 0.8;
      prevY = y;
      const w = 2 + 1.9 * (2.2 + rockFbm(5, z * 0.05) * 2.8 + Math.max(0, z - 55) * 0.09);
      sPts.push([mx, z, y, w]);
    }
    const n = sPts.length;
    const vp = new Float32Array(n * 6);
    const vuv = new Float32Array(n * 4);
    const idx = [];
    let len = 0;
    for (let i = 0; i < n; i++) {
      const [x, z, y, w] = sPts[i];
      const nxt = sPts[Math.min(n - 1, i + 1)];
      const prv = sPts[Math.max(0, i - 1)];
      let tx = nxt[0] - prv[0], tz = nxt[1] - prv[1];
      const tm = Math.hypot(tx, tz) || 1;
      const ox = (-tz / tm) * w / 2, oz = (tx / tm) * w / 2;
      if (i) len += Math.hypot(x - prv[0], z - prv[1]);
      vp[i * 6] = VALLEY.x + x + ox; vp[i * 6 + 1] = y; vp[i * 6 + 2] = VALLEY.z + z + oz;
      vp[i * 6 + 3] = VALLEY.x + x - ox; vp[i * 6 + 4] = y; vp[i * 6 + 5] = VALLEY.z + z - oz;
      vuv[i * 4] = 0; vuv[i * 4 + 1] = len * 0.22;
      vuv[i * 4 + 2] = 1.4; vuv[i * 4 + 3] = len * 0.22;
      if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(vp, 3));
    sg.setAttribute('uv', new THREE.BufferAttribute(vuv, 2));
    sg.setIndex(idx);
    sg.computeVertexNormals();
    if (sg.attributes.normal.getY(0) < 0) {
      const ia = sg.index.array;
      for (let q = 0; q < ia.length; q += 3) { const sw = ia[q + 1]; ia[q + 1] = ia[q + 2]; ia[q + 2] = sw; }
      sg.computeVertexNormals();
    }
    // Smooth the surface along the flow so it never steps with the bed noise.
    {
      const p = sg.attributes.position;
      const ys = [];
      for (let i = 0; i < n; i++) ys.push(p.getY(i * 2));
      for (let i = 0; i < n; i++) {
        let sum = 0, cnt = 0;
        for (let k = -3; k <= 3; k++) { const j = i + k; if (j >= 0 && j < n) { sum += ys[j]; cnt++; } }
        const y = Math.max(sum / cnt, sPts[i][2] - 0.15);
        p.setY(i * 2, y);
        p.setY(i * 2 + 1, y);
      }
      p.needsUpdate = true;
      sg.computeVertexNormals();
    }
    // Living stream: dark clear water, sky reflections, sharp sun glints, and
    // a normal map scrolling downstream (animated in animate()).
    streamNormalTex = waterNormal.clone();
    streamNormalTex.wrapS = streamNormalTex.wrapT = THREE.RepeatWrapping;
    streamNormalTex.repeat.set(1.2, 0.9);
    streamNormalTex.needsUpdate = true;
    const streamMat = new THREE.MeshPhysicalMaterial({
      color: '#33464a',
      roughness: 0.05,
      metalness: 0,
      transparent: true,
      opacity: 0.86,
      envMap: softWaterEnv(),
      envMapIntensity: 1.5,
      normalMap: streamNormalTex,
      normalScale: new THREE.Vector2(0.55, 0.55),
      specularIntensity: 1,
      depthWrite: false,
    });
    const stream = new THREE.Mesh(sg, streamMat);
    stream.renderOrder = 1;
    valleyRoot.add(stream);
  }
}

// Ceiling: brutalist, orthographic sun holes — axis-aligned slots, a strict
// coffer grid and one large oculus, all cut into the slab with hard edges.
// Straight 90° reveals; a slimmer slab (22 cm) so the low dawn sun still
// gets through the slots.
const ceilT = 0.22;
const ceilZ0 = sideZ0;
const ceilZ1 = sideZ1;
const CH_NX = LITE ? 120 : 240;
const CH_NZ = LITE ? 120 : 240;
// Parallel bars of sky, all running east-west (parallel to the end walls),
// with a little randomness in width, spacing and how far they reach.
// Parallel bars of sky, all running east-west (parallel to the end walls),
// with a little randomness in width, spacing and how far they reach — the
// original INGA ceiling, stretched to the widened hall.
const sunBars = [];
{
  let zBar = -2.2;
  while (zBar < 16.6) {
    const w = 0.5 + Math.random() * 0.5;
    // Kept 3.4 m+ off the side walls so the walls stay in shadow.
    const x0 = -(HALL.x - 3.4) + Math.random() * 1.6;
    const x1 = HALL.x - 3.4 - Math.random() * 1.6;
    sunBars.push([x0, zBar, x1, zBar + w]);
    zBar += w + 1.1 + Math.random() * 1.4;
  }
}
const chField = (() => {
  const f = new Float32Array(CH_NX * CH_NZ).fill(1);
  const holes = sunBars;
  const cellW = (outerX * 2) / (CH_NX - 1);
  const cellD = (ceilZ1 - ceilZ0) / (CH_NZ - 1);
  for (let j = 0; j < CH_NZ; j++) {
    for (let i = 0; i < CH_NX; i++) {
      const x = -outerX + i * cellW;
      const z = ceilZ0 + j * cellD;
      for (const [x0, z0, x1, z1] of holes) {
        if (x >= x0 && x <= x1 && z >= z0 && z <= z1) {
          f[j * CH_NX + i] = -1;
          break;
        }
      }
    }
  }
  return f;
})();

// The Cahn-Hilliard field lives on as a small interactive window beside the
// entrance: a backlit phase pattern visitors can disturb.
const WIN_NX = 120;
const WIN_NZ = 84;
const CH = (() => {
  const n = WIN_NX * WIN_NZ;
  const c = new Float32Array(n);
  const mu = new Float32Array(n);
  const dtCH = 0.02;
  const gammaCH = 1.0;
  const lap = (a, i, j) => {
    const ip = (i + 1) % WIN_NX;
    const im = (i + WIN_NX - 1) % WIN_NX;
    const jp = (j + 1) % WIN_NZ;
    const jm = (j + WIN_NZ - 1) % WIN_NZ;
    return a[j * WIN_NX + ip] + a[j * WIN_NX + im] + a[jp * WIN_NX + i] + a[jm * WIN_NX + i] - 4 * a[j * WIN_NX + i];
  };
  function init() {
    for (let i = 0; i < n; i++) c[i] = (Math.random() - 0.5) * 1.2;
  }
  function step(count) {
    for (let s = 0; s < count; s++) {
      for (let j = 0; j < WIN_NZ; j++) {
        for (let i = 0; i < WIN_NX; i++) {
          const id = j * WIN_NX + i;
          const v = c[id];
          mu[id] = v * v * v - v - gammaCH * lap(c, i, j);
        }
      }
      for (let j = 0; j < WIN_NZ; j++) {
        for (let i = 0; i < WIN_NX; i++) {
          c[j * WIN_NX + i] += dtCH * lap(mu, i, j);
        }
      }
      // Restore the balanced mean each step: material displaced by strokes is
      // redistributed, so any gap they carve always fills back in.
      let mean = 0;
      for (let i = 0; i < n; i++) mean += c[i];
      mean /= n;
      for (let i = 0; i < n; i++) c[i] -= mean;
    }
  }
  // Disturbance as strokes, not noise: slow Gaussian blobs wander across the
  // field dragging the mixture toward one phase; the equation heals the trail
  // behind them, so domains visibly reorganise instead of shaking.
  const strokes = [];
  function spawnStroke(boost) {
    const ang = Math.random() * Math.PI * 2;
    const speed = 0.5 + Math.random() * 0.7;
    strokes.push({
      x: Math.random() * WIN_NX,
      z: Math.random() * WIN_NZ,
      dx: Math.cos(ang) * speed,
      dz: Math.sin(ang) * speed,
      r: 3 + Math.random() * 5,
      amp: (Math.random() < 0.5 ? 1 : -1) * (0.08 + Math.random() * 0.08) * (boost || 1),
      life: 90 + Math.random() * 150,
    });
  }
  function poke() {
    spawnStroke(2.2);
    spawnStroke(2.2);
  }
  function disturb() {
    if (strokes.length < 3 && Math.random() < 0.02) spawnStroke(1);
    for (let s = strokes.length - 1; s >= 0; s--) {
      const st = strokes[s];
      st.x += st.dx;
      st.z += st.dz;
      st.life--;
      if (st.life <= 0 || st.x < -st.r || st.x > WIN_NX + st.r || st.z < -st.r || st.z > WIN_NZ + st.r) {
        strokes.splice(s, 1);
        continue;
      }
      const i0 = Math.max(0, Math.floor(st.x - st.r * 2));
      const i1 = Math.min(WIN_NX - 1, Math.ceil(st.x + st.r * 2));
      const j0 = Math.max(0, Math.floor(st.z - st.r * 2));
      const j1 = Math.min(WIN_NZ - 1, Math.ceil(st.z + st.r * 2));
      const inv2r2 = 1 / (2 * st.r * st.r);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const dx = i - st.x;
          const dz = j - st.z;
          const id = j * WIN_NX + i;
          const v = c[id] + st.amp * Math.exp(-(dx * dx + dz * dz) * inv2r2);
          c[id] = Math.min(1.05, Math.max(-1.05, v));
        }
      }
    }
  }
  const disp = new Float32Array(n);
  function display() {
    disp.set(c);
    for (let j = 0; j < WIN_NZ; j++) {
      for (let i = 0; i < WIN_NX; i++) {
        const m = Math.min(i, WIN_NX - 1 - i, j, WIN_NZ - 1 - j);
        if (m < 3) {
          const w = m / 3;
          const id = j * WIN_NX + i;
          disp[id] = disp[id] * w + (1 - w);
        }
      }
    }
    return disp;
  }
  init();
  step(500);
  return { init, step, disturb, poke, display };
})();

// Hole mask (1 = opening) shared by the fog god rays and the mobile shafts.
const holeMaskData = new Uint8Array(CH_NX * CH_NZ);
const holeTex = new THREE.DataTexture(holeMaskData, CH_NX, CH_NZ, THREE.RedFormat, THREE.UnsignedByteType);
holeTex.minFilter = THREE.LinearFilter;
holeTex.magFilter = THREE.LinearFilter;
function updateHoleMask(f) {
  for (let i = 0; i < holeMaskData.length; i++) {
    holeMaskData[i] = Math.round(255 * Math.min(1, Math.max(0, 0.5 - f[i] * 2.5)));
  }
  holeTex.needsUpdate = true;
}
updateHoleMask(chField);
if (fogPass) {
  fogPass.uniforms.tHoles.value = holeTex;
  fogPass.uniforms.uCeilRect.value.set(-outerX, ceilZ0, 1 / (outerX * 2), 1 / (ceilZ1 - ceilZ0));
  fogPass.uniforms.uRoom.value.set(HALL.x + 0.3, HALL.doorZ - 0.3, HALL.north + 0.3, HALL.wallTop + 0.05);
}

// Extrude the phase boundary with per-cell marching squares: bottom, top and
// skirt walls between the interpolated contour points. Catmull-Rom upsampling
// of the field before contouring is what gives the smooth high-res edges —
// much cheaper than running the sim itself on a finer grid.
const ceilingConcrete = hallConcrete.clone();
ceilingConcrete.side = THREE.DoubleSide;
const ceilMesh = new THREE.Mesh(new THREE.BufferGeometry(), ceilingConcrete);
ceilMesh.castShadow = true;
ceilMesh.receiveShadow = true;
scene.add(ceilMesh);
function rebuildCeiling(g) {
  const nx = CH_NX;
  const nz = CH_NZ;
  const cellW = (outerX * 2) / (nx - 1);
  const cellD = (ceilZ1 - ceilZ0) / (nz - 1);
  const yBot = HALL.wallTop;
  const yTop = HALL.wallTop + ceilT;
  const pos = [];
  const uvArr = [];
  const pushTri = (a, b, c3, y, flip) => {
    for (const p of flip ? [a, c3, b] : [a, b, c3]) {
      pos.push(p[0], y, p[1]);
      uvArr.push(p[0] * TEX_DENSITY, p[1] * TEX_DENSITY);
    }
  };
  const pushSkirt = (p1, p2) => {
    const v4 = [[p1[0], yTop, p1[1]], [p2[0], yTop, p2[1]], [p2[0], yBot, p2[1]], [p1[0], yBot, p1[1]]];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      pos.push(v4[k][0], v4[k][1], v4[k][2]);
      uvArr.push((v4[k][0] + v4[k][2]) * TEX_DENSITY, v4[k][1] * TEX_DENSITY);
    }
  };
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const x0 = -outerX + i * cellW;
      const x1 = x0 + cellW;
      const z0 = ceilZ0 + j * cellD;
      const z1 = z0 + cellD;
      const corners = [
        [x0, z0, g[j * nx + i]],
        [x1, z0, g[j * nx + i + 1]],
        [x1, z1, g[(j + 1) * nx + i + 1]],
        [x0, z1, g[(j + 1) * nx + i]],
      ];
      const poly = [];
      const isCross = [];
      for (let k = 0; k < 4; k++) {
        const [ax, az, av] = corners[k];
        const [bx, bz, bv] = corners[(k + 1) % 4];
        if (av > 0) {
          poly.push([ax, az]);
          isCross.push(false);
        }
        if ((av > 0) !== (bv > 0)) {
          const tt = (0 - av) / (bv - av);
          poly.push([ax + (bx - ax) * tt, az + (bz - az) * tt]);
          isCross.push(true);
        }
      }
      if (poly.length < 3) continue;
      for (let k = 1; k < poly.length - 1; k++) {
        pushTri(poly[0], poly[k], poly[k + 1], yBot, false);
        pushTri(poly[0], poly[k], poly[k + 1], yTop, true);
      }
      for (let k = 0; k < poly.length; k++) {
        const k2 = (k + 1) % poly.length;
        if (isCross[k] && isCross[k2]) pushSkirt(poly[k], poly[k2]);
      }
    }
  }
  const ceilGeo = new THREE.BufferGeometry();
  ceilGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  ceilGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
  ceilGeo.computeVertexNormals();
  ceilMesh.geometry.dispose();
  ceilMesh.geometry = ceilGeo;
}
rebuildCeiling(chField);

// ---- Plafond : lianes et toit végétal autour des ouvertures ----
// Vines hang from the edges of each opening: [x0, x1, z0, z1, y] segments.
const ceilAnchors = [];
for (const [x0, z0, x1, z1] of sunBars) {
  const y = HALL.wallTop;
  ceilAnchors.push([x0, x1, z0, z0, y], [x0, x1, z1, z1, y], [x0, x0, z0, z1, y], [x1, x1, z0, z1, y]);
}

// Interactive phase window beside the entrance: the Cahn-Hilliard field reads
// as light through a perforated pane; E injects strokes when standing close.
const winCanvas = document.createElement('canvas');
winCanvas.width = WIN_NX;
winCanvas.height = WIN_NZ;
const winCtx = winCanvas.getContext('2d');
const winImg = winCtx.createImageData(WIN_NX, WIN_NZ);
const winTex = new THREE.CanvasTexture(winCanvas);
winTex.colorSpace = THREE.SRGBColorSpace;
function drawWindow() {
  const f = CH.display();
  const d = winImg.data;
  for (let i = 0; i < f.length; i++) {
    const open = Math.min(1, Math.max(0, 0.5 - f[i] * 1.6));
    d[i * 4] = 34 + open * 221;
    d[i * 4 + 1] = 33 + open * 203;
    d[i * 4 + 2] = 30 + open * 150;
    d[i * 4 + 3] = 255;
  }
  winCtx.putImageData(winImg, 0, 0);
  winTex.needsUpdate = true;
}
drawWindow();
const winMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(1.15, 0.8),
  new THREE.MeshBasicMaterial({ map: winTex })
);
winMesh.position.set(3.55, 1.52, HALL.doorZ + 0.012);
scene.add(winMesh);
{
  const winFrameMat = new THREE.MeshStandardMaterial({ color: '#3a3833', roughness: 0.9 });
  box(1.31, 0.07, 0.1, 3.55, 1.96, HALL.doorZ + 0.01, winFrameMat, false);
  box(1.31, 0.07, 0.1, 3.55, 1.08, HALL.doorZ + 0.01, winFrameMat, false);
  box(0.07, 0.82, 0.1, 2.94, 1.52, HALL.doorZ + 0.01, winFrameMat, false);
  box(0.07, 0.82, 0.1, 4.16, 1.52, HALL.doorZ + 0.01, winFrameMat, false);
}

// Volumetric-looking light blades under each ceiling slot (additive gradient planes).
function shaftTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(255,244,214,0.85)');
  g.addColorStop(0.7, 'rgba(255,244,214,0.22)');
  g.addColorStop(1, 'rgba(255,244,214,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 256);
  const e = x.createLinearGradient(0, 0, 64, 0);
  e.addColorStop(0, 'rgba(0,0,0,0)');
  e.addColorStop(0.2, 'rgba(0,0,0,1)');
  e.addColorStop(0.8, 'rgba(0,0,0,1)');
  e.addColorStop(1, 'rgba(0,0,0,0)');
  x.globalCompositeOperation = 'destination-in';
  x.fillStyle = e;
  x.fillRect(0, 0, 64, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// Mobile fallback only: on desktop the raymarched fog pass renders real god rays.
// Per-shaft opacity fades with distance so the additive blades never stack up.
const shafts = [];
if (LITE) {
  const shaftTex = shaftTexture();
  const shaftLen = HALL.wallTop / SUN_DIR.y;
  const shaftGeo = new THREE.PlaneGeometry(2.4, shaftLen);
  const chCellW = (outerX * 2) / (CH_NX - 1);
  const chCellD = (ceilZ1 - ceilZ0) / (CH_NZ - 1);
  const BLK = 14;
  for (let bj = 0; bj < CH_NZ; bj += BLK) {
    for (let bi = 0; bi < CH_NX; bi += BLK) {
      let best = 1, bx = 0, bz = 0;
      for (let j = bj; j < Math.min(bj + BLK, CH_NZ); j++) {
        for (let i = bi; i < Math.min(bi + BLK, CH_NX); i++) {
          const v = chField[j * CH_NX + i];
          if (v < best) { best = v; bx = i; bz = j; }
        }
      }
      if (best > -0.5) continue;
      const wx = -outerX + bx * chCellW;
      const wz = ceilZ0 + bz * chCellD;
      if (Math.abs(wx) > HALL.x - 0.5 || wz < HALL.doorZ + 0.5 || wz > HALL.north - 0.5) continue;
      const mat = new THREE.MeshBasicMaterial({
        map: shaftTex,
        transparent: true,
        opacity: 0.11,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });
      const m = new THREE.Mesh(shaftGeo, mat);
      // Centred halfway down the slanted beam; local +y points at the sun.
      const half = HALL.wallTop / 2;
      m.position.set(wx - SUN_SLOPE_X * half, half, wz - SUN_SLOPE_Z * half);
      m.rotation.x = Math.atan2(SUN_DIR.z, SUN_DIR.y);
      m.rotation.z = -Math.asin(SUN_DIR.x);
      m.renderOrder = 2;
      scene.add(m);
      shafts.push(m);
    }
  }
}

// Air flow: a ~1 m³ pressure grid over the whole room, seeded with random
// noise and slowly relaxing toward a drifting noise target. Air moves from
// high to low pressure; walking injects pressure at the player's cell, so
// the wake of your own passage stirs the dust.
const AIR = (() => {
  const nx = 18, ny = 8, nz = 24;
  const x0 = -HALL.x, y0 = 0, z0 = HALL.doorZ;
  const sx = (HALL.x * 2) / nx, sy = HALL.wallTop / ny, sz = (HALL.north - HALL.doorZ) / nz;
  const p = new Float32Array(nx * ny * nz);
  for (let i = 0; i < p.length; i++) p[i] = Math.random() - 0.5;
  function sampleP(x, y, z) {
    let gx = (x - x0) / sx - 0.5, gy = (y - y0) / sy - 0.5, gz = (z - z0) / sz - 0.5;
    gx = Math.min(nx - 1.001, Math.max(0, gx));
    gy = Math.min(ny - 1.001, Math.max(0, gy));
    gz = Math.min(nz - 1.001, Math.max(0, gz));
    const i0 = gx | 0, j0 = gy | 0, k0 = gz | 0;
    const fx = gx - i0, fy = gy - j0, fz = gz - k0;
    let v = 0;
    for (let dk = 0; dk < 2; dk++)
      for (let dj = 0; dj < 2; dj++)
        for (let di = 0; di < 2; di++)
          v += p[((k0 + dk) * ny + j0 + dj) * nx + i0 + di] *
            (di ? fx : 1 - fx) * (dj ? fy : 1 - fy) * (dk ? fz : 1 - fz);
    return v;
  }
  const FLOW_E = 0.7, FLOW_GAIN = 0.3;
  function flow(x, y, z, out) {
    out.x = (sampleP(x - FLOW_E, y, z) - sampleP(x + FLOW_E, y, z)) * FLOW_GAIN;
    out.y = (sampleP(x, y - FLOW_E, z) - sampleP(x, y + FLOW_E, z)) * FLOW_GAIN;
    out.z = (sampleP(x, y, z - FLOW_E) - sampleP(x, y, z + FLOW_E)) * FLOW_GAIN;
  }
  function update(dt, t, px, py, pz, speed) {
    const k = Math.min(1, dt * 0.12);
    let q = 0;
    for (let kz = 0; kz < nz; kz++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++, q++) {
          const n = Math.sin(i * 1.9 + kz * 0.7 + t * 0.13) * Math.cos(j * 1.5 - t * 0.11) * Math.sin(kz * 2.1 + i * 0.4 + t * 0.17) * 0.8;
          p[q] += (n - p[q]) * k;
        }
    if (speed > 0.2) {
      const ci = Math.min(nx - 1, Math.max(0, Math.round((px - x0) / sx - 0.5)));
      const cj = Math.min(ny - 1, Math.max(0, Math.round((py - y0) / sy - 0.5)));
      const ck = Math.min(nz - 1, Math.max(0, Math.round((pz - z0) / sz - 0.5)));
      const c = (ck * ny + cj) * nx + ci;
      p[c] = Math.min(2.5, p[c] + speed * dt * 1.6);
    }
  }
  return { flow, update };
})();

// Dust motes around the sun shafts. Each mote is simulated in the shaft's
// ceiling-plane frame then projected down the sun's slant, so the visible
// swarm traces the exact cone of direct light. Motes drift on the AIR flow
// field (roaming a dark margin either side of their sky bar) and only light
// up while inside the beam — appearing as they enter, vanishing as they
// leave.
const DUST_MARGIN = 0.8;
const DUST_COUNT = LITE ? 500 : 1500;
// With a low sun the beams slant far: a mote low in its beam would be
// projected behind the walls. Each mote's height is floored so that its
// projected position stays inside the hall.
const DUST_BOUNDS = { zMin: HALL.doorZ + 0.4, zMax: HALL.north - 0.3, xMax: HALL.x - 0.3 };
function dustMinY(lx, lz) {
  let maxDrop = HALL.wallTop - 0.45;
  if (SUN_SLOPE_Z > 0) maxDrop = Math.min(maxDrop, (lz - DUST_BOUNDS.zMin) / SUN_SLOPE_Z);
  else if (SUN_SLOPE_Z < 0) maxDrop = Math.min(maxDrop, (DUST_BOUNDS.zMax - lz) / -SUN_SLOPE_Z);
  if (SUN_SLOPE_X < 0) maxDrop = Math.min(maxDrop, (DUST_BOUNDS.xMax - lx) / -SUN_SLOPE_X);
  else if (SUN_SLOPE_X > 0) maxDrop = Math.min(maxDrop, (lx + DUST_BOUNDS.xMax) / SUN_SLOPE_X);
  return Math.max(0.25, HALL.wallTop - Math.max(0, maxDrop));
}
const dustPos = new Float32Array(DUST_COUNT * 3);
const dustLoc = new Float32Array(DUST_COUNT * 3);
const dustVel = new Float32Array(DUST_COUNT * 3);
const dustBar = new Uint8Array(DUST_COUNT);
const dustSeed = new Float32Array(DUST_COUNT);
for (let i = 0; i < DUST_COUNT; i++) {
  // Pick a bar and spot, favouring places with a long visible beam.
  let b = 0, lx = 0, lz = 0, yMin = 0;
  for (let tries = 0; tries < 12; tries++) {
    b = (Math.random() * sunBars.length) | 0;
    const [bx0, bz0, bx1, bz1] = sunBars[b];
    lx = bx0 + Math.random() * (bx1 - bx0);
    lz = bz0 - DUST_MARGIN + Math.random() * (bz1 - bz0 + DUST_MARGIN * 2);
    yMin = dustMinY(lx, lz);
    if (Math.random() < (HALL.wallTop - 0.2 - yMin) / HALL.wallTop) break;
  }
  dustBar[i] = b;
  dustLoc[i * 3] = lx;
  dustLoc[i * 3 + 1] = yMin + Math.random() * Math.max(0.05, HALL.wallTop - 0.2 - yMin);
  dustLoc[i * 3 + 2] = lz;
  dustVel[i * 3] = (Math.random() - 0.5) * 0.04;
  dustVel[i * 3 + 1] = (Math.random() - 0.5) * 0.03;
  dustVel[i * 3 + 2] = (Math.random() - 0.5) * 0.04;
  dustSeed[i] = Math.random() * Math.PI * 2;
  const drop = HALL.wallTop - dustLoc[i * 3 + 1];
  dustPos[i * 3] = dustLoc[i * 3] - SUN_SLOPE_X * drop;
  dustPos[i * 3 + 1] = dustLoc[i * 3 + 1];
  dustPos[i * 3 + 2] = dustLoc[i * 3 + 2] - SUN_SLOPE_Z * drop;
}
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dustFade = new Float32Array(DUST_COUNT);
dustGeo.setAttribute('aFade', new THREE.BufferAttribute(dustFade, 1));
const airV = { x: 0, y: 0, z: 0 };
const _prevCam = new THREE.Vector3();
const dustMat = new THREE.PointsMaterial({
  color: '#fff6e2',
  size: 0.026,
  transparent: true,
  opacity: 0.55,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  sizeAttenuation: true,
});
// Only render motes near the camera: fade to nothing past ~12 m.
dustMat.onBeforeCompile = (sh) => {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aFade;\nvarying float vDustFade;')
    .replace('#include <project_vertex>', '#include <project_vertex>\nvDustFade = aFade * (1.0 - smoothstep(8.0, 12.0, length(mvPosition.xyz)));');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vDustFade;')
    .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse, opacity * vDustFade );');
};
dustMat.customProgramCacheKey = () => 'inga-dust-fade';
const dust = new THREE.Points(dustGeo, dustMat);
dust.renderOrder = 3;
scene.add(dust);

// Dust in the sunlight pouring through the glass bay. Motes float in the
// front half of the hall and drift slowly; all motion runs on the GPU. Each
// one traces back toward the sun: it only lights up if that ray leaves
// through the glass (under the canopy), so the swarm draws the real beam.
const BAY_DUST_COUNT = LITE ? 220 : 550;
const bayDust = (() => {
  const pos = new Float32Array(BAY_DUST_COUNT * 3);
  const seed = new Float32Array(BAY_DUST_COUNT);
  for (let i = 0; i < BAY_DUST_COUNT; i++) {
    pos[i * 3] = (Math.random() * 2 - 1) * 10;
    pos[i * 3 + 1] = 0.15 + Math.pow(Math.random(), 1.4) * 5.2;
    pos[i * 3 + 2] = HALL.north - 0.3 - Math.random() * 12;
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uScale: { value: 400 },
      uSun: { value: SUN_DIR.clone() },
      uGlass: { value: new THREE.Vector4(HALL.north + 0.2, HALL.wallTop - TERRACE.edgeBeam, HALL.x - 0.1, TERRACE_ROOF_EDGE_Z) },
      uColor: { value: new THREE.Color('#fff0d6') },
    },
    vertexShader: `
      attribute float aSeed;
      uniform float uTime, uScale;
      uniform vec3 uSun;
      uniform vec4 uGlass; // glass z, glass top, half width, canopy edge z
      varying float vA;
      void main() {
        float s = aSeed * 6.2831;
        vec3 p = position;
        // Slow, lazy drift: layered sines, a faint overall sink, wrapped.
        p.x += sin(uTime * 0.071 + s * 3.0) * 0.45 + sin(uTime * 0.023 + s * 7.0) * 0.8;
        p.z += cos(uTime * 0.063 + s * 5.0) * 0.45 + sin(uTime * 0.019 + s * 2.0) * 0.6;
        p.y += sin(uTime * 0.052 + s * 4.0) * 0.3;
        p.y = 0.15 + mod(p.y - 0.15 - uTime * 0.012 * (0.4 + aSeed), 5.3);
        // Trace toward the sun: lit only if the ray exits through the glass
        // below the canopy.
        float k = (uGlass.x - p.z) / uSun.z;
        vec3 g = p + uSun * k;
        float yc = g.y + (uGlass.w - uGlass.x) * uSun.y / uSun.z;
        float lit = smoothstep(0.0, 0.25, g.y) * (1.0 - smoothstep(uGlass.y - 0.3, uGlass.y, yc))
                  * (1.0 - smoothstep(uGlass.z - 0.4, uGlass.z, abs(g.x)));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float dist = -mv.z;
        float twinkle = 0.55 + 0.45 * sin(uTime * (0.8 + aSeed * 1.6) + s * 13.0);
        vA = lit * twinkle * (1.0 - smoothstep(9.0, 15.0, dist)) * smoothstep(0.25, 0.8, dist);
        gl_PointSize = max(1.5, (0.04 + aSeed * 0.035) * uScale / max(dist, 0.1));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.05, d) * vA * 0.7;
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 3;
  scene.add(pts);
  return pts;
})();

// Canal water: clear when you look down into it, reflective at grazing
// angles (Fresnel), deep-tinted, softly rippling — and every fish (and
// your own feet) leaves rings of small waves on the surface.
const RIPPLE_N = 38;
const rippleData = Array.from({ length: RIPPLE_N }, () => new THREE.Vector4(0, 0, 0, 0));
const canalNormal = waterNormal.clone();
canalNormal.wrapS = canalNormal.wrapT = THREE.RepeatWrapping;
canalNormal.repeat.set(1, 1);
canalNormal.needsUpdate = true;
const canalWaterMat = new THREE.MeshPhysicalMaterial({
  color: '#2b3a37',
  roughness: 0.03,
  metalness: 0,
  transparent: true,
  envMap: softWaterEnv(),
  envMapIntensity: 0.6,
  specularColor: new THREE.Color('#fff1dc'),
  normalMap: canalNormal,
  normalScale: new THREE.Vector2(0.08, 0.08),
  depthWrite: false,
  side: THREE.DoubleSide,
});
canalWaterMat.onBeforeCompile = (sh) => {
  sh.uniforms.uRip = { value: rippleData };
  sh.uniforms.uWTime = causticUniforms.uCausticTime;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWWP;')
    .replace('#include <project_vertex>', 'vWWP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n#include <project_vertex>');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>\nvarying vec3 vWWP;\nuniform vec4 uRip[${RIPPLE_N}];\nuniform float uWTime;`)
    .replace('#include <normal_fragment_maps>', [
      '#include <normal_fragment_maps>',
      '{',
      '  vec2 g = vec2( 0.0 );',
      // Flow direction of the canal at this point (counter-clockwise seen
      // from above, toward the hall in the threshold, west in the middle).
      `  vec2 fd = ( vWWP.z < ${(HALL.doorZ + 0.05).toFixed(2)} ) ? vec2( 0.0, 1.0 ) : ( vWWP.z > ${CROSS.z0.toFixed(2)} && vWWP.z < ${CROSS.z1.toFixed(2)} && abs( vWWP.x ) < ${CHANNEL.ix1.toFixed(2)} ) ? vec2( -1.0, 0.0 ) : vWWP.z < ${CHANNEL.iz0.toFixed(2)} ? vec2( 1.0, 0.0 ) : vWWP.z > ${CHANNEL.iz1.toFixed(2)} ? vec2( -1.0, 0.0 ) : vWWP.x > 0.0 ? vec2( 0.0, 1.0 ) : vec2( 0.0, -1.0 );`,
      '  vec2 fp = vec2( -fd.y, fd.x );',
      // Fourier synthesis: the surface is a sum of simple sine waves, each
      // with its own wavelength, direction (around the flow), amplitude ∝
      // wavelength (equal slope per octave, like real water) and speed from
      // deep-water dispersion ω = √(g·k), all carried by the current.
      // h = Σ Aᵢ sin(kᵢ (dᵢ·p) − ωᵢ t + φᵢ)  →  normal from −∇h.
      '  const float FLOW = 0.35;',
      '  vec2 pf = vec2( dot( vWWP.xz, fd ), dot( vWWP.xz, fp ) );',
      '  vec2 grad = vec2( 0.0 );',
      '  vec4 W[6];',
      //            dir.along, dir.across, wavelength (m), phase
      '  W[0] = vec4( 0.98, 0.18, 1.10, 0.0 );',
      '  W[1] = vec4( 0.86, -0.50, 0.55, 1.7 );',
      '  W[2] = vec4( 0.70, 0.71, 0.31, 4.1 );',
      '  W[3] = vec4( 0.99, -0.12, 0.17, 2.6 );',
      '  W[4] = vec4( 0.35, 0.94, 0.10, 5.3 );',
      '  W[5] = vec4( 0.80, -0.60, 0.06, 0.9 );',
      '  for ( int i = 0; i < 6; i ++ ) {',
      '    vec2 dir = normalize( W[ i ].xy );',
      '    float k = 6.2832 / W[ i ].z;',
      '    float A = 0.0062 * W[ i ].z;',
      '    float w = sqrt( 9.81 * k ) * 0.35;',
      '    float ph = k * dot( dir, pf - vec2( FLOW * uWTime, 0.0 ) ) - w * uWTime + W[ i ].w;',
      '    grad += dir * ( A * k * cos( ph ) );',
      '  }',
      // Back from the flow frame to world x/z.
      '  g += -( fd * grad.x + fp * grad.y );',
      `  for ( int i = 0; i < ${RIPPLE_N}; i ++ ) {`,
      '    vec4 r = uRip[ i ];',
      '    if ( r.z <= 0.0 ) continue;',
      '    vec2 d = vWWP.xz - r.xy;',
      '    float dist = length( d ) + 1e-4;',
      '    float w = r.z * exp( - dist * 3.2 ) * smoothstep( 1.4, 0.0, dist );',
      '    g += ( d / dist ) * cos( dist * 26.0 - uWTime * 6.5 + r.w ) * w;',
      '  }',
      '  normal = normalize( normal + ( viewMatrix * vec4( g.x, 0.0, g.y, 0.0 ) ).xyz );',
      '}',
    ].join('\n'))
    .replace('#include <opaque_fragment>', [
      '#include <opaque_fragment>',
      '{ float fres = pow( 1.0 - clamp( abs( dot( normalize( vViewPosition ), normal ) ), 0.0, 1.0 ), 3.0 );',
      '  gl_FragColor.a = mix( 0.24, 0.8, fres ); }',
    ].join('\n'));
};
canalWaterMat.customProgramCacheKey = () => 'inga-canal-water';
// The canal as four clean, non-overlapping strips (north and south run
// the full width, east and west fill in between). The old ring mesh paired
// mismatched points along its edges, which twisted triangles at the corners.
function canalStrips(segPerM = 1.2) {
  const parts = [];
  const strip = (x0, x1, z0, z1) => {
    const w = x1 - x0, d = z1 - z0;
    const g = new THREE.PlaneGeometry(w, d, Math.max(1, Math.round(w * segPerM)), Math.max(1, Math.round(d * segPerM)));
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * 0.08, p.getZ(i) * 0.08);
    parts.push(g);
  };
  strip(CHANNEL.x0, CHANNEL.x1, CHANNEL.z0, CHANNEL.iz0);
  strip(CHANNEL.x0, CHANNEL.x1, CHANNEL.iz1, CHANNEL.z1);
  strip(CHANNEL.x0, CHANNEL.ix0, CHANNEL.iz0, CHANNEL.iz1);
  strip(CHANNEL.ix1, CHANNEL.x1, CHANNEL.iz0, CHANNEL.iz1);
  strip(CHANNEL.ix0, CHANNEL.ix1, CROSS.z0, CROSS.z1);
  return mergeGeometries(parts);
}
const water = new THREE.Mesh(canalStrips(), canalWaterMat);
water.position.y = CANAL_WATER_Y;
water.castShadow = false;
water.receiveShadow = false;
water.renderOrder = 1;
scene.add(water);
// Inner side wall of the canal, down to the bed.
{
  const sd = 0.06, top = -0.04, h = top - (CANAL_BED_Y - 0.03);
  const ym = top - h / 2;
  const sideMat = hallConcrete.clone();
  addCaustics(sideMat, 0.14);
  box(CHANNEL.ix1 - CHANNEL.ix0, h, sd, 0, ym, CHANNEL.iz0 - sd / 2, sideMat, false);
  box(CHANNEL.ix1 - CHANNEL.ix0, h, sd, 0, ym, CHANNEL.iz1 + sd / 2, sideMat, false);
  for (const [za, zb] of [[CHANNEL.iz0, CROSS.z0], [CROSS.z1, CHANNEL.iz1]]) {
    box(sd, h, zb - za, CHANNEL.ix0 - sd / 2, ym, (za + zb) / 2, sideMat, false);
    box(sd, h, zb - za, CHANNEL.ix1 + sd / 2, ym, (za + zb) / 2, sideMat, false);
  }
  box(CHANNEL.ix1 - CHANNEL.ix0, h, sd, 0, ym, CROSS.z0 - sd / 2, sideMat, false);
  box(CHANNEL.ix1 - CHANNEL.ix0, h, sd, 0, ym, CROSS.z1 + sd / 2, sideMat, false);
}
const bed = new THREE.Mesh(canalStrips(0.6), bedMat);
bed.position.y = CANAL_BED_Y;
const canalLifeUniforms = { uTime: { value: 0 } };
// The threshold's stream: a thin channel along the right wall of the entry,
// flowing toward the hall and into the south canal. Same water and bed.
{
  const { chX0, chX1, z0 } = ENTRY;
  const zEnd = HALL.doorZ + 0.02, len = zEnd - z0, zm = (z0 + zEnd) / 2, w = chX1 - chX0 + 0.15;
  const mk = (mat, y, seg) => {
    const g = new THREE.PlaneGeometry(w, len, 2, Math.round(len * seg));
    g.rotateX(-Math.PI / 2); g.translate((chX0 + chX1 + 0.15) / 2, 0, zm);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * 0.08, p.getZ(i) * 0.08);
    const m = new THREE.Mesh(g, mat); m.position.y = y; return m;
  };
  const ew = mk(canalWaterMat, CANAL_WATER_Y, 1.2); ew.renderOrder = 1; scene.add(ew);
  const eb = mk(bedMat, CANAL_BED_Y, 0.6); eb.receiveShadow = true; scene.add(eb);
  // Inner side wall, coping with its overflow slot.
  const sideMat = hallConcrete.clone(); addCaustics(sideMat, 0.14);
  const h = -0.04 - (CANAL_BED_Y - 0.03);
  box(0.06, h, len, chX0 - 0.03, -0.04 - h / 2, zm, sideMat, false);
  const copeMat = new THREE.MeshStandardMaterial({ map: noiseTexture('#d9d4c7', 10), color: '#ecebe2', roughness: 0.75 });
  box(0.14, 0.03, len - 0.3, chX0 - 0.07, -0.043, zm - 0.15, copeMat, false);
  box(0.012, 0.004, len - 0.4, chX0 - 0.035, -0.028, zm - 0.15, new THREE.MeshStandardMaterial({ color: '#23272a', roughness: 0.9 }), false);
  // A few pebbles on its bed.
  const n = LITE ? 45 : 90;
  const pm = new THREE.InstancedMesh(stoneGeo, stoneWetMat, n);
  const d = new THREE.Object3D(), c = new THREE.Color();
  const tones = ['#c8c9ca', '#dcd9cf', '#ecebe2', '#8d8a82', '#76604f', '#a9a59b'];
  for (let i = 0; i < n; i++) {
    const r = 0.025 + Math.pow(Math.random(), 1.5) * 0.08;
    d.position.set(chX0 + 0.08 + Math.random() * (chX1 - chX0 - 0.1), CANAL_BED_Y + r * 0.25, z0 + 0.2 + Math.random() * (len - 0.4));
    d.rotation.set(0, Math.random() * 6.28, 0);
    d.scale.set(r * (0.8 + Math.random() * 0.6), r * 0.45, r * (0.8 + Math.random() * 0.6));
    d.updateMatrix(); pm.setMatrixAt(i, d.matrix);
    c.set(tones[i % tones.length]).multiplyScalar(0.82); pm.setColorAt(i, c);
  }
  scene.add(pm);
}
// One family of bridges: a thin board-formed concrete deck floating just
// above the floor on slender dark square-tube legs standing in the water,
// with tube cross-beams — and a crisp shadow gap under the deck edge.
function brutalBridge({ x0, x1, z0, z1, top = 0.07, deckT = 0.06, legXs, legZs, beams = 'x' }) {
  const legMat = brutalBridge.legMat || (brutalBridge.legMat = new THREE.MeshStandardMaterial({ color: '#2e3134', roughness: 0.45, metalness: 0.55 }));
  box(x1 - x0, deckT, z1 - z0, (x0 + x1) / 2, top - deckT / 2, (z0 + z1) / 2, hallConcrete);
  BRIDGE_DECKS.push([x0, x1, z0, z1, top]);
  // Shadow gap: a slightly inset dark underside.
  box(x1 - x0 - 0.08, 0.02, z1 - z0 - 0.08, (x0 + x1) / 2, top - deckT - 0.01, (z0 + z1) / 2, legMat, false);
  const legTop = top - deckT - 0.02, lh = legTop - CANAL_BED_Y;
  // Legs and beams merged into one mesh (one draw call), no shadow casting.
  const g = [];
  for (const x of legXs) for (const z of legZs) g.push(new THREE.BoxGeometry(0.07, lh, 0.07).translate(x, CANAL_BED_Y + lh / 2, z));
  if (beams === 'x') for (const z of legZs) g.push(new THREE.BoxGeometry(x1 - x0 - 0.2, 0.05, 0.05).translate((x0 + x1) / 2, legTop - 0.025, z));
  else for (const x of legXs) g.push(new THREE.BoxGeometry(0.05, 0.05, z1 - z0 - 0.2).translate(x, legTop - 0.025, (z0 + z1) / 2));
  const steel = new THREE.Mesh(mergeGeometries(g), legMat);
  steel.receiveShadow = true;
  scene.add(steel);
}
// Small brutalist bridge over the cross canal: a thin concrete deck barely
// lifted above the floor, carried by slender square-tube legs standing in
// the water.
{
  const deckT = 0.06;
  const L = MIDBRIDGE.z1 - MIDBRIDGE.z0, W = MIDBRIDGE.half * 2;
  const deckMat = hallConcrete.clone();
  box(W, deckT, L, 0, MIDBRIDGE.top - deckT / 2, (MIDBRIDGE.z0 + MIDBRIDGE.z1) / 2, deckMat);
  BRIDGE_DECKS.push([-MIDBRIDGE.half, MIDBRIDGE.half, MIDBRIDGE.z0, MIDBRIDGE.z1, MIDBRIDGE.top]);
  // A crisp shadow gap under the deck edge, then the legs.
  const legMat = new THREE.MeshStandardMaterial({ color: '#2e3134', roughness: 0.45, metalness: 0.55 });
  const legTop = MIDBRIDGE.top - deckT, legBot = CANAL_BED_Y;
  const lh = legTop - legBot;
  const sg = [];
  for (const x of [-MIDBRIDGE.half + 0.15, 0, MIDBRIDGE.half - 0.15]) {
    for (const z of [CROSS.z0 + 0.1, CROSS.z1 - 0.1]) sg.push(new THREE.BoxGeometry(0.07, lh, 0.07).translate(x, legBot + lh / 2, z));
  }
  // Two square-tube cross-beams under the deck, spanning the water.
  for (const z of [CROSS.z0 + 0.1, CROSS.z1 - 0.1]) sg.push(new THREE.BoxGeometry(W - 0.2, 0.05, 0.05).translate(0, legTop - 0.025, z));
  const steelM = new THREE.Mesh(mergeGeometries(sg), legMat);
  steelM.receiveShadow = true;
  scene.add(steelM);
}
// Stone coping between the marble floor and the water: a thin, slightly
// raised band of warm stone with a fine overflow slot running along it
// (it catches the water before it can spill onto the floor).
{
  const copeMat = new THREE.MeshStandardMaterial({ map: noiseTexture('#d9d4c7', 10), color: '#ecebe2', roughness: 0.75 });
  const slotMat = new THREE.MeshStandardMaterial({ color: '#23272a', roughness: 0.9 });
  const W = 0.14, H = 0.03, top = -0.04 + 0.012, SLOT = 0.012;
  const yC = top - H / 2;
  const geos = [], slots = [];
  const band = (x0, x1, z0, z1) => {
    const g = worldUVs(new THREE.BoxGeometry(x1 - x0, H, z1 - z0), x1 - x0, H, z1 - z0);
    g.translate((x0 + x1) / 2, yC, (z0 + z1) / 2);
    geos.push(g);
  };
  const slot = (x0, x1, z0, z1) => {
    const g = new THREE.BoxGeometry(x1 - x0, 0.004, z1 - z0);
    g.translate((x0 + x1) / 2, top + 0.0005, (z0 + z1) / 2);
    slots.push(g);
  };
  const { ix0, ix1, iz0, iz1 } = CHANNEL;
  // Band sits on the floor side of the edge; slot 3.5 cm in from the water.
  const { z0: cz0, z1: cz1 } = CROSS;
  band(ix0, ix1, iz0, iz0 + W); band(ix0, ix1, iz1 - W, iz1);
  band(ix0, ix1, cz0 - W, cz0); band(ix0, ix1, cz1, cz1 + W);
  for (const [za, zb] of [[iz0 + W, cz0 - W], [cz1 + W, iz1 - W]]) { band(ix0, ix0 + W, za, zb); band(ix1 - W, ix1, za, zb); }
  const o = 0.035;
  slot(ix0 + o, ix1 - o, iz0 + o, iz0 + o + SLOT); slot(ix0 + o, ix1 - o, iz1 - o - SLOT, iz1 - o);
  slot(ix0 + o, ix1 - o, cz0 - o - SLOT, cz0 - o); slot(ix0 + o, ix1 - o, cz1 + o, cz1 + o + SLOT);
  for (const [za, zb] of [[iz0 + o, cz0 - o], [cz1 + o, iz1 - o]]) { slot(ix0 + o, ix0 + o + SLOT, za, zb); slot(ix1 - o - SLOT, ix1 - o, za, zb); }
  const coping = new THREE.Mesh(mergeGeometries(geos), copeMat);
  coping.receiveShadow = true;
  coping.castShadow = false;
  scene.add(coping);
  scene.add(new THREE.Mesh(mergeGeometries(slots), slotMat));
}
{
  // Moss spilling over the inner edge of the canal, here and there.
  const mossGeos = [];
  const edges = [
    [CHANNEL.ix0, CHANNEL.iz0, CHANNEL.ix0, CHANNEL.iz1, -1, 0], [CHANNEL.ix1, CHANNEL.iz0, CHANNEL.ix1, CHANNEL.iz1, 1, 0],
    [CHANNEL.ix0, CHANNEL.iz0, CHANNEL.ix1, CHANNEL.iz0, 0, -1], [CHANNEL.ix0, CHANNEL.iz1, CHANNEL.ix1, CHANNEL.iz1, 0, 1],
  ];
  for (const [ax, az, bx, bz, ox, oz] of []) {
    const L = Math.hypot(bx - ax, bz - az);
    const patches = Math.round(L / 5);
    for (let k = 0; k < patches; k++) {
      const len = 0.6 + Math.random() * 1.6;
      const u = (k + 0.2 + Math.random() * 0.6) / patches;
      const cx = ax + (bx - ax) * u, cz = az + (bz - az) * u;
      // Skip the bridges.
      if (Math.abs(cx) < DOOR_HALF_GUESS && oz === 1) continue;
      if (Math.abs(cx) < 2.4 && oz === -1) continue;
      // A cushion: a few overlapping squashed blobs, some hanging over
      // the water.
      const blobs = 3 + Math.round(len * 3);
      for (let k2 = 0; k2 < blobs; k2++) {
        const g = mergeVertices((() => { const ig = new THREE.IcosahedronGeometry(1, 2); ig.deleteAttribute('normal'); ig.deleteAttribute('uv'); return ig; })());
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const n = 0.8 + 0.4 * rockFbm(p.getX(i) * 2.5 + k2 * 7 + cx, p.getZ(i) * 2.5 + p.getY(i) * 2 + cz);
          p.setXYZ(i, p.getX(i) * n, Math.max(-0.35, p.getY(i)) * n, p.getZ(i) * n);
        }
        const along = (k2 / Math.max(1, blobs - 1) - 0.5) * len;
        const over = (Math.random() - 0.25) * 0.18;
        const r = 0.07 + Math.random() * 0.08;
        g.scale(r * 1.4, r * 0.55, r * 1.2);
        g.translate(
          cx + (ox === 0 ? along : ox * over),
          -0.035 - (over > 0.06 ? 0.03 : 0),
          cz + (oz === 0 ? along : oz * over));
        g.computeVertexNormals();
        mossGeos.push(g);
      }
    }
  }
  if (false && mossGeos.length) { // moss spilling over the edge: removed (not wanted)
    const mtex = mossTexture(256);
    mtex.repeat.set(3, 3);
    const merged = mergeGeometries(mossGeos);
    // World-ish UVs so the moss texture doesn't stretch.
    const mp = merged.attributes.position, uvs = new Float32Array(mp.count * 2);
    for (let i = 0; i < mp.count; i++) { uvs[i * 2] = mp.getX(i) * 1.6 + mp.getY(i); uvs[i * 2 + 1] = mp.getZ(i) * 1.6; }
    merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    const mm = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ map: mtex, color: '#c9dc8a', roughness: 1 }));
    mm.receiveShadow = true;
    scene.add(mm);
  }
  // Water weeds: thin ribbons rooted in the bed, swaying in the current.
  const blade = new THREE.PlaneGeometry(0.035, 1, 1, 6);
  blade.translate(0, 0.5, 0);
  const weedMat = new THREE.MeshStandardMaterial({ color: '#3f5b2f', roughness: 0.8, side: THREE.DoubleSide });
  weedMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = canalLifeUniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        'float ph = instanceMatrix[3].x * 3.1 + instanceMatrix[3].z * 2.3;',
        'float k = transformed.y * transformed.y;',
        'transformed.x += ( 0.25 + sin( uTime * 1.3 + ph + transformed.y * 2.5 ) * 0.3 ) * k;',
        'transformed.z += cos( uTime * 0.7 + ph * 1.3 ) * 0.2 * k;',
      ].join('\n'));
  };
  weedMat.customProgramCacheKey = () => 'inga-weed';
  const WEEDS = LITE ? 70 : 160;
  const weeds = new THREE.InstancedMesh(blade, weedMat, WEEDS);
  const d = new THREE.Object3D();
  const strips = [[CHANNEL.x0, CHANNEL.ix0, CHANNEL.z0, CHANNEL.z1], [CHANNEL.ix1, CHANNEL.x1, CHANNEL.z0, CHANNEL.z1], [CHANNEL.ix0, CHANNEL.ix1, CHANNEL.z0, CHANNEL.iz0], [CHANNEL.ix0, CHANNEL.ix1, CROSS.z0, CROSS.z1]];
  let n = 0;
  while (n < WEEDS) {
    // Clumps of 4–9 blades.
    const st = strips[(Math.random() * strips.length) | 0];
    const cx = st[0] + 0.15 + Math.random() * (st[1] - st[0] - 0.3), cz = st[2] + 0.2 + Math.random() * (st[3] - st[2] - 0.4);
    const k = 4 + ((Math.random() * 6) | 0);
    for (let i = 0; i < k && n < WEEDS; i++, n++) {
      d.position.set(cx + (Math.random() - 0.5) * 0.18, CANAL_BED_Y, cz + (Math.random() - 0.5) * 0.18);
      // Local +x (the lean) points downstream: south strip → +x, east → +z, west → −z.
      const yawFlow = st === strips[3] ? Math.PI : st === strips[2] ? 0 : (st === strips[1] ? -Math.PI / 2 : Math.PI / 2);
      d.rotation.set(0, yawFlow + (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.2);
      d.scale.set(0.8 + Math.random() * 0.6, 0.14 + Math.random() * 0.2, 1);
      d.updateMatrix();
      weeds.setMatrixAt(n, d.matrix);
    }
  }
  scene.add(weeds);
}
// A few dead leaves floating on the surface, drifting and slowly turning.
const floatLeaves = [];
{
  const sh = new THREE.Shape();
  sh.moveTo(0, -0.5); sh.bezierCurveTo(0.35, -0.3, 0.32, 0.25, 0, 0.5); sh.bezierCurveTo(-0.32, 0.25, -0.35, -0.3, 0, -0.5);
  const g = new THREE.ShapeGeometry(sh, 6);
  g.rotateX(-Math.PI / 2);
  const tones = ['#c9a24a', '#8a6b3e', '#b8893f', '#a07a40', '#d1ae5c'];
  for (let i = 0; i < (LITE ? 9 : 16); i++) {
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: tones[i % tones.length], roughness: 0.7, side: THREE.DoubleSide }));
    m.scale.setScalar(0.06 + Math.random() * 0.05);
    m.renderOrder = 2;
    scene.add(m);
    floatLeaves.push({ m, loop: null, south: i % 2 === 1, dist: Math.random() * 90, speed: 0.14 + Math.random() * 0.1, lane: (Math.random() - 0.5) * 0.5, spin: (Math.random() - 0.5) * 0.4, rot: Math.random() * 6 });
  }
}
bed.receiveShadow = true;
bed.castShadow = false;
scene.add(bed);

// Bridges over the side canals into the corridors.
for (const sx of [-1, 1]) {
  const xa = sx * (HALL.x + 0.02), xb = sx * (CHANNEL.ix1 - 0.15);
  brutalBridge({ x0: Math.min(xa, xb), x1: Math.max(xa, xb), z0: CORR.z0 + 0.05, z1: CORR.z1 - 0.05,
    legXs: [sx * (HALL.x - 0.2), sx * (CHANNEL.ix1 + 0.15)], legZs: [CORR.z0 + 0.2, CORR.z1 - 0.2], beams: 'z' });
}
// Into the hall from the threshold: the bridge family in a variant — two
// staggered decks side by side, a narrow shadow gap between them.
brutalBridge({ x0: -1.4, x1: -0.03, z0: -5.85, z1: -3.72, legXs: [-1.2, -0.25], legZs: [HALL.doorZ + 0.12, CHANNEL.iz0 - 0.12], beams: 'z' });
brutalBridge({ x0: 0.03, x1: 1.4, z0: -5.6, z1: -3.55, legXs: [0.25, 1.2], legZs: [HALL.doorZ + 0.12, CHANNEL.iz0 - 0.12], beams: 'z' });

const fish = [];
const fishGeo = new THREE.SphereGeometry(0.12, 12, 8);
const tailGeo = new THREE.ConeGeometry(0.05, 0.13, 4);
// Swim routes along the true centre lines of the canals, with rounded
// corners so fish turn smoothly. Two loops, both counter-clockwise like the
// current: the full ring, and the southern loop that cuts back west through
// the cross canal.
const FISH_LINE = {
  x: (CHANNEL.x1 + CHANNEL.ix1) / 2,
  zS: (CHANNEL.z0 + CHANNEL.iz0) / 2,
  zN: (CHANNEL.z1 + CHANNEL.iz1) / 2,
  r: 0.4,
};
function buildLoop(pts, r) {
  const segs = [];
  let len = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const dIn = [Math.sign(p1[0] - p0[0]), Math.sign(p1[1] - p0[1])];
    const dOut = [Math.sign(p2[0] - p1[0]), Math.sign(p2[1] - p1[1])];
    // Straight from after this corner to before the next one.
    const p3 = pts[(i + 2) % n];
    const dNext = [Math.sign(p3[0] - p2[0]), Math.sign(p3[1] - p2[1])];
    void dNext;
    const a = [p1[0] + dOut[0] * r, p1[1] + dOut[1] * r];
    const b = [p2[0] - dOut[0] * r, p2[1] - dOut[1] * r];
    // Arc at corner p1 (from the end of the incoming straight to a).
    const c = [p1[0] - dIn[0] * r + dOut[0] * r, p1[1] - dIn[1] * r + dOut[1] * r];
    const A = [p1[0] - dIn[0] * r, p1[1] - dIn[1] * r];
    const a0 = Math.atan2(A[1] - c[1], A[0] - c[0]);
    let a1 = Math.atan2(a[1] - c[1], a[0] - c[0]);
    let da = a1 - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    segs.push({ kind: 'arc', cx: c[0], cz: c[1], a0, da, len: Math.abs(da) * r });
    len += Math.abs(da) * r;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segs.push({ kind: 'line', ax: a[0], az: a[1], bx: b[0], bz: b[1], len: l });
    len += l;
  }
  return { segs, len, r };
}
const LOOP_RING = buildLoop([[-FISH_LINE.x, FISH_LINE.zS], [FISH_LINE.x, FISH_LINE.zS], [FISH_LINE.x, FISH_LINE.zN], [-FISH_LINE.x, FISH_LINE.zN]], FISH_LINE.r);
const LOOP_SOUTH = buildLoop([[-FISH_LINE.x, FISH_LINE.zS], [FISH_LINE.x, FISH_LINE.zS], [FISH_LINE.x, CROSS.zc], [-FISH_LINE.x, CROSS.zc]], FISH_LINE.r);
const LOOP_ENTRY = buildLoop([[ENTRY.chX0 + 0.2, ENTRY.z0 + 0.5], [ENTRY.chX1 - 0.12, ENTRY.z0 + 0.5], [ENTRY.chX1 - 0.12, HALL.doorZ - 0.4], [ENTRY.chX0 + 0.2, HALL.doorZ - 0.4]], 0.11);
const fishLoop = LOOP_RING.len;
const _loopDir = new THREE.Vector3();
function sampleLoop(distance, out, loop = LOOP_RING) {
  let d = distance % loop.len;
  if (d < 0) d += loop.len;
  for (const seg of loop.segs) {
    if (d <= seg.len) {
      if (seg.kind === 'line') {
        const u = seg.len > 0 ? d / seg.len : 0;
        out.set(seg.ax + (seg.bx - seg.ax) * u, -0.1, seg.az + (seg.bz - seg.az) * u);
        return _loopDir.set(seg.bx - seg.ax, 0, seg.bz - seg.az).normalize();
      }
      const a = seg.a0 + (d / seg.len) * seg.da;
      out.set(seg.cx + Math.cos(a) * loop.r, -0.1, seg.cz + Math.sin(a) * loop.r);
      const sg = Math.sign(seg.da);
      return _loopDir.set(-Math.sin(a) * sg, 0, Math.cos(a) * sg);
    }
    d -= seg.len;
  }
  const s0 = loop.segs[1];
  out.set(s0.ax, -0.1, s0.az);
  return _loopDir.set(1, 0, 0);
}
// ---- Poissons ----
// Koi-like carp and catfish from Japanese streams, built properly: a
// spindle body with a slim tail stalk, forked caudal fin, long dorsal fin,
// pectoral and pelvic fins, eyes; catfish get a broad flat head and four
// barbels. Each fish has its own painted coat (vertex colours): kohaku-like
// patches, golden yamabuki, mottled brown catfish — darker backs, pale
// bellies. The body undulates in the vertex shader, more toward the tail.
const FISH_TYPES = [
  // [count, palette, kind, length range]
  [10, ['#e8892f', '#e07a2a', '#f08c34', '#d9822f', '#ef9a3e'], 'koi', [0.42, 0.72]],
  [8, ['#f2c14a', '#f1b03c', '#e8b545', '#f5d06a'], 'gold', [0.34, 0.58]],
  [5, ['#ef9a3e', '#f4b850', '#e88a33'], 'koi', [0.22, 0.32]],
  [9, ['#6b5240', '#7d6250', '#5a4636', '#8a6e55', '#4d3d31', '#76604f'], 'cat', [0.5, 0.86]],
];
const fishSwimShared = { uTime: { value: 0 } };
function fishGeometry(cat) {
  const prof = [];
  for (let i = 0; i <= 18; i++) {
    const u = i / 18; // 0 = tail stalk, 1 = snout
    let r = Math.pow(Math.sin(Math.PI * Math.pow(u, cat ? 0.78 : 0.64)), 0.85);
    r *= u < 0.22 ? 0.45 + u * 2.5 : 1;            // slim caudal peduncle
    if (cat && u > 0.75) r *= 1 + (u - 0.75) * 1.2; // broad head
    prof.push(new THREE.Vector2(Math.max(0.004, r * (cat ? 0.115 : 0.125)), u - 0.5));
  }
  const body = new THREE.LatheGeometry(prof, 14);
  body.rotateX(Math.PI / 2);
  body.scale(cat ? 1.22 : 0.62, cat ? 0.6 : 0.96, 1);
  const parts = [[body, 0]];
  const fin = (pts, rotY = -Math.PI / 2) => {
    const sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]);
    for (const q of pts.slice(1)) sh.lineTo(q[0], q[1]);
    const g = new THREE.ShapeGeometry(sh); g.rotateY(rotY); return g;
  };
  // Forked tail (shape x runs tail → head; rotated so −x ends up at −z, the back).
  parts.push([fin([[-0.46, 0], [-0.7, 0.17], [-0.62, 0.01], [-0.7, -0.15]]), 1]);
  // Dorsal fin.
  parts.push([fin(cat ? [[0.12, 0.06], [0.02, 0.12], [-0.04, 0.06]] : [[0.18, 0.1], [0.05, 0.19], [-0.22, 0.12], [-0.25, 0.06]]), 1]);
  // Pectoral and pelvic fins: small flat paddles at the sides.
  for (const sx of [-1, 1]) {
    const pec = new THREE.ShapeGeometry((() => { const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0.09, -0.04); sh.lineTo(0.06, 0.03); sh.lineTo(0, 0); return sh; })());
    pec.rotateX(-Math.PI / 2); pec.rotateZ(sx * 0.5); pec.rotateY(sx > 0 ? -0.6 : Math.PI + 0.6);
    pec.translate(sx * (cat ? 0.12 : 0.07), -0.05, 0.2);
    parts.push([pec, 1]);
    const pel = pec.clone(); pel.scale(0.7, 0.7, 0.7); pel.translate(0, -0.015, -0.28);
    parts.push([pel, 1]);
    // Eye.
    const eye = new THREE.SphereGeometry(cat ? 0.012 : 0.016, 6, 4);
    eye.translate(sx * (cat ? 0.1 : 0.058), cat ? 0.02 : 0.025, cat ? 0.42 : 0.41);
    parts.push([eye, 2]);
  }
  if (cat) {
    for (const [sx, len, dy] of [[-1, 0.2, 0], [1, 0.2, 0], [-1, 0.1, -0.04], [1, 0.1, -0.04]]) {
      const bar = new THREE.CylinderGeometry(0.004, 0.0015, len, 4);
      bar.rotateX(Math.PI / 2); bar.rotateY(sx * 0.7); bar.rotateX(0.3);
      bar.translate(sx * 0.07, -0.02 + dy, 0.5 + len * 0.3);
      parts.push([bar, 3]);
    }
  }
  const geos = parts.map(([g, part]) => {
    const ng = g.index ? g.toNonIndexed() : g;
    ng.deleteAttribute('uv');
    ng.setAttribute('part', new THREE.Float32BufferAttribute(new Float32Array(ng.attributes.position.count).fill(part), 1));
    return ng;
  });
  const merged = mergeGeometries(geos);
  merged.computeVertexNormals();
  return merged;
}
const fishGeoCarp = fishGeometry(false), fishGeoCat = fishGeometry(true);
// Paint one fish's coat into a vertex-colour copy of its geometry.
function paintFish(base, kind, palette, seed) {
  const g = base.clone();
  const p = g.attributes.position, part = g.attributes.part;
  const col = new Float32Array(p.count * 3);
  const c0 = new THREE.Color(palette), c = new THREE.Color();
  const cream = new THREE.Color('#f3ece0'), belly = new THREE.Color(kind === 'cat' ? '#cdbfa6' : '#f6eedc');
  const dark = new THREE.Color(kind === 'cat' ? '#2c241d' : '#a2501f');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), pt = part.getX(i);
    if (pt === 2) { c.set('#121212'); }
    else if (pt === 3) { c.copy(c0).multiplyScalar(0.7); }
    else {
      c.copy(c0);
      const n = rockFbm(x * 9 + seed, z * 7 + y * 5 + seed * 1.7);
      if (kind === 'koi' && n > 0.54) c.lerp(cream, Math.min(1, (n - 0.54) * 8)); // white patches
      if (kind === 'cat') c.lerp(dark, Math.max(0, n - 0.45) * 1.6);          // mottling
      // Countershading: darker back, pale belly.
      const v = y / 0.12;
      if (v > 0) c.lerp(dark, Math.min(0.35, v * 0.3));
      else c.lerp(belly, Math.min(0.75, -v * 0.9));
      if (pt === 1) c.lerp(cream, 0.25); // fins a little paler
    }
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
function fishMaterial(cat, freq, amp, phase) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: cat ? 0.72 : 0.42, side: THREE.DoubleSide });
  m.userData.swim = { uFreq: { value: freq }, uAmp: { value: amp }, uPhase: { value: phase } };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = fishSwimShared.uTime;
    Object.assign(sh.uniforms, m.userData.swim);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime, uFreq, uAmp, uPhase;')
      .replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        // Body wave: grows toward the tail (−z), travels head → tail.
        'float tailw = smoothstep( 0.3, -0.65, transformed.z );',
        'transformed.x += sin( uTime * uFreq - transformed.z * 6.5 + uPhase ) * uAmp * tailw;',
      ].join('\n'));
  };
  m.customProgramCacheKey = () => 'inga-fish-swim';
  return m;
}
const fishSpecs = [];
for (const [count, palette, kind, [l0, l1]] of FISH_TYPES) {
  for (let i = 0; i < count; i++) fishSpecs.push({ color: palette[i % palette.length], kind, cat: kind === 'cat', len: l0 + Math.random() * (l1 - l0) });
}
// Shuffle so kinds are mixed along the canal.
for (let i = fishSpecs.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [fishSpecs[i], fishSpecs[j]] = [fishSpecs[j], fishSpecs[i]]; }
// Three small fish of the threshold's stream.
for (const color of ['#ef9a3e', '#f2c14a', '#e88a33']) fishSpecs.push({ color, kind: 'koi', cat: false, len: 0.2 + Math.random() * 0.08, entry: true });
fishSpecs.forEach((spec, i) => {
  const freq = spec.cat ? 4 + Math.random() * 1.5 : 7 + Math.random() * 3;
  const mat = fishMaterial(spec.cat, freq, 0.1, Math.random() * 6);
  const geo = paintFish(spec.cat ? fishGeoCat : fishGeoCarp, spec.kind, spec.color, Math.random() * 50);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.setScalar(spec.len);
  mesh.castShadow = !LITE;
  const group = new THREE.Group();
  group.add(mesh);
  scene.add(group);
  const halfH = spec.len * (spec.cat ? 0.04 : 0.07);
  fish.push({
    group, mat, cat: spec.cat, len: spec.len,
    loop: spec.entry ? LOOP_ENTRY : i % 3 === 1 ? LOOP_SOUTH : LOOP_RING,
    dist: Math.random() * 200,
    // All with the current; each fish its own pace: small ones are quick,
    // koi and gold varied, catfish slow.
    speed: spec.cat ? 0.15 + Math.random() * 0.2 : spec.len < 0.33 ? 0.6 + Math.random() * 0.5 : 0.32 + Math.random() * 0.45,
    depth: spec.cat ? CANAL_BED_Y + halfH + 0.03 : Math.min(CANAL_WATER_Y - halfH - 0.05, -0.2 - Math.random() * 0.22),
    lane: spec.entry ? 0 : (Math.random() - 0.5) * Math.max(0.05, 0.5 - spec.len * 0.35),
    phase: Math.random() * 6, jump: null,
  });
});

// Splash rings on the canal surface (a small reusable pool).
let fishJumpTimer = 5;
const splashRings = [];
{
  const g = new THREE.RingGeometry(0.16, 0.2, 32);
  g.rotateX(-Math.PI / 2);
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#f3f2ec', transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false;
    m.renderOrder = 2;
    scene.add(m);
    splashRings.push({ mesh: m, t0: 0 });
  }
}
const DROPS = 60;
const dropMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4), new THREE.MeshStandardMaterial({ color: '#e9eeec', roughness: 0.1, transparent: true, opacity: 0.75 }), DROPS);
dropMesh.frustumCulled = false;
dropMesh.renderOrder = 3;
scene.add(dropMesh);
const drops = Array.from({ length: DROPS }, () => ({ live: false, p: new THREE.Vector3(), v: new THREE.Vector3(), r: 0.01 }));
const _dropM = new THREE.Matrix4();
const _dropHide = new THREE.Matrix4().makeScale(0, 0, 0);
for (let i = 0; i < DROPS; i++) dropMesh.setMatrixAt(i, _dropHide);
function flingDrops(pos, strength) {
  const n = 4 + Math.round(strength * 10);
  for (let k = 0, i = 0; i < DROPS && k < n; i++) {
    const d = drops[i];
    if (d.live) continue;
    const a = Math.random() * Math.PI * 2, sp = 0.4 + Math.random() * 0.9 * strength;
    d.p.set(pos.x, CANAL_WATER_Y + 0.01, pos.z);
    d.v.set(Math.cos(a) * sp * 0.6, 0.9 + Math.random() * 1.4 * strength, Math.sin(a) * sp * 0.6);
    d.r = 0.006 + Math.random() * 0.01;
    d.live = true;
    k++;
  }
}
function updateDrops(dt) {
  for (let i = 0; i < DROPS; i++) {
    const d = drops[i];
    if (!d.live) continue;
    d.v.y -= 9.8 * dt;
    d.p.addScaledVector(d.v, dt);
    if (d.p.y < CANAL_WATER_Y) { d.live = false; dropMesh.setMatrixAt(i, _dropHide); continue; }
    _dropM.makeScale(d.r, d.r, d.r).setPosition(d.p);
    dropMesh.setMatrixAt(i, _dropM);
  }
  dropMesh.instanceMatrix.needsUpdate = true;
}
function splashAt(pos, strength, silent = false) {
  if (strength > 0) flingDrops(pos, strength);
  const r = splashRings.find((x) => !x.mesh.visible) || splashRings[0];
  r.mesh.position.set(pos.x, -0.085, pos.z);
  r.mesh.visible = true;
  r.t0 = t;
  if (!silent && level === 'hall') {
    const d = camera.position.distanceTo(pos);
    fishSplash(strength * Math.max(0, 1 - d / 22));
  }
}

// Sparse traces already in the hall, left where they were so the near field stays inhabited.
// The hall, furnished like the threshold: a long low stone bench with a
// folded linen, stone pedestals with vases and dry branches along the
// walkways, and a warm glow at the foot of the walls.
const hallStone = new THREE.MeshStandardMaterial({ map: noiseTexture('#d9d4c7', 12), color: '#ecebe2', roughness: 0.85 });
const HALL_OBSTACLES = [];
box(0.6, 0.42, 3.4, -2.95, 0.21, 2.6, hallStone);
HALL_OBSTACLES.push([-3.35, -2.55, 0.8, 4.4, 0.42]);
{
  const fold = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.55), linen);
  fold.position.set(-2.95, 0.45, 3.7); fold.rotation.y = 0.08; fold.castShadow = true; scene.add(fold);
}
function vaseWithBranch(x, y, z, tone, sc) {
  const prof = [];
  for (let i = 0; i <= 12; i++) { const u = i / 12; prof.push(new THREE.Vector2(0.02 + 0.1 * Math.sin(Math.PI * Math.min(1, u * 1.15)) * (u < 0.85 ? 1 : 0.5) + (u > 0.85 ? 0.03 : 0), u * 0.42)); }
  const v = new THREE.Mesh(new THREE.LatheGeometry(prof, 20), new THREE.MeshStandardMaterial({ color: tone, roughness: 0.85 }));
  v.scale.setScalar(sc); v.position.set(x, y, z); v.castShadow = true; scene.add(v);
  const bm = vaseWithBranch.m || (vaseWithBranch.m = new THREE.MeshStandardMaterial({ color: '#5a4636', roughness: 0.9 }));
  let py = y + 0.36 * sc;
  const tg = [];
  const tmpO = new THREE.Object3D();
  for (let k = 0; k < 5; k++) {
    const len = (0.2 + Math.random() * 0.25) * sc;
    const ax = (Math.random() - 0.5) * 0.9, az = (Math.random() - 0.5) * 0.9;
    tmpO.position.set(x + Math.sin(az) * len * 0.15, py + len / 2, z + Math.sin(ax) * len * 0.3);
    tmpO.rotation.set(ax, 0, az); tmpO.scale.set(1, 1, 1); tmpO.updateMatrix();
    tg.push(new THREE.CylinderGeometry(0.004, 0.007, len, 5).applyMatrix4(tmpO.matrix));
    if (k === 1) py += len * 0.7;
  }
  scene.add(new THREE.Mesh(mergeGeometries(tg), bm));
}
const PX = CHANNEL.ix1 - 0.9;
{
  // Warm wash at the foot of the side walls, just above the water.
  const gc = document.createElement('canvas'); gc.width = 8; gc.height = 128;
  const x2 = gc.getContext('2d'); const gr = x2.createLinearGradient(0, 128, 0, 0);
  gr.addColorStop(0, 'rgba(255,214,160,0.85)'); gr.addColorStop(0.35, 'rgba(255,214,160,0.22)'); gr.addColorStop(1, 'rgba(255,214,160,0)');
  x2.fillStyle = gr; x2.fillRect(0, 0, 8, 128);
  const tex = new THREE.CanvasTexture(gc); tex.colorSpace = THREE.SRGBColorSpace;
  const gm = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const len = HALL.north - HALL.doorZ - 0.8, zm = (HALL.north + HALL.doorZ) / 2;
  for (const sx of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.4), gm);
    w.rotation.y = -sx * Math.PI / 2;
    w.position.set(sx * (HALL.x - 0.02), CANAL_WATER_Y + 0.7, zm);
    w.renderOrder = 2;
    scene.add(w);
  }
}
const stone = new THREE.MeshStandardMaterial({ color: '#97958b', roughness: 1 });

const crackMat = new THREE.LineBasicMaterial({ color: '#6d7961', transparent: true, opacity: 0.75 });
for (const [sx, sz] of [[-3, 1.5], [-2.7, 5.2], [2.5, 2], [2.8, 8.6], [-1.2, 9.2], [-3.0, 12], [3.2, 14.8], [-1.8, 16.2]]) {
  const pts = [];
  for (let i = 0; i < 13; i++) pts.push(new THREE.Vector3(sx + i * 0.22 + Math.sin(i * 2) * 0.07, -0.012, sz + Math.sin(i * 0.7) * 0.15));
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), crackMat));
  for (let i = 0; i < 5; i++) {
    const k = sphere(0.04, sx + i * 0.48, -0.02, sz + Math.sin(i * 0.7) * 0.15, moss, 7);
    k.scale.set(2, 0.28, 1);
    k.castShadow = false;
  }
}

function tuft(x, z) {
  for (const [dx, dz, h, rot] of [[0, 0, 0.11, 0.2], [0.05, 0.03, 0.18, 1.1], [-0.04, 0.045, 0.08, 2.2], [0.02, -0.04, 0.15, 0.7]]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.014, h, 0.03), moss);
    blade.position.set(x + dx, -0.04 + h * 0.5, z + dz);
    blade.rotation.y = rot;
    blade.rotation.z = dx * 1.4;
    blade.castShadow = false;
    blade.receiveShadow = true;
    scene.add(blade);
  }
}
tuft(-3.4, 16.6);
tuft(3.35, 11.5);

// Lush wet plants along the canal: instanced leaves with a wet clearcoat,
// glistening droplets, and slow drips falling into the water.
function leafTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 256, 0, 0);
  g.addColorStop(0, '#24512b');
  g.addColorStop(0.55, '#2f6336');
  g.addColorStop(1, '#3a7340');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 256);
  x.strokeStyle = 'rgba(214,232,200,0.5)';
  x.lineWidth = 3;
  x.beginPath();
  x.moveTo(64, 252);
  x.quadraticCurveTo(60, 128, 64, 8);
  x.stroke();
  x.lineWidth = 1.2;
  x.strokeStyle = 'rgba(190,215,178,0.28)';
  for (let i = 0; i < 9; i++) {
    const y = 232 - i * 25;
    x.beginPath();
    x.moveTo(64, y);
    x.quadraticCurveTo(96, y - 15, 122, y - 28);
    x.stroke();
    x.beginPath();
    x.moveTo(64, y);
    x.quadraticCurveTo(32, y - 15, 6, y - 28);
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
function leafGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.17, 0.1, 0.21, 0.38, 0.025, 0.78);
  s.bezierCurveTo(0.01, 0.81, -0.01, 0.81, -0.025, 0.78);
  s.bezierCurveTo(-0.21, 0.38, -0.17, 0.1, 0, 0);
  const geo = new THREE.ShapeGeometry(s, 10);
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    uv.setXY(i, (px - bb.min.x) / (bb.max.x - bb.min.x), (py - bb.min.y) / (bb.max.y - bb.min.y));
    const droop = (py / 0.8) ** 2 * 0.3;
    pos.setZ(i, -droop + Math.abs(px) * 0.5);
  }
  geo.computeVertexNormals();
  return geo;
}
const leafMat = new THREE.MeshPhysicalMaterial({
  map: leafTexture(),
  color: '#cfd8c8',
  roughness: 0.38,
  clearcoat: 1,
  clearcoatRoughness: 0.14,
  envMapIntensity: 1.0,
  side: THREE.DoubleSide,
});
const plantSpots = [];
for (let z = 0; z <= 14; z += 4.5) {
  plantSpots.push([-(CHANNEL.ix1 + 0.33), -0.16, z + (Math.random() - 0.5) * 1.4]);
  plantSpots.push([CHANNEL.ix1 + 0.33, -0.16, z + 2.2 + (Math.random() - 0.5) * 1.4]);
}
plantSpots.push(
  [-1.6, -0.16, -4.5],
  [1.65, -0.16, -4.3],
  [-4.6, ROCK_BASE_Y + loungeHeight(-4.6, 9.4), 9.4]
);
const LEAVES_PER_PLANT = 14;
const leafMesh = new THREE.InstancedMesh(leafGeometry(), leafMat, plantSpots.length * LEAVES_PER_PLANT);
leafMesh.castShadow = true;
leafMesh.receiveShadow = true;
const dummy = new THREE.Object3D();
const tint = new THREE.Color();
let li = 0;
for (const [px, py, pz] of plantSpots) {
  for (let k = 0; k < LEAVES_PER_PLANT; k++) {
    dummy.position.set(px + (Math.random() - 0.5) * 0.3, py, pz + (Math.random() - 0.5) * 0.3);
    dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
    dummy.rotateX(-(0.35 + Math.random() * 0.75));
    const sc = 0.65 + Math.random() * 1.15;
    dummy.scale.setScalar(sc);
    dummy.updateMatrix();
    leafMesh.setMatrixAt(li, dummy.matrix);
    tint.setScalar(0.78 + Math.random() * 0.3);
    leafMesh.setColorAt(li, tint);
    li++;
  }
}
scene.add(leafMesh);

// Hanging vines (pothos-like) from the light-well frames: mostly short,
// a few longer strands, swaying very slightly. Instanced heart leaves.
// And the planted roof: a moss lip and leafy tufts along the top edge of
// each well, seen in silhouette against the sky from inside.
const vineUniforms = { uTime: { value: 0 } };
let vineKit = null; // shared heart-leaf geometry + swaying material
{
  const heart = new THREE.Shape();
  heart.moveTo(0, 0);
  heart.bezierCurveTo(0.55, 0.05, 0.62, -0.55, 0, -1.0);
  heart.bezierCurveTo(-0.62, -0.55, -0.55, 0.05, 0, 0);
  const heartGeo = new THREE.ShapeGeometry(heart, 6);
  {
    // Slight cup along the midrib so the leaves catch light.
    const p = heartGeo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.abs(p.getX(i)) * 0.25 - p.getY(i) * 0.08);
    heartGeo.computeVertexNormals();
  }
  const vineMat = new THREE.MeshStandardMaterial({ color: '#6f9a48', roughness: 0.55, side: THREE.DoubleSide });
  vineMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = vineUniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute vec2 aVine;')
      .replace('#include <project_vertex>', [
        'vec4 mvPosition = vec4( transformed, 1.0 );',
        '#ifdef USE_INSTANCING',
        'mvPosition = instanceMatrix * mvPosition;',
        '#endif',
        'float vineD = pow( aVine.x, 1.4 );',
        'mvPosition.x += sin( uTime * 0.55 + aVine.y ) * 0.045 * vineD;',
        'mvPosition.z += cos( uTime * 0.41 + aVine.y * 1.3 ) * 0.03 * vineD;',
        'mvPosition = modelViewMatrix * mvPosition;',
        'gl_Position = projectionMatrix * mvPosition;',
      ].join('\n'));
  };
  vineMat.customProgramCacheKey = () => 'inga-vine';
  vineKit = { heartGeo, vineMat };
  const mats = [];
  const vine = [];
  const col = [];
  const d = new THREE.Object3D();
  const leafAt = (x, y, z, sc, yaw, tilt, depth, phase, shade) => {
    d.position.set(x, y, z);
    d.rotation.set(tilt, yaw, 0, 'YXZ');
    d.scale.setScalar(sc);
    d.updateMatrix();
    mats.push(d.matrix.clone());
    vine.push(depth, phase);
    col.push(shade);
  };
  // Strands.
  // Edges are picked in proportion to their length (long bars get more).
  const anchorLen = ceilAnchors.map(([x0, x1, za, zb]) => Math.hypot(x1 - x0, zb - za) + 0.05);
  const anchorTotal = anchorLen.reduce((a, b) => a + b, 0);
  // Lots of hanging greenery: curtains of strands along every opening.
  const strands = LITE ? 140 : 240;
  for (let k = 0; k < strands; k++) {
    let pick = Math.random() * anchorTotal, ai = 0;
    while (ai < ceilAnchors.length - 1 && pick > anchorLen[ai]) { pick -= anchorLen[ai]; ai++; }
    const [x0, x1, za, zb, y] = ceilAnchors[ai];
    const ax = x0 + Math.random() * (x1 - x0) + (Math.random() - 0.5) * 0.1;
    const az = za + Math.random() * (zb - za) + (Math.random() - 0.5) * 0.1;
    const L = 0.4 + Math.pow(Math.random(), 1.3) * 3.6; // up to 4 m, stays above head height
    const phase = Math.random() * 6.28;
    const bend = (Math.random() - 0.5) * 0.25;
    const n = Math.max(4, Math.round(L / (LITE ? 0.08 : 0.065)));
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const depth = t * L;
      const x = ax + Math.sin(depth * 2.1 + phase) * 0.03 + bend * t * t;
      const zz = az + Math.cos(depth * 1.7 + phase) * 0.03;
      const side = i % 2 ? 1 : -1;
      const sc = (0.085 - 0.04 * t) * (0.8 + Math.random() * 0.4);
      leafAt(x + side * 0.02, y - depth, zz, sc, phase + i * 2.4 + Math.random() * 0.6, 0.35 + Math.random() * 0.5, depth, phase, 0.75 + Math.random() * 0.4);
    }
    // A small leafy clump at the anchor hides where the strand starts.
    for (let i = 0; i < 3; i++) {
      leafAt(ax + (Math.random() - 0.5) * 0.3, y + 0.02, az + (Math.random() - 0.5) * 0.2, 0.08 + Math.random() * 0.05, Math.random() * 6.28, 1.2 + Math.random() * 0.4, 0, phase, 0.7 + Math.random() * 0.3);
    }
  }
  // Roof planting: tufts of upright leaves along each well's top edges.
  const roofY = HALL.wallTop + ceilT;
  const roofDX = 0, roofDZ = 0; // reveals are vertical: top edge sits right above the bottom one
  const lipGeos = [];
  for (const [bx0, bz0, bx1, bz1] of sunBars) {
    // Four edges: [start x, start z, end x, end z, outward x, outward z]
    const edges = [
      [bx0, bz0, bx1, bz0, 0, -1], [bx0, bz1, bx1, bz1, 0, 1],
      [bx0, bz0, bx0, bz1, -1, 0], [bx1, bz0, bx1, bz1, 1, 0],
    ];
    for (const [ax0, az0, ax1, az1, ox, oz] of edges) {
      const len = Math.hypot(ax1 - ax0, az1 - az0) + 0.3;
      // Moss lip: a lumpy rounded bead along the edge, slightly overhanging.
      const lip = new THREE.CylinderGeometry(0.16, 0.16, len, 10, Math.max(4, Math.round(len * (LITE ? 2 : 4))), false);
      lip.rotateZ(Math.PI / 2);
      const p = lip.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const lx = p.getX(i);
        const r = 0.75 + 0.5 * rockFbm(lx * 1.3 + ax0 + az0, p.getY(i) * 3 + p.getZ(i) * 3);
        p.setY(i, p.getY(i) * r * 0.7);
        p.setZ(i, p.getZ(i) * r);
      }
      if (ox !== 0) lip.rotateY(Math.PI / 2);
      lip.translate((ax0 + ax1) / 2 + roofDX + ox * 0.06, roofY + 0.04, (az0 + az1) / 2 + roofDZ + oz * 0.06);
      lipGeos.push(lip);
      const tufts = Math.max(1, Math.round(len / (LITE ? 1.6 : 1.0)));
      for (let k = 0; k < tufts; k++) {
        const u = Math.random();
        const tx = ax0 + (ax1 - ax0) * u + roofDX + ox * (0.05 + Math.random() * 0.25);
        const tz = az0 + (az1 - az0) * u + roofDZ + oz * (0.05 + Math.random() * 0.25);
        const leaves = 4 + ((Math.random() * 4) | 0);
        for (let i = 0; i < leaves; i++) {
          // Upright leaves (tip up), leaning out over the opening.
          d.position.set(tx + (Math.random() - 0.5) * 0.2, roofY + 0.05, tz + (Math.random() - 0.5) * 0.2);
          d.rotation.set(Math.PI + (Math.random() - 0.5) * 0.9 - (oz || ox) * 0.5, Math.random() * 6.28, 0, 'YXZ');
          d.scale.setScalar(0.18 + Math.random() * 0.22);
          d.updateMatrix();
          mats.push(d.matrix.clone());
          vine.push(0, 0);
          col.push(0.6 + Math.random() * 0.35);
        }
      }
    }
  }
  const lipMesh = new THREE.Mesh(mergeGeometries(lipGeos), new THREE.MeshStandardMaterial({ color: '#4f6a31', roughness: 1 }));
  lipMesh.castShadow = true;
  lipMesh.receiveShadow = true;
  scene.add(lipMesh);
  const im = new THREE.InstancedMesh(heartGeo, vineMat, mats.length);
  const tmp = new THREE.Color();
  for (let i = 0; i < mats.length; i++) {
    im.setMatrixAt(i, mats[i]);
    im.setColorAt(i, tmp.setScalar(col[i]));
  }
  im.geometry = heartGeo.clone();
  im.geometry.setAttribute('aVine', new THREE.InstancedBufferAttribute(new Float32Array(vine), 2));
  im.castShadow = !LITE;
  im.receiveShadow = true;
  im.frustumCulled = false;
  scene.add(im);
}

const dropletMat = new THREE.MeshPhysicalMaterial({
  color: '#eef4f2',
  roughness: 0.04,
  metalness: 0,
  transparent: true,
  opacity: 0.5,
  clearcoat: 1,
  clearcoatRoughness: 0.03,
  envMapIntensity: 2.4,
});
const dropletGeo = new THREE.SphereGeometry(0.014, 8, 6);
const dropletMesh = new THREE.InstancedMesh(dropletGeo, dropletMat, plantSpots.length * 7);
let di = 0;
for (const [px, py, pz] of plantSpots) {
  for (let k = 0; k < 7; k++) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.15 + Math.random() * 0.55;
    dummy.position.set(px + Math.cos(a) * r, py + 0.12 + Math.random() * 0.6, pz + Math.sin(a) * r);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(0.7 + Math.random() * 1.1);
    dummy.updateMatrix();
    dropletMesh.setMatrixAt(di++, dummy.matrix);
  }
}
scene.add(dropletMesh);

// Fractal ferns: each frond is built recursively (rachis -> pinnae -> pinnules),
// the same branching rule applied at every level. uv.y stores the distance to the
// tip so the wind shader can weight its displacement.
function fernGeometry(frondCount) {
  const pos = [];
  const nor = [];
  const uvA = [];
  const idx = [];
  let vi = 0;
  const up = new THREE.Vector3(0, 1, 0);
  const _side = new THREE.Vector3();
  const _n = new THREE.Vector3();
  const _tip = new THREE.Vector3();
  function quad(o, dirN, l, w, t) {
    _side.crossVectors(dirN, up);
    if (_side.lengthSq() < 1e-6) _side.set(1, 0, 0);
    _side.normalize();
    _n.crossVectors(_side, dirN).normalize();
    _tip.copy(o).addScaledVector(dirN, l);
    const pts = [
      [o.x + _side.x * w / 2, o.y + _side.y * w / 2, o.z + _side.z * w / 2],
      [o.x - _side.x * w / 2, o.y - _side.y * w / 2, o.z - _side.z * w / 2],
      [_tip.x - _side.x * w * 0.12, _tip.y - _side.y * w * 0.12, _tip.z - _side.z * w * 0.12],
      [_tip.x + _side.x * w * 0.12, _tip.y + _side.y * w * 0.12, _tip.z + _side.z * w * 0.12],
    ];
    for (const p of pts) {
      pos.push(p[0], p[1], p[2]);
      nor.push(_n.x, _n.y, _n.z);
      uvA.push(0, t);
    }
    idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
    vi += 4;
  }
  const segsByLevel = LITE ? [0, 4, 9] : [0, 6, 13];
  function branch(origin, dir, len, level, t0, t1) {
    const d = dir.clone().normalize();
    if (level === 0) {
      quad(origin, d, len, len * 0.42, t1);
      return;
    }
    const segs = segsByLevel[level];
    const p = origin.clone();
    const droop = level === 2 ? 0.055 : 0.1;
    const sideV = new THREE.Vector3();
    for (let i = 0; i < segs; i++) {
      const f = i / segs;
      const t = t0 + (t1 - t0) * f;
      const segLen = len / segs;
      d.y -= droop * (0.4 + f);
      d.normalize();
      quad(p, d, segLen * 1.06, len * 0.016 * (1.6 - f), t);
      const childLen = len * (level === 2 ? 0.3 : 0.42) * (1 - f * 0.8);
      sideV.crossVectors(d, up).normalize();
      for (const s of [1, -1]) {
        const cd = d.clone().multiplyScalar(0.5).addScaledVector(sideV, s);
        cd.y += level === 2 ? 0.06 : 0.0;
        branch(p, cd, childLen, level - 1, t, Math.min(1, t + 0.18));
      }
      p.addScaledVector(d, segLen);
    }
  }
  for (let fIdx = 0; fIdx < frondCount; fIdx++) {
    const yawA = (fIdx / frondCount) * Math.PI * 2 + Math.random() * 0.5;
    const pitch = 0.95 + Math.random() * 0.4;
    const dir = new THREE.Vector3(
      Math.cos(yawA) * Math.cos(pitch),
      Math.sin(pitch),
      Math.sin(yawA) * Math.cos(pitch)
    );
    branch(new THREE.Vector3(0, 0, 0), dir, 0.85 + Math.random() * 0.45, 2, 0, 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvA, 2));
  geo.setIndex(idx);
  return geo;
}
const fernUniforms = { uTime: { value: 0 } };
const fernMat = new THREE.MeshPhysicalMaterial({
  color: '#2d5f35',
  roughness: 0.4,
  clearcoat: 0.9,
  clearcoatRoughness: 0.18,
  envMapIntensity: 0.9,
  side: THREE.DoubleSide,
});
fernMat.onBeforeCompile = (sh) => {
  sh.uniforms.uTime = fernUniforms.uTime;
  sh.vertexShader = `uniform float uTime;\n${sh.vertexShader.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
     float windW = uv.y * uv.y;
     transformed.x += sin(uTime * 1.4 + position.y * 2.0 + position.x * 3.1) * 0.028 * windW;
     transformed.z += cos(uTime * 1.1 + position.z * 2.7 + position.x * 1.3) * 0.022 * windW;`
  )}`;
};
fernMat.customProgramCacheKey = () => 'inga-fern-wind';
const fernVariants = [];
const FERN_FRONDS = LITE ? 6 : 9;
for (let i = 0; i < 4; i++) fernVariants.push(fernGeometry(FERN_FRONDS));
const ferns = [];
function fern(x, y, z, scale) {
  const mesh = new THREE.Mesh(fernVariants[Math.floor(Math.random() * fernVariants.length)], fernMat);
  mesh.position.set(x, y, z);
  mesh.rotation.y = Math.random() * Math.PI * 2;
  mesh.scale.setScalar(scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  ferns.push({ mesh, bx: 0, bz: 0, vx: 0, vz: 0, phase: Math.random() * 6, yaw: mesh.rotation.y });
}
const fernSpots = [
  [-2.3, 0, 3.1, 1.15], [3.0, 0, 5.3, 1.0], [2.2, 0, 4.6, 0.7],
  [-3.1, 0, 4.0, 0.85], [6.9, 0, 9.1, 1.25], [-6.8, 0, 15.6, 1.2],
  [-7.1, 0, 5.4, 0.9], [7.2, 0, 16.9, 1.05], [2.4, 0, -3.5, 0.8],
  [-2.5, 0, -3.3, 0.95], [5.0, 0, 12.4, 1.1], [-4.6, 0, 10.2, 0.95],
  [2.7, 0, 4.9, 1.3], [-(CHANNEL.ix1 + 0.23), -0.16, 13.0, 1.35], [CHANNEL.ix1 + 0.23, -0.16, 3.8, 1.3],
  [2.7, 0, 16.9, 1.2],
];
for (const [x, y, z, s] of (LITE ? fernSpots.slice(0, 8) : fernSpots).filter(([fx, , fz]) => !(fz > HALL.doorZ && fx > 0.5) && !(fx < LOUNGE.x1 + 0.3 && fx > LOUNGE.x0 - 0.3 && fz > LOUNGE.z0 && fz < LOUNGE.z1))) {
  const onRocks = y === 0 && Math.abs(x) > PATH_HALF && Math.abs(x) < ISLAND.x1 && z > ISLAND.z0 && z < ISLAND.z1;
  fern(x, onRocks ? ROCK_BASE_Y + rockHeight(x, z) : y, z, s);
}

// Drips: a few droplets detach from canal-side plants and fall into the water.
const drips = [];
const dripGeo = new THREE.SphereGeometry(0.016, 8, 6);
for (let i = 0; i < 6; i++) {
  const spot = plantSpots[Math.floor(Math.random() * (plantSpots.length - 4))];
  const m = new THREE.Mesh(dripGeo, dropletMat);
  m.castShadow = false;
  scene.add(m);
  drips.push({
    m,
    x: spot[0] + (Math.random() - 0.5) * 0.4,
    z: spot[2] + (Math.random() - 0.5) * 0.4,
    top: 0.45 + Math.random() * 0.5,
    period: 2.6 + Math.random() * 3.4,
    phase: Math.random() * 6,
  });
}

const works = [];
function artwork(name, desc, x, y, z, side, color1, color2) {
  const group = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.13, 2.7, 2.1), wood);
  group.add(frame);
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 420;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color1;
  ctx.fillRect(0, 0, 320, 420);
  ctx.fillStyle = color2;
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.ellipse(165, 210, 83, 125, 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.3;
  for (let i = 0; i < 50; i++) ctx.fillRect(Math.random() * 320, Math.random() * 420, Math.random() * 50, 1);
  const art = new THREE.Mesh(
    new THREE.PlaneGeometry(2.02, 2.55),
    new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(c), roughness: 1, side: THREE.DoubleSide })
  );
  art.rotation.y = Math.PI / 2;
  art.position.x = side === -1 ? 0.075 : -0.075;
  group.add(art);
  group.position.set(x, y, z);
  scene.add(group);
  works.push({ name, desc, pos: new THREE.Vector3(x, y, z) });
}
const ART_X = HALL.x - 0.3;
artwork('Étude minérale', 'Une recherche sur la matière, la lumière et le temps.', -ART_X, 2.45, 3, -1, '#aca79a', '#5f6456');
artwork('Surface intérieure', 'Une composition silencieuse entre forme et texture.', ART_X, 2.45, 9.5, 1, '#c7b6a0', '#77766a');
artwork('Trace', 'L’empreinte d’une présence dans un espace habité.', -ART_X, 2.45, 14.5, -1, '#aaa398', '#524c46');

const essenceMat = new THREE.MeshBasicMaterial({ color: '#f1eee4', transparent: true, opacity: 0.18, depthWrite: false });
const essence = sphere(0.075, 0, 0, 0, essenceMat, 24);
essence.castShadow = false;

// ---- Portals between the gallery and the valley ----
const portalMat = new THREE.MeshBasicMaterial({ color: '#07090c' });

// ---- Baie vitrée, balcon et extérieur ----
// The north wall is a floor-to-ceiling glass bay (thin dark steel mullions,
// one transom at door-head height). The centre bay is an open sliding door
// onto a cantilevered concrete balcony with a glass balustrade, under a
// concrete canopy. The gallery stands on square concrete piers; a stream
// runs beneath it, down a valley ringed by mountains.
const BAL = {
  z0: HALL.north + HALL.wallT,
  z1: HALL.north + HALL.wallT + TERRACE.depth,
  halfW: HALL.x + HALL.wallT,
};
const GROUND_Y = VALLEY.y;
// Glass bay after the reference photo: very large panes, slender dark steel
// mullions (6 cm face, 16 cm deep), a single broader transom at sill/rail
// height, thin head and floor frames. Five 4.8 m bays; the centre bay holds
// a glazed door onto the balcony, left swung open outward.
// A grand pivot door filling the whole centre bay (≈4.7 × 7.3 m), turning
// a quarter turn on an off-centre pivot: the long side swings out onto the
// terrace, the short side into the hall, leaving a wide passage.
const DOOR_HALF = 2.4 - 0.03;
const BAY_MULLIONS = (() => { const sb = (HALL.x - 2.4) / 2; return [-(2.4 + sb), -2.4, 2.4, 2.4 + sb]; })();
const DOOR_H = HALL.wallTop - 0.08;
const DOOR_LEAF_W = DOOR_HALF * 2 - 0.08;
const DOOR_PIVOT_X = DOOR_HALF - 0.04 - DOOR_LEAF_W * 0.25;
const DOOR_OPEN_ANGLE = Math.PI / 2;
// Door state: E (or a tap on the prompt) toggles it; the leaf eases between
// closed (0) and open. Closed, it blocks the doorway.
const door = { leaf: null, open: false, angle: 0, pos: new THREE.Vector3(0, 1.3, HALL.north + 0.2) };
{
  const glassZ = HALL.north + 0.2;
  const glassMat = new THREE.MeshStandardMaterial({
    color: '#c4d0d4', transparent: true, opacity: 0.08, roughness: 0.04,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const steelMat = new THREE.MeshStandardMaterial({ color: '#2e3134', roughness: 0.4, metalness: 0.55 });
  const pane = (w, h, x, y, z, parent = scene) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat);
    m.position.set(x, y, z);
    m.renderOrder = 2;
    parent.add(m);
    return m;
  };
  const H = HALL.wallTop;
  const MULL = 0.06, MULL_D = 0.16;
  const TRANSOM_Y = 1.1, TRANSOM_H = 0.12, TRANSOM_D = 0.18;
  // Glass: left and right of the door full height, and above the door.
  const sideW = HALL.x - DOOR_HALF;
  pane(sideW, H, -(DOOR_HALF + sideW / 2), H / 2, glassZ);
  pane(sideW, H, DOOR_HALF + sideW / 2, H / 2, glassZ);
  const frameGeos = [];
  const bar = (w, h, d, x, y, z) => frameGeos.push(new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  // Mullions between the five bays, plus the edge frames against the walls.
  for (const x of BAY_MULLIONS) bar(MULL, H, MULL_D, x, H / 2, glassZ);
  for (const s of [-1, 1]) bar(MULL, H, MULL_D, s * (HALL.x - MULL / 2), H / 2, glassZ);
  bar(HALL.x * 2, 0.08, MULL_D, 0, H - 0.04, glassZ);
  bar(HALL.x * 2, 0.05, MULL_D, 0, 0.0, glassZ);
  // Transom at rail height, interrupted by the door opening.
  const tW = HALL.x - DOOR_HALF;
  bar(tW, TRANSOM_H, TRANSOM_D, -(DOOR_HALF + tW / 2), TRANSOM_Y, glassZ);
  bar(tW, TRANSOM_H, TRANSOM_D, DOOR_HALF + tW / 2, TRANSOM_Y, glassZ);
  // Door frame: jambs and head.
  for (const s of [-1, 1]) bar(MULL, DOOR_H, MULL_D, s * DOOR_HALF, DOOR_H / 2, glassZ);
  bar(DOOR_HALF * 2 + MULL, 0.08, MULL_D, 0, DOOR_H, glassZ);
  const frame = new THREE.Mesh(mergeGeometries(frameGeos), steelMat);
  frame.castShadow = true;
  frame.receiveShadow = true;
  scene.add(frame);
  // Pivot leaf: steel-framed glass, local x runs from its left edge (−) to
  // its right edge (+) around the pivot; a transom bar matches the bay's.
  const leafW = DOOR_LEAF_W, lh = DOOR_H - 0.06;
  const xl = -DOOR_HALF + 0.04 - DOOR_PIVOT_X, xr = DOOR_HALF - 0.04 - DOOR_PIVOT_X;
  const leaf = new THREE.Group();
  leaf.position.set(DOOR_PIVOT_X, 0, glassZ + 0.04);
  leaf.rotation.y = 0;
  door.leaf = leaf;
  pane(leafW, lh, (xl + xr) / 2, lh / 2, 0, leaf);
  const fw = 0.07;
  const leafGeos = [
    new THREE.BoxGeometry(fw, lh, 0.08).translate(xl + fw / 2, lh / 2, 0),
    new THREE.BoxGeometry(fw, lh, 0.08).translate(xr - fw / 2, lh / 2, 0),
    new THREE.BoxGeometry(leafW, fw, 0.08).translate((xl + xr) / 2, lh - fw / 2, 0),
    new THREE.BoxGeometry(leafW, 0.1, 0.08).translate((xl + xr) / 2, 0.05, 0),
    new THREE.BoxGeometry(leafW, 0.1, 0.1).translate((xl + xr) / 2, 1.1, 0),
    // Long vertical pull bar near the free (long) edge, both faces.
    new THREE.BoxGeometry(0.04, 1.8, 0.04).translate(xl + 0.22, 1.25, 0.09),
    new THREE.BoxGeometry(0.04, 1.8, 0.04).translate(xl + 0.22, 1.25, -0.09),
  ];
  const leafFrame = new THREE.Mesh(mergeGeometries(leafGeos), steelMat);
  leafFrame.castShadow = true;
  leaf.add(leafFrame);
  scene.add(leaf);

  // Threshold bridge over the canal, in front of the door.
  const thZ0 = CHANNEL.iz1 - 0.2;
  const thZ1 = HALL.north + 0.05;
  brutalBridge({ x0: -DOOR_HALF + 0.1, x1: DOOR_HALF - 0.1, z0: thZ0, z1: thZ1, legXs: [-DOOR_HALF + 0.3, -0.75, 0.75, DOOR_HALF - 0.3], legZs: [CHANNEL.iz1 + 0.12, HALL.north - 0.12] });

  // Balcony slab, top flush with the gallery floor.
  const balD = BAL.z1 - BAL.z0;
  box(BAL.halfW * 2, 0.5, balD, 0, -0.27, BAL.z0 + balD / 2, hallConcrete);
  // Frameless glass balustrade on a slim steel shoe.
  const railH = 1.05;
  pane(BAL.halfW * 2 - 0.12, railH, 0, railH / 2, BAL.z1 - 0.06);
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(balD - 0.06, railH), glassMat);
    p.rotation.y = Math.PI / 2;
    p.position.set(s * (BAL.halfW - 0.06), railH / 2, BAL.z0 + balD / 2);
    p.renderOrder = 2;
    scene.add(p);
    box(0.06, 0.06, balD, s * (BAL.halfW - 0.06), 0.01, BAL.z0 + balD / 2, steelMat, false);
  }
  box(BAL.halfW * 2, 0.06, 0.06, 0, 0.01, BAL.z1 - 0.06, steelMat, false);
  // ---- Brutalist terrace roof ----
  // A thick board-formed slab covering the whole terrace and oversailing
  // it, with a deep edge beam. With the low dawn sun it cuts the daylight:
  // light only slides in under it, low and raking, across the terrace and
  // through the bay.
  const roofW = outerX * 2 + TERRACE.roofOver * 2;
  const roofZ0 = HALL.north, roofZ1 = TERRACE_ROOF_EDGE_Z;
  const roofD = roofZ1 - roofZ0;
  // Solid board-formed slab; its underside is the terrace ceiling: deep
  // concrete beams running out from the facade, aligned with the bay
  // mullions, and one cross beam — a calm brutalist coffer.
  const rT = TERRACE.roofT, rY = HALL.wallTop + rT / 2;
  box(roofW, rT, roofD, 0, rY, roofZ0 + roofD / 2, hallConcrete);
  const beamD = 0.42;
  for (const x of BAY_MULLIONS) box(0.34, beamD, roofD - 0.5, x, HALL.wallTop - beamD / 2, roofZ0 + (roofD - 0.5) / 2, hallConcrete);
  box(roofW - 1, beamD * 0.8, 0.34, 0, HALL.wallTop - beamD * 0.4, roofZ0 + roofD * 0.55, hallConcrete);
  const tSlots = [];
  // Downstand edge beams (front and both sides).
  const eb = TERRACE.edgeBeam;
  box(roofW, eb, 0.5, 0, HALL.wallTop - eb / 2, roofZ1 - 0.25, hallConcrete);
  for (const sx of [-1, 1]) box(0.5, eb, roofD, sx * (roofW / 2 - 0.25), HALL.wallTop - eb / 2, roofZ0 + roofD / 2, hallConcrete);

  // One big round column: board-formed concrete, off-centre so the view
  // stays open, running from the valley floor up to the roof.
  // A massive drum, 3.2 m across: it claims the terrace.
  const colR = 1.6;
  const colX = -6.6, colZ = BAL.z1 - 3.6;
  const colBot = VALLEY.y - 6, colTop = HALL.wallTop - eb;
  const colGeo = new THREE.CylinderGeometry(colR, colR, colTop - colBot, 56, 1);
  const colUv = colGeo.attributes.uv;
  for (let i = 0; i < colUv.count; i++) colUv.setXY(i, colUv.getX(i) * 2 * Math.PI * colR * TEX_DENSITY, colUv.getY(i) * (colTop - colBot) * TEX_DENSITY);
  const column = new THREE.Mesh(colGeo, hallConcrete);
  column.position.set(colX, (colTop + colBot) / 2, colZ);
  column.castShadow = true;
  column.receiveShadow = true;
  scene.add(column);
  TERRACE.column = { x: colX, z: colZ, r: colR };

  // Long shallow reflecting basin along the terrace edge, low concrete curbs.
  const basinZ0 = BAL.z1 - 1.55, basinZ1 = BAL.z1 - 0.2;
  const basinW = BAL.halfW * 2 - 0.6;
  const curbH = 0.16;
  box(basinW, curbH, 0.16, 0, curbH / 2, basinZ0 + 0.08, hallConcrete);
  for (const sx of [-1, 1]) box(0.16, curbH, basinZ1 - basinZ0, sx * (basinW / 2 - 0.08), curbH / 2, (basinZ0 + basinZ1) / 2, hallConcrete);
  box(basinW, 0.03, basinZ1 - basinZ0, 0, -0.005, (basinZ0 + basinZ1) / 2, new THREE.MeshStandardMaterial({ color: '#2b2f2e', roughness: 0.9 }), false);
  const basin = new THREE.Mesh(new THREE.PlaneGeometry(basinW - 0.32, basinZ1 - basinZ0 - 0.2), waterMat);
  basin.rotation.x = -Math.PI / 2;
  basin.position.set(0, curbH - 0.03, (basinZ0 + basinZ1) / 2 + 0.02);
  basin.renderOrder = 1;
  scene.add(basin);
  TERRACE.walkZMax = basinZ0 - 0.35;

  // Curtain of vines falling from the roof edge: dense and long on the
  // sides, shorter with gaps across the middle so the valley view stays.
  const edgeY = HALL.wallTop - eb;
  const fz = roofZ1 - 0.05, sxE = roofW / 2 - 0.05;
  buildVineCurtain([
    { a: [-sxE, fz], b: [sxE, fz], weight: 1, len: (u) => { const c = Math.abs(u - 0.5) * 2; return c > 0.45 ? 3.2 + Math.random() * 3.6 : 0.6 + Math.pow(Math.random(), 2) * 2.4; } },
    { a: [-sxE, roofZ0 + 2], b: [-sxE, fz], weight: 0.55, len: () => 3.5 + Math.random() * 3.4 },
    { a: [sxE, roofZ0 + 2], b: [sxE, fz], weight: 0.55, len: () => 3.5 + Math.random() * 3.4 },
  ], edgeY, LITE ? 130 : 240);
  // Curtain of vines at the mouth of the threshold, open in the middle so
  // the hall is revealed softly as you walk through.
  buildVineCurtain([
    { a: [ENTRY.x0 + 0.15, ENTRY.z1 - 0.7], b: [ENTRY.x1 - 0.15, ENTRY.z1 - 0.7], weight: 1,
      len: (u) => Math.abs(u - 0.5) < 0.16 ? 0.3 + Math.random() * 0.5 : 2.2 + Math.random() * 1.5 },
  ], ENTRY.ceil, LITE ? 70 : 130);
  // Same planted roof as the gallery: moss and tufts along every slot and
  // vines hanging from the slot edges into the terrace.
  const slotEdges = [];
  for (const [hx0, sz0, hx1, sz1] of tSlots) {
    slotEdges.push({ a: [hx0, sz0], b: [hx1, sz0], weight: 1, len: () => 0.4 + Math.pow(Math.random(), 1.4) * 3.2 });
    slotEdges.push({ a: [hx0, sz1], b: [hx1, sz1], weight: 1, len: () => 0.4 + Math.pow(Math.random(), 1.4) * 3.2 });
  }


  // The building's underside and its piers, seen when leaning over the rail.
  const plinthZ0 = HALL.doorZ - HALL.wallT;
  box(outerX * 2, 1.0, BAL.z0 - plinthZ0, 0, CANAL_BED_Y - 0.06 - 0.5, (plinthZ0 + BAL.z0) / 2, hallConcrete, false); // top below the canal bed
  const pierH = -1.4 - (GROUND_Y - 2);
  for (const z of [BAL.z1 - 1.0, (BAL.z0 + BAL.z1) / 2, 11, 2]) {
    for (const x of [-9.6, -3.2, 3.2, 9.6]) box(1.2, pierH, 1.2, x, -1.4 - pierH / 2, z, hallConcrete, false);
  }
}

// Builds a curtain of hanging vine strands from edge segments, reusing the
// hall's heart-leaf geometry and swaying material.
function buildVineCurtain(edges, anchorY, count) {
  if (!vineKit) return;
  const total = edges.reduce((a, e) => a + Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) * e.weight, 0);
  const mats = [], vine = [], col = [];
  const d = new THREE.Object3D();
  const spacing = LITE ? 0.1 : 0.075;
  for (let k = 0; k < count; k++) {
    let pick = Math.random() * total, e = edges[0];
    for (const ed of edges) { const w = Math.hypot(ed.b[0] - ed.a[0], ed.b[1] - ed.a[1]) * ed.weight; if (pick <= w) { e = ed; break; } pick -= w; }
    const u = Math.random();
    const ax = e.a[0] + (e.b[0] - e.a[0]) * u + (Math.random() - 0.5) * 0.15;
    const az = e.a[1] + (e.b[1] - e.a[1]) * u + (Math.random() - 0.5) * 0.25;
    const L = e.len(u);
    const phase = Math.random() * 6.28;
    const n = Math.max(4, Math.round(L / spacing));
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const depth = t * L;
      const side = i % 2 ? 1 : -1;
      d.position.set(ax + Math.sin(depth * 1.6 + phase) * 0.04 + side * 0.025, anchorY - depth, az + Math.cos(depth * 1.3 + phase) * 0.04);
      d.rotation.set(0.35 + Math.random() * 0.5, phase + i * 2.4 + Math.random() * 0.6, 0, 'YXZ');
      d.scale.setScalar((0.1 - 0.035 * t) * (0.8 + Math.random() * 0.4));
      d.updateMatrix();
      mats.push(d.matrix.clone());
      vine.push(depth, phase);
      col.push(0.7 + Math.random() * 0.45);
    }
  }
  const geo = vineKit.heartGeo.clone();
  geo.setAttribute('aVine', new THREE.InstancedBufferAttribute(new Float32Array(vine), 2));
  const im = new THREE.InstancedMesh(geo, vineKit.vineMat, mats.length);
  const c = new THREE.Color();
  for (let i = 0; i < mats.length; i++) { im.setMatrixAt(i, mats[i]); im.setColorAt(i, c.setScalar(col[i])); }
  im.castShadow = !LITE;
  im.receiveShadow = true;
  im.frustumCulled = false;
  scene.add(im);
}

// Moss lips and leafy tufts along the top edges of roof openings.
function buildRoofPlants(rects, roofY) {
  if (!vineKit) return;
  const lipGeos = [], mats = [];
  const d = new THREE.Object3D();
  for (const [x0, z0, x1, z1] of rects) {
    for (const [ez, out] of [[z0, -1], [z1, 1]]) {
      const len = x1 - x0 + 0.3;
      const lip = new THREE.CylinderGeometry(0.16, 0.16, len, 10, Math.max(4, Math.round(len * (LITE ? 2 : 4))), false);
      lip.rotateZ(Math.PI / 2);
      const p = lip.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const r = 0.75 + 0.5 * rockFbm(p.getX(i) * 1.3 + ez, p.getY(i) * 3 + p.getZ(i) * 3);
        p.setY(i, p.getY(i) * r * 0.7);
        p.setZ(i, p.getZ(i) * r);
      }
      lip.translate((x0 + x1) / 2, roofY + 0.04, ez + out * 0.06);
      lipGeos.push(lip);
      const tufts = Math.max(1, Math.round(len / (LITE ? 1.6 : 1.0)));
      for (let k = 0; k < tufts; k++) {
        const tx = x0 + Math.random() * (x1 - x0), tz = ez + out * (0.05 + Math.random() * 0.25);
        for (let i = 0, n = 4 + ((Math.random() * 4) | 0); i < n; i++) {
          d.position.set(tx + (Math.random() - 0.5) * 0.2, roofY + 0.05, tz + (Math.random() - 0.5) * 0.2);
          d.rotation.set(Math.PI + (Math.random() - 0.5) * 0.9 - out * 0.5, Math.random() * 6.28, 0, 'YXZ');
          d.scale.setScalar(0.18 + Math.random() * 0.22);
          d.updateMatrix();
          mats.push(d.matrix.clone());
        }
      }
    }
  }
  const lipMesh = new THREE.Mesh(mergeGeometries(lipGeos), new THREE.MeshStandardMaterial({ color: '#4f6a31', roughness: 1 }));
  lipMesh.castShadow = true;
  lipMesh.receiveShadow = true;
  scene.add(lipMesh);
  const geo = vineKit.heartGeo.clone();
  geo.setAttribute('aVine', new THREE.InstancedBufferAttribute(new Float32Array(mats.length * 2), 2));
  const im = new THREE.InstancedMesh(geo, vineKit.vineMat, mats.length);
  const c = new THREE.Color();
  for (let i = 0; i < mats.length; i++) { im.setMatrixAt(i, mats[i]); im.setColorAt(i, c.setScalar(0.6 + Math.random() * 0.35)); }
  im.castShadow = true;
  im.frustumCulled = false;
  scene.add(im);
}

// ---- Mobilier & sculptures : béton brut où la nature reprend ----
{
  const mossTexF = mossTexture(256);
  mossTexF.repeat.set(2, 2);
  const mossMatF = new THREE.MeshStandardMaterial({ map: mossTexF, vertexColors: true, roughness: 1 });
  const concreteF = new THREE.MeshStandardMaterial({ map: noiseTexture('#cfcbc2', 14), color: '#dedad2', roughness: 0.92 });
  // Lumpy moss cushions: welded noisy blobs, greens with lichen yellows.
  const MOSS_TONES = ['#6f8f3a', '#86a548', '#5c7a32', '#a3b04a', '#c7c05a', '#9aa07c'];
  function mossLumps(cx, cy, cz, rx, rz, count, rMax, lichen = 0.25, normal = 'up') {
    const geos = [];
    const c = new THREE.Color();
    for (let k = 0; k < count; k++) {
      const ig = new THREE.IcosahedronGeometry(1, 2); ig.deleteAttribute('normal'); ig.deleteAttribute('uv');
      const g = mergeVertices(ig);
      const p = g.attributes.position;
      const r = rMax * (0.45 + Math.random() * 0.55);
      const u = (Math.random() * 2 - 1) * rx, v = (Math.random() * 2 - 1) * rz;
      for (let i = 0; i < p.count; i++) {
        const n = 0.8 + 0.4 * rockFbm(p.getX(i) * 3 + k * 7.1, p.getZ(i) * 3 + p.getY(i) * 2 + k);
        p.setXYZ(i, p.getX(i) * n * r, Math.max(-0.2, p.getY(i)) * n * r * 0.6, p.getZ(i) * n * r);
      }
      if (normal === 'x') g.rotateZ(-Math.PI / 2);
      if (normal === '-x') g.rotateZ(Math.PI / 2);
      if (normal === 'z') g.rotateX(Math.PI / 2);
      if (normal === '-z') g.rotateX(-Math.PI / 2);
      if (normal === 'up') g.translate(cx + u, cy, cz + v);
      else if (normal === 'x' || normal === '-x') g.translate(cx, cy + v, cz + u);
      else g.translate(cx + u, cy + v, cz);
      const tone = Math.random() < lichen ? MOSS_TONES[4 + ((Math.random() * 2) | 0)] : MOSS_TONES[(Math.random() * 4) | 0];
      // The moss texture is dark; lift the tint (vertex colours may exceed 1).
      c.set(tone).offsetHSL(0, 0, (Math.random() - 0.5) * 0.06).multiplyScalar(2.7);
      const col = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const uv = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) * 2.5; uv[i * 2 + 1] = p.getZ(i) * 2.5 + p.getY(i); }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.computeVertexNormals();
      geos.push(g);
    }
    return geos;
  }
  const mossGeosAll = [];
  // 1. Flared concrete blocks with moss & lichen on top and in side hollows.
  function mossBlock(x, z, w, d, h, flare, rotY) {
    const g = new THREE.BoxGeometry(w, h, d, 1, 1, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * flare); p.setZ(i, p.getZ(i) * flare); }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, concreteF);
    m.position.set(x, h / 2, z); m.rotation.y = rotY; m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    const lumps = mossLumps(0, h / 2 + 0.01, 0, w * flare * 0.32, d * flare * 0.32, 4 + Math.round(w * d * 14), Math.min(w, d) * 0.32, 0.35);
    // a hollow on one side, filled with moss
    lumps.push(...mossLumps(w * (0.5 + (flare - 1) * 0.3) * 0.98, -h * 0.1, 0, d * 0.18, h * 0.16, 3, Math.min(d, h) * 0.18, 0.3, 'x'));
    const tmp = new THREE.Object3D(); tmp.position.set(x, h / 2, z); tmp.rotation.y = rotY; tmp.updateMatrix();
    for (const lg of lumps) { lg.applyMatrix4(tmp.matrix); mossGeosAll.push(lg); }
    const r = Math.max(w, d) * flare * 0.6 + 0.2;
    HALL_OBSTACLES.push([x - r, x + r, z - r, z + r]);
  }
  // Moss climbing a little way up the terrace column, from the lounge.
  {
    const col = TERRACE.column;
    const n = LITE ? 26 : 44;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const hgt = Math.pow(Math.random(), 2.2) * 0.55;
      const lumps = mossLumps(0, 0, 0, 0.02, 0.02, 1, 0.12 * (1 - hgt * 0.8) + 0.03, 0.12, 'x');
      const tmp = new THREE.Object3D();
      tmp.position.set(col.x + Math.cos(a) * (col.r - 0.01), 0.02 + hgt, col.z + Math.sin(a) * (col.r - 0.01));
      tmp.rotation.y = -a; tmp.updateMatrix();
      for (const lg of lumps) { lg.applyMatrix4(tmp.matrix); mossGeosAll.push(lg); }
    }
  }
  const mossMesh = new THREE.Mesh(mergeGeometries(mossGeosAll), mossMatF);
  mossMesh.castShadow = !LITE; mossMesh.receiveShadow = true;
  scene.add(mossMesh);
  // 4. Giant smooth pebble: a day bed of pale stone.
  {
    const g = mergeVertices((() => { const ig = new THREE.IcosahedronGeometry(1, 4); ig.deleteAttribute('normal'); ig.deleteAttribute('uv'); return ig; })());
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const n = 1 + 0.04 * (rockFbm(p.getX(i) * 1.2 + 3, p.getZ(i) * 1.2) - 0.5);
      p.setXYZ(i, p.getX(i) * 1.7 * n, (y > 0 ? y * 0.34 : y * 0.12) * n, p.getZ(i) * 1.35 * n);
    }
    g.computeVertexNormals();
    const peb = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: noiseTexture('#d6d3cc', 6), color: '#e2dfd8', roughness: 0.55 }));
    peb.position.set(-1.0, 0.12, 10.6); peb.rotation.y = 0.35; peb.castShadow = true; peb.receiveShadow = true;
    scene.add(peb);
    HALL_OBSTACLES.push([-2.3, 0.3, 9.8, 11.4, 0.3]);
  }
  // 5. Soft modular sofa in dark leather on the moss lounge, set
  //    perpendicular to the entry axis, facing the central path.
  {
    const leather = new THREE.MeshStandardMaterial({ color: '#3c423f', roughness: 0.42, metalness: 0 });
    const sofa = new THREE.Group();
    const puff = (w, h, d, x, y, z, ry, rx = 0) => {
      const g = new RoundedBoxGeometry(w, h, d, 9, Math.min(w, h, d) * 0.42);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const X = p.getX(i), Y = p.getY(i), Z = p.getZ(i);
        const nx = X / (w / 2), ny = Y / (h / 2), nz = Z / (d / 2);
        // Plump pillow: faces bulge, the top sags a little, soft wrinkles.
        const bx = 1 + 0.09 * (1 - ny * ny) * (1 - nz * nz);
        const bz = 1 + 0.09 * (1 - ny * ny) * (1 - nx * nx);
        const by = 1 + 0.12 * (1 - nx * nx) * (1 - nz * nz);
        const wr = 0.006 * Math.sin(X * 23 + Z * 7) * Math.sin(Y * 17 + X * 5);
        p.setXYZ(i, X * bx + wr, Y * by - (ny > 0.5 ? 0.035 * (1 - nx * nx) * (1 - nz * nz) : 0), Z * bz + wr);
      }
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, leather);
      m.position.set(x, y, z); m.rotation.set(rx, ry, 0); m.castShadow = true; m.receiveShadow = true;
      sofa.add(m);
    };
    const n = 4, step = 1.0, sx0 = -(n - 1) * step / 2;
    for (let i = 0; i < n; i++) {
      const x = sx0 + i * step, jit = (Math.random() - 0.5) * 0.08;
      puff(1.0, 0.44, 1.0, x, 0.22, jit, (Math.random() - 0.5) * 0.05);                       // seat
      puff(1.0, 0.58, 0.38, x, 0.6, -0.45 + jit, (Math.random() - 0.5) * 0.06, -0.16);       // back, leaning
    }
    puff(0.46, 0.6, 1.0, sx0 - 0.72, 0.3, 0.02, 0.04);
    puff(0.46, 0.6, 1.0, sx0 + (n - 1) * step + 0.72, 0.3, -0.02, -0.04);
    const cx = -7.4, cz = 11.4;
    sofa.position.set(cx, ROCK_BASE_Y + loungeHeight(cx, cz), cz);
    sofa.rotation.y = Math.PI / 2; // seat front (local +z) faces +x, toward the path
    scene.add(sofa);
    const halfL = (n - 1) * step / 2 + 0.95;
    const sy = ROCK_BASE_Y + loungeHeight(cx, cz);
    HALL_OBSTACLES.push([cx - 0.3, cx + 0.6, cz - halfL, cz + halfL, sy + 0.47]); // seats (and arms)
    HALL_OBSTACLES.push([cx - 0.75, cx - 0.3, cz - halfL, cz + halfL, sy + 0.86]); // backs
  }
}

// Portal to the valley now stands at the east end of the balcony, facing the door.
const portalX = HALL.x - 1.6;
const portalZ = BAL.z0 + 2.4;
box(0.26, 2.72, 0.22, portalX, 1.36, portalZ - 0.86, hallConcrete);
box(0.26, 2.72, 0.22, portalX, 1.36, portalZ + 0.86, hallConcrete);
box(0.26, 0.22, 1.94, portalX, 2.83, portalZ, hallConcrete);
const portalHall = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.6), portalMat);
portalHall.position.set(portalX - 0.02, 1.3, portalZ);
portalHall.rotation.y = -Math.PI / 2;
scene.add(portalHall);

const _vpx = dsMeander(95) + 10, _vpz = 100;
const _vpy = VALLEY.y + dsHeight(_vpx, _vpz);
box(0.24, 3, 0.3, VALLEY.x + _vpx - 0.87, _vpy + 1.5, VALLEY.z + _vpz, hallConcrete);
box(0.24, 3, 0.3, VALLEY.x + _vpx + 0.87, _vpy + 1.5, VALLEY.z + _vpz, hallConcrete);
box(1.98, 0.24, 0.3, VALLEY.x + _vpx, _vpy + 3.1, VALLEY.z + _vpz, hallConcrete);
const portalValley = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.6), portalMat);
portalValley.position.set(VALLEY.x + _vpx, _vpy + 1.32, VALLEY.z + _vpz - 0.16);
portalValley.rotation.y = Math.PI;
scene.add(portalValley);

let level = 'hall';
const valleyHemi = new THREE.HemisphereLight('#eef2f0', '#5c5e53', 0);
scene.add(valleyHemi);
const sunShadow0 = sun.castShadow;
// One shared atmosphere: the valley's pale Death Stranding haze. Inside the
// hall it barely registers over 20 m, but it makes the view through the glass
// read as one continuous landscape. Lighting still adapts to where you are:
// the hall keeps its hard sun and dim ambient (plus some sky through the
// bay), the open valley gets its soft overcast light.
const HALL_SKY_HEMI = 0.38;
// Dawn haze: lighter than before, slightly warm, matched to the sky horizon.
const HAZE_COLOR = new THREE.Color('#d9d6ce');
scene.background = HAZE_COLOR.clone();
scene.fog = new THREE.FogExp2(HAZE_COLOR, 0.0034);
valleyHemi.color.set('#c9d6e6');
valleyHemi.groundColor.set('#6b6455');
valleyHemi.intensity = HALL_SKY_HEMI;

// Dawn sky dome (follows the camera): cool blue-grey overhead, pale at the
// horizon, a warm glow around the low sun — a thin high veil, neither clear
// nor overcast.
const sky = (() => {
  const geo = new THREE.SphereGeometry(400, 48, 24);
  const pos = geo.attributes.position;
  const col = [];
  const zenith = new THREE.Color('#8fa3b6');
  const horizon = HAZE_COLOR.clone();
  const glow = new THREE.Color('#f3d2a6');
  const v = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    const up = Math.max(0, v.y);
    c.copy(horizon).lerp(zenith, Math.pow(up, 0.55));
    const toSun = Math.max(0, v.dot(SUN_DIR));
    c.lerp(glow, Math.pow(toSun, 6) * 0.75 + Math.pow(toSun, 60) * 0.25);
    if (v.y < 0) c.copy(horizon);
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  m.renderOrder = -10;
  m.frustumCulled = false;
  scene.add(m);
  // The sun itself: a soft bright disc veiled by the haze.
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(9, 32),
    new THREE.MeshBasicMaterial({ color: '#fff1dc', transparent: true, opacity: 0.85, fog: false, depthWrite: false })
  );
  sunDisc.position.copy(SUN_DIR).multiplyScalar(380);
  sunDisc.lookAt(0, 0, 0);
  sunDisc.renderOrder = -9;
  m.add(sunDisc);
  return m;
})();

// Fine ground mist: pools in the valley floor (a few metres deep), thickens
// with distance, drifts slowly. Injected into the valley's ground, rock,
// moss and water materials so it hugs the terrain with no hard plane edges.
const mistUniforms = { uMistTime: { value: 0 } };
const MIST = { color: new THREE.Color('#e7e3db'), bottom: VALLEY.y - 2, top: VALLEY.y + 4, strength: 0.5 };
function addGroundMist(mat) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(mat, sh, r);
    sh.uniforms.uMistTime = mistUniforms.uMistTime;
    sh.uniforms.uMistColor = { value: MIST.color };
    sh.uniforms.uMistRange = { value: new THREE.Vector3(MIST.bottom, MIST.top, MIST.strength) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMistPos;')
      .replace('#include <project_vertex>', [
        'vec4 mistWP = vec4( transformed, 1.0 );',
        '#ifdef USE_INSTANCING',
        'mistWP = instanceMatrix * mistWP;',
        '#endif',
        'vMistPos = ( modelMatrix * mistWP ).xyz;',
        '#include <project_vertex>',
      ].join('\n'));
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMistPos;\nuniform float uMistTime;\nuniform vec3 uMistColor;\nuniform vec3 uMistRange;')
      .replace('#include <fog_fragment>', [
        '{',
        '  float mh = 1.0 - smoothstep( uMistRange.x, uMistRange.y, vMistPos.y );',
        '  float md = 1.0 - exp( - distance( cameraPosition, vMistPos ) / 55.0 );',
        '  float drift = 0.72 + 0.28 * sin( vMistPos.x * 0.045 + uMistTime * 0.06 ) * sin( vMistPos.z * 0.037 - uMistTime * 0.045 );',
        '  gl_FragColor.rgb = mix( gl_FragColor.rgb, uMistColor, clamp( mh * md * drift * uMistRange.z, 0.0, 1.0 ) );',
        '}',
        '#include <fog_fragment>',
      ].join('\n'));
  };
  mat.customProgramCacheKey = () => prevKey() + '|mist';
  mat.needsUpdate = true;
}
valleyRoot.traverse((o) => {
  // A grazing dawn sun gives shadow acne on the far terrain; the gallery's
  // own shadow falls behind it anyway, so the valley skips sun shadows.
  if (o.isMesh) o.receiveShadow = false;
  const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
  for (const m of mats) if (!m.userData.mist) { m.userData.mist = true; addGroundMist(m); }
});
function setLevel(lv) {
  level = lv;
  const valley = lv === 'valley';
  if (fogPass) fogPass.enabled = !valley;
  sun.castShadow = valley ? false : sunShadow0;
  sun.intensity = valley ? 1.9 : 3.6;
  valleyHemi.intensity = valley ? 1.0 : HALL_SKY_HEMI;
  bayFill.intensity = valley ? 0 : 0.42;
  scene.environmentIntensity = valley ? 0.3 : 0.08;
  camera.far = 450;
  camera.updateProjectionMatrix();
  dust.visible = !valley;
  bayDust.visible = !valley;
  if (valley) {
    const sx2 = dsMeander(95) + 10;
    camera.position.set(VALLEY.x + sx2, VALLEY.y + dsHeight(sx2, 95) + 1.58, VALLEY.z + 95);
  } else {
    camera.position.set(0, 1.58, HALL.north - 1.5);
  }
  yaw = 0;
  pitch = 0;
  verticalVelocity = 0;
  grounded = true;
  _prevCam.copy(camera.position);
}

const WALK = {
  corridorHalf: ENTRY.x1 - 0.3,
  corridorZMin: ENTRY.z0 + 0.4,
  bridgeHalf: 1.85,
  bridgeZMin: -5.06,
  bridgeZMax: -3.7,
  // The whole marble floor up to the canal edge is walkable…
  floorHalf: CHANNEL.ix1 - 0.3,
  floorZMin: CHANNEL.iz0 + 0.07,
  floorZMax: CHANNEL.iz1 - 0.4,
  // …except the moss islands, which you walk around.
  islandMargin: 0.25,
};
// Ground height in the hall: moss relief on the islands, the canal bed in
// the water (except on the bridges), marble elsewhere.
function hallGround(x, z) {
  const ax = Math.abs(x);
  if (z > CORR.z0 && z < CORR.z1 && ax > CHANNEL.ix1 - 0.1) return { y: ax <= HALL.x ? 0.07 : 0, surface: 'stone' };
  if (z <= HALL.doorZ - 0.6) return x > ENTRY.chX0 ? { y: CANAL_BED_Y + 0.04, surface: 'water' } : { y: 0, surface: 'stone' };
  // Bridge decks first: exactly where the concrete is, you stand on it.
  for (const [a0, a1, b0, b1, top] of BRIDGE_DECKS) if (x >= a0 && x <= a1 && z >= b0 && z <= b1) return { y: top, surface: 'stone' };
  // Beyond the glass: the terrace slab (with the moss lounge on it).
  if (z > HALL.north + 0.05) {
    const ht = loungeHeight(x, z);
    return ht > 0.015 ? { y: ROCK_BASE_Y + ht, surface: 'moss' } : { y: 0, surface: 'stone' };
  }
  const inCanal = ((ax > CHANNEL.ix1 || z < CHANNEL.iz0 || z > CHANNEL.iz1) || inCross(x, z)) && z > HALL.doorZ;
  if (inCanal) return { y: CANAL_BED_Y + 0.04, surface: 'water' };
  const h = loungeHeight(x, z);
  if (h > 0.015) return { y: ROCK_BASE_Y + h, surface: 'moss' };
  return { y: 0, surface: 'stone' };
}
// Distance from (x, z) to the pivoting door leaf (a segment through the pivot).
function doorLeafDist(x, z) {
  const a = door.angle, px = DOOR_PIVOT_X, pz = HALL.north + 0.24;
  // Leaf ends relative to the pivot: −0.75·W (terrace side) … +0.25·W (hall side).
  const c = Math.cos(a), s = -Math.sin(a);
  const ax0 = px - 0.75 * DOOR_LEAF_W * c, az0 = pz - 0.75 * DOOR_LEAF_W * s;
  const ax1 = px + 0.25 * DOOR_LEAF_W * c, az1 = pz + 0.25 * DOOR_LEAF_W * s;
  const dx = ax1 - ax0, dz = az1 - az0;
  const u = Math.max(0, Math.min(1, ((x - ax0) * dx + (z - az0) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - (ax0 + u * dx), z - (az0 + u * dz));
}
// Walls, glass and solid things only. Heights (canal edges, bridges, moss,
// bench, sofa…) are handled by the step rule in the movement code, so you
// can walk, wade and climb everywhere. 'free' ignores the door leaf and
// furniture (used to get out if something ends up on top of you).
function walkGround(x, z) {
  if (level === 'valley') return { y: VALLEY.y + dsHeight(x - VALLEY.x, z - VALLEY.z), surface: 'valley' };
  let g = hallGround(x, z);
  for (const [a0, a1, b0, b1, top] of HALL_OBSTACLES)
    if (top !== undefined && top > g.y && x > a0 && x < a1 && z > b0 && z < b1) g = { y: top, surface: 'stone' };
  return g;
}
function canOccupy(x, z, free = false) {
  if (level === 'valley') return Math.hypot(x - VALLEY.x, z - VALLEY.z) < VALLEY.radius;
  if (!free && door.angle > 0.05 && Math.abs(z - HALL.north) < DOOR_LEAF_W + 0.5 && doorLeafDist(x, z) < 0.32) return false;
  if (z > CORR.z0 + 0.3 && z < CORR.z1 - 0.3 && Math.abs(x) > HALL.x - 0.4 && Math.abs(x) < HALL.x + HALL.wallT + CORR.len - 0.3) return true;
  if (z <= HALL.doorZ) return Math.abs(x) <= WALK.corridorHalf && z >= WALK.corridorZMin && !(x < ENTRY.x0 + 0.85 && z > -14.4 && z < -10.4); // (bench)
  const onBridge = Math.abs(x) <= WALK.bridgeHalf && z >= WALK.bridgeZMin && z <= WALK.bridgeZMax;
  const ax = Math.abs(x);
  const m = WALK.islandMargin;
  const inIsland = ax > PATH_HALF - m && ax < ISLAND.x1 + m && z > ISLAND.z0 - m && z < ISLAND.z1 + m;
  // The whole interior is walkable now: marble, moss islands, and the canal
  // itself (you wade in it), right up to the walls and the glass.
  const onFloor = ax <= HALL.x - 0.3 && z >= HALL.doorZ + 0.3 && z <= HALL.north - 0.1
    && (free || !HALL_OBSTACLES.some(([a0, a1, b0, b1, top]) => top === undefined && x > a0 && x < a1 && z > b0 && z < b1));
  // Through the open sliding door and out onto the balcony.
  const onDoor = door.angle > DOOR_OPEN_ANGLE * 0.35 && ax <= DOOR_HALF - 0.3 && z >= WALK.floorZMax - 0.2 && z <= BAL.z0 + 0.2
    ;
  const col = TERRACE.column;
  const onBalcony = ax <= BAL.halfW - 0.4 && z >= BAL.z0 - 0.05 && z <= TERRACE.walkZMax
    && (!col || Math.hypot(x - col.x, z - col.z) > col.r + 0.35);
  return onBridge || onFloor || onDoor || onBalcony;
}

let yaw = Math.PI, pitch = 0, verticalVelocity = 0, grounded = true, started = false, activeWork = null;
// What's underfoot in the hall: 'stone' (marble/concrete), 'moss', 'water'.
let playerSurface = 'stone', playerInWater = false, playerSpeed = 0, _prevStepX = 0, _prevStepZ = 0;
const keys = {};
const movement = { x: 0, y: 0 };
let dragLook = null;
const hint = document.querySelector('#hint');
const panel = document.querySelector('#artPanel');
const move = new THREE.Vector2();
const _fishPos = new THREE.Vector3();
const _fishAhead = new THREE.Vector3();
const _fishPerp = new THREE.Vector3();
const _fishQ = new THREE.Quaternion();

function enter(fadeDelay = 0) {
  const intro = document.querySelector('#intro');
  setTimeout(() => intro.classList.add('leaving'), fadeDelay);
  setTimeout(() => { intro.style.display = 'none'; }, fadeDelay + 700);
  started = true;
  if (matchMedia('(pointer:fine)').matches) renderer.domElement.requestPointerLock?.();
}

// ---- Slide to unlock (page d'accueil) ----
// The handle sits at the left end of the bar striking through INGA. Drag
// it to the LEFT, into empty space (no visible track: only the arrow says
// which way); the bar stretches with it, the word stays struck through.
// Far enough → a soft click and the gallery opens; otherwise it springs back.
{
  const handle = document.querySelector('#unlock');
  const strike = document.querySelector('#strike');
  let dragging = false, startX = 0, dx = 0, done = false, maxDrag = 200, base = 0, maxRight = 200;
  let crackReady = false; // the crack is (re)built once everything below exists
  // The handle rests in the middle of the N, so there is room to slide left.
  const measure = () => {
    const r = strike.getBoundingClientRect();
    const n = document.querySelector('#nLetter').getBoundingClientRect();
    base = n.left + n.width / 2 - r.left;
    strike.style.setProperty('--base', `${base}px`);
    maxDrag = Math.max(70, Math.min(r.width * 0.42, r.left + base - 14));
    strike.style.setProperty('--max', `${maxDrag}px`);
    maxRight = Math.max(0, r.width - base - 4); // free play to the right, along the whole bar
    if (crackReady) buildCrack();
  };
  measure();
  document.fonts?.ready.then(measure);
  addEventListener('resize', () => { if (!done) measure(); });
  const setOffset = (v, animate) => {
    // Left unlocks; right just slides along the bar and does nothing.
    dx = Math.max(-maxDrag, Math.min(maxRight, v));
    strike.classList.toggle('springing', !!animate);
    strike.style.setProperty('--pull', `${-dx}px`);
    // The bar only exists where the arrow has been: no preview of the track.
  };
  // ---- The crack ----
  // One long, fine, natural fissure through INGA, grown by the slide: it
  // starts past a small threshold and lengthens with the pull; let go
  // early and it closes up again. Built once (fractal jagged polyline from
  // a point on the N, out to both ends, plus two hairline branches) and
  // drawn in three layers: soft shadow, faint luminous halo, bright core.
  const CRACK_START = 0.12;  // fraction of the travel before it starts
  const UNLOCK_AT = 0.72;    // fraction of the travel that opens the gallery
  const crackSvg = document.querySelector('#cracks');
  let crackParts = [];
  let lastCrackle = 0;
  // Brutalist fracture: long straight runs, a few sharp angled breaks and
  // small stepped offsets — like a crack through a poured concrete slab,
  // not an organic zigzag.
  function brutal(x0, y0, x1, y1, W, H) {
    // Pure geometry: long perfectly level runs, crisp right-angle steps,
    // and only rarely a 45° cut.
    const pts = [[x0, y0]];
    const dir = Math.sign(x1 - x0) || 1;
    let x = x0, y = y0;
    const band = H * 0.08;
    while ((x1 - x) * dir > W * 0.03) {
      x += dir * W * (0.08 + Math.random() * 0.12);
      if ((x1 - x) * dir < 0) x = x1;
      pts.push([x, y]);
      if ((x1 - x) * dir <= W * 0.03) break;
      const up = (y > y0 + band * 0.5) ? -1 : (y < y0 - band * 0.5) ? 1 : (Math.random() < 0.5 ? -1 : 1);
      const rise = H * (0.015 + Math.random() * 0.03);
      if (Math.random() < 0.75) {
        y += up * rise;                    // right-angle step
      } else {
        x += dir * rise; y += up * rise;   // 45° cut
      }
      y = Math.max(y0 - band, Math.min(y0 + band, y));
      pts.push([x, y]);
    }
    pts.push([x1, y]);
    return pts;
  }
  // Branches: small clean L-shapes (a drop, then a short level run).
  const branch = (o, W, H, up, dir) => {
    const drop = H * (0.06 + Math.random() * 0.05) * (up ? -1 : 1);
    const p1 = [o[0], o[1] + drop];
    return [o, p1, [p1[0] + dir * W * (0.025 + Math.random() * 0.035), p1[1]]];
  };
  const toD = (pts) => 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L');
  function buildCrack() {
    if (done) return;
    const wm = document.querySelector('#wordmark').getBoundingClientRect();
    const ir = intro.getBoundingClientRect();
    crackSvg.setAttribute('viewBox', `0 0 ${ir.width} ${ir.height}`);
    const sr = strike.getBoundingClientRect();
    const ox = sr.left - ir.left + base, oy = wm.top - ir.top + wm.height * (0.5 + (Math.random() - 0.5) * 0.12);
    const H = wm.height, x0 = wm.left - ir.left + wm.width * 0.06, x1 = wm.right - ir.left - wm.width * 0.08;
    const Wd = wm.width;
    // A fissure that nearly splits the whole page: born at the arrow, it
    // runs right almost to the edge and, a little behind, left too;
    // branches climb and drop far into the page.
    const PW = ir.width, PH = ir.height;
    const right = brutal(ox, oy, PW * 0.97, oy, PW, PH * 0.9);
    const left = brutal(ox, oy, PW * 0.03, oy, PW, PH * 0.9);
    const at = (pts, f) => pts[Math.max(1, Math.floor(pts.length * f))] || pts[pts.length - 1];
    const bigBranch = (o, up, dir) => {
      const drop = PH * (0.08 + Math.random() * 0.1) * (up ? -1 : 1);
      const p1 = [o[0], o[1] + drop];
      const p2 = [p1[0] + dir * PW * (0.04 + Math.random() * 0.06), p1[1]];
      const p3 = [p2[0], p2[1] + drop * (0.3 + Math.random() * 0.4)];
      return [o, p1, p2, p3];
    };
    const brA = bigBranch(at(right, 0.3), true, 1);
    const brB = bigBranch(at(right, 0.62), false, 1);
    const brC = bigBranch(at(right, 0.85), true, 1);
    const brD = bigBranch(at(left, 0.55), false, -1);
    // [path, starts at progress, ends at progress, width scale]
    const defs = [[right, 0, 1, 1.3], [left, 0.12, 1, 1.15], [brA, 0.3, 0.75, 0.75], [brB, 0.5, 0.95, 0.7], [brC, 0.7, 1, 0.6], [brD, 0.45, 1, 0.65]];
    crackSvg.innerHTML = `<defs>
      <filter id="crackBlur" x="-5%" y="-50%" width="110%" height="200%"><feGaussianBlur stdDeviation="1.1"/></filter>
      <filter id="crackGlow" x="-5%" y="-50%" width="110%" height="200%"><feGaussianBlur stdDeviation="2.6"/></filter></defs>` +
      defs.map(([pts, , , w], i) => `<g data-i="${i}">
        <path class="cs" d="${toD(pts)}" pathLength="1" stroke-width="${(2.2 * w).toFixed(2)}" filter="url(#crackBlur)" transform="translate(0.6 1.4)"/>
        <path class="cg" d="${toD(pts)}" pathLength="1" stroke-width="${(4 * w).toFixed(2)}" filter="url(#crackGlow)"/>
        <path class="cc" d="${toD(pts)}" pathLength="1" stroke-width="${(1.05 * w).toFixed(2)}"/></g>`).join('');
    crackParts = defs.map(([, a0, a1], i) => ({ a0, a1, paths: crackSvg.querySelectorAll(`g[data-i="${i}"] path`) }));
    setCrack(0, false);
  }
  function setCrack(p, animate) {
    crackSvg.classList.toggle('healing', !!animate);
    for (const c of crackParts) {
      const k = Math.min(1, Math.max(0, (p - c.a0) / (c.a1 - c.a0)));
      for (const el of c.paths) el.style.strokeDashoffset = (1 - k).toFixed(4);
    }
    crackSvg.style.opacity = p > 0 ? 1 : 0;
  }
  // Crack progress from the current pull (0 before the threshold, 1 at unlock).
  const crackProgress = () => Math.min(1, Math.max(0, (-dx / maxDrag - CRACK_START) / (UNLOCK_AT - CRACK_START)));
  const unlock = () => {
    if (done) return;
    done = true;
    dragging = false;
    handle.classList.remove('held');
    setCrack(1, false);
    windRush.exhale();
    enter(750);
  };
  // Push the arrow past the right end of the bar and it FALLS: gravity,
  // a little spin, bounces, then rests at the bottom of the page. Grab it,
  // carry it back onto the bar (it snaps on when dropped close enough) and
  // slide left. Dropped anywhere else, it falls again — it can be thrown.
  const intro = document.querySelector('#intro');
  let mode = 'bar';     // 'bar' (on the strike) | 'free' (off the bar)
  let carried = false;
  const P = { x: 0, y: 0, vx: 0, vy: 0, a: 0, va: 0, size: 30, resting: false };
  let raf = 0, lastT = 0, grabX = 0, grabY = 0;
  const trail = [];
  const GRAVITY = 2600;
  const place = () => {
    handle.style.left = `${P.x}px`;
    handle.style.top = `${P.y}px`;
    handle.style.transform = `translate(-50%,-50%) rotate(${P.a}rad) scale(${carried ? 1.1 : 1})`;
  };
  const nearBar = () => {
    const r = strike.getBoundingClientRect();
    const cy = r.top + r.height / 2;
    return Math.abs(P.y - cy) < Math.max(30, P.size * 0.9) && P.x > r.left - maxDrag && P.x < r.right + 8;
  };
  const step = (now) => {
    raf = 0;
    const dt = Math.min(0.033, (now - lastT) / 1000 || 0.016);
    lastT = now;
    if (mode !== 'free' || carried) return;
    const W = intro.clientWidth, H = intro.clientHeight, h = P.size / 2;
    const floor = H - 30 - h;
    P.vy += GRAVITY * dt;
    P.x += P.vx * dt;
    P.y += P.vy * dt;
    P.a += P.va * dt;
    if (P.x < h) { P.x = h; P.vx = Math.abs(P.vx) * 0.45; P.va *= -0.6; }
    if (P.x > W - h) { P.x = W - h; P.vx = -Math.abs(P.vx) * 0.45; P.va *= -0.6; }
    let onFloor = false;
    if (P.y >= floor) {
      P.y = floor;
      onFloor = true;
      if (P.vy > 140) {
        uiClick(Math.min(0.9, P.vy / 1500));
        P.vy = -P.vy * 0.32;
        P.va = P.va * 0.5 + P.vx * 0.004;
      } else P.vy = 0;
      P.vx *= Math.max(0, 1 - 5 * dt);
      // Settle flat on one of its sides.
      const q = Math.PI / 2, target = Math.round(P.a / q) * q;
      P.a += (target - P.a) * Math.min(1, dt * 9);
      P.va *= Math.max(0, 1 - 8 * dt);
    }
    place();
    if (onFloor && P.vy === 0 && Math.abs(P.vx) < 4 && Math.abs(P.va) < 0.05) { P.resting = true; return; }
    raf = requestAnimationFrame(step);
  };
  const run = () => { P.resting = false; if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(step); } };
  const detach = (vx) => {
    const r = handle.getBoundingClientRect();
    P.size = handle.offsetWidth;
    P.x = r.left + r.width / 2;
    P.y = r.top + r.height / 2;
    P.vx = Math.max(160, Math.min(900, vx));
    P.vy = -180;
    P.a = 0;
    P.va = 6 + Math.random() * 4;
    mode = 'free';
    dragging = false;
    windRush.stop();
    setCrack(0, true);
    handle.classList.remove('held');
    handle.classList.add('loose');
    handle.style.width = handle.style.height = `${P.size}px`;
    intro.appendChild(handle);
    strike.style.setProperty('--pull', '0px');
    strike.style.setProperty('--reveal', '0');
    uiClick(0.5);
    place();
    run();
  };
  const snapToBar = () => {
    mode = 'bar';
    handle.classList.remove('loose', 'held');
    handle.removeAttribute('style');
    strike.appendChild(handle);
    strike.classList.remove('near');
    measure();
    const r = strike.getBoundingClientRect();
    setOffset(P.x - (r.left + base), false);
    uiClick(0.8);
  };
  handle.addEventListener('pointerdown', (e) => {
    if (done) return;
    e.preventDefault();
    ensureAudio();
    handle.setPointerCapture(e.pointerId);
    uiClick(0.35);
    if (mode === 'free') {
      carried = true;
      grabX = e.clientX - P.x;
      grabY = e.clientY - P.y;
      trail.length = 0;
      handle.classList.add('held');
      place();
      return;
    }
    measure();
    dragging = true;
    startX = e.clientX - dx;
    handle.classList.add('held');
    windRush.start();
  });
  handle.addEventListener('pointermove', (e) => {
    if (mode === 'free') {
      if (!carried) return;
      P.x = e.clientX - grabX;
      P.y = e.clientY - grabY;
      P.a *= 0.85;
      trail.push([e.clientX, e.clientY, performance.now()]);
      if (trail.length > 6) trail.shift();
      strike.classList.toggle('near', nearBar());
      place();
      return;
    }
    if (!dragging) return;
    const raw = e.clientX - startX;
    // Past the right end of the bar: it tips off and falls.
    if (raw > maxRight + 28) {
      const tr = trail.length > 1 ? trail : null;
      handle.releasePointerCapture?.(e.pointerId);
      detach(tr ? 0 : 320);
      return;
    }
    setOffset(raw, false);
    const cp = crackProgress();
    setCrack(cp, false);
    // Air rushing through the opening crack.
    windRush.set(Math.max(0, -dx) / maxDrag, cp);
    if (cp >= 1) unlock();
  });
  const release = (e) => {
    if (mode === 'free') {
      if (!carried) return;
      carried = false;
      handle.classList.remove('held');
      strike.classList.remove('near');
      if (nearBar()) { snapToBar(); return; }
      // Thrown: velocity from the last pointer samples.
      if (trail.length > 1) {
        const [x0, y0, t0] = trail[0], [x1, y1, t1] = trail[trail.length - 1];
        const dtt = Math.max(0.016, (t1 - t0) / 1000);
        P.vx = Math.max(-1800, Math.min(1800, (x1 - x0) / dtt));
        P.vy = Math.max(-1800, Math.min(1800, (y1 - y0) / dtt));
      } else { P.vx = 0; P.vy = 0; }
      P.va = P.vx * 0.006;
      run();
      return;
    }
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('held');
    if (crackProgress() >= 1) unlock();
    else { setOffset(0, true); setCrack(0, true); lastCrackle = 0; windRush.stop(); }
  };
  handle.addEventListener('pointerup', release);
  handle.addEventListener('pointercancel', release);
  addEventListener('resize', () => {
    if (mode === 'free') { P.x = Math.min(P.x, intro.clientWidth - P.size / 2); run(); }
  });
  crackReady = true;
  measure();
  handle.addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'Enter', ' '].includes(e.key)) { e.preventDefault(); ensureAudio(); measure(); unlock(); }
  });
}
document.querySelector('#close').onclick = () => { panel.style.display = 'none'; };
document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyE' && !e.repeat) pressPrompt();
  if (e.code === 'Escape') panel.style.display = 'none';
  if (e.code === 'Space') jump();
});
document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'KeyE') releasePrompt(true);
});
renderer.domElement.addEventListener('click', () => {
  if (started && matchMedia('(pointer:fine)').matches && !panel.matches(':hover')) renderer.domElement.requestPointerLock?.();
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === renderer.domElement) {
    yaw -= e.movementX * 0.0021;
    pitch = Math.max(-1.35, Math.min(1.35, pitch - e.movementY * 0.0021));
  }
});
function jump() { if (grounded && started) { verticalVelocity = 4.6; grounded = false; } }
document.querySelector('#jump').addEventListener('pointerdown', (e) => { e.preventDefault(); jump(); });
const joy = document.querySelector('#joystick');
const knob = document.querySelector('#knob');
function joyUpdate(e) {
  const r = joy.getBoundingClientRect();
  let dx = e.clientX - (r.left + r.width / 2);
  let dy = e.clientY - (r.top + r.height / 2);
  const len = Math.hypot(dx, dy);
  const s = Math.min(1, len / 39);
  if (len) { dx = dx / len * s; dy = dy / len * s; }
  movement.x = dx;
  movement.y = -dy;
  knob.style.transform = `translate(${dx * 39}px,${dy * 39}px)`;
}
joy.addEventListener('pointerdown', (e) => { joy.setPointerCapture(e.pointerId); joyUpdate(e); });
joy.addEventListener('pointermove', (e) => { if (joy.hasPointerCapture(e.pointerId)) joyUpdate(e); });
function resetJoy() { movement.x = movement.y = 0; knob.style.transform = ''; }
joy.addEventListener('pointerup', resetJoy);
joy.addEventListener('pointercancel', resetJoy);
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch' && e.clientX > innerWidth * 0.36) dragLook = { id: e.pointerId, x: e.clientX, y: e.clientY };
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (dragLook?.id === e.pointerId) {
    yaw -= (e.clientX - dragLook.x) * 0.004;
    pitch = Math.max(-1.25, Math.min(1.25, pitch - (e.clientY - dragLook.y) * 0.004));
    dragLook.x = e.clientX;
    dragLook.y = e.clientY;
  }
});
renderer.domElement.addEventListener('pointerup', (e) => { if (dragLook?.id === e.pointerId) dragLook = null; });
function interact() {
  if (level === 'hall' && camera.position.distanceTo(door.pos) < 3.4) {
    door.open = !door.open;
    doorRub();
    return;
  }
  if (level === 'hall' && camera.position.distanceTo(portalHall.position) < 2.7) {
    setLevel('valley');
    return;
  }
  if (level === 'valley' && camera.position.distanceTo(portalValley.position) < 3.4) {
    setLevel('hall');
    return;
  }
  if (level === 'hall' && camera.position.distanceTo(winMesh.position) < 2.4) {
    CH.poke();
    return;
  }
  if (!activeWork) return;
  document.querySelector('#artTitle').textContent = activeWork.name;
  document.querySelector('#artText').textContent = activeWork.desc;
  panel.style.display = 'block';
  document.exitPointerLock?.();
}

// Interaction prompt feel: holding E (or a finger on the prompt) contracts
// it slightly; releasing triggers the action with a soft click.
let promptHeld = false;
const nearDoorNow = () => level === 'hall' && camera.position.distanceTo(door.pos) < 3.4;
function pressPrompt() {
  if (!hint.classList.contains('visible')) return;
  promptHeld = true;
  hint.classList.add('pressed');
  if (!nearDoorNow()) uiClick(0.35);
}
function releasePrompt(fire) {
  if (!promptHeld) return;
  promptHeld = false;
  hint.classList.remove('pressed');
  if (fire && hint.classList.contains('visible')) {
    if (!nearDoorNow()) uiClick(1);
    interact();
  }
}
// Soft UI click synthesised on the fly: a short muted tick (filtered noise)
// over a low, quickly damped "tock". Its own tiny audio context, so it works
// whether or not the ambient sound is switched on.
let uiCtx = null;
// Concrete cracking: a few dry crackles, one sharp snap, a short gritty
// rumble of falling grains and a dull low thud. Synthesised on the fly.
// Air through the crack (the game-UI "wind through a fissure" idea):
// filtered noise that is born when you grab the arrow, swells and opens up
// (higher, brighter, a faint whistle) as the fissure grows, and exhales
// softly when the gallery opens. No impact, no crunch.
const windRush = (() => {
  let src = null, bp = null, whistle = null, wg = null, g = null;
  const ctx = () => { if (!uiCtx) uiCtx = new (window.AudioContext || window.webkitAudioContext)(); if (uiCtx.state === 'suspended') uiCtx.resume(); return uiCtx; };
  return {
    start() {
      try {
        const c = ctx();
        if (src) return;
        const n = c.sampleRate * 3, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
        let lp = 0;
        for (let i = 0; i < n; i++) { lp += 0.25 * ((Math.random() * 2 - 1) - lp); d[i] = lp; }
        src = c.createBufferSource(); src.buffer = b; src.loop = true;
        bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 320; bp.Q.value = 1.2;
        const soft = c.createBiquadFilter(); soft.type = 'lowpass'; soft.frequency.value = 1400;
        whistle = c.createBiquadFilter(); whistle.type = 'bandpass'; whistle.frequency.value = 900; whistle.Q.value = 18;
        wg = c.createGain(); wg.gain.value = 0;
        g = c.createGain(); g.gain.value = 0;
        src.connect(bp).connect(soft).connect(g).connect(c.destination);
        src.connect(whistle).connect(wg).connect(c.destination);
        src.start();
        g.gain.setTargetAtTime(0.007, c.currentTime, 0.25);
      } catch (e) { /* audio indisponible */ }
    },
    set(pull, crack) {
      if (!src) return;
      const c = uiCtx, t = c.currentTime;
      bp.frequency.setTargetAtTime(320 + 700 * crack + 100 * pull, t, 0.15);
      g.gain.setTargetAtTime(0.007 + 0.022 * crack, t, 0.15);
      whistle.frequency.setTargetAtTime(650 + 500 * crack, t, 0.2);
      wg.gain.setTargetAtTime(0.0025 * crack * crack, t, 0.2);
    },
    stop() {
      if (!src) return;
      const c = uiCtx, s0 = src;
      g.gain.setTargetAtTime(0, c.currentTime, 0.18); wg.gain.setTargetAtTime(0, c.currentTime, 0.18);
      setTimeout(() => { try { s0.stop(); } catch (e) {} }, 900);
      src = null;
    },
    exhale() {
      if (!src) this.start();
      if (!src) return;
      const c = uiCtx, t = c.currentTime, s0 = src;
      bp.frequency.setTargetAtTime(1000, t, 0.2); bp.frequency.setTargetAtTime(380, t + 0.5, 0.7);
      g.gain.setTargetAtTime(0.03, t, 0.2); g.gain.setTargetAtTime(0, t + 0.5, 0.7);
      wg.gain.setTargetAtTime(0.003, t, 0.2); wg.gain.setTargetAtTime(0, t + 0.4, 0.5);
      setTimeout(() => { try { s0.stop(); } catch (e) {} }, 4500);
      src = null;
    },
  };
})();
// Stone giving way, very softly: short low-mid grinding grains (no bright
// clicks), each with a tiny dull knock. Barely there.
function crackle(level = 0.4) {
  try {
    if (!uiCtx) uiCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (uiCtx.state === 'suspended') uiCtx.resume();
    const ctx = uiCtx, sr = ctx.sampleRate, t0 = ctx.currentTime + 0.005;
    const n = Math.floor(sr * (0.05 + Math.random() * 0.05));
    const b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
    // Grainy: sparse impulses smeared together, not white hiss.
    for (let i = 0; i < n; i++) d[i] = (Math.random() < 0.18 ? (Math.random() * 2 - 1) : 0) * Math.pow(1 - i / n, 1.6);
    const src = ctx.createBufferSource(); src.buffer = b;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 380 + Math.random() * 420; bp.Q.value = 0.9;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    const g = ctx.createGain(); g.gain.value = 0.05 * level;
    src.connect(bp).connect(lp).connect(g).connect(ctx.destination);
    src.start(t0);
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(120 + Math.random() * 40, t0); o.frequency.exponentialRampToValueAtTime(60, t0 + 0.06);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, t0); og.gain.exponentialRampToValueAtTime(0.02 * level, t0 + 0.006); og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08);
    o.connect(og).connect(ctx.destination); o.start(t0); o.stop(t0 + 0.1);
  } catch (e) { /* audio indisponible */ }
}
function concreteCrack() {
  try {
    if (!uiCtx) uiCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (uiCtx.state === 'suspended') uiCtx.resume();
    const ctx = uiCtx, sr = ctx.sampleRate, now = ctx.currentTime + 0.01;
    const out = ctx.createGain();
    out.gain.value = 0.32;
    out.connect(ctx.destination);
    const noiseBuf = (sec, shape) => {
      const n = Math.floor(sr * sec), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * shape(i / n);
      return b;
    };
    const play = (buf, t, type, freq, q, gain) => {
      const src = ctx.createBufferSource(); src.buffer = buf;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = gain;
      src.connect(f).connect(g).connect(out); src.start(t);
    };
    // Crackles: tiny clicks spread over ~0.35 s, getting fainter.
    for (let i = 0; i < 11; i++) {
      const t = now + Math.pow(Math.random(), 1.6) * 0.35;
      play(noiseBuf(0.004 + Math.random() * 0.008, (u) => Math.pow(1 - u, 3)), t, 'bandpass', 1800 + Math.random() * 2600, 1.2, 0.5 * (1 - (t - now) / 0.4));
    }
    // The snap.
    play(noiseBuf(0.06, (u) => Math.exp(-u * 9)), now + 0.04, 'highpass', 900, 0.7, 0.9);
    // Gritty rumble of grains.
    play(noiseBuf(0.5, (u) => Math.exp(-u * 4) * (0.6 + 0.4 * Math.random())), now + 0.05, 'lowpass', 420, 0.6, 0.6);
    // Dull thud.
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(95, now + 0.04);
    o.frequency.exponentialRampToValueAtTime(42, now + 0.22);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, now + 0.04);
    og.gain.exponentialRampToValueAtTime(0.55, now + 0.05);
    og.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    o.connect(og).connect(out); o.start(now + 0.04); o.stop(now + 0.35);
  } catch (e) { /* audio indisponible */ }
}
function uiClick(level = 1) {
  try {
    if (!uiCtx) uiCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (uiCtx.state === 'suspended') uiCtx.resume();
    const t0 = uiCtx.currentTime + 0.005;
    const out = uiCtx.createGain();
    out.gain.value = 0.11 * level;
    out.connect(uiCtx.destination);
    const len = Math.floor(uiCtx.sampleRate * 0.03);
    const buf = uiCtx.createBuffer(1, len, uiCtx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
    const tick = uiCtx.createBufferSource();
    tick.buffer = buf;
    const lp = uiCtx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    const tg = uiCtx.createGain();
    tg.gain.value = 0.55;
    tick.connect(lp).connect(tg).connect(out);
    tick.start(t0);
    const osc = uiCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, t0);
    osc.frequency.exponentialRampToValueAtTime(170, t0 + 0.07);
    const og = uiCtx.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(0.7, t0 + 0.004);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
    osc.connect(og).connect(out);
    osc.start(t0);
    osc.stop(t0 + 0.11);
  } catch (e) { /* audio indisponible */ }
}

// ---- Ambiance sonore (toujours active) ----
// A small live mix, every layer synthesised: dawn mountain wind, nature
// waking (rare distant birds), the outdoor stream, the indoor canal with
// drips, fish swishes and splashes. Each bus is steered every frame by
// where you stand: deep in the hall, near the glass bay, on the terrace or
// down in the valley. Started by the first touch on the entry arrow.
let audioCtx = null;
const AUD = {};
function noiseBuffer(ctx, seconds, brown = false) {
  const n = Math.floor(ctx.sampleRate * seconds), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return b;
}
// Recognisable running water: many tiny resonant "bubbles" (rising, fast
// decaying sine chirps — the acoustic signature of a brook) over a soft
// bed of filtered noise. Rendered once into a loopable buffer.
function brookBuffer(ctx, seconds, density, fMin, fMax, bed) {
  const sr = ctx.sampleRate, n = Math.floor(sr * seconds);
  const b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < n; i++) { lp += 0.08 * ((Math.random() * 2 - 1) - lp); d[i] = lp * bed; }
  const count = Math.floor(density * seconds);
  for (let k = 0; k < count; k++) {
    const start = Math.floor(Math.random() * n);
    const f0 = fMin * Math.pow(fMax / fMin, Math.random());
    const tau = 0.006 + Math.random() * 0.02;
    const rise = 2 + Math.random() * 6;
    const amp = (0.03 + Math.random() * 0.06) * Math.pow(fMin / f0, 0.35);
    const len = Math.floor(sr * tau * 5);
    let ph = 0;
    for (let j = 0; j < len; j++) {
      const t = j / sr;
      ph += 2 * Math.PI * f0 * (1 + rise * t) / sr;
      d[(start + j) % n] += Math.sin(ph) * amp * Math.exp(-t / tau);
    }
  }
  return b;
}
// Synthetic room tail for the concrete hall (exponentially decaying noise).
function roomImpulse(ctx, seconds) {
  const sr = ctx.sampleRate, n = Math.floor(sr * seconds), b = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2) * (i < sr * 0.012 ? i / (sr * 0.012) : 1);
  }
  return b;
}
function ensureAudio() {
  if (audioCtx) { if (audioCtx.state === 'suspended') audioCtx.resume(); return; }
  try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  const ctx = audioCtx;
  const master = ctx.createGain();
  master.gain.value = 0.55;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20; comp.ratio.value = 3; comp.attack.value = 0.02; comp.release.value = 0.4;
  master.connect(comp).connect(ctx.destination);
  const bus = (cutoff) => {
    const g = ctx.createGain(); g.gain.value = 0;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
    g.connect(f).connect(master);
    return { g, f };
  };
  const loop = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
  const white = noiseBuffer(ctx, 8), brown = noiseBuffer(ctx, 12, true);

  // Concrete hall reverb, fed by indoor sounds (steps, canal, drips).
  AUD.room = ctx.createGain(); AUD.room.gain.value = 0;
  const conv = ctx.createConvolver(); conv.buffer = roomImpulse(ctx, 2.4);
  const wet = ctx.createGain(); wet.gain.value = 0.5;
  AUD.room.connect(conv).connect(wet).connect(master);

  // Breeze, Japanese-garden quiet: no rumble, just air and a few leaves.
  AUD.wind = bus(5000);
  {
    const air = ctx.createBiquadFilter(); air.type = 'bandpass'; air.frequency.value = 1600; air.Q.value = 0.45;
    AUD.gust = ctx.createGain(); AUD.gust.gain.value = 0.04;
    loop(white).connect(air).connect(AUD.gust).connect(AUD.wind.g);
    // Leaves: high, fluttering, very faint.
    const leaf = ctx.createBiquadFilter(); leaf.type = 'highpass'; leaf.frequency.value = 3800;
    const lg = ctx.createGain(); lg.gain.value = 0.012;
    const flutter = ctx.createOscillator(); flutter.frequency.value = 7.3;
    const fg = ctx.createGain(); fg.gain.value = 0.01;
    flutter.connect(fg).connect(lg.gain); flutter.start();
    loop(white).connect(leaf).connect(lg).connect(AUD.wind.g);
    AUD.whistle = air;
  }
  // Outdoor stream: a lively brook.
  // Outdoor stream: far below the terrace, so no bubbles at all — a soft,
  // distant murmur that slowly breathes, in the same delicate key as inside.
  AUD.stream = bus(1600);
  {
    const lo = ctx.createBiquadFilter(); lo.type = 'lowpass'; lo.frequency.value = 900; lo.Q.value = 0.4;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 160;
    const body = ctx.createGain(); body.gain.value = 0.5;
    loop(white).connect(hp).connect(lo).connect(body).connect(AUD.stream.g);
    const mid = ctx.createBiquadFilter(); mid.type = 'bandpass'; mid.frequency.value = 650; mid.Q.value = 0.8;
    const mg = ctx.createGain(); mg.gain.value = 0.18;
    loop(white).connect(mid).connect(mg).connect(AUD.stream.g);
    // Slow breathing of the murmur.
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lg = ctx.createGain(); lg.gain.value = 0.12;
    lfo.connect(lg).connect(body.gain); lfo.start();
  }
  // Indoor canal: a calm, sparse trickle, close and intimate.
  AUD.canal = bus(5200); // (kept for routing; the canal itself is still water)
  // Event sounds in the hall (fish bubbles & splashes, drips): dry + room.
  AUD.fx = ctx.createGain(); AUD.fx.gain.value = 0;
  AUD.fx.connect(master);
  const fxSend = ctx.createGain(); fxSend.gain.value = 0.35;
  AUD.fx.connect(fxSend).connect(AUD.room);
  // Air through the ceiling slots: narrow-band, faintly "sung" noise.
  AUD.slot = bus(4000);
  AUD.slotBands = [];
  for (const [f, q, g] of [[640, 7, 0.55], [1290, 9, 0.22], [2050, 10, 0.08]]) {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
    const gg = ctx.createGain(); gg.gain.value = g;
    loop(white).connect(bp).connect(gg).connect(AUD.slot.g);
    AUD.slotBands.push([bp, f]);
  }
  // Draught through the open glass door.
  AUD.draft = bus(3200);
  {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 950; bp.Q.value = 1.2;
    const gg = ctx.createGain(); gg.gain.value = 0.6;
    loop(white).connect(bp).connect(gg).connect(AUD.draft.g);
    const tone = ctx.createBiquadFilter(); tone.type = 'bandpass'; tone.frequency.value = 460; tone.Q.value = 5;
    const tg = ctx.createGain(); tg.gain.value = 0.3;
    loop(white).connect(tone).connect(tg).connect(AUD.draft.g);
  }
  // Footsteps bus (dry) + reverb send.
  AUD.steps = ctx.createGain(); AUD.steps.gain.value = 1;
  AUD.steps.connect(master);
  AUD.stepSend = ctx.createGain(); AUD.stepSend.gain.value = 0.14;
  AUD.steps.connect(AUD.stepSend).connect(AUD.room);
  AUD.stepBuf = noiseBuffer(ctx, 0.4);
  // Nature waking: its own bus, filtered by how "outside" you are.
  AUD.nature = bus(3000);
  AUD.gustTarget = 0.05;
  AUD.started = ctx.currentTime;
  scheduleBird();
  scheduleDrip();
}
// One distant bird: a short phrase of quick falling whistles, sometimes a trill.
function birdPhrase(t0, pitch, gain) {
  const ctx = audioCtx;
  const notes = 3 + ((Math.random() * 5) | 0);
  let t = t0;
  for (let i = 0; i < notes; i++) {
    const o = ctx.createOscillator(); o.type = 'sine';
    const f0 = pitch * (1 + (Math.random() - 0.5) * 0.12) * (1 - i * 0.03);
    const dur = 0.05 + Math.random() * 0.09;
    o.frequency.setValueAtTime(f0 * 1.15, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.82, t + dur);
    const vib = ctx.createOscillator(); vib.frequency.value = 28 + Math.random() * 20;
    const vg = ctx.createGain(); vg.gain.value = f0 * 0.025;
    vib.connect(vg).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(AUD.nature.g);
    o.start(t); o.stop(t + dur + 0.02); vib.start(t); vib.stop(t + dur + 0.02);
    t += dur + 0.03 + Math.random() * 0.08;
  }
}
function scheduleBird() {
  setTimeout(() => {
    if (audioCtx && audioCtx.state === 'running') {
      const t0 = audioCtx.currentTime + 0.05;
      const pitch = 2600 + Math.random() * 2000;
      birdPhrase(t0, pitch, 0.018 + Math.random() * 0.02);
      // Sometimes another, farther bird answers.
      if (Math.random() < 0.35) birdPhrase(t0 + 1.2 + Math.random() * 1.5, 2200 + Math.random() * 2200, 0.01 + Math.random() * 0.012);
    }
    scheduleBird();
  }, 9000 + Math.random() * 18000);
}
// Drips from the canal-side plants.
function scheduleDrip() {
  setTimeout(() => {
    if (audioCtx && audioCtx.state === 'running') {
      const ctx = audioCtx, t0 = ctx.currentTime + 0.02;
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(320 + Math.random() * 250, t0);
      o.frequency.exponentialRampToValueAtTime(650 + Math.random() * 300, t0 + 0.07);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime((0.004 + Math.random() * 0.006) * (AUD.canalNear || 0) + 0.0002, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.11);
      g.gain.value *= 1;
      o.connect(g).connect(AUD.fx);
      o.start(t0); o.stop(t0 + 0.14);
    }
    scheduleDrip();
  }, 2500 + Math.random() * 8000);
}
// A fish brushing the water nearby: a soft, short swish.
function fishSwish(level) {
  if (!audioCtx || audioCtx.state !== 'running') return;
  const ctx = audioCtx, t0 = ctx.currentTime + 0.01;
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 0.35);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(500, t0); bp.frequency.linearRampToValueAtTime(900, t0 + 0.3); bp.Q.value = 2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.05 * level, t0 + 0.08);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.33);
  src.connect(bp).connect(g).connect(AUD.fx);
  src.start(t0);
}
// A fish darting: a short string of bubbles and a swirl of water.
// The big pivot door turning: a light, low rub along the floor that
// follows the swing — no click.
function doorRub() {
  if (!audioCtx || audioCtx.state !== 'running') return;
  const ctx = audioCtx, t0 = ctx.currentTime + 0.02, dur = 1.25;
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, dur + 0.4, true);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
  bp.frequency.setValueAtTime(520, t0); bp.frequency.linearRampToValueAtTime(330, t0 + dur);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(0.045, t0 + 0.25);
  g.gain.linearRampToValueAtTime(0.035, t0 + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.3);
  src.connect(bp).connect(lp).connect(g).connect(AUD.fx || ctx.destination);
  src.start(t0);
}
function waterStir(level, dur) {
  if (!audioCtx || audioCtx.state !== 'running' || level < 0.02) return;
  const ctx = audioCtx, t0 = ctx.currentTime + 0.01;
  const n = 3 + ((Math.random() * 4) | 0);
  for (let i = 0; i < n; i++) {
    const tb = t0 + Math.pow(Math.random(), 0.8) * dur;
    const f0 = 320 * Math.pow(3.5, Math.random());
    const tau = 0.012 + Math.random() * 0.03;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f0, tb); o.frequency.exponentialRampToValueAtTime(f0 * (1.4 + Math.random() * 0.8), tb + tau * 3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, tb); g.gain.exponentialRampToValueAtTime((0.012 + Math.random() * 0.016) * level, tb + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, tb + tau * 4);
    o.connect(g).connect(AUD.fx); o.start(tb); o.stop(tb + tau * 4 + 0.02);
  }
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, dur + 0.3);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(500, t0); bp.frequency.linearRampToValueAtTime(900, t0 + dur); bp.Q.value = 1.6;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.02 * level, t0 + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.25);
  src.connect(bp).connect(g).connect(AUD.fx); src.start(t0);
}
// A fish jumping: a light splash going in, then a couple of droplets.
function fishSplash(level) {
  if (!audioCtx || audioCtx.state !== 'running' || level < 0.02) return;
  const ctx = audioCtx, t0 = ctx.currentTime + 0.01;
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 0.25);
  const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 1400; hp.Q.value = 0.6;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.022 * level, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
  src.connect(hp).connect(g).connect(AUD.fx);
  src.start(t0);
  for (let k = 0; k < 3; k++) {
    const td = t0 + 0.18 + Math.random() * 0.35;
    const d = ctx.createOscillator();
    d.frequency.setValueAtTime(700 + Math.random() * 500, td); d.frequency.exponentialRampToValueAtTime(1300 + Math.random() * 400, td + 0.04);
    const dg = ctx.createGain();
    dg.gain.setValueAtTime(0.0001, td); dg.gain.exponentialRampToValueAtTime(0.008 * level, td + 0.006); dg.gain.exponentialRampToValueAtTime(0.0001, td + 0.06);
    d.connect(dg).connect(AUD.fx); d.start(td); d.stop(td + 0.08);
  }
}
// One soft step: slippers on cold concrete. A muffled padded contact,
// a faint fabric scuff, a hint of heel. On the valley's moss: duller.
function footstep(side, soft) {
  if (!audioCtx || audioCtx.state !== 'running') return;
  const ctx = audioCtx, t0 = ctx.currentTime + 0.005;
  const v = (0.8 + Math.random() * 0.4) * (soft ? 0.7 : 1);
  // Two muffled fabric contacts: heel, then the ball of the foot rolling
  // down a moment later. Soft attacks, no tonal thud — just felt on stone.
  const touch = (at, gain, cutoff, len) => {
    const src = ctx.createBufferSource(); src.buffer = AUD.stepBuf;
    src.playbackRate.value = 0.7 + Math.random() * 0.25;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff; lp.Q.value = 0.5;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 140;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    src.connect(hp).connect(lp).connect(g).connect(AUD.steps);
    src.start(at, Math.random() * 0.2, len + 0.05);
  };
  // Barely there: you guess your steps more than you hear them.
  const cut = (soft ? 360 : 480) + Math.random() * 120 + side * 25;
  touch(t0, 0.009 * v, cut, 0.12);
  touch(t0 + 0.07 + Math.random() * 0.04, 0.0055 * v, cut * 1.2, 0.13);
}
// On moss: a soft, flat press of the foot into something yielding — damp
// and muffled, no crackle.
function mossStep(side) {
  if (!audioCtx || audioCtx.state !== 'running') return;
  const ctx = audioCtx, t0 = ctx.currentTime + 0.005, v = 0.8 + Math.random() * 0.4;
  const src = ctx.createBufferSource(); src.buffer = AUD.stepBuf; src.playbackRate.value = 0.55 + Math.random() * 0.2;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260 + Math.random() * 80 + side * 15; lp.Q.value = 0.4;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.012 * v, t0 + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);
  src.connect(lp).connect(g).connect(AUD.steps); src.start(t0, Math.random() * 0.15, 0.3);
}
// In the water: a light slosh as the foot moves through, a little swirl
// and a couple of drops. Light.
function wadeStep(side) {
  if (!audioCtx || audioCtx.state !== 'running') return;
  const ctx = audioCtx, t0 = ctx.currentTime + 0.005, v = 0.8 + Math.random() * 0.4;
  const src = ctx.createBufferSource(); src.buffer = AUD.stepBuf; src.playbackRate.value = 0.8 + Math.random() * 0.2;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(700 + side * 40, t0); bp.frequency.linearRampToValueAtTime(1100, t0 + 0.25); bp.Q.value = 0.9;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.014 * v, t0 + 0.06);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);
  src.connect(bp).connect(g).connect(AUD.steps); src.start(t0, Math.random() * 0.05, 0.38);
  for (let k = 0; k < 2; k++) {
    const td = t0 + 0.12 + Math.random() * 0.2;
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(500 + Math.random() * 400, td); o.frequency.exponentialRampToValueAtTime(900 + Math.random() * 400, td + 0.04);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, td); og.gain.exponentialRampToValueAtTime(0.004 * v, td + 0.005); og.gain.exponentialRampToValueAtTime(0.0001, td + 0.06);
    o.connect(og).connect(AUD.steps); o.start(td); o.stop(td + 0.08);
  }
}
const stepState = { prev: new THREE.Vector3(), acc: 0, side: 1, init: false };
// Per-frame mix: where are we?
function updateAudio(dt, t) {
  if (!audioCtx || !AUD.wind) return;
  const cx = camera.position.x, cz = camera.position.z;
  const glassZ = HALL.north + 0.2;
  let outdoor, bayNear, canalVol, streamVol;
  if (level === 'valley') {
    outdoor = 1; bayNear = 0; canalVol = 0;
    const d = Math.abs(cx - VALLEY.x - dsMeander(cz - VALLEY.z));
    streamVol = 0.15 + 0.75 * Math.max(0, 1 - d / 30);
  } else if (cz > glassZ) {
    // Terrace: outside but covered; the stream rises from below.
    outdoor = 0.75; bayNear = 1; canalVol = 0;
    streamVol = 0.55 + 0.2 * Math.min(1, (cz - glassZ) / 8);
  } else {
    bayNear = Math.max(0, 1 - (glassZ - cz) / 10);
    bayNear *= bayNear;
    // Through the closed glass the outside is a faint presence; the open
    // door lets it in progressively as the leaf turns.
    const opening = door.angle / DOOR_OPEN_ANGLE;
    outdoor = 0.1 + bayNear * (0.12 + 0.4 * opening);
    streamVol = 0.025 + bayNear * (0.05 + 0.35 * opening);
    const dEdge = Math.min(cx - CHANNEL.ix0, CHANNEL.ix1 - cx, cz - CHANNEL.iz0, CHANNEL.iz1 - cz, Math.max(0, Math.abs(cz - CROSS.zc) - HALL.channel / 2));
    canalVol = cz <= HALL.doorZ ? 0.1 + 0.45 * Math.max(0, 1 - (ENTRY.chX0 - cx) / 4) : 0.12 + 0.5 * Math.max(0, 1 - dEdge / 8);
  }
  // Slowly wandering gusts (very light at dawn).
  if (Math.random() < dt * 0.2) AUD.gustTarget = 0.015 + Math.random() * 0.05;
  const k = Math.min(1, dt * 1.5), ks = Math.min(1, dt * 0.4);
  const set = (param, v, kk = k) => { param.value += (v - param.value) * kk; };
  // Fade the whole ambience in over the first seconds.
  const fadeIn = Math.min(1, (audioCtx.currentTime - AUD.started) / 6);
  set(AUD.gust.gain, AUD.gustTarget * 0.6, ks);
  // Kept very low: the ambience gives the space an identity, never more.
  const OUT = 0.65; // overall level of everything coming from outside
  set(AUD.wind.g.gain, (0.022 + 0.09 * outdoor) * OUT * fadeIn);
  set(AUD.wind.f.frequency, 1200 + 5000 * outdoor);
  set(AUD.nature.g.gain, (0.1 + 0.9 * outdoor) * OUT * fadeIn);
  set(AUD.nature.f.frequency, 1500 + 3500 * outdoor);
  set(AUD.stream.g.gain, streamVol * 0.07 * OUT * fadeIn);
  set(AUD.stream.f.frequency, 700 + 900 * Math.min(1, outdoor * 1.2));
  set(AUD.canal.g.gain, canalVol * 0.16 * fadeIn);
  AUD.canalNear = level === 'valley' || cz > glassZ ? 0 : Math.min(1, canalVol * 1.6);
  set(AUD.fx.gain, (level === 'valley' ? 0 : 1) * fadeIn);
  // Wind through the ceiling slots: stronger right under one, follows gusts.
  const gustN = AUD.gust.gain.value / 0.024;
  let slotNear = 0;
  if (level !== 'valley' && cz < glassZ) {
    for (const [x0, z0, x1, z1] of sunBars) {
      const dx = Math.max(x0 - cx, 0, cx - x1), dzb = Math.max(z0 - cz, 0, cz - z1);
      slotNear = Math.max(slotNear, 1 - Math.min(1, Math.hypot(dx, dzb) / 2.5));
    }
    set(AUD.slot.g.gain, (0.004 + 0.016 * slotNear) * gustN * 0.8 * fadeIn);
  } else set(AUD.slot.g.gain, 0);
  for (const [bp, f] of AUD.slotBands) bp.frequency.value = f * (0.97 + 0.06 * gustN);
  // Draught at the open door.
  const doorOpen = door.angle / DOOR_OPEN_ANGLE;
  const doorNear = level === 'valley' ? 0 : Math.max(0, 1 - camera.position.distanceTo(door.pos) / 7);
  set(AUD.draft.g.gain, 0.03 * doorOpen * doorNear * gustN * OUT * fadeIn);
  // The concrete hall answers indoors, a little on the covered terrace.
  const roomAmt = level === 'valley' ? 0 : (cz > glassZ ? 0.25 : 1);
  set(AUD.room.gain, 0.5 * roomAmt);
  // Footsteps: one every ~0.72 m walked on the ground.
  const p = camera.position;
  if (!stepState.init) { stepState.prev.copy(p); stepState.init = true; }
  const moved = Math.hypot(p.x - stepState.prev.x, p.z - stepState.prev.z);
  stepState.prev.copy(p);
  if (grounded && started && moved < 1) {
    stepState.acc += moved;
    if (stepState.acc > (playerSurface === 'water' ? 0.95 : 1.15)) {
      stepState.acc = 0;
      stepState.side = -stepState.side;
      if (playerSurface === 'water') wadeStep(stepState.side);
      else if (playerSurface === 'moss') mossStep(stepState.side);
      else footstep(stepState.side, level === 'valley');
    }
  } else if (!grounded) stepState.acc = 0.5;
}

const clock = new THREE.Clock();
let t = 0;
// ---- Résolution dynamique + compteur d'images -------------------------------
// Toutes les ~1,5 s : si on tombe sous 40 i/s, la résolution interne baisse ;
// au-dessus de 57 i/s elle remonte, dans les bornes du préréglage.
let frameCount = 0;
let fpsFrames = 0;
let fpsT0 = 0;
const qualityBtn = document.createElement('button');
qualityBtn.id = 'quality';
qualityBtn.title = 'Changer la qualité graphique (recharge la page)';
const QUALITY_LABEL = { low: 'LÉGER', medium: 'MOYEN', high: 'ÉLEVÉ' };
qualityBtn.textContent = `QUALITÉ : ${QUALITY_LABEL[QUALITY]}`;
qualityBtn.style.cssText = 'position:absolute;top:26px;right:28px;pointer-events:auto;cursor:pointer;font-size:11px';
qualityBtn.className = 'hudBtn';
qualityBtn.onclick = (e) => {
  e.stopPropagation();
  const next = QUALITIES[(QUALITIES.indexOf(QUALITY) + 1) % QUALITIES.length];
  const url = new URL(location.href);
  url.searchParams.set('q', next);
  location.href = url.toString();
};
document.querySelector('#hud').append(qualityBtn);
function adaptResolution(now) {
  fpsFrames++;
  const span = now - fpsT0;
  if (span < 1.5) return;
  const fps = fpsFrames / span;
  fpsFrames = 0;
  fpsT0 = now;
  qualityBtn.textContent = `QUALITÉ : ${QUALITY_LABEL[QUALITY]} · ${Math.round(fps)} i/s`;
  if (document.hidden) return;
  const cap = Math.min(devicePixelRatio, Q.maxScale);
  let next = renderScale;
  if (fps < 40) next = Math.max(Q.minScale, renderScale * (fps < 25 ? 0.8 : 0.9));
  else if (fps > 57) next = Math.min(cap, renderScale * 1.08);
  if (Math.abs(next - renderScale) > 0.02) {
    renderScale = next;
    renderer.setPixelRatio(renderScale);
    composer.setPixelRatio(renderScale);
  }
}

if (import.meta.env.DEV) window.__inga = { camera, canOccupy, walkGround, door, scene, dsHeight, dsMeander, VALLEY, look: (y, p) => { yaw = y; pitch = p; }, setLevel, quality: QUALITY, scale: () => renderScale };

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.045);
  // Door swings with a soft ease-out toward its target.
  if (door.leaf) {
    const target = door.open ? DOOR_OPEN_ANGLE : 0;
    door.angle += (target - door.angle) * Math.min(1, dt * 3.2);
    door.leaf.rotation.y = door.angle;
  }
  t += dt;
  if (started) {
    CH.disturb();
    CH.step(2);
    drawWindow();
  }
  fishSwimShared.uTime.value = t;
  let ri = 0;
  for (const f of fish) {
    // Now and then a fish darts: a burst of speed, zigzags, tail beating —
    // and that movement is what stirs the water (bubbles, a ring).
    f.dartIn = (f.dartIn ?? 8 + Math.random() * 40) - dt;
    if (f.dartIn <= 0 && !f.dart && !f.jump) {
      f.dartIn = 25 + Math.random() * 45;
      f.dart = { t0: t, dur: 0.7 + Math.random() * 0.6 };
      if (level === 'hall') {
        const d = camera.position.distanceTo(f.group.position);
        waterStir(0.22 * Math.max(0, 1 - d / 12) * (f.cat ? 0.6 : 1), f.dart.dur);
      }
      splashAt(f.group.position, 0, true);
    }
    let boost = 1, wig = 0;
    if (f.dart) {
      const u = (t - f.dart.t0) / f.dart.dur;
      if (u >= 1) f.dart = null;
      else { boost = 1 + 2.4 * Math.sin(Math.PI * u); wig = Math.sin(u * 22) * 0.1 * Math.sin(Math.PI * u); }
    }
    // Calm rhythm: sometimes they drift almost to a stop, then go on.
    const pace = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * (f.cat ? 0.07 : 0.11) + f.phase * 2.3));
    const v = f.speed * pace * boost;
    f.dist += v * dt;
    const dir = sampleLoop(f.dist, _fishPos, f.loop);
    _fishPerp.set(-dir.z, 0, dir.x);
    _fishPos.addScaledVector(_fishPerp, f.lane + Math.sin(t * (0.35 + f.speed * 0.4) + f.phase) * 0.09 + wig);
    _fishPos.y = f.depth + Math.sin(t * 0.5 + f.phase) * 0.015;
    let lift = 0;
    if (f.jump) {
      const u = (t - f.jump.t0) / f.jump.dur;
      if (u >= 1) f.jump = null;
      else {
        lift = Math.sin(Math.PI * u) * ((CANAL_WATER_Y - f.depth) + f.jump.h);
        const above = _fishPos.y + lift > CANAL_WATER_Y;
        // Splash where it breaks the surface: out (lighter), then back in.
        if (above && !f.jump.out) { f.jump.out = true; splashAt(_fishPos, 0.35); }
        if (!above && f.jump.out && !f.jump.back) { f.jump.back = true; splashAt(_fishPos, 0.55); }
      }
    }
    _fishPos.y += lift;
    // Heading follows the fish's real motion (smoothed), so it turns with
    // the corners and with its own weaving.
    if (!f.head) { f.head = dir.clone(); f.prev = _fishPos.clone(); }
    const mvx = _fishPos.x - f.prev.x, mvz = _fishPos.z - f.prev.z, mv = Math.hypot(mvx, mvz);
    if (mv > 1e-5) {
      const k = Math.min(1, dt * 7);
      f.head.x += (mvx / mv - f.head.x) * k;
      f.head.z += (mvz / mv - f.head.z) * k;
      f.head.y = 0;
      f.head.normalize();
    }
    f.prev.copy(_fishPos);
    f.group.position.copy(_fishPos);
    _fishAhead.copy(_fishPos).addScaledVector(f.head, 1);
    if (f.jump) _fishAhead.y += Math.cos(Math.PI * ((t - f.jump.t0) / f.jump.dur)) * 0.9;
    f.group.lookAt(_fishAhead);
    // Whole-body sway and a touch of roll with each stroke.
    const stroke = t * f.mat.userData.swim.uFreq.value * 0.5 + f.phase;
    f.group.rotateY(Math.sin(stroke) * (f.cat ? 0.05 : 0.09));
    f.group.rotateZ(Math.sin(stroke + 1.2) * 0.04);
    // Tail beat follows speed.
    // Stronger, faster tail beat when it speeds up.
    const effort = Math.min(2.2, Math.abs(v) / Math.abs(f.speed || 1));
    f.mat.userData.swim.uAmp.value = (f.cat ? 0.08 : 0.12) * (0.6 + 0.4 * effort);
    // Their wake on the surface (deep catfish barely touch it).
    if (ri < RIPPLE_N - 1) rippleData[ri++].set(_fishPos.x, _fishPos.z, (f.cat ? 0.05 : 0.14) * Math.min(2.5, Math.abs(v) * 4) * (f.jump ? 3 : 1), f.phase);
  }
  // Your own feet in the water.
  rippleData[RIPPLE_N - 1].set(camera.position.x, camera.position.z, playerInWater ? Math.min(0.9, playerSpeed * 0.5) : 0, 0);
  // Now and then one fish leaps.
  fishJumpTimer -= dt;
  if (fishJumpTimer <= 0) {
    fishJumpTimer = 4 + Math.random() * 7;
    const f = fish[(Math.random() * fish.length) | 0];
    if (!f.jump && !f.cat) {
      // Small hops: low arcs, quick.
      f.jump = { t0: t, dur: 0.45 + Math.random() * 0.25, h: 0.1 + Math.random() * 0.18 + f.len * 0.12 };

    }
  }
  updateDrops(dt);
  for (const r of splashRings) {
    if (!r.mesh.visible) continue;
    const u = (t - r.t0) / 1.6;
    if (u >= 1) { r.mesh.visible = false; continue; }
    r.mesh.scale.setScalar(0.15 + u * 1.2);
    r.mesh.material.opacity = 0.45 * (1 - u);
  }
  waterMat.opacity = 0.6 + Math.sin(t * 0.7) * 0.018;
  if (waterMat.userData.shader) waterMat.userData.shader.uniforms.uTime.value = t;
  sky.position.copy(camera.position);
  mistUniforms.uMistTime.value = t;
  causticUniforms.uCausticTime.value = t;
  canalLifeUniforms.uTime.value = t;
  for (const L of floatLeaves) {
    L.dist += L.speed * dt;
    if (!L.loop) L.loop = L.south ? LOOP_SOUTH : LOOP_RING;
    const dirL = sampleLoop(L.dist, _fishPos, L.loop);
    _fishPerp.set(-dirL.z, 0, dirL.x);
    _fishPos.addScaledVector(_fishPerp, L.lane + Math.sin(t * 0.2 + L.rot) * 0.06);
    L.m.position.set(_fishPos.x, CANAL_WATER_Y + 0.004 + Math.sin(t * 1.3 + L.rot) * 0.003, _fishPos.z);
    L.rot += L.spin * dt;
    L.m.rotation.set(Math.sin(t + L.rot) * 0.05, L.rot, 0);
  }
  canalNormal.offset.set(t * 0.012, -t * 0.009);
  vineUniforms.uTime.value = t;
  bayDust.material.uniforms.uTime.value = t;
  bayDust.material.uniforms.uScale.value = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  // Stream flows downstream (+uv.y); a slight sideways wobble keeps it alive.
  if (streamNormalTex) streamNormalTex.offset.set(Math.sin(t * 0.21) * 0.04, -t * 0.32);
  waterNormal.offset.x = t * 0.0085;
  waterNormal.offset.y = t * 0.0052;
  const camSpeed = dt > 0 ? _prevCam.distanceTo(camera.position) / dt : 0;
  AIR.update(dt, t, camera.position.x, camera.position.y, camera.position.z, camSpeed);
  _prevCam.copy(camera.position);
  const dp = dustGeo.attributes.position.array;
  for (let i = 0; i < DUST_COUNT; i++) {
    const o = i * 3;
    const b = dustBar[i];
    const bar = sunBars[b];
    const s = dustSeed[i];
    // Advect on the air-flow field, sampled at the mote's world position —
    // each mote follows its own local current instead of a shared direction.
    AIR.flow(dp[o], dp[o + 1], dp[o + 2], airV);
    const ease = Math.min(1, dt * 1.4);
    dustVel[o] += (airV.x + Math.sin(t * 0.8 + s * 3.1) * 0.012 - dustVel[o]) * ease;
    dustVel[o + 1] += (airV.y - 0.008 + Math.cos(t * 0.7 + s * 2.3) * 0.01 - dustVel[o + 1]) * ease;
    dustVel[o + 2] += (airV.z + Math.cos(t * 1.05 + s * 1.9) * 0.012 - dustVel[o + 2]) * ease;
    // World velocity → ceiling-frame velocity (the frame slides with height).
    dustLoc[o] += (dustVel[o] - SUN_SLOPE_X * dustVel[o + 1]) * dt;
    dustLoc[o + 1] += dustVel[o + 1] * dt;
    dustLoc[o + 2] += (dustVel[o + 2] - SUN_SLOPE_Z * dustVel[o + 1]) * dt;
    // Soft bounds on the roaming band (bar plus a dark margin each side).
    if (dustLoc[o] < bar[0]) { dustLoc[o] = bar[0]; dustVel[o] = Math.abs(dustVel[o]) * 0.5; }
    else if (dustLoc[o] > bar[2]) { dustLoc[o] = bar[2]; dustVel[o] = -Math.abs(dustVel[o]) * 0.5; }
    if (dustLoc[o + 2] < bar[1] - DUST_MARGIN) { dustLoc[o + 2] = bar[1] - DUST_MARGIN; dustVel[o + 2] = Math.abs(dustVel[o + 2]) * 0.5; }
    else if (dustLoc[o + 2] > bar[3] + DUST_MARGIN) { dustLoc[o + 2] = bar[3] + DUST_MARGIN; dustVel[o + 2] = -Math.abs(dustVel[o + 2]) * 0.5; }
    const yFloor = dustMinY(dustLoc[o], dustLoc[o + 2]);
    if (dustLoc[o + 1] < yFloor) { dustLoc[o + 1] = yFloor; dustVel[o + 1] = Math.abs(dustVel[o + 1]) * 0.4; }
    else if (dustLoc[o + 1] > HALL.wallTop - 0.2) { dustLoc[o + 1] = HALL.wallTop - 0.2; dustVel[o + 1] = -Math.abs(dustVel[o + 1]) * 0.4; }
    // Lit only while inside the exact cone: fade on distance past the bar edge.
    const inZ = Math.min(dustLoc[o + 2] - bar[1], bar[3] - dustLoc[o + 2]);
    const inX = Math.min(dustLoc[o] - bar[0], bar[2] - dustLoc[o]);
    const inside = Math.min(inZ, inX);
    dustFade[i] = Math.min(1, Math.max(0, (inside + 0.03) / 0.12));
    const drop = HALL.wallTop - dustLoc[o + 1];
    dp[o] = dustLoc[o] - SUN_SLOPE_X * drop;
    dp[o + 1] = dustLoc[o + 1];
    dp[o + 2] = dustLoc[o + 2] - SUN_SLOPE_Z * drop;
  }
  dustGeo.attributes.position.needsUpdate = true;
  dustGeo.attributes.aFade.needsUpdate = true;
  fernUniforms.uTime.value = t;
  for (const f of ferns) {
    const dx = camera.position.x - f.mesh.position.x;
    const dz = camera.position.z - f.mesh.position.z;
    const d = Math.hypot(dx, dz);
    let tx = 0, tz = 0;
    const R = 1.1 + 0.55 * f.mesh.scale.x;
    if (started && d < R && camera.position.y < 2.4) {
      const push = (1 - d / R) * 0.5;
      const inv = 1 / (d || 1);
      tx = -dx * inv * push;
      tz = -dz * inv * push;
    }
    f.vx += ((tx - f.bx) * 26 - f.vx * 4.2) * dt;
    f.vz += ((tz - f.bz) * 26 - f.vz * 4.2) * dt;
    f.bx += f.vx * dt;
    f.bz += f.vz * dt;
    const sway = Math.sin(t * 0.8 + f.phase) * 0.018;
    f.mesh.rotation.set(f.bz + sway, f.yaw, -f.bx + sway * 0.6);
  }
  for (const dr of drips) {
    const cycle = ((t + dr.phase) % dr.period) / dr.period;
    const fall = Math.min(1, cycle * 2.6);
    dr.m.position.set(dr.x, dr.top - (dr.top + 0.09) * fall * fall, dr.z);
    dr.m.visible = cycle < 0.42;
  }
  updateAudio(dt, t);
  for (const s of shafts) {
    const d = Math.abs(s.position.z - camera.position.z);
    s.material.opacity = 0.07 * Math.max(0, 1 - d / 26);
  }
  if (fogPass) {
    fogPass.uniforms.uTime.value = t;
    fogPass.uniforms.uProjInv.value.copy(camera.projectionMatrixInverse);
    fogPass.uniforms.uViewInv.value.copy(camera.matrixWorld);
    fogPass.uniforms.uCamPos.value.copy(camera.position);
  }
  if (started && panel.style.display !== 'block') {
    const forward = (keys.KeyW || keys.KeyZ || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + movement.y;
    const sideways = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.KeyQ || keys.ArrowLeft ? 1 : 0) + movement.x;
    move.set(sideways, forward);
    if (move.length() > 1) move.normalize();
    const surfSlow = level === 'hall' ? (playerSurface === 'water' ? 0.62 : playerSurface === 'moss' ? 0.88 : 1) : 1;
    const speed = (keys.ShiftLeft ? 5.3 : 3.25) * surfSlow * dt;
    const nx = camera.position.x + (Math.cos(yaw) * move.x - Math.sin(yaw) * move.y) * speed;
    const nz = camera.position.z + (-Math.sin(yaw) * move.x - Math.cos(yaw) * move.y) * speed;
    // Step rule: from where your feet are you can step up a little anywhere
    // (more when climbing out of the water, hands on the edge); anything
    // higher needs a jump. Bridges, canal lips, moss, bench, sofa: all just
    // heights, so nothing is a hidden wall and you never pass through a deck.
    const EYE = 1.58;
    const cx = camera.position.x, cz = camera.position.z;
    const here = walkGround(cx, cz);
    const feet = camera.position.y - EYE;
    const reach = Math.max(feet, here.y) + (here.surface === 'water' ? 0.78 : 0.36);
    // Stuck inside something (the door swung onto you…)? Let yourself out.
    const free = !canOccupy(cx, cz);
    const ok = (px, pz) => canOccupy(px, pz, free) && walkGround(px, pz).y <= reach;
    let x = nx, z = nz;
    if (!ok(x, z)) {
      if (ok(nx, cz)) z = cz;
      else if (ok(cx, nz)) x = cx;
      else { x = cx; z = cz; }
    }
    camera.position.x = x;
    camera.position.z = z;
    verticalVelocity -= 9.3 * dt;
    camera.position.y += verticalVelocity * dt;
    const gr = walkGround(x, z);
    const floorY = gr.y + EYE;
    playerSurface = gr.surface;
    playerInWater = playerSurface === 'water';
    playerSpeed = dt > 0 ? Math.hypot(x - _prevStepX, z - _prevStepZ) / dt : 0;
    _prevStepX = x; _prevStepZ = z;
    if (camera.position.y <= floorY + 0.001) {
      // Step up smoothly (a quick ease rather than a pop); land on falls.
      const up = floorY - camera.position.y;
      camera.position.y += up > 0.05 ? up * Math.min(1, dt * 11) : up;
      verticalVelocity = 0;
      grounded = true;
    }
    camera.rotation.set(pitch, yaw, 0);
  }
  let nearest = null;
  let dist = 5.6;
  for (const w of works) {
    const d = camera.position.distanceTo(w.pos);
    if (d < dist) { dist = d; nearest = w; }
  }
  activeWork = nearest;
  const nearWin = level === 'hall' && camera.position.distanceTo(winMesh.position) < 2.4;
  const nearPortal = level === 'hall'
    ? camera.position.distanceTo(portalHall.position) < 2.7
    : camera.position.distanceTo(portalValley.position) < 3.4;
  const nearDoor = level === 'hall' && camera.position.distanceTo(door.pos) < 3.4;
  hint.classList.toggle('visible', (!!nearest || nearWin || nearPortal || nearDoor) && panel.style.display !== 'block' && started);
  const tap = matchMedia('(pointer:coarse)').matches;
  const doorVerb = door.open ? 'fermer' : 'ouvrir';
  const hintText = nearDoor
    ? `Porte · ${tap ? 'Touchez pour ' + doorVerb : 'E pour ' + doorVerb}`
    : nearPortal
    ? (level === 'hall'
      ? `La vallée · ${tap ? 'Touchez ici pour traverser' : 'E pour traverser'}`
      : `La galerie · ${tap ? 'Touchez ici pour revenir' : 'E pour revenir'}`)
    : nearest
      ? `${nearest.name} · ${tap ? 'Touchez ici pour découvrir' : 'E pour découvrir'}`
      : nearWin
        ? `Champ de phase · ${tap ? 'Touchez ici pour perturber' : 'E pour perturber'}`
        : '';
  if (hint.textContent !== hintText) hint.textContent = hintText;
  essence.position.copy(camera.position);
  essence.position.y -= 0.25;
  essence.position.add(new THREE.Vector3(0, Math.sin(t * 1.4) * 0.02, -0.35).applyEuler(camera.rotation));
  frameCount++;
  if (frameCount % Q.shadowEvery === 0) renderer.shadowMap.needsUpdate = true;
  composer.render();
  adaptResolution(clock.elapsedTime);
  if (window.__ingaShot) {
    window.__ingaShot = false;
    renderer.domElement.toBlob((b) => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = 'inga-moss.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });
  }
}
animate();
hint.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); hint.setPointerCapture?.(e.pointerId); pressPrompt(); });
hint.addEventListener('pointerup', (e) => {
  e.stopPropagation();
  const r = hint.getBoundingClientRect();
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  releasePrompt(inside);
});
hint.addEventListener('pointercancel', () => releasePrompt(false));
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});
