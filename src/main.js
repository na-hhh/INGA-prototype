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
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import './style.css';

const isCoarse = matchMedia('(pointer:coarse)').matches;

const app = document.querySelector('#app');
app.innerHTML = `<div id="hud"><div id="brand">INGA</div><div id="subtitle">A LIVING SPACE — STUDY 01</div><button id="sound">SON : OFF</button><div id="help">ZQSD / WASD · se déplacer<br>SOURIS · regarder autour<br>ESPACE · léviter &nbsp; · &nbsp; E · découvrir une œuvre</div><div id="hint"></div><div id="mobile"><div id="joystick"><div id="knob"></div></div><button id="jump">↑</button><div id="looknote">Glisser à droite pour regarder</div></div></div><div id="intro"><div class="inner"><h1>INGA</h1><p>Un espace à habiter.<br>Le béton, la lumière, l'eau et les traces de vie.</p><button id="enter">ENTRER DANS INGA</button><small>Étude architecturale interactive 01<br>Œuvres et matières provisoires · Son facultatif</small></div></div><div id="artPanel"><button id="close">FERMER ×</button><div class="eyebrow">INGA / COLLECTION 01</div><h2 id="artTitle"></h2><p id="artText"></p><p style="font-size:11px;opacity:.6">Œuvre provisoire — à remplacer par une création originale.</p></div>`;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#dde6ec');
scene.fog = new THREE.FogExp2('#393834', matchMedia('(pointer:coarse)').matches ? 0.0075 : 0.0042);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Shadows are rendered once per frame (flagged in animate), not once per
// internal pass — SSR/GTAO re-render the scene several times.
renderer.shadowMap.autoUpdate = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.22;
app.prepend(renderer.domElement);

const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.08, 220);
camera.position.set(0, 1.58, -10.6);
camera.rotation.order = 'YXZ';

{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.07;
  pmrem.dispose();
}

const composer = new EffectComposer(renderer);
// SSR = screen-space ray tracing of reflections; replaces the plain RenderPass
// on desktop. The reflective meshes are registered in ssrSelects after creation.
const ssrSelects = [];
let ssrPass = null;
if (!isCoarse) {
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
if (!isCoarse) {
  gtaoPass = new GTAOPass(scene, camera, innerWidth, innerHeight);
  gtaoPass.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.6, thickness: 0.6, scale: 1.1 });
  gtaoPass.blendIntensity = 0.85;
  composer.addPass(gtaoPass);
}
// Raymarched volumetric fog: height fog + animated 3D noise + real god rays
// traced against the ceiling slot geometry, lit with a Henyey-Greenstein phase.
let fogPass = null;
if (!isCoarse) {
  const VolumetricFogShader = {
    uniforms: {
      tDiffuse: { value: null },
      tDepth: { value: null },
      tHoles: { value: null },
      uProjInv: { value: new THREE.Matrix4() },
      uViewInv: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uSunDir: { value: new THREE.Vector3(-8, 22, 8).normalize() },
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
const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.55, 0.82);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());
composer.addPass(new SMAAPass());

// The only daylight enters through the ceiling holes: a faint sky remainder,
// one hard sun blocked by the real ceiling/wall geometry, a whisper of bounce.
scene.add(new THREE.HemisphereLight('#dfe8f2', '#4e4a44', 0.14));
const sun = new THREE.DirectionalLight('#fff1d9', 3.6);
sun.position.set(-8, 22, 15);
sun.target.position.set(0, 0, 7);
scene.add(sun.target);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.left = -16;
sun.shadow.camera.right = 16;
sun.shadow.camera.top = 22;
sun.shadow.camera.bottom = -22;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 80;
sun.shadow.bias = -0.00035;
sun.shadow.normalBias = 0.045;
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun);
const bounce = new THREE.DirectionalLight('#e1eaf4', 0.09);
bounce.position.set(5, 8, 9);
scene.add(bounce);

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
  const base = [233, 233, 237];
  const cloud = [198, 205, 217];
  const veinCol = [88, 102, 131];
  const bigCol = [120, 133, 158];
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
        col += (veinCol[ch] - col) * vm;
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
const hallFloorSurf = marbleSurface(isCoarse ? 512 : 1024);
const hallFloorMat = new THREE.MeshPhysicalMaterial({
  map: hallFloorSurf.map,
  normalMap: hallFloorSurf.normalMap,
  normalScale: new THREE.Vector2(0.25, 0.25),
  roughnessMap: hallFloorSurf.roughnessMap,
  roughness: 0.32,
  metalness: 0,
  clearcoat: 0.4,
  clearcoatRoughness: 0.22,
  envMapIntensity: 0.9,
});
// 1024 px over a 1.25 m repeat (world UVs x2): the grain holds up close-to.
const hallWallSurf = boardConcreteSurface(isCoarse ? 512 : 1024);
hallWallSurf.map.repeat.set(2, 2);
hallWallSurf.normalMap.repeat.set(2, 2);
hallWallSurf.roughnessMap.repeat.set(2, 2);
const hallConcrete = new THREE.MeshStandardMaterial({
  map: hallWallSurf.map,
  normalMap: hallWallSurf.normalMap,
  normalScale: new THREE.Vector2(1.0, 1.0),
  roughnessMap: hallWallSurf.roughnessMap,
  roughness: 1,
});
const bedTex = noiseTexture('#6d716c', 16);
bedTex.repeat.set(12, 16);
const bedMat = new THREE.MeshStandardMaterial({ map: bedTex, color: '#9a9d96', roughness: 1 });
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

// Compact hall: ~17 m wide, ~23 m deep, ceiling at 5.72 m.
// The narrow canal is a recess at the foot of the walls. It never crosses the floor.
const HALL = {
  x: 8.6,
  doorZ: -4.85,
  north: 18.4,
  channel: 0.88,
  wallT: 0.46,
  wallTop: 7.4,
  wallBottom: -0.28,
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

// Entry passage: intimate but generous — no tunnel. Textile, inhabited.
box(4.7, 0.25, 6.7, 0, -0.16, -8.2, floorMat);
box(0.25, 3.85, 6.7, -2.35, 1.9, -8.2);
box(0.25, 3.85, 6.7, 2.35, 1.9, -8.2);
box(4.7, 0.24, 6.7, 0, 3.72, -8.2);
box(4.7, 3.8, 0.25, 0, 1.9, -11.6);
box(1.18, 0.16, 2.05, -1.62, 0.47, -8.5, wood);
for (const z of [-9.25, -7.78]) box(0.11, 0.42, 0.13, -1.62, 0.23, z, wood);
const fabric = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.25, 14, 18), linen);
const fabricPos = fabric.geometry.attributes.position;
for (let i = 0; i < fabricPos.count; i++) {
  const x = fabricPos.getX(i);
  const y = fabricPos.getY(i);
  fabricPos.setZ(i, Math.sin(x * 14 + y * 6) * 0.038);
}
fabric.rotation.y = Math.PI / 2;
fabric.position.set(-1.72, 1.78, -7.5);
scene.add(fabric);
const drape = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.86, 12, 12), linen);
drape.rotation.set(-0.5, 0.3, 0.2);
drape.position.set(-1.68, 0.57, -8.8);
scene.add(drape);
const shoeMat = new THREE.MeshStandardMaterial({ color: '#3a3029', roughness: 0.73 });
for (const x of [0.25, 0.65]) {
  const s = sphere(0.17, x, 0.14, -8.6, shoeMat);
  s.scale.set(0.8, 0.48, 1.6);
  const sock = sphere(0.095, x, 0.09, -8.05, new THREE.MeshStandardMaterial({ color: '#ddd6c9' }));
  sock.scale.set(0.8, 0.38, 1.5);
}
for (const [x, z, rot] of [[-2.18, -9.8, Math.PI / 2], [2.18, -8.1, -Math.PI / 2]]) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 1.9, 20, 20),
    new THREE.MeshStandardMaterial({ color: z < -9 ? '#7c756a' : '#d4c6af', side: THREE.DoubleSide, roughness: 1 })
  );
  m.rotation.y = rot;
  m.position.set(x, 1.65, z);
  scene.add(m);
}

const wallH = HALL.wallTop - HALL.wallBottom;
const wallY = (HALL.wallTop + HALL.wallBottom) / 2;
const sideZ0 = HALL.doorZ - HALL.wallT;
const sideZ1 = HALL.north + HALL.wallT;
const sideLen = sideZ1 - sideZ0;
const sideCenter = (sideZ0 + sideZ1) / 2;
const outerX = HALL.x + HALL.wallT / 2;
box(HALL.wallT, wallH, sideLen, -outerX, wallY, sideCenter, hallConcrete);
box(HALL.wallT, wallH, sideLen, outerX, wallY, sideCenter, hallConcrete);
box(HALL.x * 2 + HALL.wallT, wallH, HALL.wallT, 0, wallY, HALL.north + HALL.wallT / 2, hallConcrete);

const opening = 2.2;
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
    for (let x = -HALL.x + 0.9; x < HALL.x - 0.45; x += tieBay) {
      tiePos.push([x, y, HALL.north - 0.004, 1]);
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
box(floorW, 0.1, floorD, 0, -0.17, floorCenterZ, gravelBedMat, false);

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
    const z0 = CHANNEL.iz0 + j * tileD + (j === 0 ? 0 : TILE_GAP / 2);
    const z1 = CHANNEL.iz0 + (j + 1) * tileD - (j === nTz - 1 ? 0 : TILE_GAP / 2);
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
const tileMesh = new THREE.Mesh(mergeGeometries(tileGeos), hallFloorMat);
tileMesh.receiveShadow = true;
scene.add(tileMesh);
ssrSelects.push(tileMesh);

// River stones: instanced squashed ellipsoids, dry + wet (clearcoat) variants.
const stoneGeo = new THREE.SphereGeometry(1, 9, 7);
const stoneDryMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
const stoneWetMat = new THREE.MeshPhysicalMaterial({
  roughness: 0.13,
  clearcoat: 1,
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
const GAP_STEP = isCoarse ? 0.13 : 0.06;
for (let i = 1; i < nTx; i++) {
  const gx = CHANNEL.ix0 + i * tileW;
  for (let z = CHANNEL.iz0 + 0.06; z < CHANNEL.iz1 - 0.06; z += GAP_STEP * (0.7 + Math.random() * 0.6)) {
    const x = gx + (Math.random() - 0.5) * TILE_GAP * 0.6;
    dropStone(x, -0.12, z, 0.016, 0.034, Math.random() < wetChance(x, z));
  }
}
for (let j = 1; j < nTz; j++) {
  const gz = CHANNEL.iz0 + j * tileD;
  for (let x = CHANNEL.ix0 + 0.06; x < CHANNEL.ix1 - 0.06; x += GAP_STEP * (0.7 + Math.random() * 0.6)) {
    const z = gz + (Math.random() - 0.5) * TILE_GAP * 0.6;
    dropStone(x, -0.12, z, 0.016, 0.034, Math.random() < wetChance(x, z));
  }
}
// Canal bed: fully covered in larger stones, all wet (under water).
const BED_STEP = isCoarse ? 0.26 : 0.115;
const bedStrips = [
  [CHANNEL.x0, CHANNEL.ix0, CHANNEL.z0, CHANNEL.z1],
  [CHANNEL.ix1, CHANNEL.x1, CHANNEL.z0, CHANNEL.z1],
  [CHANNEL.ix0, CHANNEL.ix1, CHANNEL.z0, CHANNEL.iz0],
  [CHANNEL.ix0, CHANNEL.ix1, CHANNEL.iz1, CHANNEL.z1],
];
for (const [sx0, sx1, sz0, sz1] of bedStrips) {
  for (let x = sx0 + 0.06; x < sx1 - 0.04; x += BED_STEP) {
    for (let z = sz0 + 0.06; z < sz1 - 0.04; z += BED_STEP) {
      dropStone(
        x + (Math.random() - 0.5) * BED_STEP * 0.7,
        -0.2,
        z + (Math.random() - 0.5) * BED_STEP * 0.7,
        0.035, 0.078, true
      );
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
buildStones(wetXf, wetCol, stoneWetMat);

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
function rockFade(x, z) {
  const ax = Math.abs(x);
  const fp0 = Math.min(1, Math.max(0, (ax - PATH_HALF) / 0.9));
  const fadePath = fp0 * fp0 * (3 - 2 * fp0);
  const fadeCanal = Math.min(1, Math.max(0, (CHANNEL.ix1 - ax) / 0.55));
  const fadeS = Math.min(1, Math.max(0, (z - CHANNEL.iz0) / 0.8));
  const fadeN = Math.min(1, Math.max(0, (CHANNEL.iz1 - z) / 0.8));
  return fadePath * Math.min(fadeCanal, fadeS, fadeN);
}
function rockHeightBase(x, z) {
  const ax = Math.abs(x);
  if (ax <= PATH_HALF || ax >= CHANNEL.ix1) return 0;
  const wx = x + 1.6 * (rockFbm(x * 0.33 + 7.2, z * 0.33) - 0.5);
  const wz = z + 1.6 * (rockFbm(x * 0.33, z * 0.33 + 3.1) - 0.5);
  let h = Math.pow(rockRidged(wx * 0.5, wz * 0.5), 1.5) * 1.35;
  const bands = h * 3.2;
  const bi = Math.floor(bands);
  const bf = Math.min(1, (bands - bi) * 2.4);
  h = h * 0.62 + ((bi + bf * bf * (3 - 2 * bf)) / 3.2) * 0.38;
  return h * rockFade(x, z);
}
// Gravity: a thermal-erosion pass over the base field. Material steeper than
// the talus angle slides to lower neighbours; where it lands is recorded in a
// deposition map (scree fans read as loose bare grit, not moss).
const ERO_GX = isCoarse ? 110 : 220;
const ERO_GZ = isCoarse ? 150 : 300;
const ERO_X0 = -CHANNEL.ix1, ERO_X1 = CHANNEL.ix1;
const ERO_Z0 = CHANNEL.iz0, ERO_Z1 = CHANNEL.iz1;
const eroH = new Float32Array(ERO_GX * ERO_GZ);
const eroDep = new Float32Array(ERO_GX * ERO_GZ);
{
  const cellX = (ERO_X1 - ERO_X0) / (ERO_GX - 1);
  for (let j = 0; j < ERO_GZ; j++)
    for (let i = 0; i < ERO_GX; i++)
      eroH[j * ERO_GX + i] = rockHeightBase(ERO_X0 + i * ((ERO_X1 - ERO_X0) / (ERO_GX - 1)), ERO_Z0 + j * ((ERO_Z1 - ERO_Z0) / (ERO_GZ - 1)));
  const talus = cellX * 1.1;
  const iters = isCoarse ? 24 : 42;
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
  for (let j = 0; j < ERO_GZ; j++)
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
const VALLEY = { x: 0, z: 600, radius: 142 };
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
  const segX = isCoarse ? 32 : 140;
  const segZ = isCoarse ? 130 : 560;
  const stripW = CHANNEL.ix1 - PATH_HALF;
  const stripD = CHANNEL.iz1 - CHANNEL.iz0;
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
  const dispAmtU = { value: isCoarse ? 0 : 0.12 };
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
      if (!isCoarse) dispAmtU.value = 0.35;
    };
    const applyRockNormal = (t) => {
      rockMat.normalMap = prep(t, false);
      rockMat.normalScale.set(0.75, 0.75);
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
  const tmpA = new THREE.Color();
  const tmpB = new THREE.Color();
  for (const sideSign of [-1, 1]) {
    const geo = new THREE.PlaneGeometry(stripW, stripD, segX, segZ);
    geo.rotateX(-Math.PI / 2);
    const cx = sideSign * (PATH_HALF + stripW / 2);
    const czm = (CHANNEL.iz0 + CHANNEL.iz1) / 2;
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
      const h = rockHeight(x, z);
      // Strata lips: the top of each terrace band leans out over the downhill
      // side, folding the sheet into true overhangs.
      const gx = (rockHeight(x + eG, z) - rockHeight(x - eG, z)) / (2 * eG);
      const gz = (rockHeight(x, z + eG) - rockHeight(x, z - eG)) / (2 * eG);
      const gm = Math.hypot(gx, gz);
      let ox = 0, oz = 0;
      if (gm > 0.35 && h > 0.08) {
        const p = (h * 3.2) % 1;
        const lip = p * p * p * Math.min(1, (gm - 0.35) * 1.4) * 0.26;
        ox = (-gx / gm) * lip;
        oz = (-gz / gm) * lip;
      }
      pos.setXYZ(i, x + ox, ROCK_BASE_Y + h, z + oz);
      uvA.setXY(i, (x + ox) * 0.85, (z + oz) * 0.85);
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
      const around = (rockHeight(x + e, z) + rockHeight(x - e, z) + rockHeight(x, z + e) + rockHeight(x, z - e)) / 4;
      const cav = Math.min(1, Math.max(0, (around - h) * 7));
      // Freshly slid scree stays bare grit — moss only holds on stable rock.
      const dep = Math.min(1, Math.max(0, rockDeposit(x, z) - 0.09) * 3.2);
      let m = (Math.max(0, 1 - slope * 2.6) * (0.5 + 0.5 * rockFbm(x * 1.9 + 31, z * 1.9)) + cav * 0.55) * (1 - dep * 0.85);
      m = Math.min(1, Math.max(0, (m - 0.3) * 2.2));
      mossArr[i] = m;
      tmpA.copy(rockBase).lerp(rockWarm, rockFbm(x * 0.5 + 11, z * 0.5));
      // Cavity term doubles as baked AO: crevices read darker, like Decima's cavity map.
      tmpA.multiplyScalar(1 - cav * 0.35 - slope * 0.18);
      tmpA.lerp(tmpB.setRGB(0.52, 0.5, 0.47), dep * 0.5);
      tmpB.copy(mossCool).lerp(mossWarm, rockFbm(x * 1.3, z * 1.3 + 17));
      tmpA.lerp(tmpB, m);
      colArr[i * 3] = tmpA.r;
      colArr[i * 3 + 1] = tmpA.g;
      colArr[i * 3 + 2] = tmpA.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
    geo.setAttribute('moss', new THREE.BufferAttribute(mossArr, 1));
    const mesh = new THREE.Mesh(geo, rockMat);
    mesh.castShadow = !isCoarse;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // Wind-rounded boulders half sunk into the moss; yaw-only rotation keeps
  // the vertex-painted moss on their up-facing side.
  const bGeo = new THREE.IcosahedronGeometry(1, isCoarse ? 2 : 4);
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
  for (let i = 0; i < bPos.count; i++) {
    const up = Math.max(0, bNor.getY(i));
    const m = Math.min(1, Math.max(0, (up - 0.45) * 2.1)) * (0.4 + 0.6 * rockFbm(bPos.getX(i) * 2.4 + 9, bPos.getZ(i) * 2.4));
    bMoss[i] = m;
    tmpA.setRGB(0.44, 0.43, 0.43).lerp(tmpB.setRGB(0.8, 0.85, 0.65), m);
    bCol[i * 3] = tmpA.r;
    bCol[i * 3 + 1] = tmpA.g;
    bCol[i * 3 + 2] = tmpA.b;
  }
  bGeo.setAttribute('color', new THREE.BufferAttribute(bCol, 3));
  bGeo.setAttribute('moss', new THREE.BufferAttribute(bMoss, 1));
  const N_B = isCoarse ? 26 : 56;
  const bMesh = new THREE.InstancedMesh(bGeo, rockMat, N_B);
  const bDummy = new THREE.Object3D();
  for (let i = 0; i < N_B; i++) {
    const sideSign = i % 2 ? 1 : -1;
    const x = sideSign * (PATH_HALF + 0.55 + Math.random() * (stripW - 1.1));
    const z = CHANNEL.iz0 + 0.8 + Math.random() * (stripD - 1.6);
    const s = 0.22 + Math.random() * 0.75;
    bDummy.position.set(x, ROCK_BASE_Y + rockHeight(x, z) + s * 0.28, z);
    bDummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
    bDummy.scale.set(s * (0.8 + Math.random() * 0.5), s, s * (0.8 + Math.random() * 0.5));
    bDummy.updateMatrix();
    bMesh.setMatrixAt(i, bDummy.matrix);
    bMesh.setColorAt(i, tmpA.setScalar(0.85 + Math.random() * 0.3));
  }
  bMesh.castShadow = !isCoarse;
  bMesh.receiveShadow = true;
  scene.add(bMesh);

  // Water flowing: rivulets traced by gradient descent over the eroded
  // field, widening as they drop, draining outward into the peripheral canal.
  for (const sideSign of [-1, 1]) {
    for (let r = 0; r < 3; r++) {
      let sx = 0, sz = 0, sh = -1;
      for (let c = 0; c < 36; c++) {
        const x = sideSign * (PATH_HALF + 1.2 + Math.random() * 2.2);
        const z = CHANNEL.iz0 + 2.5 + Math.random() * (stripD - 5);
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
        if (Math.abs(px) >= CHANNEL.ix1 - 0.12 || h < 0.015) break;
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
    const SEG = isCoarse ? 110 : 220;
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
    scene.add(ground);

    // Strewn boulders, denser near the stream banks.
    const VB = isCoarse ? 130 : 340;
    const vbMesh = new THREE.InstancedMesh(bGeo, rockMat, VB);
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
    scene.add(vbMesh);

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
      scene.add(mesh);
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
    scatter(pebGeo, rockMat, isCoarse ? 1200 : 5000,
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
    scatter(stoneGeo, rockMat, isCoarse ? 400 : 1500,
      (x, z, h, sl, d) => (d < 3 ? 0 : Math.min(1, 0.12 + sl * 2.4)),
      (d3, x, z, h) => {
        const s = 0.1 + Math.random() * Math.random() * 0.4;
        d3.position.set(x, h + s * 0.18, z);
        d3.rotation.set(0, Math.random() * Math.PI * 2, 0);
        d3.scale.set(s * (0.8 + Math.random() * 0.5), s, s * (0.8 + Math.random() * 0.5));
      }, 0.32, 0.62);
    // Shattered slab outcrops on the steep upper reaches.
    const slabGeo = equipRock(new THREE.IcosahedronGeometry(1, 1), 0.12);
    scatter(slabGeo, rockMat, isCoarse ? 60 : 220,
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
        const g = new THREE.IcosahedronGeometry(0.07 + Math.random() * 0.09, 1);
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
        if (ML[k]) { scene.remove(ML[k]); ML[k].dispose(); ML[k] = null; }
      }
      ML.flats = scatter(tuftGeo, tuftMat, Math.round((isCoarse ? 700 : 2600) * MP.density),
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
      ML.bumps = scatter(tuftGeo, tuftMat, Math.round((isCoarse ? 600 : 2200) * MP.density),
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
      scene.add(ML.rocks);
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
      let y = dsHeight(mx, z) + 0.5;
      y = Math.min(y, prevY - 0.015);
      prevY = y;
      const w = 2.2 + rockFbm(5, z * 0.05) * 2.8 + Math.max(0, z - 55) * 0.09;
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
    const stream = new THREE.Mesh(sg, waterMat);
    stream.renderOrder = 1;
    scene.add(stream);
  }
}

// Ceiling: brutalist, orthographic sun holes — axis-aligned slots, a strict
// coffer grid and one large oculus, all cut into the slab with hard edges.
const ceilT = 0.4;
const ceilZ0 = sideZ0;
const ceilZ1 = sideZ1;
const CH_NX = isCoarse ? 88 : 176;
const CH_NZ = isCoarse ? 120 : 240;
// Parallel bars of sky, all running east-west (parallel to the end walls),
// with a little randomness in width, spacing and how far they reach.
const sunBars = [];
{
  let zBar = -2.2;
  while (zBar < 16.6) {
    const w = 0.35 + Math.random() * 0.5;
    const x0 = -7.2 + Math.random() * 1.6;
    const x1 = 7.2 - Math.random() * 1.6;
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
if (isCoarse) {
  const shaftTex = shaftTexture();
  const shaftGeo = new THREE.PlaneGeometry(2.4, HALL.wallTop + 0.6);
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
      m.position.set(wx, HALL.wallTop / 2 - 0.1, wz);
      m.rotation.x = 0.34;
      m.rotation.z = -0.09;
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
const DUST_COUNT = isCoarse ? 500 : 1500;
const SUN_SLOPE_X = -8 / 22;
const SUN_SLOPE_Z = 8 / 22;
const dustPos = new Float32Array(DUST_COUNT * 3);
const dustLoc = new Float32Array(DUST_COUNT * 3);
const dustVel = new Float32Array(DUST_COUNT * 3);
const dustBar = new Uint8Array(DUST_COUNT);
const dustSeed = new Float32Array(DUST_COUNT);
for (let i = 0; i < DUST_COUNT; i++) {
  const b = (Math.random() * sunBars.length) | 0;
  const [bx0, bz0, bx1, bz1] = sunBars[b];
  dustBar[i] = b;
  dustLoc[i * 3] = bx0 + Math.random() * (bx1 - bx0);
  dustLoc[i * 3 + 1] = 0.3 + Math.random() * (HALL.wallTop - 0.6);
  dustLoc[i * 3 + 2] = bz0 - DUST_MARGIN + Math.random() * (bz1 - bz0 + DUST_MARGIN * 2);
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
  size: 0.013,
  transparent: true,
  opacity: 0.34,
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

const water = new THREE.Mesh(ringGeometry(CHANNEL, CHANNEL), waterMat);
water.position.y = -0.09;
water.castShadow = false;
water.receiveShadow = false;
scene.add(water);
const bed = new THREE.Mesh(ringGeometry(CHANNEL, CHANNEL), bedMat);
bed.position.y = -0.2;
bed.receiveShadow = true;
bed.castShadow = false;
scene.add(bed);

ssrSelects.push(box(4.2, 0.055, 1.28, 0, -0.045, -4.4, bridgeMat));

const fish = [];
const fishGeo = new THREE.SphereGeometry(0.12, 12, 8);
const tailGeo = new THREE.ConeGeometry(0.05, 0.13, 4);
const fishPath = [
  new THREE.Vector3(CHANNEL.ix0 + 0.08, -0.1, (CHANNEL.z0 + CHANNEL.iz0) / 2),
  new THREE.Vector3(CHANNEL.ix1 - 0.08, -0.1, (CHANNEL.z0 + CHANNEL.iz0) / 2),
  new THREE.Vector3(CHANNEL.ix1 - 0.08, -0.1, (CHANNEL.z1 + CHANNEL.iz1) / 2),
  new THREE.Vector3(CHANNEL.ix0 + 0.08, -0.1, (CHANNEL.z1 + CHANNEL.iz1) / 2),
];
const fishSegs = [];
let fishLoop = 0;
for (let i = 0; i < 4; i++) {
  const a = fishPath[i];
  const b = fishPath[(i + 1) % 4];
  const len = a.distanceTo(b);
  fishSegs.push({ a, b, len, dir: b.clone().sub(a).normalize() });
  fishLoop += len;
}
function sampleLoop(distance, out) {
  let d = distance % fishLoop;
  if (d < 0) d += fishLoop;
  for (let i = 0; i < fishSegs.length; i++) {
    const seg = fishSegs[i];
    if (d <= seg.len || i === fishSegs.length - 1) {
      out.lerpVectors(seg.a, seg.b, seg.len > 0 ? Math.min(d / seg.len, 1) : 0);
      return seg.dir;
    }
    d -= seg.len;
  }
  return fishSegs[0].dir;
}
for (const spec of [
  { dist: 18, speed: 0.32, color: '#c6b39a', scale: 1 },
  { dist: 36, speed: -0.27, color: '#d2b48c', scale: 0.86 },
  { dist: 78, speed: 0.38, color: '#b7b1a4', scale: 1.04 },
  { dist: 128, speed: 0.24, color: '#8f9186', scale: 0.9 },
  { dist: 176, speed: -0.3, color: '#cbb99a', scale: 1 },
  { dist: 224, speed: 0.28, color: '#a39e93', scale: 0.82 },
]) {
  const mat = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.48 });
  const group = new THREE.Group();
  const body = new THREE.Mesh(fishGeo, mat);
  body.scale.set(0.46 * spec.scale, 0.24 * spec.scale, 1.15 * spec.scale);
  body.castShadow = true;
  group.add(body);
  const tail = new THREE.Mesh(tailGeo, mat);
  tail.rotation.x = Math.PI / 2;
  tail.position.z = 0.16 * spec.scale;
  tail.castShadow = true;
  group.add(tail);
  scene.add(group);
  fish.push({ group, tail, dist: spec.dist, speed: spec.speed, phase: spec.dist * 0.17, scale: spec.scale });
}

// Sparse traces already in the hall, left where they were so the near field stays inhabited.
box(3.2, 0.32, 1.15, -2.1, 0.45, 6.4, new THREE.MeshStandardMaterial({ color: '#a7a398', roughness: 0.95 }));
box(2.6, 0.7, 0.3, -2.1, 1, 6.9, new THREE.MeshStandardMaterial({ color: '#aaa69a', roughness: 1 }));
box(1.2, 0.12, 0.7, -1.4, 0.48, 4.2, wood);
const stone = new THREE.MeshStandardMaterial({ color: '#97958b', roughness: 1 });
const rock = sphere(0.72, 4.6, ROCK_BASE_Y + rockHeight(4.6, 8.2) + 0.3, 8.2, stone, 9);
rock.scale.set(1.5, 0.7, 0.85);

const crackMat = new THREE.LineBasicMaterial({ color: '#6d7961', transparent: true, opacity: 0.75 });
for (const [sx, sz] of [[-3, 1.5], [-2.7, 6.5], [2.5, 2], [2.8, 7.4], [-1.2, 8], [-3.0, 12], [3.2, 14.8], [-1.8, 16.2]]) {
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
  [5.2, ROCK_BASE_Y + rockHeight(5.2, 13.6), 13.6],
  [-4.6, ROCK_BASE_Y + rockHeight(-4.6, 9.4), 9.4]
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
  const segsByLevel = isCoarse ? [0, 4, 9] : [0, 6, 13];
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
const FERN_FRONDS = isCoarse ? 6 : 9;
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
  [-7.1, 0, 6.2, 0.9], [7.2, 0, 16.9, 1.05], [2.4, 0, -3.5, 0.8],
  [-2.5, 0, -3.3, 0.95], [5.0, 0, 12.4, 1.1], [-4.6, 0, 10.2, 0.95],
  [2.7, 0, 4.9, 1.3], [-7.95, -0.16, 13.0, 1.35], [7.95, -0.16, 3.8, 1.3],
  [0.4, 0, 17.0, 1.2],
];
for (const [x, y, z, s] of isCoarse ? fernSpots.slice(0, 8) : fernSpots) {
  const onRocks = y === 0 && Math.abs(x) > PATH_HALF && Math.abs(x) < CHANNEL.ix1;
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
artwork('Étude minérale', 'Une recherche sur la matière, la lumière et le temps.', -8.3, 2.45, 3, -1, '#aca79a', '#5f6456');
artwork('Surface intérieure', 'Une composition silencieuse entre forme et texture.', 8.3, 2.45, 9.5, 1, '#c7b6a0', '#77766a');
artwork('Trace', 'L’empreinte d’une présence dans un espace habité.', -8.3, 2.45, 14.5, -1, '#aaa398', '#524c46');

const essenceMat = new THREE.MeshBasicMaterial({ color: '#f1eee4', transparent: true, opacity: 0.18, depthWrite: false });
const essence = sphere(0.075, 0, 0, 0, essenceMat, 24);
essence.castShadow = false;

// ---- Portals between the gallery and the valley ----
const portalMat = new THREE.MeshBasicMaterial({ color: '#07090c' });
box(0.22, 2.72, 0.26, -0.86, 1.36, HALL.north - 0.1, hallConcrete);
box(0.22, 2.72, 0.26, 0.86, 1.36, HALL.north - 0.1, hallConcrete);
box(1.94, 0.22, 0.26, 0, 2.83, HALL.north - 0.1, hallConcrete);
const portalHall = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.6), portalMat);
portalHall.position.set(0, 1.3, HALL.north - 0.12);
portalHall.rotation.y = Math.PI;
scene.add(portalHall);

const _vpx = dsMeander(95) + 10, _vpz = 100;
const _vpy = dsHeight(_vpx, _vpz);
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
const hallBg = scene.background.clone();
const hallFog = scene.fog;
const sunShadow0 = sun.castShadow;
function setLevel(lv) {
  level = lv;
  const valley = lv === 'valley';
  scene.background = valley ? new THREE.Color('#e9ebe7') : hallBg;
  scene.fog = valley ? new THREE.FogExp2('#e6e8e4', 0.0056) : hallFog;
  if (fogPass) fogPass.enabled = !valley;
  sun.castShadow = valley ? false : sunShadow0;
  sun.intensity = valley ? 1.0 : 3.6;
  valleyHemi.intensity = valley ? 1.3 : 0;
  scene.environmentIntensity = valley ? 0.3 : 0.07;
  camera.far = valley ? 420 : 220;
  camera.updateProjectionMatrix();
  dust.visible = !valley;
  if (valley) {
    const sx2 = dsMeander(95) + 10;
    camera.position.set(VALLEY.x + sx2, dsHeight(sx2, 95) + 1.58, VALLEY.z + 95);
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
  corridorHalf: 1.85,
  corridorZMin: -11.15,
  bridgeHalf: 1.85,
  bridgeZMin: -5.06,
  bridgeZMax: -3.7,
  floorHalf: PATH_HALF - 0.25,
  floorZMin: CHANNEL.iz0 + 0.07,
  floorZMax: CHANNEL.iz1 - 0.4,
};
function canOccupy(x, z) {
  if (level === 'valley') return Math.hypot(x - VALLEY.x, z - VALLEY.z) < VALLEY.radius;
  if (z <= HALL.doorZ) return Math.abs(x) <= WALK.corridorHalf && z >= WALK.corridorZMin;
  const onBridge = Math.abs(x) <= WALK.bridgeHalf && z >= WALK.bridgeZMin && z <= WALK.bridgeZMax;
  const onFloor = Math.abs(x) <= WALK.floorHalf && z >= WALK.floorZMin && z <= WALK.floorZMax;
  return onBridge || onFloor;
}

let yaw = 0, pitch = 0, verticalVelocity = 0, grounded = true, started = false, activeWork = null;
const keys = {};
const movement = { x: 0, y: 0 };
let dragLook = null;
const hint = document.querySelector('#hint');
const panel = document.querySelector('#artPanel');
const move = new THREE.Vector2();
const _fishPos = new THREE.Vector3();
const _fishAhead = new THREE.Vector3();
const _fishPerp = new THREE.Vector3();

function enter() {
  document.querySelector('#intro').style.display = 'none';
  started = true;
  if (matchMedia('(pointer:fine)').matches) renderer.domElement.requestPointerLock?.();
}
document.querySelector('#enter').onclick = enter;
document.querySelector('#close').onclick = () => { panel.style.display = 'none'; };
document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyE') interact();
  if (e.code === 'Escape') panel.style.display = 'none';
  if (e.code === 'Space') jump();
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });
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

let audioCtx, audioGain, waterGain;
function buildAudio() {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const rate = audioCtx.sampleRate;
  audioGain = audioCtx.createGain();
  audioGain.gain.value = 0.34;
  audioGain.connect(audioCtx.destination);

  // Wind bed.
  const wlen = rate * 24;
  const wbuf = audioCtx.createBuffer(1, wlen, rate);
  const wdata = wbuf.getChannelData(0);
  let slow = 0;
  for (let i = 0; i < wlen; i++) {
    slow = slow * 0.996 + (Math.random() * 2 - 1) * 0.004;
    wdata[i] = slow * 0.3 + (Math.random() * 2 - 1) * 0.016;
  }
  const wind = audioCtx.createBufferSource();
  wind.buffer = wbuf;
  wind.loop = true;
  const windFilter = audioCtx.createBiquadFilter();
  windFilter.type = 'lowpass';
  windFilter.frequency.value = 360;
  const windGain = audioCtx.createGain();
  windGain.gain.value = 0.8;
  wind.connect(windFilter).connect(windGain).connect(audioGain);
  wind.start();

  // Water: white noise through modulated bandpasses = burbling stream.
  const nlen = rate * 10;
  const nbuf = audioCtx.createBuffer(1, nlen, rate);
  const ndata = nbuf.getChannelData(0);
  for (let i = 0; i < nlen; i++) ndata[i] = Math.random() * 2 - 1;
  const noise = audioCtx.createBufferSource();
  noise.buffer = nbuf;
  noise.loop = true;
  waterGain = audioCtx.createGain();
  waterGain.gain.value = 0;
  waterGain.connect(audioGain);
  const bp1 = audioCtx.createBiquadFilter();
  bp1.type = 'bandpass';
  bp1.frequency.value = 360;
  bp1.Q.value = 0.8;
  const g1 = audioCtx.createGain();
  g1.gain.value = 0.09;
  noise.connect(bp1).connect(g1).connect(waterGain);
  const bp2 = audioCtx.createBiquadFilter();
  bp2.type = 'bandpass';
  bp2.frequency.value = 1050;
  bp2.Q.value = 1.1;
  const g2 = audioCtx.createGain();
  g2.gain.value = 0.018;
  noise.connect(bp2).connect(g2).connect(waterGain);
  noise.start();
  const lfo1 = audioCtx.createOscillator();
  lfo1.frequency.value = 0.37;
  const lfo1g = audioCtx.createGain();
  lfo1g.gain.value = 90;
  lfo1.connect(lfo1g).connect(bp1.frequency);
  lfo1.start();
  const lfo2 = audioCtx.createOscillator();
  lfo2.frequency.value = 2.1;
  const lfo2g = audioCtx.createGain();
  lfo2g.gain.value = 0.016;
  lfo2.connect(lfo2g).connect(g2.gain);
  lfo2.start();

  // Random drips ("plip") into the canal.
  function plip() {
    if (audioCtx.state !== 'running' || !waterGain.gain.value) return;
    const t0 = audioCtx.currentTime + Math.random() * 0.3;
    const osc = audioCtx.createOscillator();
    osc.frequency.setValueAtTime(300 + Math.random() * 250, t0);
    osc.frequency.exponentialRampToValueAtTime(600 + Math.random() * 300, t0 + 0.07);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.04 + Math.random() * 0.04, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.11);
    osc.connect(g).connect(waterGain);
    osc.start(t0);
    osc.stop(t0 + 0.14);
  }
  // Long, irregular silences between drips instead of a metronome.
  (function schedulePlip() {
    setTimeout(() => { plip(); schedulePlip(); }, 2000 + Math.random() * 7000);
  })();
}
document.querySelector('#sound').onclick = () => {
  const b = document.querySelector('#sound');
  if (audioCtx) {
    if (audioCtx.state === 'running') { audioCtx.suspend(); b.textContent = 'SON : OFF'; }
    else { audioCtx.resume(); b.textContent = 'SON : ON'; }
    return;
  }
  buildAudio();
  b.textContent = 'SON : ON';
};

const clock = new THREE.Clock();
let t = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.045);
  t += dt;
  if (started) {
    CH.disturb();
    CH.step(2);
    drawWindow();
  }
  for (const f of fish) {
    f.dist += f.speed * dt;
    const dir = sampleLoop(f.dist, _fishPos);
    _fishPerp.set(-dir.z, 0, dir.x);
    _fishPos.addScaledVector(_fishPerp, Math.sin(t * 0.35 + f.phase) * 0.1);
    _fishPos.y = -0.1 + Math.sin(t * 0.7 + f.phase) * 0.012;
    f.group.position.copy(_fishPos);
    _fishAhead.copy(_fishPos).addScaledVector(dir, f.speed >= 0 ? 1 : -1);
    f.group.lookAt(_fishAhead);
    f.tail.rotation.x = Math.PI / 2 + Math.sin(t * 2.3 + f.phase) * 0.32;
  }
  waterMat.opacity = 0.6 + Math.sin(t * 0.7) * 0.018;
  if (waterMat.userData.shader) waterMat.userData.shader.uniforms.uTime.value = t;
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
    if (dustLoc[o + 1] < 0.25) { dustLoc[o + 1] = 0.25; dustVel[o + 1] = Math.abs(dustVel[o + 1]) * 0.4; }
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
  if (waterGain) {
    const cx = camera.position.x;
    const cz = camera.position.z;
    const dEdge = Math.min(cx - CHANNEL.ix0, CHANNEL.ix1 - cx, cz - CHANNEL.iz0, CHANNEL.iz1 - cz);
    const vol = level === 'valley'
      ? Math.max(0.05, Math.min(1, 1 - Math.abs(cx - VALLEY.x - dsMeander(cz - VALLEY.z)) / 16))
      : cz <= HALL.doorZ ? 0.12 : Math.max(0.06, Math.min(1, 1 - dEdge / 9));
    waterGain.gain.value += (vol - waterGain.gain.value) * Math.min(1, dt * 3);
  }
  for (const s of shafts) {
    const d = Math.abs(s.position.z - camera.position.z);
    s.material.opacity = 0.11 * Math.max(0, 1 - d / 26);
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
    const speed = (keys.ShiftLeft ? 5.3 : 3.25) * dt;
    const nx = camera.position.x + (Math.cos(yaw) * move.x - Math.sin(yaw) * move.y) * speed;
    const nz = camera.position.z + (-Math.sin(yaw) * move.x - Math.cos(yaw) * move.y) * speed;
    let x = nx;
    let z = nz;
    if (!canOccupy(x, z)) {
      if (canOccupy(nx, camera.position.z)) z = camera.position.z;
      else if (canOccupy(camera.position.x, nz)) x = camera.position.x;
      else { x = camera.position.x; z = camera.position.z; }
    }
    camera.position.x = x;
    camera.position.z = z;
    verticalVelocity -= 9.3 * dt;
    camera.position.y += verticalVelocity * dt;
    const floorY = level === 'valley'
      ? dsHeight(camera.position.x - VALLEY.x, camera.position.z - VALLEY.z) + 1.58
      : 1.58;
    if (camera.position.y <= floorY) {
      camera.position.y = floorY;
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
  hint.classList.toggle('visible', (!!nearest || nearWin || nearPortal) && panel.style.display !== 'block' && started);
  const tap = matchMedia('(pointer:coarse)').matches;
  hint.textContent = nearPortal
    ? (level === 'hall'
      ? `La vallée · ${tap ? 'Touchez ici pour traverser' : 'E pour traverser'}`
      : `La galerie · ${tap ? 'Touchez ici pour revenir' : 'E pour revenir'}`)
    : nearest
      ? `${nearest.name} · ${tap ? 'Touchez ici pour découvrir' : 'E pour découvrir'}`
      : nearWin
        ? `Champ de phase · ${tap ? 'Touchez ici pour perturber' : 'E pour perturber'}`
        : '';
  essence.position.copy(camera.position);
  essence.position.y -= 0.25;
  essence.position.add(new THREE.Vector3(0, Math.sin(t * 1.4) * 0.02, -0.35).applyEuler(camera.rotation));
  renderer.shadowMap.needsUpdate = true;
  composer.render();
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
hint.addEventListener('click', interact);
hint.style.pointerEvents = 'auto';
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

if (import.meta.env.DEV) window.__inga = { camera, canOccupy, scene };
