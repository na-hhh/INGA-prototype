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
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createSmoke2D } from './smoke2d.js';
import { createSmoke3D } from './smoke3d.js';
import { createBuilder } from './builder.js';
import { createBrutalLevel } from './brutal.js';
import { createDummy } from './dummy.js';
import { createPaintDecals } from './paintDecals.js';
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
camera.position.set(0, 1.58, -10.6);
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
  // SSRPass alloue un tampon de profondeur 16 bits ; avec near = 8 cm il ne
  // résout plus que ~8 cm à 20 m et ~50 cm à 50 m : toute la scène (rendue
  // dans cette cible), les reflets et le brouillard qui relisent la
  // profondeur se couvrent de franges concentriques à distance. 24 bits.
  ssrPass.beautyRenderTarget.depthTexture.type = THREE.UnsignedIntType;
  composer.addPass(ssrPass);
} else {
  composer.addPass(new RenderPass(scene, camera));
}
// Peinture projetée sur la géométrie (voir paintDecals.js) : juste après le
// rendu de la scène, avant l'occlusion ambiante qui l'assombrira comme le reste.
const paintDecals = ssrPass ? createPaintDecals({ camera, depthTexture: () => ssrPass.beautyRenderTarget.depthTexture }) : null;
if (paintDecals) composer.addPass(paintDecals.pass);
// Rendu allégé (niveau de la ville) : la passe de reflets redessine la scène
// trois fois (image, normales, métal) et l'occlusion une quatrième. Pour une
// scène de plus d'un million de triangles, on ne garde qu'UN rendu : les
// reflets sont coupés et l'occlusion relit la profondeur déjà calculée.
let sceneLite = false;
if (ssrPass) {
  const full = ssrPass.render.bind(ssrPass);
  ssrPass.render = function (rndr, writeBuffer, ...rest) {
    if (!sceneLite) return full(rndr, writeBuffer, ...rest);
    rndr.setRenderTarget(this.beautyRenderTarget);
    rndr.clear();
    rndr.render(this.scene, this.camera);
    this.copyMaterial.uniforms.tDiffuse.value = this.beautyRenderTarget.texture;
    this.copyMaterial.blending = THREE.NoBlending;
    this._renderPass(rndr, this.copyMaterial, this.renderToScreen ? null : writeBuffer);
  };
}
let gtaoPass = null;
if (!LITE) {
  gtaoPass = new GTAOPass(scene, camera, innerWidth, innerHeight);
  gtaoPass.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.3, thickness: 1.0, scale: 1.8, samples: 16 });
  gtaoPass.blendIntensity = 1.0;
  composer.addPass(gtaoPass);
}
let gtaoOwn = null;
function setSceneLite(on) {
  if (on === sceneLite) return;
  sceneLite = on;
  if (!gtaoPass || !ssrPass) return;
  if (!gtaoOwn) gtaoOwn = { depth: gtaoPass.depthTexture, normal: gtaoPass.normalTexture };
  gtaoPass.depthTexture = on ? ssrPass.beautyRenderTarget.depthTexture : gtaoOwn.depth;
  gtaoPass.normalTexture = on ? undefined : gtaoOwn.normal;
  gtaoPass._renderGBuffer = !on;
  for (const m of [gtaoPass.gtaoMaterial, gtaoPass.pdMaterial]) {
    m.defines.NORMAL_VECTOR_TYPE = on ? 0 : 1;
    m.uniforms.tNormal.value = gtaoPass.normalTexture ?? null;
    m.uniforms.tDepth.value = gtaoPass.depthTexture;
    m.needsUpdate = true;
  }
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
// Paintable fog density: a coarse 3D volume over the whole walkable world.
// The brush is the only source of fog: 0 (default) = clear air,
// 128 = the reference procedural density, 255 = double.
// Painted with the in-game brush (F), persisted in localStorage.
const FOG_VOL = {
  nx: 192, ny: 48, nz: 192,
  min: new THREE.Vector3(-170, -26, -100),
  max: new THREE.Vector3(170, 74, 210),
};
const fogVolData = new Uint8Array(FOG_VOL.nx * FOG_VOL.ny * FOG_VOL.nz);
try {
  const sv = localStorage.getItem('ingaFogVol2');
  if (sv) {
    const b = atob(sv);
    if (b.length === fogVolData.length) for (let i = 0; i < b.length; i++) fogVolData[i] = b.charCodeAt(i);
  }
} catch { /* quota/corrupt: keep neutral */ }
const fogVolTex = new THREE.Data3DTexture(fogVolData, FOG_VOL.nx, FOG_VOL.ny, FOG_VOL.nz);
fogVolTex.format = THREE.RedFormat;
fogVolTex.minFilter = THREE.LinearFilter;
fogVolTex.magFilter = THREE.LinearFilter;
fogVolTex.unpackAlignment = 1;
fogVolTex.needsUpdate = true;
// Shared by every valley material's ground-mist injection; x/y (height range)
// are filled in once VALLEY exists, z is the strength the fog panel drives.
const MIST_RANGE = new THREE.Vector3(0, 1, +(localStorage.getItem('ingaMist') || 0.5));
function paintFog(c, radius, amount) {
  const { nx, ny, nz, min, max } = FOG_VOL;
  const sx = nx / (max.x - min.x), sy = ny / (max.y - min.y), sz = nz / (max.z - min.z);
  const x0 = Math.max(0, Math.floor((c.x - radius - min.x) * sx)), x1 = Math.min(nx - 1, Math.ceil((c.x + radius - min.x) * sx));
  const y0 = Math.max(0, Math.floor((c.y - radius - min.y) * sy)), y1 = Math.min(ny - 1, Math.ceil((c.y + radius - min.y) * sy));
  const z0 = Math.max(0, Math.floor((c.z - radius - min.z) * sz)), z1 = Math.min(nz - 1, Math.ceil((c.z + radius - min.z) * sz));
  for (let iz = z0; iz <= z1; iz++) {
    const wz = min.z + (iz + 0.5) / sz;
    for (let iy = y0; iy <= y1; iy++) {
      const wy = min.y + (iy + 0.5) / sy;
      for (let ix = x0; ix <= x1; ix++) {
        const wx = min.x + (ix + 0.5) / sx;
        const d = Math.hypot(wx - c.x, wy - c.y, wz - c.z) / radius;
        if (d >= 1) continue;
        const fall = (1 - d) * (1 - d) * (3 - 2 * (1 - d)); // smooth edge
        const i = ix + nx * (iy + ny * iz);
        fogVolData[i] = Math.max(0, Math.min(255, fogVolData[i] + amount * 255 * fall));
      }
    }
  }
  fogVolTex.needsUpdate = true;
}
// ---- Fog smoke simulation ----
// The fog behaves like heavy smoke: it falls under gravity, and where the
// fall is blocked (terrain, or a saturated cell below) it spreads sideways —
// draining downhill and flattening into pools over local minima.
const FOG_SIM = { gravity: 0.4, spread: 0.35, decay: 0 };
let fogGround = null; // per xz-column: first air voxel above the terrain
let fogSimSlice = 0;
function fogGroundInit() {
  const { nx, ny, nz, min, max } = FOG_VOL;
  const cw = (max.x - min.x) / nx, cd = (max.z - min.z) / nz, ch = (max.y - min.y) / ny;
  fogGround = new Uint8Array(nx * nz);
  for (let iz = 0; iz < nz; iz++) {
    const wz = min.z + (iz + 0.5) * cd;
    for (let ix = 0; ix < nx; ix++) {
      const wx = min.x + (ix + 0.5) * cw;
      let gy;
      if (level === 'smoke') {
        // Flat slab at y = 0; the tank walls become terrain so the smoke
        // pools inside instead of leaking through them.
        const dx = Math.abs(wx - BAC.cx), dz = Math.abs(wz - BAC.cz);
        const inWall = dx <= BAC.half + BAC.wallT && dz <= BAC.half + BAC.wallT && (dx > BAC.half || dz > BAC.half);
        gy = inWall ? BAC.wallH : 0;
      } else {
        const inHall = Math.abs(wx) <= HALL.x && wz >= HALL.doorZ && wz <= HALL.north;
        gy = inHall ? 0 : VALLEY.y + dsHeight(wx - VALLEY.x, wz - VALLEY.z);
      }
      fogGround[ix + nx * iz] = Math.max(0, Math.min(ny, Math.ceil((gy - min.y) / ch)));
    }
  }
}
function fogSimTick() {
  if (FOG_SIM.gravity <= 0 && FOG_SIM.spread <= 0 && FOG_SIM.decay <= 0) return;
  if (!fogGround) fogGroundInit();
  const { nx, ny, nz } = FOG_VOL;
  const grav = Math.min(1, FOG_SIM.gravity * 0.6), sp = Math.min(0.24, FOG_SIM.spread * 0.2), dec = FOG_SIM.decay * 0.03;
  let changed = false;
  // 18 slices/frame: full-volume settle pass ~6x/second at 60 fps, which
  // keeps the apparent fall speed similar to the old half-res grid.
  for (let s = 0; s < 18; s++) {
    const iz = fogSimSlice = (fogSimSlice + 1) % nz;
    const zBase = nx * ny * iz;
    for (let ix = 0; ix < nx; ix++) {
      const g0 = fogGround[ix + nx * iz];
      for (let iy = g0; iy < ny; iy++) {
        const i = ix + nx * iy + zBase;
        let v = fogVolData[i];
        if (v < 2) continue;
        if (dec > 0) {
          v = Math.max(0, v - Math.max(1, v * dec | 0));
          fogVolData[i] = v;
          changed = true;
          if (v < 2) continue;
        }
        // Gravity: pour into the air cell below until it saturates.
        if (iy > g0 && grav > 0) {
          const ib = i - nx;
          const t = Math.min(v, 255 - fogVolData[ib]) * grav | 0;
          if (t > 0) { v -= t; fogVolData[i] = v; fogVolData[ib] += t; changed = true; }
        }
        // Blocked below (ground or a near-full cell): flow sideways. If the
        // neighbour column has free air BELOW this level, pour diagonally
        // down into it — without this, slopes drain one whole layer at a
        // time and the fog reads as terraced plateaus.
        if (sp > 0 && v > 4 && (iy === g0 || fogVolData[i - nx] > 230)) {
          for (let k = 0; k < 4; k++) {
            const jx = ix + (k === 0 ? 1 : k === 1 ? -1 : 0);
            const jz = iz + (k === 2 ? 1 : k === 3 ? -1 : 0);
            if (jx < 0 || jx >= nx || jz < 0 || jz >= nz) continue;
            const jg = fogGround[jx + nx * jz];
            if (iy < jg) continue; // hillside: no flow into terrain
            if (iy > jg && fogVolData[jx + nx * (iy - 1 + ny * jz)] < 230) {
              const j = jx + nx * (iy - 1 + ny * jz);
              const t = Math.min(v, 255 - fogVolData[j]) * Math.min(0.9, sp * 3) | 0;
              if (t > 0) { v -= t; fogVolData[i] = v; fogVolData[j] += t; changed = true; }
            } else {
              const j = jx + nx * (iy + ny * jz);
              const d = v - fogVolData[j];
              if (d > 2) {
                const t = d * sp | 0;
                if (t > 0) { v -= t; fogVolData[i] = v; fogVolData[j] += t; changed = true; }
              }
            }
          }
        }
      }
      // Ghost cell: copy the first air value into the terrain voxel below
      // it, so trilinear filtering doesn't fade to black at every terrain
      // stair-step (the striping seen on hillsides).
      if (g0 > 0 && g0 < ny) {
        const gi = ix + nx * (g0 - 1) + zBase;
        const src = fogVolData[ix + nx * g0 + zBase];
        if (fogVolData[gi] !== src) { fogVolData[gi] = src; changed = true; }
      }
    }
  }
  if (changed) fogVolTex.needsUpdate = true;
}
// Raymarched volumetric fog: height fog + animated 3D noise + real god rays
// shadow-mapped against the actual geometry, lit with a Henyey-Greenstein phase.
let fogPass = null;
if (!LITE) {
  const VolumetricFogShader = {
    uniforms: {
      tDiffuse: { value: null },
      tDepth: { value: null },
      tShadow: { value: null },
      uShadowMatrix: { value: new THREE.Matrix4() },
      uFogVol: { value: fogVolTex },
      uFogMin: { value: FOG_VOL.min },
      uFogInv: { value: new THREE.Vector3(
        1 / (FOG_VOL.max.x - FOG_VOL.min.x),
        1 / (FOG_VOL.max.y - FOG_VOL.min.y),
        1 / (FOG_VOL.max.z - FOG_VOL.min.z)) },
      uProjInv: { value: new THREE.Matrix4() },
      uViewInv: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uSunDir: { value: SUN_DIR.clone() },
      uSunCol: { value: new THREE.Vector3(1.0, 0.92, 0.78).multiplyScalar(2.6) },
      uTime: { value: 0 },
      // Fumée des sources (galerie) : second volume, celui du fluide FFT,
      // ajouté au brouillard peint. uSmokeGain = 0 coupe la lecture.
      uSmokeVol: { value: null },
      uSmokeMin: { value: new THREE.Vector3() },
      uSmokeInv: { value: new THREE.Vector3(1, 1, 1) },
      uSmokeGain: { value: 0 },
      uSmokeLum: { value: 0.6 },
      // 0 = densité brute, 1 = bruit procédural fixe, 2 = bruit advecté.
      uSmokeMode: { value: 1 },
      uSmokeScale: { value: 1 },
      uSmokeStep: { value: 0.15 },
      uDet0: { value: null },
      uDet1: { value: null },
      uDetW: { value: new THREE.Vector2(1, 0) },
      uDetAmp: { value: 1 },
      uNoise: { value: null },
    },
    vertexShader: `varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      #include <packing>
      uniform sampler2D tDiffuse;
      uniform sampler2D tDepth;
      uniform sampler2D tShadow;
      uniform mat4 uShadowMatrix;
      uniform highp sampler3D uFogVol;
      uniform vec3 uFogMin;
      uniform vec3 uFogInv;
      uniform mat4 uProjInv;
      uniform mat4 uViewInv;
      uniform vec3 uCamPos;
      uniform vec3 uSunDir;
      uniform vec3 uSunCol;
      uniform float uTime;
      uniform highp sampler3D uSmokeVol;
      uniform vec3 uSmokeMin;
      uniform vec3 uSmokeInv;
      uniform float uSmokeGain;
      uniform float uSmokeLum;
      uniform float uSmokeMode;
      uniform float uSmokeScale;
      uniform float uSmokeStep;
      uniform highp sampler3D uDet0;
      uniform highp sampler3D uDet1;
      uniform vec2 uDetW;
      uniform float uDetAmp;
      uniform highp sampler3D uNoise;
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
      // Sample the sun's real shadow map: fog is lit exactly where actual
      // geometry (ceiling holes, roof overhangs, boulders) lets the sun
      // through, so the beams are cast physically rather than programmed.
      // Outside the shadow camera's footprint there is only open sky.
      float sunVis(vec3 p) {
        vec4 sc = uShadowMatrix * vec4(p, 1.0);
        if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0 || sc.z < 0.0) return 0.7;
        float d = unpackRGBAToDepth(texture2D(tShadow, sc.xy));
        return sc.z - 0.002 < d ? 1.0 : 0.0;
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
        // March the full map: fog must never visibly pop in at a range cap.
        float dist = min(length(rd), 460.0);
        rd = normalize(rd);
        const int STEPS = 64;
        // Exponential marching: ~1.3 m steps near the camera growing ~4.5%
        // per step (to ~22 m at the 460 m tail). Steps sized from total ray
        // length made beams coarse whenever open sky lay behind them.
        float t = 0.0;
        float sl = 1.32;
        // Stable per-pixel jitter (no time term, no IGN): animated noise read
        // as static, IGN's diagonal structure read as zebra stripes.
        float jl = hash13(vec3(gl_FragCoord.xy, 7.0)) * 0.25;
        vec3 trans = vec3(1.0);
        vec3 inscatter = vec3(0.0);
        float cosT = dot(rd, uSunDir);
        float g = 0.45;
        // Dual-lobe phase: fog diffuses light in every direction (isotropic
        // 1/4pi) with a forward bias toward the sun, instead of only glowing
        // when the camera faces the light.
        float hg = (1.0 - g * g) / (12.566 * pow(1.0 + g * g - 2.0 * g * cosT, 1.5));
        float phase = mix(0.0796, hg, 0.55);
        vec3 fogCol = vec3(0.115, 0.112, 0.102);
        vec3 sunCol = uSunCol;
        // Chromatic extinction: blue dies first, so light crossing enough fog
        // comes out warmed and stained by the medium.
        vec3 sigma = vec3(0.8, 1.0, 1.45);
        for (int i = 0; i < STEPS; i++) {
          float t1 = min(t + sl, dist);
          float seg = t1 - t;
          if (seg <= 0.0) break;
          // Quarter-step stratified offset only: full-segment jitter reads as
          // film grain in dense fog.
          vec3 p = ro + rd * (t + seg * (0.375 + jl));
          float n = noise3(p * 0.33 + vec3(uTime * 0.045, uTime * 0.012, uTime * 0.02));
          // No built-in altitude falloff: the painted volume alone decides
          // where fog lives (the smoke sim already pulls it downhill).
          float density = 0.016 * (0.55 + 0.9 * n);
          // Painted volume is the only fog source: 0 = clear air,
          // 128/255 = the reference density, 255 = double.
          // Vertical domain warp before the volume lookup: the settle sim
          // builds flat saturated layers, and sampled straight they read as
          // stacked planes. Warping the sample height ±~2.5 m by drifting
          // noise erodes the iso-surfaces into wisps.
          float wy = (noise3(p * vec3(0.16, 0.09, 0.16) + vec3(uTime * 0.03, 0.0, uTime * 0.022)) - 0.5) * 5.0;
          density *= texture(uFogVol, clamp((p + vec3(0.0, wy, 0.0) - uFogMin) * uFogInv, 0.0, 1.0)).r * 2.0;
          // Stratified beam sampling: 4 taps per segment, each pixel shifted
          // by a stable sub-step offset. Identical offsets for all pixels
          // made concentric shells that swept radially when moving;
          // full-step jitter made white speckle. A quarter stratum: neither.
          float lit = 0.25 * (
            sunVis(ro + rd * (t + seg * (jl + 0.0))) +
            sunVis(ro + rd * (t + seg * (jl + 0.25))) +
            sunVis(ro + rd * (t + seg * (jl + 0.5))) +
            sunVis(ro + rd * (t + seg * (jl + 0.75))));
          // Beams only add in-scatter; boosting extinction inside them put
          // jitter grain on every surface seen through a beam.
          vec3 absorb = exp(-density * sigma * seg);
          // Ambient skylight scattered by the fog, visible from any angle,
          // plus the sun term shaped by the dual-lobe phase above.
          vec3 S = fogCol * 2.2 + sunCol * phase * (lit * 3.6 + 0.012);
          inscatter += trans * (1.0 - absorb) * S;
          trans *= absorb;
          if (trans.g < 0.004) break; // opaque fog: nothing behind contributes
          t = t1;
          sl *= 1.045;
        }
        vec3 col = sceneCol.rgb * trans + inscatter;
        // Fumée des sources : marche séparée, bornée à la boîte du fluide, à
        // pas fins (0,15 m près de la caméra, +2 %/pas) — la marche du
        // brouillard ci-dessus garde ses pas d'origine. Décalage d'un pas
        // entier par pixel : aucune coquille concentrique possible.
        if (uSmokeGain > 0.0) {
          vec3 rdi = 1.0 / (rd + vec3(equal(rd, vec3(0.0))) * 1e-6);
          vec3 ta = (uSmokeMin - ro) * rdi;
          vec3 tb = (uSmokeMin + 1.0 / uSmokeInv - ro) * rdi;
          vec3 tmn = min(ta, tb);
          vec3 tmx = max(ta, tb);
          float tn = max(max(tmn.x, tmn.y), max(tmn.z, 0.0));
          float tf = min(min(tmx.x, tmx.y), min(tmx.z, dist));
          if (tf > tn) {
            vec3 sTrans = vec3(1.0);
            vec3 sIn = vec3(0.0);
            float st = tn;
            float ss = uSmokeStep;
            float sj = hash13(vec3(gl_FragCoord.xy, 3.0));
            vec3 drift = vec3(uTime * 0.05, -uTime * 0.16, uTime * 0.04);
            for (int i = 0; i < 96; i++) {
              float s1 = min(st + ss, tf);
              float seg = s1 - st;
              if (seg <= 0.0) break;
              vec3 p = ro + rd * (st + seg * sj);
              vec3 sp = (p - uSmokeMin) * uSmokeInv;
              float raw0 = texture(uSmokeVol, sp).r;
              if (raw0 > 0.003) {
                float d = raw0;
                if (uSmokeMode > 1.5) {
                  // Bruit advecté (esprit « wavelet turbulence ») : deux jeux
                  // de coordonnées transportés par l'écoulement, régénérés en
                  // alternance. Le bruit est lu dans une texture 3D répétée :
                  // les détails sont étirés en filaments par le fluide.
                  vec3 q0 = p + texture(uDet0, sp).xyz;
                  vec3 q1 = p + texture(uDet1, sp).xyz + 13.7;
                  vec3 dsp = (texture(uNoise, q0 * 0.085).rgb - 0.5) * uDetW.x + (texture(uNoise, q1 * 0.085).rgb - 0.5) * uDetW.y;
                  float raw = texture(uSmokeVol, (p + dsp * uDetAmp * 4.0 - uSmokeMin) * uSmokeInv).r;
                  float nz = ((texture(uNoise, q0 * 0.31).a - 0.5) * uDetW.x + (texture(uNoise, q1 * 0.31).a - 0.5) * uDetW.y) / length(uDetW);
                  d = max(0.0, raw * (1.15 + 3.4 * uDetAmp * nz) - 0.06 * uDetAmp * (0.5 + 2.0 * nz) * (1.0 - raw));
                } else if (uSmokeMode > 0.5) {
                  // Déformation du domaine puis érosion par deux octaves de
                  // bruit fixe : du détail sous la maille, mais qui ne suit
                  // pas l'écoulement.
                  vec3 q = p * 1.25 * uSmokeScale + drift;
                  vec3 w = vec3(noise3(q), noise3(q.yzx + 7.3), noise3(q.zxy + 3.1)) - 0.5;
                  float raw = texture(uSmokeVol, (p + w * 0.4 / uSmokeScale - uSmokeMin) * uSmokeInv).r;
                  float nz = noise3(p * 2.6 * uSmokeScale + drift * 2.0) * 0.65 + noise3(p * 6.5 * uSmokeScale + drift * 3.0) * 0.35;
                  d = max(0.0, raw * (0.45 + 1.1 * nz) - 0.05 * nz);
                }
                d *= 0.032 * uSmokeGain;
                if (d > 0.0) {
                  vec3 absorb = exp(-d * sigma * seg);
                  vec3 S = vec3(uSmokeLum) + sunCol * phase * (sunVis(p) * 3.6 + 0.012);
                  sIn += sTrans * (1.0 - absorb) * S;
                  sTrans *= absorb;
                  if (sTrans.g < 0.01) break;
                }
              }
              st = s1;
              ss *= 1.02;
            }
            col = col * sTrans + sIn;
          }
        }
        gl_FragColor = vec4(col, sceneCol.a);
      }`,
  };
  fogPass = new ShaderPass(VolumetricFogShader);
  // Reuse the depth buffer SSRPass already renders — no extra scene pass.
  fogPass.uniforms.tDepth.value = ssrPass.beautyRenderTarget.depthTexture;
  // ShaderPass clones uniform textures; rebind the live volume or the GPU
  // keeps a frozen snapshot and brush edits never show.
  fogPass.uniforms.uFogVol.value = fogVolTex;
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

// ---- Fog brush (F): paint fog density with a sphere, god mode (G) to fly ----
const fogBrush = { open: false, radius: 12, strength: 4, dist: 18, btn: -1, dirty: false };
// Panneau des sources de fumée (V) — déclaré ici pour les gardes du menu dev.
const smokeSrcUI = { open: false };
const fogBrushGizmo = new THREE.Mesh(
  new THREE.SphereGeometry(1, 28, 18),
  new THREE.MeshBasicMaterial({ color: 0x55c8ff, transparent: true, opacity: 0.16, depthWrite: false }));
fogBrushGizmo.visible = false;
scene.add(fogBrushGizmo);
// Tout ce qui appartient à « la pièce » (galerie ou atelier) : repères, balles,
// aspirateurs, constructions. Jamais masqué par le changement de niveau.
const roomRoot = new THREE.Group();
scene.add(roomRoot);
const _fbDir = new THREE.Vector3();
// Programmatic pointer-lock exits (panels) must not open the Échap dev menu.
let devMenuSuppress = 0;
function saveFogVol() {
  if (level === 'smoke') return; // bac experiments are ephemeral
  let s = '';
  for (let i = 0; i < fogVolData.length; i += 0x8000) s += String.fromCharCode(...fogVolData.subarray(i, i + 0x8000));
  try { localStorage.setItem('ingaFogVol2', btoa(s)); } catch { /* quota */ }
}
function fillFogVol(v) {
  fogVolData.fill(v);
  fogVolTex.needsUpdate = true;
  saveFogVol();
}
{
  const fp = document.createElement('div');
  fp.style.cssText = 'position:fixed;top:64px;left:18px;width:250px;background:#10151299;color:#e4e8de;font:11px "DM Sans",sans-serif;padding:14px 16px;border:1px solid #ffffff2a;border-radius:10px;z-index:9;display:none;backdrop-filter:blur(12px)';
  fp.innerHTML = '<div style="letter-spacing:.16em;font-size:10px;margin-bottom:4px">PINCEAU BROUILLARD</div>'
    + '<div style="opacity:.6;margin-bottom:10px">F pour fermer · G : vol libre (Espace/C : monter/descendre)<br>Clic gauche : ajouter · Clic droit : effacer<br>Échap libère la souris pour les réglages</div>';
  document.body.appendChild(fp);
  const addSlider = (label, min, max, step, value, on) => {
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
    inp.style.cssText = 'width:100%;accent-color:#6fb8c5';
    inp.addEventListener('input', () => { valEl.textContent = (+inp.value).toFixed(2); on(+inp.value); });
    lab.append(nameEl, valEl);
    w.append(lab, inp);
    fp.append(w);
  };
  const addButton = (label, on) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'margin:10px 8px 0 0;background:#f5f0e916;border:1px solid #ffffff44;color:#e4e8de;padding:7px 11px;border-radius:5px;cursor:pointer;font:11px "DM Sans",sans-serif';
    b.addEventListener('click', on);
    fp.append(b);
  };
  addSlider('Rayon', 1.5, 50, 0.5, fogBrush.radius, (v) => { fogBrush.radius = v; });
  addSlider('Force', 0.1, 15, 0.1, fogBrush.strength, (v) => { fogBrush.strength = v; });
  addSlider('Distance du pinceau', 2, 120, 1, fogBrush.dist, (v) => { fogBrush.dist = v; });
  addSlider('Gravité (fumée)', 0, 3, 0.05, FOG_SIM.gravity, (v) => { FOG_SIM.gravity = v; });
  addSlider('Étalement (fumée)', 0, 3, 0.05, FOG_SIM.spread, (v) => { FOG_SIM.spread = v; });
  addSlider('Dissipation', 0, 1, 0.01, FOG_SIM.decay, (v) => { FOG_SIM.decay = v; });
  addSlider('Brume de vallée', 0, 1, 0.02, MIST_RANGE.z, (v) => {
    MIST_RANGE.z = v;
    try { localStorage.setItem('ingaMist', String(v)); } catch { /* quota */ }
  });
  addButton('Tout vider', () => fillFogVol(0));
  addButton('Brouillard partout', () => fillFogVol(128));
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyF' || e.repeat || e.target instanceof HTMLInputElement) return;
    if (smokeSrcUI.open || builder.ui.open) return; // un seul outil au clic à la fois
    fogBrush.open = !fogBrush.open;
    fp.style.display = fogBrush.open ? 'block' : 'none';
    fogBrushGizmo.visible = fogBrush.open;
    if (fogBrush.open) { devMenuSuppress = performance.now(); document.exitPointerLock?.(); }
  });
  window.addEventListener('mousedown', (e) => { if (fogBrush.open && e.target === renderer.domElement) fogBrush.btn = e.button; });
  window.addEventListener('mouseup', () => {
    if (fogBrush.btn !== -1 && fogBrush.dirty) { saveFogVol(); fogBrush.dirty = false; }
    fogBrush.btn = -1;
  });
  window.addEventListener('contextmenu', (e) => { if (fogBrush.open || smokeSrcUI.open || builder.ui.open || level === 'smoke') e.preventDefault(); });
}

// The only daylight enters through the ceiling holes: a faint sky remainder,
// one hard sun blocked by the real ceiling/wall geometry, a whisper of bounce.
scene.add(new THREE.HemisphereLight('#dfe8f2', '#4e4a44', 0.14));
const sun = new THREE.DirectionalLight(SUN_COLOR, 3.6);
sun.target.position.set(0, 2, 9);
sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 45);
scene.add(sun.target);
sun.castShadow = true;
sun.shadow.mapSize.set(Q.shadowMap, Q.shadowMap);
sun.shadow.camera.left = -19;
sun.shadow.camera.right = 19;
sun.shadow.camera.top = 27;
sun.shadow.camera.bottom = -27;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 100;
sun.shadow.bias = -0.00035;
sun.shadow.normalBias = 0.045;
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun);
// Live reference: three updates this matrix whenever the shadow renders.
if (fogPass) fogPass.uniforms.uShadowMatrix.value = sun.shadow.matrix;
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
const hallFloorSurf = marbleSurface(LITE ? 512 : 1024);
const hallFloorMat = new THREE.MeshPhysicalMaterial({
  map: hallFloorSurf.map,
  normalMap: hallFloorSurf.normalMap,
  normalScale: new THREE.Vector2(0.25, 0.25),
  roughnessMap: hallFloorSurf.roughnessMap,
  roughness: 0.32,
  metalness: 0,
  // En 'low', pas de vernis (clearcoat) : une passe d'éclairage en moins sur tout le sol.
  clearcoat: QUALITY === 'low' ? 0 : 0.4,
  clearcoatRoughness: 0.22,
  envMapIntensity: 0.9,
});
// 1024 px over a 1.25 m repeat (world UVs x2): the grain holds up close-to.
const hallWallSurf = boardConcreteSurface(LITE ? 512 : 1024);
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
const bedTex = noiseTexture('#4b4c47', 26);
bedTex.repeat.set(14, 14);
const bedMat = new THREE.MeshStandardMaterial({ map: bedTex, color: '#6e675b', roughness: 1, side: THREE.DoubleSide });
// ---- Ruisseau intérieur ----
const CANAL_BED_Y = -0.42; // ~33 cm of water
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
      .replace('#include <emissivemap_fragment>', [
        '#include <emissivemap_fragment>',
        '{',
        `  bool sideW = abs( vShWP.x ) > ${(HALL.x - 0.15).toFixed(2)} && vShWP.z > ${HALL.doorZ.toFixed(2)} && vShWP.z < ${HALL.north.toFixed(2)};`,
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

// Hall: ~24 m wide, ~23 m deep, ceiling at 7.4 m.
// The narrow canal is a recess at the foot of the walls, following the whole
// perimeter. It never crosses the floor.
const HALL = {
  x: 12,
  doorZ: -4.85,
  north: 18.4,
  channel: 0.88,
  wallT: 0.46,
  wallTop: 7.4,
  wallBottom: -0.55,
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
// North wall replaced by a floor-to-ceiling glass bay (see "Baie vitrée"):
// only the concrete sill below floor level remains.
box(HALL.x * 2 + HALL.wallT, -0.02 - HALL.wallBottom, HALL.wallT, 0, (HALL.wallBottom - 0.02) / 2, HALL.north + HALL.wallT / 2, hallConcrete);

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
const mossCapXf = [];
// Canal bed: scattered pebbles (some, not too many), varied shapes and
// sizes, colours from the gallery palette with slight variation.
const BED_STEP = LITE ? 0.26 : 0.115;
const bedStrips = [
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
function rockFade(x, z) {
  const ax = Math.abs(x);
  const side = x > 0 ? 40 : 0;
  const dPath = ax - (PATH_HALF + 0.1 + 2.4 * Math.max(0, rockFbm(z * 0.3 + 3.7 + side, 1.3) - 0.32));
  const dOut = ISLAND.x1 - 0.05 - 0.8 * Math.max(0, rockFbm(z * 0.27 + 11 + side, 5.1) - 0.3) - ax;
  const dS = z - (ISLAND.z0 + 0.9 * Math.max(0, rockFbm(ax * 0.35 + 2, 9) - 0.3));
  const dN = ISLAND.z1 - 0.9 * Math.max(0, rockFbm(ax * 0.35 + 6, 4) - 0.3) - z;
  const d = Math.min(dPath, dOut, dS, dN);
  if (d <= 0) return 0;
  return Math.sin(Math.min(1, d / 1.3) * Math.PI / 2);
}
function rockHeightBase(x, z) {
  const ax = Math.abs(x);
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
        // All colour lookups go through textureGrad with gradients taken from
        // the smooth pre-parallax UV: the offset UV is discontinuous at ray
        // hits, and implicit mip selection there renders as static noise.
        'vec4 ingaTex( sampler2D tex, vec2 uv, vec2 gx, vec2 gy ) {',
        '  float sel = smoothstep( 0.35, 0.65, ingaNoise( uv * 0.35 ) );',
        // Procedural noise cannot mipmap: once its period is sub-pixel it is
        // per-pixel random (static on far surfaces), so collapse the blend to
        // a constant as the screen-space footprint grows.
        '  float foot = ( length( gx ) + length( gy ) ) * 0.35;',
        '  sel = mix( sel, 0.5, smoothstep( 0.08, 0.3, foot ) );',
        '  mat2 ingaRot = mat2( -0.24, 0.31, -0.31, -0.24 );',
        '  vec4 a = textureGrad( tex, uv, gx, gy );',
        '  vec4 b = textureGrad( tex, uv * ingaRot + vec2( 5.3, 1.7 ), gx * ingaRot, gy * ingaRot );',
        '  return mix( a, b, sel );',
        '}',
        'uniform sampler2D dispMap;',
        'uniform float uDispM;',
        'varying vec3 vWorldPos;',
        'varying vec3 vWorldNormal;',
        // Explicit LOD here: implicit mip selection inside the divergent
        // raymarch loop is undefined behaviour and renders as static noise.
        'float ingaHeight( vec2 uv ) { return textureLod( dispMap, uv, 2.0 ).r; }',
        // Parallax occlusion: raymarch the height map so the ground has
        // real per-pixel relief, not just painted shading. Fades out with
        // distance — beyond ~35 m the texels are sub-pixel and only shimmer.
        'vec2 ingaPom( vec2 uv, float scl ) {',
        '  float att = clamp( vWorldNormal.y, 0.0, 1.0 ); att *= att;',
        '  float ingaDist = length( cameraPosition - vWorldPos );',
        '  att *= 1.0 - smoothstep( 16.0, 38.0, ingaDist );',
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
        'vec2 ingaGx = dFdx( vMapUv );',
        'vec2 ingaGy = dFdy( vMapUv );',
        'vec4 rockTexel = ingaTex( map, ingaUvR, ingaGx * uRockScale, ingaGy * uRockScale );',
        'vec4 mossTexel = ingaTex( mossMap, ( vMapUv + ingaDeltaW ) * uMossScale, ingaGx * uMossScale, ingaGy * uMossScale );',
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
  for (const sideSign of [-1, 1]) {
    const geo = new THREE.PlaneGeometry(stripW, stripD, segX, segZ);
    geo.rotateX(-Math.PI / 2);
    const cx = sideSign * (PATH_HALF + stripW / 2);
    const czm = (ISLAND.z0 + ISLAND.z1) / 2;
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
      let h = rockHeight(x, z);
      // Clumpy moss surface: small lumps on top of the big cushions.
      if (h > 0.002) {
        const grow = Math.min(1, h / 0.1);
        h += grow * (0.04 * (rockValueNoise(x * 2.2 + 13, z * 2.2) - 0.5) + 0.008 * (rockValueNoise(x * 7.3, z * 7.3 + 21) - 0.5));
      }
      // Outside the cushion outline the sheet dips under the marble, so the
      // moss edge is a clean organic line on the floor.
      // Next to the outline: just below the tile top (-0.04) so the crossing
      // interpolates smoothly instead of stair-stepping. Further out: well
      // under the gravel so no green shows through the tile joints.
      let y = ROCK_BASE_Y + h;
      if (h <= 0.002) {
        const r = 0.16;
        const nearEdge = rockHeight(x + r, z) + rockHeight(x - r, z) + rockHeight(x, z + r) + rockHeight(x, z - r) > 0;
        y = nearEdge ? -0.055 : -0.3;
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
      const around = (rockHeight(x + e, z) + rockHeight(x - e, z) + rockHeight(x, z + e) + rockHeight(x, z - e)) / 4;
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
        if (open) { devMenuSuppress = performance.now(); document.exitPointerLock?.(); }
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
    // Shore fade: the shoreline used to be the raw terrain-triangle/water
    // intersection — a sawtooth of mesh edges, shimmering from afar. Bake the
    // analytic terrain height around the stream into a texture and fade the
    // water out where it runs shallow, so the bank is a smooth gradient
    // instead of a geometric cut.
    const SHORE = { x0: -56, x1: 56, z0: -152, z1: 130, nx: 256, nz: 512 };
    const shoreData = new Float32Array(SHORE.nx * SHORE.nz);
    for (let j = 0; j < SHORE.nz; j++) {
      const z = SHORE.z0 + ((SHORE.z1 - SHORE.z0) * j) / (SHORE.nz - 1);
      for (let i = 0; i < SHORE.nx; i++) {
        const x = SHORE.x0 + ((SHORE.x1 - SHORE.x0) * i) / (SHORE.nx - 1);
        shoreData[j * SHORE.nx + i] = dsHeight(x, z);
      }
    }
    const shoreTex = new THREE.DataTexture(shoreData, SHORE.nx, SHORE.nz, THREE.RedFormat, THREE.FloatType);
    shoreTex.minFilter = THREE.LinearFilter;
    shoreTex.magFilter = THREE.LinearFilter;
    shoreTex.needsUpdate = true;
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
    streamMat.onBeforeCompile = (sh) => {
      sh.uniforms.uShoreH = { value: shoreTex };
      sh.uniforms.uShoreMin = { value: new THREE.Vector2(VALLEY.x + SHORE.x0, VALLEY.z + SHORE.z0) };
      sh.uniforms.uShoreInv = { value: new THREE.Vector2(1 / (SHORE.x1 - SHORE.x0), 1 / (SHORE.z1 - SHORE.z0)) };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vShoreWP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShoreWP = (modelMatrix * vec4(position, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>',
          '#include <common>\nvarying vec3 vShoreWP;\nuniform sampler2D uShoreH;\nuniform vec2 uShoreMin;\nuniform vec2 uShoreInv;')
        .replace('#include <map_fragment>', [
          '#include <map_fragment>',
          '{',
          // vShoreWP.y is in valleyRoot space already offset by the group, so
          // compare against terrain in the same (world) frame.
          `  float terrY = texture2D(uShoreH, clamp((vShoreWP.xz - uShoreMin) * uShoreInv, 0.0, 1.0)).r + ${VALLEY.y.toFixed(1)};`,
          '  float wdep = vShoreWP.y - terrY;',
          '  diffuseColor.a *= smoothstep(0.0, 0.7, wdep);',
          '}',
        ].join('\n'));
    };
    streamMat.customProgramCacheKey = () => 'inga-stream-shore';
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
const RIPPLE_N = 20;
const rippleData = Array.from({ length: RIPPLE_N }, () => new THREE.Vector4(0, 0, 0, 0));
const canalNormal = waterNormal.clone();
canalNormal.wrapS = canalNormal.wrapT = THREE.RepeatWrapping;
canalNormal.repeat.set(1, 1);
canalNormal.needsUpdate = true;
const canalWaterMat = new THREE.MeshPhysicalMaterial({
  color: '#2b3a37',
  roughness: 0.05,
  metalness: 0,
  transparent: true,
  envMap: softWaterEnv(),
  envMapIntensity: 0.75,
  normalMap: canalNormal,
  normalScale: new THREE.Vector2(0.22, 0.22),
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
      // Two slow, crossing swells keep the surface alive everywhere.
      '  g += vec2( cos( vWWP.x * 2.1 + uWTime * 0.9 ), sin( vWWP.z * 1.7 - uWTime * 0.7 ) ) * 0.05;',
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
const water = new THREE.Mesh(ringGeometry(CHANNEL, CHANNEL), canalWaterMat);
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
  box(sd, h, CHANNEL.iz1 - CHANNEL.iz0, CHANNEL.ix0 - sd / 2, ym, (CHANNEL.iz0 + CHANNEL.iz1) / 2, sideMat, false);
  box(sd, h, CHANNEL.iz1 - CHANNEL.iz0, CHANNEL.ix1 + sd / 2, ym, (CHANNEL.iz0 + CHANNEL.iz1) / 2, sideMat, false);
}
const bed = new THREE.Mesh(ringGeometry(CHANNEL, CHANNEL), bedMat);
bed.position.y = CANAL_BED_Y;
const canalLifeUniforms = { uTime: { value: 0 } };
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
        'transformed.x += sin( uTime * 0.9 + ph + transformed.y * 2.5 ) * 0.35 * k;',
        'transformed.z += cos( uTime * 0.7 + ph * 1.3 ) * 0.2 * k;',
      ].join('\n'));
  };
  weedMat.customProgramCacheKey = () => 'inga-weed';
  const WEEDS = LITE ? 70 : 160;
  const weeds = new THREE.InstancedMesh(blade, weedMat, WEEDS);
  const d = new THREE.Object3D();
  const strips = [[CHANNEL.x0, CHANNEL.ix0, CHANNEL.z0, CHANNEL.z1], [CHANNEL.ix1, CHANNEL.x1, CHANNEL.z0, CHANNEL.z1], [CHANNEL.ix0, CHANNEL.ix1, CHANNEL.z0, CHANNEL.iz0]];
  let n = 0;
  while (n < WEEDS) {
    // Clumps of 4–9 blades.
    const st = strips[(Math.random() * strips.length) | 0];
    const cx = st[0] + 0.15 + Math.random() * (st[1] - st[0] - 0.3), cz = st[2] + 0.2 + Math.random() * (st[3] - st[2] - 0.4);
    const k = 4 + ((Math.random() * 6) | 0);
    for (let i = 0; i < k && n < WEEDS; i++, n++) {
      d.position.set(cx + (Math.random() - 0.5) * 0.18, CANAL_BED_Y, cz + (Math.random() - 0.5) * 0.18);
      d.rotation.set((Math.random() - 0.5) * 0.3, Math.random() * Math.PI, (Math.random() - 0.5) * 0.3);
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
    floatLeaves.push({ m, dist: Math.random() * 90, speed: 0.04 + Math.random() * 0.05, lane: (Math.random() - 0.5) * 0.5, spin: (Math.random() - 0.5) * 0.4, rot: Math.random() * 6 });
  }
}
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
// Fish of Japanese streams and catfish: spindle bodies that undulate as
// they swim (vertex shader), tail and dorsal fins; the brown catfish are
// flatter, with barbels. Mostly orange and yellow, the rest in browns.
const FISH_TYPES = [
  // [count, colours, catfish?, length range]
  [6, ['#e8892f', '#f0a23a', '#e07a2a', '#d9822f', '#e99a3a', '#f08c34'], false, [0.24, 0.42]],
  [5, ['#f2c14a', '#f5d06a', '#f1b03c', '#f3c95c', '#e8b545'], false, [0.18, 0.34]],
  [3, ['#ef9a3e', '#f4b850', '#e88a33'], false, [0.11, 0.17]],
  [6, ['#6b5240', '#7d6250', '#5a4636', '#8a6e55', '#4d3d31', '#76604f'], true, [0.3, 0.55]],
];
const fishSwimShared = { uTime: { value: 0 } };
function fishGeometry(cat) {
  // Lathe profile along y: tail (−0.5) → head (+0.5), then turned so the
  // head points to +z (Object3D.lookAt aims +z at the target).
  const prof = [];
  for (let i = 0; i <= 14; i++) {
    const u = i / 14;
    const r = cat
      ? 0.11 * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.75)), 0.8) + (u > 0.85 ? 0.02 : 0)
      : 0.12 * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.62)), 0.9);
    prof.push(new THREE.Vector2(Math.max(0.002, r), u - 0.5));
  }
  const body = new THREE.LatheGeometry(prof, 12);
  body.rotateX(Math.PI / 2);
  body.scale(cat ? 1.25 : 0.72, cat ? 0.68 : 1, 1); // catfish flat, carp narrow
  const parts = [body];
  const fin = (pts) => {
    const sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]);
    for (const q of pts.slice(1)) sh.lineTo(q[0], q[1]);
    const g = new THREE.ShapeGeometry(sh); g.rotateY(Math.PI / 2); return g;
  };
  // Caudal fin (vertical, at the tail) and dorsal fin.
  parts.push(fin([[-0.47, 0], [-0.64, 0.11], [-0.6, 0], [-0.64, -0.11]]));
  parts.push(fin([[0.05, 0.07], [-0.12, 0.15], [-0.18, 0.06]]));
  if (cat) {
    for (const sx of [-1, 1]) {
      const bar = new THREE.CylinderGeometry(0.004, 0.002, 0.16, 4);
      bar.rotateX(Math.PI / 2); bar.rotateY(sx * 0.6); bar.rotateX(0.25);
      bar.translate(sx * 0.06, -0.02, 0.55);
      parts.push(bar);
    }
  }
  for (const g of parts) { if (g.index) continue; }
  const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => { g.deleteAttribute('uv'); return g; }));
  merged.computeVertexNormals();
  return merged;
}
const fishGeoCarp = fishGeometry(false), fishGeoCat = fishGeometry(true);
function fishMaterial(color, cat, freq, amp, phase) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: cat ? 0.7 : 0.45, side: THREE.DoubleSide });
  m.userData.swim = { uFreq: { value: freq }, uAmp: { value: amp }, uPhase: { value: phase } };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = fishSwimShared.uTime;
    Object.assign(sh.uniforms, m.userData.swim);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime, uFreq, uAmp, uPhase;')
      .replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        // Body wave: grows toward the tail (−z), travels head → tail.
        'float tailw = smoothstep( 0.35, -0.6, transformed.z );',
        'transformed.x += sin( uTime * uFreq - transformed.z * 7.0 + uPhase ) * uAmp * tailw;',
      ].join('\n'));
  };
  m.customProgramCacheKey = () => 'inga-fish-swim';
  return m;
}
const fishSpecs = [];
for (const [count, colours, cat, [l0, l1]] of FISH_TYPES) {
  for (let i = 0; i < count; i++) fishSpecs.push({ color: colours[i % colours.length], cat, len: l0 + Math.random() * (l1 - l0) });
}
fishSpecs.forEach((spec, i) => {
  const freq = spec.cat ? 4 + Math.random() * 2 : 7 + Math.random() * 4;
  const mat = fishMaterial(spec.color, spec.cat, freq, 0.06, Math.random() * 6);
  const mesh = new THREE.Mesh(spec.cat ? fishGeoCat : fishGeoCarp, mat);
  mesh.scale.setScalar(spec.len);
  mesh.castShadow = !LITE;
  const group = new THREE.Group();
  group.add(mesh);
  scene.add(group);
  fish.push({
    group, mat, cat: spec.cat, len: spec.len,
    dist: i * (fishLoop / fishSpecs.length) + Math.random() * 4,
    speed: (i % 3 === 0 ? -1 : 1) * (spec.cat ? 0.12 + Math.random() * 0.1 : 0.22 + Math.random() * 0.22),
    depth: spec.cat ? CANAL_BED_Y + 0.05 + Math.random() * 0.04 : CANAL_WATER_Y - 0.08 - Math.random() * 0.14,
    lane: (Math.random() - 0.5) * 0.4,
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
function splashAt(pos, strength, silent = false) {
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
box(3.2, 0.32, 1.15, -2.1, 0.45, 6.4, new THREE.MeshStandardMaterial({ color: '#a7a398', roughness: 0.95 }));
box(2.6, 0.7, 0.3, -2.1, 1, 6.9, new THREE.MeshStandardMaterial({ color: '#aaa69a', roughness: 1 }));
box(1.2, 0.12, 0.7, -1.4, 0.48, 4.2, wood);
const stone = new THREE.MeshStandardMaterial({ color: '#97958b', roughness: 1 });

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
  [-7.1, 0, 6.2, 0.9], [7.2, 0, 16.9, 1.05], [2.4, 0, -3.5, 0.8],
  [-2.5, 0, -3.3, 0.95], [5.0, 0, 12.4, 1.1], [-4.6, 0, 10.2, 0.95],
  [2.7, 0, 4.9, 1.3], [-(CHANNEL.ix1 + 0.23), -0.16, 13.0, 1.35], [CHANNEL.ix1 + 0.23, -0.16, 3.8, 1.3],
  [2.7, 0, 16.9, 1.2],
];
for (const [x, y, z, s] of LITE ? fernSpots.slice(0, 8) : fernSpots) {
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
  for (const x of [-7.2, -2.4, 2.4, 7.2]) bar(MULL, H, MULL_D, x, H / 2, glassZ);
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
  const thZ0 = CHANNEL.iz1 - 0.15;
  const thZ1 = HALL.north + 0.05;
  box(DOOR_HALF * 2 - 0.2, 0.055, thZ1 - thZ0, 0, -0.045, (thZ0 + thZ1) / 2, bridgeMat);

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
  for (const x of [-7.2, -2.4, 2.4, 7.2]) box(0.34, beamD, roofD - 0.5, x, HALL.wallTop - beamD / 2, roofZ0 + (roofD - 0.5) / 2, hallConcrete);
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
// La pièce où vivent fumée, outils et constructions : la galerie ou l'atelier
// (même emprise, mêmes coordonnées).
const inRoom = () => level === 'hall' || level === 'atelier' || level === 'brutal';
let worldHidden = false;
const valleyHemi = new THREE.HemisphereLight('#eef2f0', '#5c5e53', 0);
scene.add(valleyHemi);
const sunShadow0 = sun.castShadow;

// ---- Bac à fumée (niveau de travail isolé) ----------------------------------
// A plain tank on black: floor, four thick walls (mirrored into the smoke
// sim's terrain map so the smoke pools inside), the sun, and a fixed camera.
// No player — just spawn smoke spheres and watch them settle.
// open : les parois +x et +z (celles face à la caméra) sont retirées, la
// fumée s'échappe et s'étale sur le sol autour du bac.
const BAC = { cx: 0, cz: 9, half: 14, wallT: 2, wallH: 4.5, open: true };
try { if (localStorage.getItem('ingaBacOpen') === '0') BAC.open = false; } catch { /* stockage indisponible */ }
// Une cellule (x, z) est-elle dans une paroi du bac ? Les parois −x et −z
// vont jusqu'au bord du domaine ; +x et +z n'existent que bac fermé.
const bacWall = (wx, wz) => {
  const dx = wx - BAC.cx, dz = wz - BAC.cz, H = BAC.half, T = BAC.wallT;
  return dx < -H || dz < -H || (!BAC.open && ((dx > H && dx < H + T && dz < H + T) || (dz > H && dz < H + T && dx < H + T)));
};
const sandboxRoot = new THREE.Group();
sandboxRoot.visible = false;
{
  const conc = new THREE.MeshStandardMaterial({ color: '#3a3936', roughness: 0.95 });
  const dark = new THREE.MeshStandardMaterial({ color: '#232220', roughness: 0.97 });
  const add = (w, h, d, x, y, z, mat = conc) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    sandboxRoot.add(m);
    return m;
  };
  const span = BAC.half * 2 + BAC.wallT * 2;
  const floor = add(span + 8, 0.5, span + 8, BAC.cx, -0.25, BAC.cz, dark);
  floor.castShadow = false;
  add(span, BAC.wallH, BAC.wallT, BAC.cx, BAC.wallH / 2, BAC.cz - BAC.half - BAC.wallT / 2);
  add(span, BAC.wallH, BAC.wallT, BAC.cx, BAC.wallH / 2, BAC.cz + BAC.half + BAC.wallT / 2);
  add(BAC.wallT, BAC.wallH, BAC.half * 2, BAC.cx - BAC.half - BAC.wallT / 2, BAC.wallH / 2, BAC.cz);
  add(BAC.wallT, BAC.wallH, BAC.half * 2, BAC.cx + BAC.half + BAC.wallT / 2, BAC.wallH / 2, BAC.cz);
  // Bac invisible : seuls comptent ses contours dans le fluide (masques de
  // vitesse et cellules solides) — la fumée semble se heurter à des parois
  // absentes. Les mailles restent là pour les réafficher au besoin.
  for (const m of sandboxRoot.children) { m.visible = false; m.castShadow = false; }
}
scene.add(sandboxRoot);
// Bac 2D : coupe verticale simulée sur GPU (voir smoke2d.js).
const smoke2d = createSmoke2D(renderer, { cx: BAC.cx, cz: BAC.cz, half: BAC.half, wallT: BAC.wallT, wallH: BAC.wallH, open: BAC.open });
sandboxRoot.add(smoke2d.mesh);
const bac2d = { on: false };
// Volume vide : dans le bac, le brouillard peint du monde est débranché.
const emptyFogTex = new THREE.Data3DTexture(new Uint8Array(1), 1, 1, 1);
emptyFogTex.format = THREE.RedFormat;
emptyFogTex.needsUpdate = true;
const smokeUI = document.createElement('div');
smokeUI.style.cssText = 'position:fixed;bottom:26px;left:50%;transform:translateX(-50%);display:none;gap:10px;z-index:9';
{
  const mk = (label, on) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'background:#f5f0e916;border:1px solid #ffffff44;color:#e4e8de;padding:9px 14px;border-radius:5px;cursor:pointer;font:11px "DM Sans",sans-serif;letter-spacing:.1em;backdrop-filter:blur(8px)';
    b.addEventListener('click', on);
    smokeUI.append(b);
  };
  mk('LÂCHER UNE BOUFFÉE DE FUMÉE', () => { if (bac2d.on) smoke2d.spawn(); else if (flAlgo.gpu) smoke3d.spawn(); else bacSpawn(); });
  mk('VIDER LE BAC', () => { if (bac2d.on) smoke2d.clear(); else if (flAlgo.gpu) smoke3d.clear(); else bacClear(); });
  document.body.append(smokeUI);
}
// ---- Fluide FFT du bac (Stam, « A Simple Fluid Solver based on the FFT ») ---
// La vitesse vit sur une grille 32³ : forces (poids de la fumée, confinement
// de vorticité), advection semi-lagrangienne, puis diffusion et projection à
// divergence nulle appliquées dans l'espace de Fourier (FFT 3D maison). La
// densité est advectée sur une grille fine propre au bac — le volume mondial
// (192×48×192 sur toute la carte) ne met que ~16 voxels en travers du bac,
// bien trop grossier pour lire des volutes — et rendue par le raymarcheur
// habituel dont setLevel détourne les uniforms. La FFT impose des bords
// périodiques : un masque amortit la vitesse aux limites du domaine et
// annule la composante normale contre les parois (glissement libre).
const FL = {
  n: 32,                      // grille de vitesse (puissance de 2 pour la FFT)
  dn: { x: 64, y: 48, z: 64 },// grille de densité (texture du bac)
  min: new THREE.Vector3(BAC.cx - 16, -1, BAC.cz - 16),
  size: new THREE.Vector3(32, 22, 32),
  visc: 0.08,   // diffusion spectrale
  dissip: 0.07, // évaporation de la densité (fraction/s)
  weight: 5.5,  // fumée lourde : poids proportionnel à la densité
  swirl: 2.5,   // confinement de vorticité
};
FL.h = new THREE.Vector3(FL.size.x / FL.n, FL.size.y / FL.n, FL.size.z / FL.n);
// Le même solveur sert deux domaines : le bac (niveau de travail) et le hall
// de la galerie, où des sources posées par l'utilisateur émettent en continu.
// Le hall est une boîte fermée (sol, plafond, quatre murs) ; les bandes
// d'amortissement périodique du domaine tombent dans l'épaisseur des murs.
// Réglages de la fumée de la galerie (panneau V), conservés entre séances.
const smokeSaved = (() => {
  try { return JSON.parse(localStorage.getItem('ingaSmoke')) || {}; } catch { return {}; }
})();
const smokeNums = (defaults, saved) => {
  const o = { ...defaults };
  if (saved && typeof saved === 'object') for (const k in defaults) if (typeof defaults[k] === 'number' && Number.isFinite(saved[k])) o[k] = saved[k];
  return o;
};
const SMOKE_SIM = smokeNums({ visc: 0.05, dissip: 0.08, weight: 3, swirl: 3 }, smokeSaved.sim);
const FL_DOMAINS = {
  bac: { dn: { x: 80, y: 48, z: 80 }, min: [BAC.cx - 16, -1, BAC.cz - 16], size: [40, 22, 40], sim: { visc: FL.visc, dissip: FL.dissip, weight: FL.weight, swirl: FL.swirl } },
  // Hall : mailles de 25 cm (le bac en a de 50) — les volutes se lisent de près.
  hall: { dn: { x: 112, y: 40, z: 112 }, min: [-14, -1, (HALL.doorZ + HALL.north) / 2 - 14], size: [28, 10, 28], sim: SMOKE_SIM },
};
let flDomain = '';
const WORLD_FOG_INV = new THREE.Vector3(
  1 / (FOG_VOL.max.x - FOG_VOL.min.x),
  1 / (FOG_VOL.max.y - FOG_VOL.min.y),
  1 / (FOG_VOL.max.z - FOG_VOL.min.z));
const BAC_FOG_INV = new THREE.Vector3(1 / FL.size.x, 1 / FL.size.y, 1 / FL.size.z);
const flN3 = FL.n * FL.n * FL.n;
const flU = new Float32Array(flN3), flV = new Float32Array(flN3), flW = new Float32Array(flN3);
const flUr = new Float32Array(flN3), flUi = new Float32Array(flN3);
const flVr = new Float32Array(flN3), flVi = new Float32Array(flN3);
const flWr = new Float32Array(flN3), flWi = new Float32Array(flN3);
const flCx = new Float32Array(flN3), flCy = new Float32Array(flN3);
const flCz = new Float32Array(flN3), flCm = new Float32Array(flN3);
const flMu = new Float32Array(flN3), flMv = new Float32Array(flN3), flMw = new Float32Array(flN3);
const flKx = new Float32Array(FL.n), flKy = new Float32Array(FL.n), flKz = new Float32Array(FL.n);
const flWxA = new Float32Array(FL.n), flWyA = new Float32Array(FL.n), flWzA = new Float32Array(FL.n);
// Grille de densité, allouée par flConfigure à la résolution du domaine.
let bacScr = null; // tampons MacCormack de la densité, alloués à la demande
let bacD0, bacD1, bacTexData, bacSolid, bacFogTex; // bacSolid : 1 = mur, sol ou coquille vide du bord
// Boîtes englobantes [x0,x1,y0,y1,z0,z1] du contenu non nul de bacD0/bacD1 :
// l'advection ne parcourt que la zone enfumée (plus une marge de transport).
const bbD0 = [1, 0, 1, 0, 1, 0], bbD1 = [1, 0, 1, 0, 1, 0];
const bbAdd = (b, x0, x1, y0, y1, z0, z1) => {
  if (b[1] < b[0]) { b[0] = x0; b[1] = x1; b[2] = y0; b[3] = y1; b[4] = z0; b[5] = z1; return; }
  if (x0 < b[0]) b[0] = x0; if (x1 > b[1]) b[1] = x1;
  if (y0 < b[2]) b[2] = y0; if (y1 > b[3]) b[3] = y1;
  if (z0 < b[4]) b[4] = z0; if (z1 > b[5]) b[5] = z1;
};
// Tables par axe : centres monde et coordonnées (grille vitesse) des cellules
// de densité, et cellule de densité la plus proche de chaque cellule vitesse.
let dWx, dWy, dWz, dGx, dGy, dGz;
const velDx = new Int32Array(FL.n), velDy = new Int32Array(FL.n), velDz = new Int32Array(FL.n);
const flClamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
// ---- Algorithmes du bac ------------------------------------------------------
// Chaque entrée est une façon différente d'obtenir des formes fines sans
// monter la résolution de la grille. Drapeaux : mac = advection MacCormack
// (vitesse et densité), reflect = advection-réflexion, vortex = particules de
// vorticité, particles = fumée portée par des particules, shade = détail
// ajouté au rendu (0 brut, 1 bruit fixe, 2 bruit advecté).
const BAC_ALGOS = {
  stam: { name: 'Stam (référence)', mac: false, reflect: false, vortex: false, particles: false, shade: 0,
    info: 'Semi-lagrangien + FFT. Stable et bon marché, mais chaque pas floute la fumée : c\'est la base de comparaison. — Stam, 1999/2001.' },
  mac: { name: 'MacCormack', mac: true, reflect: false, vortex: false, particles: false, shade: 0,
    info: 'Advection aller-retour qui estime puis retire l\'erreur de flou (ordre 2), avec limiteur. Bords nets à grille égale ; ≈ 2× le coût d\'advection. — Selle, Fedkiw et al., 2008.' },
  reflect: { name: 'Advection-réflexion', mac: true, reflect: true, vortex: false, particles: false, shade: 0,
    info: 'La projection, qui dissipe l\'énergie, est remplacée à mi-pas par une réflexion qui la conserve : les tourbillons vivent bien plus longtemps. Deux projections par pas. — Zehnder, Narain, Thomaszewski, 2018.' },
  vortex: { name: 'Particules de vorticité', mac: true, reflect: false, vortex: true, particles: false, shade: 0,
    info: 'Quelques dizaines de particules transportent un tourbillon et le réinjectent dans la grille : la turbulence ne s\'éteint plus dans la maille. Coût négligeable. — Selle, Rasmussen, Fedkiw, 2005.' },
  noise: { name: 'Bruit procédural', mac: true, reflect: false, vortex: false, particles: false, shade: 1,
    info: 'La simulation reste grossière ; le rendu déforme et érode la densité avec du bruit fixe. Presque gratuit, mais le détail ne suit pas l\'écoulement. — Perlin ; Bridson et al. (curl noise), 2007.' },
  detail: { name: 'Bruit advecté', mac: true, reflect: false, vortex: false, particles: false, shade: 2,
    info: 'Le bruit de détail est transporté par le fluide (coordonnées de texture advectées, régénérées en alternance) : il s\'étire en filaments comme la vraie fumée. — Neyret, 2003 ; Kim, Thürey et al. (wavelet turbulence), 2008.' },
  particles: { name: 'Fumée en particules', mac: true, reflect: false, vortex: false, particles: true, shade: 0,
    info: 'La densité n\'est plus sur une grille : des dizaines de milliers de particules suivent la vitesse grossière. Aucune diffusion numérique, l\'advection chaotique étire des filaments très fins. — approche lagrangienne (FLIP/PIC ; Particle Flow Maps, 2024).' },
};
// Filière GPU (smoke3d.js) : la densité ne passe plus par JavaScript.
Object.assign(BAC_ALGOS, {
  gpuHybrid: { name: 'GPU · densité fine', gpu: 'hybrid', mac: true, reflect: false, vortex: false, particles: false, shade: 0,
    info: 'La vitesse reste le solveur FFT 32³ (déporté dans un Worker), mais la densité est advectée sur le GPU dans une grille bien plus fine, avec turbulence sous-maille, boîte qui suit la fumée, auto-ombrage et rendu demi-résolution accumulé.' },
  gpuFull: { name: 'GPU · solveur complet', gpu: 'full', mac: true, reflect: false, vortex: false, particles: false, shade: 0,
    info: 'Vitesse et densité entièrement sur le GPU (projection de Jacobi, grille de vitesse 64×48×64 dans la boîte qui suit la fumée). Plus aucun calcul de fluide côté CPU.' },
  gpuParticles: { name: 'GPU · particules', gpu: 'particles', mac: true, reflect: false, vortex: false, particles: false, shade: 0,
    info: 'Jusqu\'à un million de particules déplacées par le GPU dans la vitesse du solveur FFT (Worker) plus la turbulence sous-maille, éclairées par le volume de lumière.' },
});
// Boîtes construites dans la pièce (outil B) : obstacles pour le fluide.
let roomBoxes = [];
const inRoomBox = (x, y, z, mx = 0, my = 0, mz = 0) => roomBoxes.some((b) => Math.abs(x - b.x) < b.sx / 2 + mx && Math.abs(y - b.y) < b.sy / 2 + my && Math.abs(z - b.z) < b.sz / 2 + mz);
const HALL_ALGO = { gpu: null, mac: false, reflect: false, vortex: false, particles: false, shade: 1 };
let bacAlgoId = 'stam';
const flAlgo = { ...HALL_ALGO };
const BAC_VIEW = { gain: 1.8, lum: 0.3, detail: 1, particles: 40000 };
function flConfigure(kind, force = false) {
  if (kind === flDomain && !force) return;
  flDomain = kind;
  const dom = FL_DOMAINS[kind];
  const hall = kind === 'hall';
  FL.min.fromArray(dom.min);
  FL.size.fromArray(dom.size);
  FL.h.set(FL.size.x / FL.n, FL.size.y / FL.n, FL.size.z / FL.n);
  BAC_FOG_INV.set(1 / FL.size.x, 1 / FL.size.y, 1 / FL.size.z);
  Object.assign(FL, dom.sim);
  Object.assign(flAlgo, { gpu: null }, hall ? HALL_ALGO : BAC_ALGOS[bacAlgoId]);
  bacScr = null;
  FL.dn = dom.dn;
  {
    const cells = FL.dn.x * FL.dn.y * FL.dn.z;
    bacD0 = new Float32Array(cells); bacD1 = new Float32Array(cells);
    bacTexData = new Uint8Array(cells);
    bacSolid = new Uint8Array(cells);
    bacFogTex?.dispose();
    bacFogTex = new THREE.Data3DTexture(bacTexData, FL.dn.x, FL.dn.y, FL.dn.z);
    bacFogTex.format = THREE.RedFormat;
    bacFogTex.minFilter = THREE.LinearFilter;
    bacFogTex.magFilter = THREE.LinearFilter;
    bacFogTex.unpackAlignment = 1;
    bacFogTex.needsUpdate = true;
    dWx = new Float32Array(FL.dn.x); dWy = new Float32Array(FL.dn.y); dWz = new Float32Array(FL.dn.z);
    dGx = new Float32Array(FL.dn.x); dGy = new Float32Array(FL.dn.y); dGz = new Float32Array(FL.dn.z);
    bbD0[0] = bbD1[0] = 1; bbD0[1] = bbD1[1] = 0;
    if (fogPass) fogPass.uniforms.uSmokeVol.value = bacFogTex;
  }
  const solidAt = hall
    ? (wx, wy, wz) => wy < 0 || wy > HALL.wallTop || Math.abs(wx) > HALL.x || wz < HALL.doorZ || wz > HALL.north || inRoomBox(wx, wy, wz)
    : (wx, wy, wz) => wy < 0 || (wy < BAC.wallH && bacWall(wx, wz));
  const { x: dnx, y: dny, z: dnz } = FL.dn;
  const fill = (dW, dG, dn, min, size, h) => {
    for (let i = 0; i < dn; i++) {
      dW[i] = min + (i + 0.5) * size / dn;
      dG[i] = flClamp((dW[i] - min) / h - 0.5, 0, FL.n - 1.001);
    }
  };
  fill(dWx, dGx, dnx, FL.min.x, FL.size.x, FL.h.x);
  fill(dWy, dGy, dny, FL.min.y, FL.size.y, FL.h.y);
  fill(dWz, dGz, dnz, FL.min.z, FL.size.z, FL.h.z);
  for (let i = 0; i < FL.n; i++) {
    flWxA[i] = FL.min.x + (i + 0.5) * FL.h.x;
    flWyA[i] = FL.min.y + (i + 0.5) * FL.h.y;
    flWzA[i] = FL.min.z + (i + 0.5) * FL.h.z;
    velDx[i] = flClamp(Math.round((flWxA[i] - FL.min.x) * dnx / FL.size.x - 0.5), 0, dnx - 1);
    velDy[i] = dnx * flClamp(Math.round((flWyA[i] - FL.min.y) * dny / FL.size.y - 0.5), 0, dny - 1);
    velDz[i] = dnx * dny * flClamp(Math.round((flWzA[i] - FL.min.z) * dnz / FL.size.z - 0.5), 0, dnz - 1);
    // Nombres d'onde : k = 2π·m/L, m signé (moitié haute = fréquences négatives).
    const m = i <= FL.n / 2 ? i : i - FL.n;
    flKx[i] = 2 * Math.PI * m / FL.size.x;
    flKy[i] = 2 * Math.PI * m / FL.size.y;
    flKz[i] = 2 * Math.PI * m / FL.size.z;
  }
  // Cellules solides de la grille densité : parois sous la crête, sous le sol,
  // plus une coquille d'un voxel toujours vide — le shader borne ses lectures
  // au volume (clamp), la coquille garantit que l'extérieur échantillonne 0.
  let i = 0;
  for (let iz = 0; iz < dnz; iz++) for (let iy = 0; iy < dny; iy++) for (let ix = 0; ix < dnx; ix++, i++) {
    const shell = ix === 0 || ix === dnx - 1 || iy === 0 || iy === dny - 1 || iz === 0 || iz === dnz - 1;
    bacSolid[i] = shell || solidAt(dWx[ix], dWy[iy], dWz[iz]) ? 1 : 0;
  }
  // Masques de vitesse : amorti aux bords du domaine (périodicité), vitesse
  // nulle dans les murs et sous le sol, composante normale seule annulée à
  // l'approche d'une paroi ou du sol (la fumée glisse, puis déborde par-dessus
  // la crête des murs où aucun masque ne s'applique).
  i = 0;
  for (let z = 0; z < FL.n; z++) for (let y = 0; y < FL.n; y++) for (let x = 0; x < FL.n; x++, i++) {
    const wx = flWxA[x], wy = flWyA[y], wz = flWzA[z];
    const a = Math.min(1,
      Math.min(wx - FL.min.x, FL.min.x + FL.size.x - wx) / 2,
      (FL.min.y + FL.size.y - wy) / 2,
      Math.min(wz - FL.min.z, FL.min.z + FL.size.z - wz) / 2);
    let mu = a, mv = a, mw = a;
    if (hall) {
      if (solidAt(wx, wy, wz)) { mu = mv = mw = 0; }
      else {
        mv *= flClamp(wy / 0.5, 0, 1) * flClamp((HALL.wallTop - wy) / 0.5, 0, 1);
        mu *= flClamp((HALL.x - Math.abs(wx)) / 1.0, 0, 1);
        mw *= flClamp(Math.min(wz - HALL.doorZ, HALL.north - wz) / 1.0, 0, 1);
        // Constructions : vitesse nulle dans toute cellule qui touche une
        // boîte (élargie d'une demi-cellule), même un mur plus fin qu'elle.
        if (inRoomBox(wx, wy, wz, FL.h.x * 0.5, FL.h.y * 0.5, FL.h.z * 0.5)) { mu = mv = mw = 0; }
      }
    } else if (wy < 0) { mu = mv = mw = 0; }
    else {
      mv *= flClamp(wy / 0.9, 0, 1);
      if (wy < BAC.wallH) {
        const dx = wx - BAC.cx, dz = wz - BAC.cz;
        if (bacWall(wx, wz)) { mu = mv = mw = 0; }
        else {
          // Composante normale annulée à l'approche des parois présentes.
          mu *= flClamp((dx + BAC.half) / 1.2, 0, 1);
          mw *= flClamp((dz + BAC.half) / 1.2, 0, 1);
          if (!BAC.open && dx < BAC.half && dz < BAC.half) {
            mu *= flClamp((BAC.half - dx) / 1.2, 0, 1);
            mw *= flClamp((BAC.half - dz) / 1.2, 0, 1);
          }
        }
      }
    }
    flMu[i] = Math.max(0, mu); flMv[i] = Math.max(0, mv); flMw[i] = Math.max(0, mw);
  }
}
flConfigure('hall'); // le jeu démarre dans la galerie ; setLevel rebascule
// Filière GPU du bac : domaine et parois du bac, vitesse du solveur FFT.
const smoke3d = createSmoke3D(renderer, {
  domain: FL_DOMAINS.bac,
  solidGLSL: `uniform float uBacOpen;
  float solidW(vec3 p) {
    if (p.y < 0.0) return 1.0;
    if (p.y >= ${BAC.wallH.toFixed(2)}) return 0.0;
    vec2 d = p.xz - vec2(${BAC.cx.toFixed(2)}, ${BAC.cz.toFixed(2)});
    float H = ${BAC.half.toFixed(2)}, T = ${BAC.wallT.toFixed(2)};
    if (d.x < -H || d.y < -H) return 1.0;
    if (uBacOpen < 0.5 && ((d.x > H && d.x < H + T && d.y < H + T) || (d.y > H && d.y < H + T && d.x < H + T))) return 1.0;
    return 0.0;
  }`,
  uniforms: { uBacOpen: { value: BAC.open ? 1 : 0 } },
  spawnCenter: [BAC.cx, BAC.cz],
  sunDir: SUN_DIR,
  velConfig: () => ({ min: FL_DOMAINS.bac.min, size: FL_DOMAINS.bac.size, geom: { kind: 'bac', cx: BAC.cx, cz: BAC.cz, half: BAC.half, wallT: BAC.wallT, wallH: BAC.wallH, open: BAC.open } }),
  depthTexture: () => (ssrPass ? ssrPass.beautyRenderTarget.depthTexture : null),
});
smoke3d.pass.camera = camera;
sandboxRoot.add(smoke3d.points);
composer.insertPass(smoke3d.pass, fogPass ? composer.passes.indexOf(fogPass) + 1 : 1);
// La même filière pour la galerie (« densité fine ») : domaine et parois du
// hall, sources de fumée, soleil réel (carte d'ombres) dans le volume de
// lumière, et grille resserrée autour du joueur. Elle a besoin de la
// profondeur de la scène, donc de la qualité ÉLEVÉE.
const smoke3dHall = ssrPass ? createSmoke3D(renderer, {
  domain: FL_DOMAINS.hall,
  solidGLSL: `float solidW(vec3 p) {
    if (p.y < 0.0 || p.y > ${HALL.wallTop.toFixed(2)} || abs(p.x) > ${HALL.x.toFixed(2)} || p.z < ${HALL.doorZ.toFixed(2)} || p.z > ${HALL.north.toFixed(2)}) return 1.0;
    return boxSolid(p);
  }`,
  sunDir: SUN_DIR,
  velConfig: () => ({ min: FL_DOMAINS.hall.min, size: FL_DOMAINS.hall.size, geom: { kind: 'hall', X: HALL.x, doorZ: HALL.doorZ, north: HALL.north, top: HALL.wallTop, boxes: roomBoxes.map((b) => ({ x: b.x, y: b.y, z: b.z, sx: b.sx, sy: b.sy, sz: b.sz })) } }),
  depthTexture: () => ssrPass.beautyRenderTarget.depthTexture,
  shadow: () => (sun.castShadow && sun.shadow.map ? { map: sun.shadow.map.texture, matrix: sun.shadow.matrix } : null),
  defaults: { focus: true, follow: true },
}) : null;
if (smoke3dHall) {
  smoke3dHall.pass.camera = camera;
  composer.insertPass(smoke3dHall.pass, composer.passes.indexOf(smoke3d.pass) + 1);
}
// ---- Niveau BRUTALISME : fenêtre de fumée qui suit le joueur ------------------
// La ville est bien plus grande que le domaine du fluide : celui-ci (40 × 16 ×
// 40 m) se recale autour du joueur, et l'architecture lui est donnée en voxels.
const brutal = createBrutalLevel({ renderer });
scene.add(brutal.root);
const BRUTAL_SIZE = [40, 16, 40], BRUTAL_N = [160, 64, 160];
const BRUTAL_MIN = new THREE.Vector3(68, -1, 24);
const brutalOccTex = new THREE.Data3DTexture(new Uint8Array(BRUTAL_N[0] * BRUTAL_N[1] * BRUTAL_N[2]), ...BRUTAL_N);
brutalOccTex.format = THREE.RedFormat;
brutalOccTex.minFilter = brutalOccTex.magFilter = THREE.NearestFilter;
brutalOccTex.unpackAlignment = 1;
brutalOccTex.needsUpdate = true;
const brutalOccMin = BRUTAL_MIN.clone();
const smoke3dBrutal = ssrPass ? createSmoke3D(renderer, {
  domain: { min: BRUTAL_MIN.toArray(), size: BRUTAL_SIZE },
  solidGLSL: `uniform highp sampler3D uOcc; uniform vec3 uOccMin;
  float solidW(vec3 p) {
    if (p.y < 0.0) return 1.0;
    vec3 u = (p - uOccMin) / vec3(${BRUTAL_SIZE.map((v) => v.toFixed(1)).join(', ')});
    if (all(greaterThan(u, vec3(0.0))) && all(lessThan(u, vec3(1.0))) && texture(uOcc, u).r > 0.5) return 1.0;
    return boxSolid(p);
  }`,
  uniforms: { uOcc: { value: brutalOccTex }, uOccMin: { value: brutalOccMin } },
  sunDir: SUN_DIR,
  velConfig: () => ({ min: BRUTAL_MIN.toArray(), size: BRUTAL_SIZE, geom: { kind: 'voxels', occ: brutalOccTex.image.data.slice(), nx: BRUTAL_N[0], ny: BRUTAL_N[1], nz: BRUTAL_N[2], vox: brutal.VOX } }),
  depthTexture: () => ssrPass.beautyRenderTarget.depthTexture,
  shadow: () => (sun.castShadow && sun.shadow.map ? { map: sun.shadow.map.texture, matrix: sun.shadow.matrix } : null),
  defaults: { focus: true, follow: true },
}) : null;
if (smoke3dBrutal) {
  smoke3dBrutal.pass.camera = camera;
  composer.insertPass(smoke3dBrutal.pass, composer.passes.indexOf(smoke3dHall.pass) + 1);
}
// Six lampes ponctuelles suivent les six néons les plus proches du joueur :
// le nombre de lampes ne change jamais (pas de recompilation), seules leurs
// positions et couleurs bougent. Elles éclairent aussi la fumée.
const neonLights = Array.from({ length: 6 }, () => { const l = new THREE.PointLight('#ffffff', 0, 20, 2); return l; }); // (détachées : plus de néons)
let neonNear = [], neonTimer = 0;
function neonUpdate(dt) {
  neonTimer -= dt;
  if (neonTimer > 0 || !brutal.neons.length) return;
  neonTimer = 0.5;
  const c = camera.position;
  neonNear = brutal.neons.map((n) => [Math.hypot(n.x - c.x, n.y - c.y, n.z - c.z), n]).sort((a, b) => a[0] - b[0]).slice(0, 6).map((e) => e[1]);
  neonLights.forEach((l, i) => {
    const n = neonNear[i];
    l.intensity = n ? 34 : 0;
    if (n) { l.position.set(n.x, n.y, n.z); l.color.set(n.color); }
  });
  applyBuild(builder.data, false);
}
// La fumée de la pièce où l'on se trouve.
const roomSmoke = () => (level === 'brutal' ? smoke3dBrutal : smoke3dHall);
function brutalRebase(force) {
  if (!brutal.ready) return;
  const f = camera.position, feet = f.y - 1.58;
  const cx = BRUTAL_MIN.x + BRUTAL_SIZE[0] / 2, cz = BRUTAL_MIN.z + BRUTAL_SIZE[2] / 2;
  if (!force && Math.abs(f.x - cx) < 8 && Math.abs(f.z - cz) < 8 && feet > BRUTAL_MIN.y + 0.5 && feet < BRUTAL_MIN.y + 9) return;
  BRUTAL_MIN.set(Math.round((f.x - BRUTAL_SIZE[0] / 2) / 4) * 4, Math.max(-1, Math.round((feet - 4) / 2) * 2 - 1), Math.round((f.z - BRUTAL_SIZE[2] / 2) / 4) * 4);
  brutalOccMin.copy(BRUTAL_MIN);
  brutalOccTex.image.data.set(brutal.occupancy(BRUTAL_MIN, ...BRUTAL_N));
  brutalOccTex.needsUpdate = true;
  smoke3dBrutal?.setDomainMin(BRUTAL_MIN);
  setRoomBounds();
}
// Emprise où l'on peut poser sources, lampes, murs : la pièce, ou la fenêtre
// de fumée courante dans la ville.
function setRoomBounds() {
  if (level === 'brutal') {
    ROOM_LO.set(BRUTAL_MIN.x + 0.3, Math.max(0.1, BRUTAL_MIN.y + 0.3), BRUTAL_MIN.z + 0.3);
    ROOM_HI.set(BRUTAL_MIN.x + BRUTAL_SIZE[0] - 0.3, BRUTAL_MIN.y + BRUTAL_SIZE[1] - 0.3, BRUTAL_MIN.z + BRUTAL_SIZE[2] - 0.3);
  } else {
    ROOM_LO.set(-HALL.x + 0.2, 0.1, HALL.doorZ + 0.2);
    ROOM_HI.set(HALL.x - 0.2, HALL.wallTop - 0.2, HALL.north - 0.2);
  }
}
// Ombres du soleil : cadrées sur le hall, ou large et centrées sur le joueur.
function setSunRig(big) {
  const c = sun.shadow.camera;
  if (big) { c.left = -46; c.right = 46; c.top = 46; c.bottom = -46; c.far = 220; }
  else { c.left = -19; c.right = 19; c.top = 27; c.bottom = -27; c.far = 100; sun.target.position.set(0, 2, 9); }
  c.updateProjectionMatrix();
}
const sunDist = () => (level === 'brutal' ? 110 : 45);
// Sources et aspirateurs : un jeu pour la galerie et l'atelier (mêmes
// coordonnées), un autre pour la ville.
let srcKey = 'room';
const srcSets = { room: null, brutal: null };
function swapSources(key) {
  if (key === srcKey) return;
  const valid = (o) => o && [o.x, o.y, o.z].every(Number.isFinite);
  srcSets[srcKey] = { s: smokeSources.slice(), v: smokeVacs.slice() };
  if (!srcSets[key]) {
    const sv = key === 'brutal' ? smokeSaved.brutal || {} : {};
    srcSets[key] = { s: (sv.sources || []).filter(valid).map((o) => ({ ...SMOKE_SRC_DEFAULTS, color: '#ffffff', ...o, phase: Math.random() * 60 })), v: (sv.vacs || []).filter(valid).map((o) => ({ ...VAC_DEFAULTS, ...o })) };
  }
  smokeSources.length = 0; smokeSources.push(...srcSets[key].s);
  smokeVacs.length = 0; smokeVacs.push(...srcSets[key].v);
  srcKey = key;
  smokeSrcUI.resetSel?.();
}
// ---- Mannequin de test animé ---------------------------------------------------
const mannequin = createDummy({ parent: roomRoot });
const _dumP = new THREE.Vector3(), _dumD = new THREE.Vector3();
function placeDummy() {
  camera.getWorldDirection(_dumD);
  _dumD.y = 0;
  if (_dumD.lengthSq() < 1e-6) _dumD.set(0, 0, -1);
  _dumD.normalize();
  _dumP.copy(camera.position).addScaledVector(_dumD, 3);
  // Pieds au sol : géométrie de la ville, ou sol de la pièce.
  if (level === 'brutal') _dumP.y = brutal.ground(_dumP.x, camera.position.y + 0.3, _dumP.z) ?? 0;
  else { _dumP.x = flClamp(_dumP.x, ROOM_LO.x, ROOM_HI.x); _dumP.z = flClamp(_dumP.z, ROOM_LO.z, ROOM_HI.z); _dumP.y = hallGround(_dumP.x, _dumP.z).y; }
  return mannequin.place(_dumP, camera.position);
}
// ---- Vue à la troisième personne (touche T) -----------------------------------
// Toute la logique du jeu continue de raisonner avec la caméra aux yeux du
// joueur. Juste avant le rendu, la caméra recule derrière un mannequin animé
// posé à la place du joueur, puis revient à sa place juste après.
const avatar = createDummy({ parent: roomRoot });
// Par défaut on joue le mannequin, vu de dos ; T repasse à la première personne.
let thirdPerson = true;
try { const v = localStorage.getItem('ingaThird'); if (v !== null) thirdPerson = v === '1'; } catch { /* stockage indisponible */ }
// Geste en cours (tir, lancer…) : il prime un instant sur la marche.
let tpAct = '', tpActUntil = 0;
const TP_ACTS = { torn: ['Sword_Attack', 0.7], gum: ['Spell_Simple_Shoot', 0.6], ball: ['Punch_Cross', 0.55], air: ['Spell_Simple_Shoot', 0.6], paint: ['Punch_Jab', 0.45], pistol: ['Pistol_Shoot', 0.3], musket: ['Pistol_Shoot', 0.6], hado: ['Spell_Simple_Shoot', 0.8] };
function avatarAct(toolId) { const a = TP_ACTS[toolId]; if (!a) return; tpAct = a[0]; tpActUntil = performance.now() + a[1] * 1000; tpAnim = ''; if (avatar.ready) avatar.play(tpAct); }
const _tpEye = new THREE.Vector3(), _tpDir = new THREE.Vector3(), _tpFeet = new THREE.Vector3();
let tpActive = false, tpAnim = '';
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyT' || e.repeat || e.target instanceof HTMLInputElement || !inRoom() || !started) return;
  thirdPerson = !thirdPerson;
  try { localStorage.setItem('ingaThird', thirdPerson ? '1' : '0'); } catch { /* quota */ }
});
function tpBegin(dt) {
  tpActive = thirdPerson && inRoom() && started && !godMode;
  if (!tpActive) { if (avatar.placed) avatar.remove(); return; }
  // Le mannequin : aux pieds du joueur, tourné dans le sens du regard.
  _tpFeet.set(camera.position.x, camera.position.y - 1.58, camera.position.z);
  if (!avatar.placed) avatar.place(_tpFeet, null);
  avatar.position.copy(_tpFeet);
  avatar.setYaw(yaw + Math.PI);
  // Arme en main : posture de tir au repos.
  const armed = ['pistol', 'musket'].includes(TOOLS[toolIndex].id);
  const want = !grounded ? 'Jump_Loop' : playerSpeed > 4.2 ? 'Jog_Fwd_Loop' : playerSpeed > 0.4 ? 'Walk_Loop' : armed ? 'Pistol_Idle_Loop' : 'Idle_Loop';
  if (avatar.ready && performance.now() > tpActUntil && want !== tpAnim) { tpAnim = want; avatar.play(want); }
  avatar.update(dt);
  // Caméra : derrière et au-dessus de l'épaule, sans traverser les murs.
  _tpEye.copy(camera.position);
  camera.getWorldDirection(_tpDir);
  let dist = 3.6;
  if (level === 'brutal') dist = Math.max(0.6, Math.min(dist, brutal.rayDist(_tpEye, _tpDir.clone().negate(), dist + 0.3) - 0.3));
  camera.position.addScaledVector(_tpDir, -dist);
  camera.position.y += 0.35;
  if (level !== 'brutal') camera.position.set(flClamp(camera.position.x, ROOM_LO.x, ROOM_HI.x), flClamp(camera.position.y, 0.3, ROOM_HI.y), flClamp(camera.position.z, ROOM_LO.z, ROOM_HI.z));
  camera.updateMatrixWorld();
  if (fogPass) { fogPass.uniforms.uViewInv.value.copy(camera.matrixWorld); fogPass.uniforms.uCamPos.value.copy(camera.position); }
}
function tpEnd() {
  if (!tpActive) return;
  camera.position.copy(_tpEye);
  camera.updateMatrixWorld();
}
let hallGpuReady = false, fireLit = false;
// ---- Mode global des paramètres ----------------------------------------------
// Activé, la fumée a les mêmes réglages dans tous les niveaux : la galerie et
// l'atelier (qui partagent déjà SMOKE_SIM / SMOKE_VIEW) et le bac, qui sinon
// garde les siens. La référence commune est celle de la galerie ; régler un
// curseur dans le bac la met à jour, et inversement à l'entrée dans le bac.
let globalParams = false;
try { globalParams = localStorage.getItem('ingaGlobal') === '1'; } catch { /* stockage indisponible */ }
const GAIN_K = 0.123; // opacité galerie → opacité de la filière GPU
function shareToBac() {
  for (const k of ['weight', 'swirl', 'dissip', 'visc']) { FL_DOMAINS.bac.sim[k] = SMOKE_SIM[k]; smoke3d.params[k] = SMOKE_SIM[k]; if (flDomain === 'bac') FL[k] = SMOKE_SIM[k]; }
  smoke3d.setSim();
  smoke2d.params.weight = SMOKE_SIM.weight; smoke2d.params.dissip = SMOKE_SIM.dissip;
  BAC_VIEW.gain = SMOKE_VIEW.gain * GAIN_K; BAC_VIEW.lum = SMOKE_VIEW.lum;
  const P = smoke3d.params;
  P.turb = SMOKE_VIEW.turb; P.simHz = SMOKE_VIEW.simHz; P.march = SMOKE_VIEW.march; P.halfRes = !SMOKE_VIEW.full;
  if (P.res !== SMOKE_VIEW.res && smoke3d.fits(SMOKE_VIEW.res)) smoke3d.setRes(SMOKE_VIEW.res);
  if (P.lightFull !== !!SMOKE_VIEW.lightFull) smoke3d.setLightFull(!!SMOKE_VIEW.lightFull);
  if (P.velN !== (SMOKE_VIEW.vel64 ? 64 : 32)) smoke3d.setVelN(SMOKE_VIEW.vel64 ? 64 : 32);
}
function shareFromBac() {
  for (const k of ['weight', 'swirl', 'dissip', 'visc']) SMOKE_SIM[k] = FL_DOMAINS.bac.sim[k];
  SMOKE_VIEW.gain = BAC_VIEW.gain / GAIN_K; SMOKE_VIEW.lum = BAC_VIEW.lum;
  const P = smoke3d.params;
  SMOKE_VIEW.turb = P.turb; SMOKE_VIEW.simHz = P.simHz; SMOKE_VIEW.march = P.march; SMOKE_VIEW.full = P.halfRes ? 0 : 1;
  SMOKE_VIEW.res = P.res; SMOKE_VIEW.lightFull = P.lightFull ? 1 : 0; SMOKE_VIEW.vel64 = P.velN === 64 ? 1 : 0;
  smokeSrcUI.save?.();
}
// La galerie (ou l'atelier) reprend les réglages communs en y entrant.
function applyRoomParams() {
  if (!roomSmoke()) return;
  Object.assign(roomSmoke().params, SMOKE_SIM);
  roomSmoke().setSim();
  const P = roomSmoke().params;
  if (!roomSmoke()._ready) return; // le premier pas applique tout
  if (P.res !== SMOKE_VIEW.res && roomSmoke().fits(SMOKE_VIEW.res)) roomSmoke().setRes(SMOKE_VIEW.res);
  if (P.lightFull !== !!SMOKE_VIEW.lightFull) roomSmoke().setLightFull(!!SMOKE_VIEW.lightFull);
  if (P.velN !== (SMOKE_VIEW.vel64 ? 64 : 32)) roomSmoke().setVelN(SMOKE_VIEW.vel64 ? 64 : 32);
}
function setGlobalParams(on) {
  globalParams = on;
  try { localStorage.setItem('ingaGlobal', on ? '1' : '0'); } catch { /* quota */ }
  // Les valeurs du niveau où l'on se trouve deviennent la référence.
  if (on && level === 'smoke') shareFromBac();
  smokeSrcUI.refresh?.(); smokeUI.refresh?.();
}
const globalCheck = (parent, accent) => {
  const lab = document.createElement('label');
  lab.style.cssText = 'display:flex;align-items:center;gap:8px;margin:8px 0 2px;cursor:pointer;letter-spacing:.04em';
  const inp = document.createElement('input');
  inp.type = 'checkbox'; inp.style.accentColor = accent;
  inp.addEventListener('change', () => setGlobalParams(inp.checked));
  lab.append(inp, document.createTextNode('Mode global : mêmes paramètres partout'));
  lab.title = 'Poids, dissipation, tourbillons, viscosité, opacité, luminosité et réglages de qualité identiques dans la galerie, l\'atelier et le bac.';
  parent.append(lab);
  return () => { inp.checked = globalParams; };
};
// ---- Atelier : niveau vierge à construire (outil B) ---------------------------
// Même emprise que la galerie, monde masqué : une dalle, et ce que l'on pose.
const ROOM_LO = new THREE.Vector3(-HALL.x + 0.2, 0.1, HALL.doorZ + 0.2);
const ROOM_HI = new THREE.Vector3(HALL.x - 0.2, HALL.wallTop - 0.2, HALL.north - 0.2);
const atelierRoot = new THREE.Group();
atelierRoot.visible = false;
const atelierFloor = { color: '#ecebe7', set: null };
{
  const slab = new THREE.Mesh(new THREE.BoxGeometry(HALL.x * 2, 0.4, HALL.north - HALL.doorZ), new THREE.MeshStandardMaterial({ color: '#ecebe7', roughness: 0.95 }));
  slab.position.set(0, -0.2, (HALL.north + HALL.doorZ) / 2);
  slab.receiveShadow = true;
  atelierRoot.add(slab);
  const grid = new THREE.GridHelper(24, 24, 0xffffff, 0xffffff);
  grid.position.set(0, 0.005, (HALL.north + HALL.doorZ) / 2);
  grid.material.transparent = true;
  atelierRoot.add(grid);
  // Couleur du sol, au choix (outil B) ; le quadrillage reste lisible : plus
  // sombre que le sol s'il est clair, plus clair s'il est sombre.
  atelierFloor.set = (hex) => {
    atelierFloor.color = hex;
    slab.material.color.set(hex);
    const c = slab.material.color, lum = 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;
    grid.material.color.set(lum > 0.25 ? 0x000000 : 0xffffff);
    grid.material.opacity = lum > 0.25 ? 0.16 : 0.12;
    try { localStorage.setItem('ingaAtelierFloor', hex); } catch { /* quota */ }
  };
  let saved = null;
  try { saved = localStorage.getItem('ingaAtelierFloor'); } catch { /* stockage indisponible */ }
  atelierFloor.set(/^#[0-9a-f]{6}$/i.test(saved || '') ? saved : '#ecebe7');
}
scene.add(atelierRoot);
const ATELIER_BG = new THREE.Color('#131517');
// Ville sous la pluie, au crépuscule : ciel couvert gris-bleu, brume légère.
const BRUTAL_BG = new THREE.Color('#4a5266');
const BRUTAL_FOG = new THREE.FogExp2('#4a5266', 0.0065);
// Réglages de la ville (menu Échap) : luminosité générale et pluie.
const CITY = { bright: 1, rain: 0.6 };
try { Object.assign(CITY, JSON.parse(localStorage.getItem('ingaCity')) || {}); } catch { /* réglages illisibles */ }
function applyCity() {
  const on = level === 'brutal';
  renderer.toneMappingExposure = 1.22 * (on ? CITY.bright : 1);
  if (brutal.rain) brutal.rain.material.uniforms.uAmount.value = CITY.rain;
  try { localStorage.setItem('ingaCity', JSON.stringify(CITY)); } catch { /* quota */ }
}
const SUN_DIR0 = SUN_DIR.clone();
const SUN_DEFAULTS = { color: SUN_COLOR, intensity: 3.6, az: (Math.atan2(SUN_DIR.x, SUN_DIR.z) * 180 / Math.PI + 360) % 360, el: Math.asin(SUN_DIR.y) * 180 / Math.PI };
const _sunBase = new THREE.Color(SUN_COLOR), _sunC = new THREE.Color();
let maskTimer = 0;
let roomLamps = []; // lampes fixes de la pièce, déjà converties pour la fumée
// Applique soleil, lampes et obstacles d'une construction à la scène et à la fumée.
function applyBuild(data, geometry) {
  roomBoxes = data.boxes;
  roomSmoke()?.setSolids(data.boxes);
  // Lampes de la construction, puis (dans la ville) les néons proches.
  const lamps = data.lights.map((l) => ({ x: l.x, y: l.y, z: l.z, color: l.color, intensity: l.intensity, range: l.range }));
  if (level === 'brutal') for (const n of neonNear) lamps.push({ x: n.x, y: n.y, z: n.z, color: n.color, intensity: 34, range: 20 });
  roomLamps = lamps.slice(0, 8).map((l) => {
    _sunC.set(l.color);
    const k = l.intensity * 0.11;
    return { x: l.x, y: l.y, z: l.z, range: l.range, r: _sunC.r * k, g: _sunC.g * k, b: _sunC.b * k };
  });
  roomSmoke()?.setLights(roomLamps);
  // Soleil : couleur et intensité partout ; direction dans l'atelier seulement.
  const sd = inRoom() ? data.sun : SUN_DEFAULTS;
  sun.color.set(sd.color);
  if (inRoom()) sun.intensity = sd.intensity;
  _sunC.set(sd.color);
  const k = 2.6 * sd.intensity / 3.6;
  const r = _sunC.r / _sunBase.r * k, g = 0.92 * _sunC.g / _sunBase.g * k, b = 0.78 * _sunC.b / _sunBase.b * k;
  roomSmoke()?.setSunColor(r, g, b);
  if (fogPass) fogPass.uniforms.uSunCol.value.set(r, g, b);
  if (level === 'atelier' || level === 'brutal') {
    const el = sd.el * Math.PI / 180, az = sd.az * Math.PI / 180;
    SUN_DIR.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  } else SUN_DIR.copy(SUN_DIR0);
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, sunDist());
  if (fogPass) fogPass.uniforms.uSunDir.value.copy(SUN_DIR);
  if (geometry) {
    // Les masques de vitesse du solveur suivent, un peu après la dernière retouche.
    clearTimeout(maskTimer);
    maskTimer = setTimeout(() => { if (flDomain === 'hall') { flConfigure('hall', true); roomSmoke()?.reconfigure(true); } }, 350);
  }
}
const builder = createBuilder({
  root: roomRoot, camera, renderer, lo: ROOM_LO, hi: ROOM_HI, sunDefaults: SUN_DEFAULTS,
  canUse: () => inRoom() && started && !fogBrush.open && !smokeSrcUI.open,
  canAimSun: () => level === 'atelier' || level === 'brutal',
  floor: { get: () => (level === 'atelier' ? atelierFloor.color : undefined), set: (v) => atelierFloor.set(v) },
  onChange: applyBuild,
  releaseMouse: () => { devMenuSuppress = performance.now(); document.exitPointerLock?.(); },
});
builder.load('hall');
// ---- Balles lancées (galerie) -------------------------------------------------
// Clic gauche, souris capturée, aucun outil ouvert : une balle part dans
// l'axe du regard, rebondit sur le sol, les murs et le plafond du hall, et
// bouscule la fumée sur son passage.
const BALL = { r: 0.16, max: 8, life: 14, speed: 15 };
const balls = [];
const ballGeo = new THREE.SphereGeometry(BALL.r, 20, 14);
const ballMat = new THREE.MeshStandardMaterial({ color: '#d9cdb8', roughness: 0.55 });
const _ballDir = new THREE.Vector3();
function throwBall() {
  camera.getWorldDirection(_ballDir);
  let b = balls.length >= BALL.max ? balls.shift() : null;
  if (!b) {
    b = { mesh: new THREE.Mesh(ballGeo, ballMat), p: new THREE.Vector3(), v: new THREE.Vector3(), age: 0 };
    b.mesh.castShadow = true;
    roomRoot.add(b.mesh);
  }
  b.p.copy(camera.position).addScaledVector(_ballDir, 0.5);
  b.p.y -= 0.12;
  b.v.copy(_ballDir).multiplyScalar(BALL.speed).add(_bodySm);
  b.age = 0;
  b.mesh.visible = true;
  balls.push(b);
}
const _hit = { point: new THREE.Vector3(), normal: new THREE.Vector3() }, _bp = new THREE.Vector3();
// Balles dans la ville : rebonds sur la vraie géométrie.
function ballsStepMesh(dt) {
  for (let i = balls.length - 1; i >= 0; i--) {
    const b = balls[i];
    b.age += dt;
    if (b.age > BALL.life || b.p.y < -20) { b.mesh.visible = false; roomRoot.remove(b.mesh); balls.splice(i, 1); continue; }
    for (let k = 0; k < 2; k++) {
      const h = dt / 2;
      b.v.y -= 9.3 * h;
      _bp.copy(b.p).addScaledVector(b.v, h);
      if (brutal.segHit(b.p, _bp, _hit)) {
        const vn = b.v.dot(_hit.normal);
        b.v.addScaledVector(_hit.normal, -1.55 * vn).multiplyScalar(0.9);
        if (_hit.normal.y > 0.7 && Math.abs(b.v.y) < 0.7) { b.v.y = 0; b.v.multiplyScalar(Math.max(0, 1 - 2.2 * h)); }
        b.p.copy(_hit.point).addScaledVector(_hit.normal, BALL.r);
      } else b.p.copy(_bp);
    }
    b.mesh.position.copy(b.p);
  }
}
function ballsStep(dt) {
  if (level === 'brutal') return ballsStepMesh(dt);
  const r = BALL.r, xM = HALL.x - r, zLo = HALL.doorZ + r, zHi = HALL.north - r, yHi = HALL.wallTop - r;
  for (let i = balls.length - 1; i >= 0; i--) {
    const b = balls[i];
    b.age += dt;
    if (b.age > BALL.life) { b.mesh.visible = false; roomRoot.remove(b.mesh); balls.splice(i, 1); continue; }
    // Deux sous-pas : une balle rapide ne traverse pas le sol.
    for (let k = 0; k < 2; k++) {
      const h = dt / 2;
      b.v.y -= 9.3 * h;
      b.p.addScaledVector(b.v, h);
      if (b.p.x > xM) { b.p.x = xM; b.v.x *= -0.6; } else if (b.p.x < -xM) { b.p.x = -xM; b.v.x *= -0.6; }
      if (b.p.z > zHi) { b.p.z = zHi; b.v.z *= -0.6; } else if (b.p.z < zLo) { b.p.z = zLo; b.v.z *= -0.6; }
      if (b.p.y > yHi) { b.p.y = yHi; b.v.y *= -0.5; }
      const gy = hallGround(b.p.x, b.p.z).y + r;
      if (b.p.y < gy) {
        b.p.y = gy;
        if (b.v.y < 0) b.v.y *= -0.55;
        if (Math.abs(b.v.y) < 0.6) b.v.y = 0;
        const fr = Math.max(0, 1 - 2.2 * h); // roulement
        b.v.x *= fr; b.v.z *= fr;
      }
    }
    b.mesh.position.copy(b.p);
  }
}
// Boule d'air : un souffle sans matière. Pas de gravité, elle file droit en
// ralentissant, meurt contre un mur ou quand elle s'essouffle. Elle n'agit que
// sur la fumée et reste invisible ; taille et vitesse se règlent dans le panneau V.
const airBalls = [];
function throwAir() {
  camera.getWorldDirection(_ballDir);
  const size = SMOKE_VIEW.airSize;
  let a = airBalls.length >= 4 ? airBalls.shift() : null;
  if (!a) {
    a = { p: new THREE.Vector3(), v: new THREE.Vector3(), age: 0, r: size };
  }
  a.r = size;
  a.p.copy(camera.position).addScaledVector(_ballDir, 0.4 + size);
  // vt : la vitesse de croisière ; la boule part lentement puis accélère.
  a.vt = _ballDir.clone().multiplyScalar(SMOKE_VIEW.airSpeed);
  a.v.copy(a.vt).multiplyScalar(0.3);
  a.age = 0;
  airBalls.push(a);
  // Une boule pleine de fumée blanche : un nuage compact naît dans la boule,
  // qui l'emporte et le traverse en accélérant — c'est lui qui rend le
  // souffle visible.
  if (SMOKE_VIEW.airSmoke > 0) puff(a.p, a.vt.clone().multiplyScalar(0.5), 80 * SMOKE_VIEW.airSmoke, size * SMOKE_VIEW.airCloud, 0.22, '#ffffff', 2.6);
}
function airStep(dt) {
  for (let i = airBalls.length - 1; i >= 0; i--) {
    const a = airBalls[i];
    a.age += dt;
    // Accélération en 0,35 s, puis lent essoufflement.
    if (a.vt) {
      a.vt.multiplyScalar(Math.exp(-0.55 * dt));
      const k = Math.min(1, a.age / Math.max(0.02, SMOKE_VIEW.airAccel));
      a.v.copy(a.vt).multiplyScalar(0.3 + 0.7 * k * k * (3 - 2 * k));
    } else a.v.multiplyScalar(Math.exp(-0.55 * dt));
    _bp.copy(a.p);
    a.p.addScaledVector(a.v, dt);
    const sp = (a.vt || a.v).length();
    // Murs, sol, plafond et constructions arrêtent la boule : elle s'écrase,
    // et son souffle s'étale en étoile le long de la surface (le nuage
    // qu'elle porte s'aplatit contre le mur au lieu de le traverser).
    const res = paintHit(_bp, a.p, _ph);
    if (res === 'hit') {
      const n = _ph.normal, at = _ph.point.clone().addScaledVector(n, Math.min(0.5, a.r * 0.5));
      _pt1.set(n.y, n.z, n.x).addScaledVector(n, -(n.y * n.x + n.z * n.y + n.x * n.z)).normalize();
      _pt2.crossVectors(n, _pt1);
      for (let k = 0, m = 9; k < m; k++) {
        const ang = (k + Math.random() * 0.6) / m * Math.PI * 2, v = sp * (0.45 + 0.35 * Math.random());
        const gv = _pt1.clone().multiplyScalar(Math.cos(ang) * v).addScaledVector(_pt2, Math.sin(ang) * v).addScaledVector(n, 0.8);
        shots.push({ kind: 'gust', p: at.clone(), prev: at.clone(), v: gv, age: 0, life: 0.35 + Math.random() * 0.4, g: 0, r: Math.max(0.35, a.r * 0.6), cap: 16, gain: 2.2, id: ++shotSeq, mesh: null, dead: 0 });
      }
    }
    if (res || sp < 1.2 || a.age > 5) airBalls.splice(i, 1);
  }
}
// Pistolet à peinture : des gouttes colorées, soumises à la gravité, qui
// s'écrasent en taches sur le sol, les murs et les constructions. Chaque tache
// fraîche fume un peu, de sa couleur, pendant quelques secondes.
const PAINT = { speed: 17, life: 7, max: 800, color: '#ff3b6b', random: true, smoke: 1, bubbles: 1, size: 1 };
try { Object.assign(PAINT, JSON.parse(localStorage.getItem('ingaPaint')) || {}); } catch { /* réglages illisibles */ }
const PAINT_PALETTE = ['#ff3b6b', '#ff9a1f', '#ffe21f', '#3ddc6a', '#22c8ff', '#7a5cff', '#ff5cf0'];
const paintShots = [], paintSplats = [];
const paintDropGeo = new THREE.SphereGeometry(0.34, 16, 12); // un énorme ballon ; ses éclaboussures sont réduites
// Quelques formes de tache : un contour irrégulier et des éclaboussures.
const paintGeos = [0, 1, 2, 3, 4].map(() => {
  const sh = new THREE.Shape();
  const N = 18, ph = Math.random() * 9;
  for (let i = 0; i <= N; i++) {
    const a = i / N * Math.PI * 2;
    const r = 1 + 0.22 * Math.sin(a * 3 + ph) + 0.16 * Math.sin(a * 5 + ph * 2.3) + 0.1 * Math.sin(a * 9 + ph * 0.7);
    if (i === 0) sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); else sh.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const parts = [new THREE.ShapeGeometry(sh)];
  for (let k = 0, n = 5 + (Math.random() * 5 | 0); k < n; k++) {
    const a = Math.random() * Math.PI * 2, d = 1.25 + Math.random() * 0.9;
    const c = new THREE.CircleGeometry(0.07 + Math.random() * 0.16, 10);
    c.translate(Math.cos(a) * d, Math.sin(a) * d, 0);
    parts.push(c);
  }
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
});
const _pn = new THREE.Vector3(), _pz = new THREE.Vector3(0, 0, 1), _pc = new THREE.Color();
function shootPaint() {
  camera.getWorldDirection(_ballDir);
  const color = PAINT.random ? PAINT_PALETTE[Math.random() * PAINT_PALETTE.length | 0] : PAINT.color;
  const m = new THREE.Mesh(paintDropGeo, new THREE.MeshBasicMaterial({ color }));
  roomRoot.add(m);
  const p = camera.position.clone().addScaledVector(_ballDir, 0.9);
  p.y -= 0.2;
  const v = _ballDir.clone().multiplyScalar(PAINT.speed).add(_bodySm);
  v.y += 2.2; // lancé en cloche
  v.x += (Math.random() - 0.5) * 0.6; v.y += (Math.random() - 0.5) * 0.6; v.z += (Math.random() - 0.5) * 0.6;
  paintShots.push({ mesh: m, p, v, prev: p.clone(), color, child: false });
}
const _pt1 = new THREE.Vector3(), _pt2 = new THREE.Vector3(), _pb = new THREE.Matrix4();
const _ph = { point: new THREE.Vector3(), normal: new THREE.Vector3() }, _pa = new THREE.Vector3(), _pq = new THREE.Vector3();
// Première surface entre a et b (ville : vraie géométrie ; pièce : sol, murs,
// plafond, constructions). Remplit out.point / out.normal. « lost » : sorti
// du niveau sans rien toucher.
function paintHit(a, b, out) {
  if (level === 'brutal') return brutal.segHit(a, b, out) ? 'hit' : b.y < -10 ? 'lost' : '';
  const p = out.point.copy(b), n = out.normal;
  for (const bx of roomBoxes) {
    const hx = bx.sx / 2, hy = bx.sy / 2, hz = bx.sz / 2;
    if (Math.abs(p.x - bx.x) > hx || Math.abs(p.y - bx.y) > hy || Math.abs(p.z - bx.z) > hz) continue;
    // La face touchée est celle que le projectile vient de franchir.
    if (Math.abs(a.x - bx.x) > hx) { n.set(Math.sign(a.x - bx.x), 0, 0); p.x = bx.x + n.x * hx; }
    else if (Math.abs(a.y - bx.y) > hy) { n.set(0, Math.sign(a.y - bx.y), 0); p.y = bx.y + n.y * hy; }
    else { n.set(0, 0, Math.sign(a.z - bx.z) || 1); p.z = bx.z + n.z * hz; }
    return 'hit';
  }
  const gy = hallGround(p.x, p.z).y;
  if (p.y < gy) { p.y = gy; n.set(0, 1, 0); return 'hit'; }
  if (Math.abs(p.x) > HALL.x || p.z < HALL.doorZ || p.z > HALL.north || p.y > HALL.wallTop) {
    if (level === 'atelier') return 'lost'; // pas de murs d'enceinte
    if (p.y > HALL.wallTop) { p.y = HALL.wallTop; n.set(0, -1, 0); }
    else if (Math.abs(p.x) > HALL.x) { n.set(-Math.sign(p.x), 0, 0); p.x = Math.sign(p.x) * HALL.x; }
    else if (p.z < HALL.doorZ) { p.z = HALL.doorZ; n.set(0, 0, 1); }
    else { p.z = HALL.north; n.set(0, 0, -1); }
    return 'hit';
  }
  return '';
}
// Pose une tache : x le long de `t` (sens du tir), z la normale.
function paintBlob(pos, n, t, color, sx, sy, emit) {
  if (paintDecals) {
    // Peinture projetée : aucune plaque, donc rien qui dépasse des surfaces.
    paintDecals.add(pos, n, t, color, sy, Math.max(0, Math.min(1, sx / sy - 1)));
    if (paintSplats.length >= PAINT.max) paintSplats.shift();
    _pq.copy(t).addScaledVector(n, -t.dot(n));
    if (_pq.lengthSq() < 1e-4) _pq.set(n.y, n.z, n.x).addScaledVector(n, -(n.y * n.x + n.z * n.y + n.x * n.z));
    _pq.normalize();
    const q = new THREE.Quaternion().setFromRotationMatrix(_pb.makeBasis(_pq, _pa.crossVectors(n, _pq), n));
    _pc.set(color);
    paintSplats.push({ mesh: { quaternion: q, position: pos.clone().addScaledVector(n, 0.012), material: { dispose() {} } }, seed: Math.random() * 100, s: Math.min(sx, sy), emit, x: pos.x + n.x * 0.25, y: pos.y + n.y * 0.25, z: pos.z + n.z * 0.25, nx: n.x, ny: n.y, nz: n.z, r: _pc.r, g: _pc.g, b: _pc.b, age: 0 });
    return;
  }
  if (paintSplats.length >= PAINT.max) { const old = paintSplats.shift(); roomRoot.remove(old.mesh); old.mesh.material.dispose(); }
  const mesh = new THREE.Mesh(paintGeos[Math.random() * paintGeos.length | 0], new THREE.MeshStandardMaterial({ color, roughness: 0.32, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide, depthWrite: false }));
  // Les taches ne s'écrivent pas dans la profondeur et se dessinent dans
  // l'ordre des tirs : deux taches superposées ne scintillent plus.
  mesh.renderOrder = 5 + (paintOrder++ % 100000) * 1e-4;
  mesh.position.copy(pos).addScaledVector(n, 0.012);
  _pq.copy(t).addScaledVector(n, -t.dot(n));
  if (_pq.lengthSq() < 1e-4) _pq.set(n.y, n.z, n.x).addScaledVector(n, -(n.y * n.x + n.z * n.y + n.x * n.z));
  _pq.normalize();
  mesh.quaternion.setFromRotationMatrix(_pb.makeBasis(_pq, _pa.crossVectors(n, _pq), n));
  mesh.rotateZ((Math.random() - 0.5) * 0.5);
  mesh.scale.set(sx, sy, 1);
  mesh.receiveShadow = true;
  roomRoot.add(mesh);
  _pc.set(color);
  paintSplats.push({ mesh, seed: Math.random() * 100, s: Math.min(sx, sy), emit, x: pos.x + n.x * 0.25, y: pos.y + n.y * 0.25, z: pos.z + n.z * 0.25, nx: n.x, ny: n.y, nz: n.z, r: _pc.r, g: _pc.g, b: _pc.b, age: 0 });
}
// Un énorme ballon de peinture qui éclate. Le cœur est une grande tache ;
// autour, des dizaines de taches moyennes sont plaquées sur le relief réel
// (chacune cherche sa surface), étalées dans le sens du tir d'autant plus que
// l'angle est rasant ; enfin une gerbe d'éclaboussures s'envole et retombe
// plus loin, là où le terrain l'arrête.
// -- Particules de peinture (peinture projetée) ---------------------------------
// À l'éclatement, le ballon libère un nuage de gouttes de tailles et de
// vitesses variées. Chacune vole, vit quelques secondes, et peint là où elle
// touche — une petite tache étirée selon son propre angle d'arrivée — en
// provoquant parfois une mini-explosion de gouttelettes. La forme finale
// vient donc de la physique et du relief, jamais deux fois la même.
const PP_MAX = 2400;
const pp = [];
const ppMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial(), PP_MAX);
ppMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
ppMesh.count = 0;
ppMesh.frustumCulled = false;
roomRoot.add(ppMesh);
const _ppM = new THREE.Matrix4(), _ppQ = new THREE.Quaternion(), _ppS = new THREE.Vector3(), _ppC = new THREE.Color(), _ppV = new THREE.Vector3();
function ppSpawn(p, v, color, size, gen, life) {
  if (pp.length >= PP_MAX) return;
  pp.push({ p: p.clone(), prev: p.clone(), v: v.clone(), color, size, gen, life, age: 0 });
}
// L'éclatement lui-même : chaque ballon tire au sort son caractère (nombre de
// gouttes, ouverture de la gerbe, part de grosses gouttes, élan conservé).
function paintBurst(pos, n, v, color) {
  const S = PAINT.size, speed = v.length() || 1, vn = v.dot(n);
  _pt1.copy(v).addScaledVector(n, -vn);
  const graze = Math.min(1, _pt1.length() / speed);
  if (_pt1.lengthSq() < 1e-4) _pt1.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).addScaledVector(n, -_pt1.dot(n));
  _pt1.normalize();
  _pt2.crossVectors(n, _pt1);
  const count = 55 + (Math.random() * 70 | 0), fan = 0.35 + Math.random() * 0.65, carry = 0.25 + Math.random() * 0.55, lift = 0.6 + Math.random() * 1.1, heavy = 0.02 + Math.random() * 0.05;
  const origin = pos.clone().addScaledVector(n, 0.1);
  for (let k = 0; k < count; k++) {
    const a = (Math.random() * 2 - 1) * Math.PI * (1 - (1 - fan) * graze), r = Math.random();
    const big = Math.random() < heavy;
    _ppV.copy(_pt1).multiplyScalar(speed * graze * carry * (0.3 + 0.9 * r) + Math.cos(a) * (1 + 6 * Math.random()))
      .addScaledVector(_pt2, Math.sin(a) * (1 + 6 * Math.random()))
      .addScaledVector(n, (1 + 5.5 * Math.random() * Math.random()) * lift + Math.abs(vn) * 0.12);
    if (big) _ppV.multiplyScalar(0.6);
    ppSpawn(origin, _ppV, color, (big ? 0.13 + Math.random() * 0.12 : 0.025 + Math.random() * Math.random() * 0.085) * S, 1, 1.2 + Math.random() * 1.6);
  }
}
function ppStep(dt) {
  let n = 0;
  for (let i = pp.length - 1; i >= 0; i--) {
    const q = pp[i];
    q.age += dt;
    let res = '';
    for (let k = 0; k < 2 && !res; k++) {
      const h = dt / 2;
      q.prev.copy(q.p);
      q.v.y -= 9.3 * h;
      q.v.multiplyScalar(1 - 0.35 * h); // un peu de traînée
      q.p.addScaledVector(q.v, h);
      res = paintHit(q.prev, q.p, _ph);
    }
    if (res === 'hit') {
      const sp = q.v.length() || 1, vn = q.v.dot(_ph.normal);
      const graze = Math.min(1, Math.sqrt(Math.max(0, sp * sp - vn * vn)) / sp);
      const R = q.size * (2.4 + Math.min(sp, 14) * 0.16);
      // Motif complet (gouttelettes, coulures) seulement pour une grosse goutte sur une paroi.
      paintDecals.add(_ph.point, _ph.normal, q.v, q.color, R, graze, R < 0.2 || Math.abs(_ph.normal.y) > 0.6);
      if (q.size > 0.12 * PAINT.size) {
        // Grosse goutte : elle bout et fume comme le cœur de l'éclat.
        _pc.set(q.color);
        if (paintSplats.length >= PAINT.max) paintSplats.shift();
        const quat = new THREE.Quaternion().setFromUnitVectors(_pz, _ph.normal);
        paintSplats.push({ mesh: { quaternion: quat, position: _ph.point.clone().addScaledVector(_ph.normal, 0.012), material: { dispose() {} } }, seed: Math.random() * 100, s: R, emit: true, x: _ph.point.x + _ph.normal.x * 0.25, y: _ph.point.y + _ph.normal.y * 0.25, z: _ph.point.z + _ph.normal.z * 0.25, nx: _ph.normal.x, ny: _ph.normal.y, nz: _ph.normal.z, r: _pc.r, g: _pc.g, b: _pc.b, age: 0 });
      }
      if (q.gen === 1 && q.size > 0.045 * PAINT.size) {
        // Mini-explosion : quelques gouttelettes rebondissent et repeignent autour.
        const nn = _ph.normal, base = _ph.point.clone().addScaledVector(nn, 0.04);
        for (let k = 0, m = 1 + (Math.random() * (q.size > 0.12 ? 6 : 3) | 0); k < m; k++) {
          _ppV.copy(q.v).addScaledVector(nn, -vn).multiplyScalar(0.2 + 0.35 * Math.random())
            .addScaledVector(nn, 0.8 + Math.random() * 2.6 + Math.abs(vn) * 0.15);
          _ppV.x += (Math.random() - 0.5) * 3.2; _ppV.y += (Math.random() - 0.5) * 1.2; _ppV.z += (Math.random() - 0.5) * 3.2;
          ppSpawn(base, _ppV, q.color, q.size * (0.3 + 0.3 * Math.random()), 2, 0.5 + Math.random() * 0.7);
        }
      }
    }
    if (res || q.age > q.life) { pp[i] = pp[pp.length - 1]; pp.pop(); continue; }
  }
  for (const q of pp) {
    if (n >= PP_MAX) break;
    ppMesh.setMatrixAt(n, _ppM.compose(q.p, _ppQ, _ppS.setScalar(q.size * 0.55)));
    ppMesh.setColorAt(n, _ppC.set(q.color));
    n++;
  }
  ppMesh.count = n;
  if (n) { ppMesh.instanceMatrix.needsUpdate = true; if (ppMesh.instanceColor) ppMesh.instanceColor.needsUpdate = true; }
}
function paintSplat(pos, n, color, v, child) {
  if (paintDecals && !child) {
    // Peinture projetée : un cœur modeste, et tout le reste aux particules.
    const speed0 = v.length() || 1, vn0 = v.dot(n);
    const g0 = Math.min(1, Math.sqrt(Math.max(0, speed0 * speed0 - vn0 * vn0)) / speed0);
    const core0 = (0.5 + Math.random() * 0.55) * PAINT.size;
    paintBlob(pos.clone(), n, v, color, core0 * (1 + g0), core0, true);
    paintBurst(pos, n, v, color);
    return;
  }
  const vn = v.dot(n);
  _pt1.copy(v).addScaledVector(n, -vn);
  const speed = v.length() || 1, graze = Math.min(1, _pt1.length() / speed);
  if (_pt1.lengthSq() < 1e-4) _pt1.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).addScaledVector(n, -_pt1.dot(n));
  _pt1.normalize();
  _pt2.crossVectors(n, _pt1);
  const S = PAINT.size;
  if (child) { const b = (0.12 + Math.random() * 0.3) * S; paintBlob(pos, n, _pt1, color, b * (1 + 1.2 * graze), b, false); return; }
  const core = (paintDecals ? 1.5 : 0.95) * (1 + Math.random() * 0.3) * S;
  // (Peinture projetée : l'étalement vers l'avant est fait par le shader.)
  paintBlob(paintDecals ? pos.clone() : pos.clone().addScaledVector(_pt1, core * 0.35 * graze), n, _pt1, color, core * (1 + (paintDecals ? 1 : 0.9) * graze), core, true);
  // Couronne plaquée sur le terrain : chaque tache part d'un point au-dessus
  // de la surface et descend chercher ce qu'il y a dessous (sol, marche,
  // mur voisin…). Rien dessous : rien de posé.
  const R = 2.3 * S, t1 = _pt1.clone(), t2 = _pt2.clone(), nn = n.clone();
  for (let k = 0, M = paintDecals ? 0 : 30; k < M; k++) {
    const a = Math.random() * Math.PI * 2, d = R * (0.25 + 0.75 * Math.sqrt(Math.random()));
    const along = Math.cos(a) * d * (1 + 1.4 * graze) + R * 0.8 * graze, across = Math.sin(a) * d * (1 - 0.3 * graze);
    _pa.copy(pos).addScaledVector(nn, 0.5).addScaledVector(t1, along).addScaledVector(t2, across);
    const from = _pa.clone(), to = _pa.clone().addScaledVector(nn, -1.6);
    if (paintHit(from, to, _ph) !== 'hit') continue;
    const fall = 1 - 0.55 * d / R; // plus petites vers le bord
    const b = (0.3 + Math.random() * 0.4) * S * fall;
    paintBlob(_ph.point.clone(), _ph.normal.clone(), t1, color, b * (1 + 1.1 * graze), b, k < 3);
  }
  // Gerbe projetée.
  const count = 34 + (Math.random() * 14 | 0);
  for (let k = 0; k < count; k++) {
    const a = Math.random() * Math.PI * 2;
    const vel = t1.clone().multiplyScalar(speed * graze * (0.2 + 0.6 * Math.random()))
      .addScaledVector(nn, 1.5 + Math.random() * 5.5 + Math.abs(vn) * 0.15)
      .addScaledVector(t1, Math.cos(a) * (1.5 + Math.random() * 5)).addScaledVector(t2, Math.sin(a) * (1.5 + Math.random() * 5));
    const m = new THREE.Mesh(paintDropGeo, new THREE.MeshBasicMaterial({ color }));
    m.scale.setScalar(0.1 + Math.random() * 0.14);
    const p = pos.clone().addScaledVector(nn, 0.08);
    m.position.copy(p);
    roomRoot.add(m);
    paintShots.push({ mesh: m, p, v: vel, prev: p.clone(), color, child: true });
  }
}
function paintStep(dt) {
  for (let i = paintShots.length - 1; i >= 0; i--) {
    const s = paintShots[i];
    let res = '';
    for (let k = 0; k < 3 && !res; k++) {
      const h = dt / 3;
      s.prev.copy(s.p);
      s.v.y -= 9.3 * h;
      s.p.addScaledVector(s.v, h);
      res = paintHit(s.prev, s.p, _ph);
    }
    if (res) { roomRoot.remove(s.mesh); s.mesh.material.dispose(); paintShots.splice(i, 1); }
    if (res === 'hit') paintSplat(_ph.point.clone(), _ph.normal.clone(), s.color, s.v.clone(), s.child);
    else if (!res) s.mesh.position.copy(s.p);
  }
  for (const sp of paintSplats) sp.age += dt;
}
// Bulles : la peinture fraîche bout. Chaque tache porte quelques bulles qui
// gonflent puis éclatent en boucle, de moins en moins à mesure qu'elle
// refroidit. Une seule géométrie instanciée pour toutes.
const BUBBLE_MAX = 2200, BUBBLES_PER = 26;
const bubbleMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshStandardMaterial({ roughness: 0.18, metalness: 0.0 }), BUBBLE_MAX);
bubbleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
bubbleMesh.count = 0;
bubbleMesh.frustumCulled = false;
bubbleMesh.renderOrder = 20; // après les taches
roomRoot.add(bubbleMesh);
const _bm = new THREE.Matrix4(), _bq = new THREE.Quaternion(), _bs = new THREE.Vector3(), _bo = new THREE.Vector3(), _bc = new THREE.Color();
const bubHash = (n) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };
function paintBubbles() {
  let n = 0;
  if (PAINT.bubbles > 0) {
    for (let i = paintSplats.length - 1; i >= 0 && n < BUBBLE_MAX; i--) {
      const sp = paintSplats[i];
      if (sp.age >= PAINT.life) continue;
      const heat = 1 - sp.age / PAINT.life;
      for (let k = 0, nb = sp.s > 0.8 ? BUBBLES_PER : sp.s > 0.25 ? 5 : 1; k < nb && n < BUBBLE_MAX; k++) {
        const h = sp.seed + k * 7.31;
        // Chaque bulle a son rythme ; les moins « chaudes » s'arrêtent d'abord.
        if (bubHash(h + 3) > heat * 1.15) continue;
        const period = 0.35 + bubHash(h) * 0.7;
        const t = (sp.age / period + bubHash(h + 1)) % 1;
        const cycle = Math.floor(sp.age / period + bubHash(h + 1));
        // Gonfle, puis éclate d'un coup en fin de cycle.
        const grow = t < 0.86 ? Math.pow(t / 0.86, 0.6) : Math.max(0, 1 - (t - 0.86) / 0.05);
        const r = Math.min(sp.s, 0.7) * (0.07 + 0.16 * bubHash(h + cycle * 1.7 + 2)) * grow * Math.min(1.6, PAINT.bubbles) * (0.5 + 0.5 * heat);
        if (r < 0.004) continue;
        const a = bubHash(h + cycle * 3.1 + 4) * Math.PI * 2, d = Math.sqrt(bubHash(h + cycle * 5.3 + 5)) * sp.s * (paintDecals ? 0.55 : 0.85);
        _bo.set(Math.cos(a) * d, Math.sin(a) * d, r * 0.35).applyQuaternion(sp.mesh.quaternion).add(sp.mesh.position);
        // Aplatie contre la surface : une calotte plutôt qu'une bille.
        _bm.compose(_bo, sp.mesh.quaternion, _bs.set(r, r, r * 0.8));
        bubbleMesh.setMatrixAt(n, _bm);
        bubbleMesh.setColorAt(n, _bc.setRGB(sp.r, sp.g, sp.b).lerp(_white, 0.28));
        n++;
      }
    }
  }
  bubbleMesh.count = n;
  if (n) { bubbleMesh.instanceMatrix.needsUpdate = true; if (bubbleMesh.instanceColor) bubbleMesh.instanceColor.needsUpdate = true; }
}
const _white = new THREE.Color(1, 1, 1);
function paintClear() {
  paintDecals?.clear();
  pp.length = 0;
  for (const sp of paintSplats) { roomRoot.remove(sp.mesh); sp.mesh.material.dispose(); }
  paintSplats.length = 0;
}
let paintHeld = false, paintTimer = 0, paintOrder = 0;
// ---- Armes : pistolet, mousquet, hadoken ---------------------------------------
// Les projectiles suivent une vraie trajectoire (gravité pour les balles),
// traversent la fumée en la bousculant sur tout leur parcours, et chaque tir
// crache sa propre fumée : un souffle bref pour le pistolet, un gros nuage
// pour le mousquet, une traînée noire derrière la boule de feu.
// Fumée propre à chaque arme : quantité, densité maximale (opacité),
// perturbation (force des rafales qui la brassent), durée, taille, couleur.
const GUN = {
  speed: 1,
  pistol: { amount: 1, density: 1.33, turb: 1, life: 1, size: 1, color: '#d9d9d9' },
  musket: { amount: 1, density: 1.8, turb: 1, life: 1, size: 1, color: '#e6e0d0' },
  hado: { amount: 1, density: 6, turb: 1, life: 1, size: 1, color: '#030303' },
};
try {
  const sv = JSON.parse(localStorage.getItem('ingaGun2')) || {};
  if (Number.isFinite(sv.speed)) GUN.speed = sv.speed;
  for (const k of ['pistol', 'musket', 'hado']) if (sv[k]) for (const f in GUN[k]) if (typeof sv[k][f] === typeof GUN[k][f]) GUN[k][f] = sv[k][f];
} catch { /* réglages illisibles */ }
const shots = [], puffs = [];
let shotSeq = 5000, musketReady = 0, gunHeld = false, gunTimer = 0;
const tracerGeo = new THREE.CylinderGeometry(0.014, 0.014, 1, 6).rotateX(Math.PI / 2);
const fireGeo = new THREE.SphereGeometry(1, 20, 14);
// Deux lampes en réserve pour les boules de feu (toujours présentes, éteintes
// au repos : en ajouter à la volée ferait recompiler tous les matériaux).
const fireLights = [0, 1].map(() => { const l = new THREE.PointLight('#ff8a2a', 0, 14, 2); roomRoot.add(l); return { light: l, used: false }; });
const _gd = new THREE.Vector3(), _gr = new THREE.Vector3(), _gu = new THREE.Vector3(), _go = new THREE.Vector3();
function muzzle() {
  camera.getWorldDirection(_gd);
  _gr.crossVectors(_gd, camera.up).normalize();
  _gu.crossVectors(_gr, _gd);
  return _go.copy(camera.position).addScaledVector(_gd, 0.75).addScaledVector(_gr, 0.17).addScaledVector(_gu, -0.13);
}
// Bouffée : une source de fumée brève, qui s'éteint toute seule.
function puff(pos, vel, rate, radius, life, color, cap = 1.33) {
  _pc.set(color);
  puffs.push({ x: pos.x, y: pos.y, z: pos.z, jx: vel.x, jy: vel.y, jz: vel.z, rate, radius, life, age: 0, r: _pc.r, g: _pc.g, b: _pc.b, cap });
}
function bang(vol, dur, cutoff) {
  if (!audioCtx) return;
  const ctx = audioCtx, src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  src.buffer = noiseBuffer(ctx, dur, true);
  f.type = 'lowpass'; f.frequency.value = cutoff;
  g.gain.setValueAtTime(vol, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  src.connect(f).connect(g).connect(ctx.destination);
  src.start();
}
function fireGun(kind) {
  const musket = kind === 'musket';
  if (musket) { if (clock.elapsedTime < musketReady) return; musketReady = clock.elapsedTime + 1.5; } // rechargement
  const o = muzzle().clone(), d = _gd.clone();
  const W = GUN[musket ? 'musket' : 'pistol'];
  const c = musket ? { speed: 70, r: 0.42, cap: 26, smoke: 46 * W.amount, sr: 0.55 * W.size, life: 1.0 * W.life, kick: 0.05, col: W.color, len: 0.5, w: 2.2 }
    : { speed: 105, r: 0.26, cap: 20, smoke: 9 * W.amount, sr: 0.28 * W.size, life: 0.35 * W.life, kick: 0.012, col: W.color, len: 0.9, w: 1 };
  const mesh = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: musket ? '#ffd9a0' : '#fff0c8', toneMapped: false }));
  mesh.scale.set(c.w, c.w, c.len);
  roomRoot.add(mesh);
  shots.push({ kind, p: o.clone(), prev: o.clone(), v: d.clone().multiplyScalar(c.speed * GUN.speed).add(_bodySm), age: 0, life: 3, g: 9.3, r: c.r, cap: c.cap, gain: musket ? 1.6 : 1.1, id: ++shotSeq, mesh, dead: 0 });
  // Fumée de bouche : un jet dans l'axe du canon…
  if (c.smoke > 0) puff(o, d.clone().multiplyScalar(musket ? 9 : 6), c.smoke, c.sr, c.life, c.col, W.density);
  // …et, pour le mousquet, le nuage du bassinet qui monte sur le côté.
  if (musket && c.smoke > 0) puff(o.clone().addScaledVector(d, -0.55).addScaledVector(_gu, 0.12), _gu.clone().multiplyScalar(2.2).addScaledVector(_gr, 1.4), c.smoke * 0.45, 0.38 * W.size, 0.7 * W.life, c.col, W.density);
  // La fumée de poudre est vive et tourmentée, bien moins « visqueuse » que le
  // brouillard : des rafales invisibles partent en éventail de la bouche et
  // la brassent pendant une seconde (elles agissent comme des balles d'air),
  // et le nuage est craché en plusieurs bouffées de directions différentes.
  if (c.smoke > 0) {
    for (let k = 0, n = Math.round((musket ? 9 : 2) * Math.min(2, W.turb)); k < n; k++) {
      const r1 = Math.random(), sx = (Math.random() - 0.5) * 2, sy = (Math.random() - 0.5) * 2;
      const gv = d.clone().multiplyScalar((musket ? 5 : 4) + 8 * r1).addScaledVector(_gr, sx * (musket ? 6.5 : 3)).addScaledVector(_gu, sy * (musket ? 5 : 2.5) + 1).multiplyScalar(0.5 + 0.5 * W.turb);
      shots.push({ kind: 'gust', p: o.clone().addScaledVector(d, 0.25 + Math.random() * 0.9).addScaledVector(_gr, sx * 0.25).addScaledVector(_gu, sy * 0.25), prev: o.clone(), v: gv, age: 0, life: (musket ? 0.5 : 0.3) + Math.random() * (musket ? 0.8 : 0.25), g: 0, r: musket ? 0.5 : 0.32, cap: 14, gain: musket ? 2.4 : 1.5, id: ++shotSeq, mesh: null, dead: 0 });
    }
    if (musket) for (let k = 0; k < 4; k++) {
      const jv = d.clone().multiplyScalar(3 + Math.random() * 7).addScaledVector(_gr, (Math.random() - 0.5) * 7).addScaledVector(_gu, (Math.random() - 0.3) * 5);
      puff(o.clone().addScaledVector(d, 0.2 + k * 0.25), jv, c.smoke * 0.3, (0.4 + Math.random() * 0.25) * W.size, (0.45 + Math.random() * 0.6) * W.life, c.col, W.density);
    }
  }
  // Étincelles de poudre à la bouche (et au bassinet pour le mousquet).
  sparkEmit(o, d.x * (musket ? 9 : 6), d.y * (musket ? 9 : 6) + 0.5, d.z * (musket ? 9 : 6), musket ? 5 : 2.5, musket ? 70 : 10, musket ? 0.5 : 0.22);
  pitch = Math.min(1.35, pitch + c.kick);
  bang(musket ? 0.9 : 0.45, musket ? 0.55 : 0.18, musket ? 900 : 2200);
}
// Étincelles : des points incandescents semés derrière la boule de feu (et
// projetés à l'explosion). Ils ralentissent, retombent un peu, pâlissent du
// blanc vers l'orange puis s'éteignent.
const SPARK_MAX = 900;
const sparks = { p: new Float32Array(SPARK_MAX * 3), v: new Float32Array(SPARK_MAX * 3), life: new Float32Array(SPARK_MAX * 2), n: 0 };
const sparkGeo = new THREE.BufferGeometry();
sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparks.p, 3).setUsage(THREE.DynamicDrawUsage));
sparkGeo.setAttribute('aLife', new THREE.BufferAttribute(sparks.life, 2).setUsage(THREE.DynamicDrawUsage));
sparkGeo.setDrawRange(0, 0);
const sparkPoints = new THREE.Points(sparkGeo, new THREE.ShaderMaterial({
  uniforms: { uScale: { value: 600 } },
  vertexShader: `attribute vec2 aLife; uniform float uScale; varying float vT;
    void main() {
      vT = aLife.x / aLife.y; // 1 → 0
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = max(1.5, (0.035 + 0.045 * vT) * uScale / -mv.z);
    }`,
  fragmentShader: `varying float vT;
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float f = max(0.0, 1.0 - dot(c, c) * 4.0);
      vec3 col = mix(vec3(1.0, 0.28, 0.04), vec3(1.0, 0.9, 0.6), vT * vT) * (1.5 + 5.0 * vT);
      gl_FragColor = vec4(col * f * f, 1.0);
    }`,
  blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, toneMapped: false,
}));
sparkPoints.frustumCulled = false;
sparkPoints.renderOrder = 40;
roomRoot.add(sparkPoints);
function sparkEmit(pos, vx, vy, vz, spread, count, life) {
  for (let k = 0; k < count && sparks.n < SPARK_MAX; k++) {
    const i = sparks.n++, a = Math.random() * Math.PI * 2, c = Math.random() * 2 - 1, sn = Math.sqrt(1 - c * c), sp = spread * (0.3 + Math.random());
    sparks.p[i * 3] = pos.x; sparks.p[i * 3 + 1] = pos.y; sparks.p[i * 3 + 2] = pos.z;
    sparks.v[i * 3] = vx + sn * Math.cos(a) * sp; sparks.v[i * 3 + 1] = vy + c * sp; sparks.v[i * 3 + 2] = vz + sn * Math.sin(a) * sp;
    sparks.life[i * 2] = sparks.life[i * 2 + 1] = life * (0.4 + Math.random() * 0.9);
  }
}
function sparksStep(dt) {
  const drag = Math.exp(-2.2 * dt);
  for (let i = sparks.n - 1; i >= 0; i--) {
    const l = sparks.life[i * 2] - dt;
    if (l <= 0) {
      // On comble le trou avec la dernière étincelle.
      const j = --sparks.n;
      for (let c = 0; c < 3; c++) { sparks.p[i * 3 + c] = sparks.p[j * 3 + c]; sparks.v[i * 3 + c] = sparks.v[j * 3 + c]; }
      sparks.life[i * 2] = sparks.life[j * 2]; sparks.life[i * 2 + 1] = sparks.life[j * 2 + 1];
      continue;
    }
    sparks.life[i * 2] = l;
    sparks.v[i * 3] *= drag; sparks.v[i * 3 + 1] = sparks.v[i * 3 + 1] * drag - 3.2 * dt; sparks.v[i * 3 + 2] *= drag;
    sparks.p[i * 3] += sparks.v[i * 3] * dt; sparks.p[i * 3 + 1] = Math.max(0.02, sparks.p[i * 3 + 1] + sparks.v[i * 3 + 1] * dt); sparks.p[i * 3 + 2] += sparks.v[i * 3 + 2] * dt;
  }
  sparkGeo.attributes.position.needsUpdate = true;
  sparkGeo.attributes.aLife.needsUpdate = true;
  sparkGeo.setDrawRange(0, sparks.n);
  sparkPoints.material.uniforms.uScale.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
}
function fireHadoken() {
  const o = muzzle().clone().addScaledVector(_gd, 0.3), d = _gd.clone();
  const mesh = new THREE.Mesh(fireGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff9a2a').multiplyScalar(3.2), toneMapped: false, fog: false }));
  const core = new THREE.Mesh(fireGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff4d0').multiplyScalar(4), toneMapped: false, fog: false }));
  core.scale.setScalar(0.55);
  mesh.add(core);
  mesh.scale.setScalar(0.2);
  roomRoot.add(mesh);
  const slot = fireLights.find((l) => !l.used);
  if (slot) slot.used = true;
  shots.push({ kind: 'hado', p: o.clone(), prev: o.clone(), v: d.clone().multiplyScalar(13), age: 0, life: 3.2, g: 0, r: 0.55, cap: 13, gain: 1.8, id: ++shotSeq, mesh, slot, dead: 0, seed: Math.random() * 10 });
  bang(0.5, 0.5, 500);
}
function shotsStep(dt) {
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    if (s.dead > 0) {
      // Le projectile a fini sa course ; il reste un instant dans la liste
      // pour que la fumée voie son dernier trajet, et que l'éclair s'éteigne.
      s.dead -= dt;
      if (s.slot) s.slot.light.intensity *= Math.max(0, 1 - dt * 9);
      if (s.dead <= 0) { if (s.slot) { s.slot.light.intensity = 0; s.slot.used = false; } shots.splice(i, 1); }
      continue;
    }
    s.age += dt;
    if (s.kind === 'gust') {
      // Rafale : pas de matière, elle ralentit vite puis disparaît.
      s.v.multiplyScalar(Math.exp(-2.6 * dt));
      s.prev.copy(s.p);
      s.p.addScaledVector(s.v, dt);
      // Rafale « glissante » : contre un mur elle garde sa vitesse, déviée le long de la paroi.
      if (s.wall && paintHit(s.prev, s.p, _ph) === 'hit') {
        const n = _ph.normal, sp = s.v.length();
        s.p.copy(_ph.point).addScaledVector(n, 0.35);
        s.v.addScaledVector(n, -s.v.dot(n));
        if (s.v.lengthSq() < 0.04 * sp * sp) s.v.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).addScaledVector(n, -(s.v.dot(n)));
        s.v.setLength(sp);
      }
      if (s.age > s.life) shots.splice(i, 1);
      continue;
    }
    let res = s.age > s.life ? 'lost' : '';
    const steps = Math.max(1, Math.ceil(s.v.length() * dt / 0.45));
    for (let k = 0; k < steps && !res; k++) {
      const h = dt / steps;
      s.prev.copy(s.p);
      s.v.y -= s.g * h;
      s.p.addScaledVector(s.v, h);
      res = paintHit(s.prev, s.p, _ph);
    }
    if (res) {
      if (res === 'hit') {
        s.p.copy(_ph.point);
        const n = _ph.normal, at = _ph.point.clone().addScaledVector(n, 0.25);
        if (s.kind === 'hado') {
          // Explosion : un gros champignon de fumée noire, un cœur orangé.
          const H = GUN.hado;
          puff(at, n.clone().multiplyScalar(3), 150 * H.amount, 1.1 * H.size, 0.55 * H.life, H.color, H.density);
          puff(at, n.clone().multiplyScalar(1.5), 14 * H.amount, 0.6 * H.size, 0.3, '#5a3a22');
          if (s.slot) { s.slot.light.position.copy(at); s.slot.light.intensity = 160; }
          sparkEmit(at, n.x * 3, n.y * 3 + 1.5, n.z * 3, 7, 140, 1.1); // gerbe d'étincelles
          // Souffle de l'explosion : des rafales en étoile qui font bouillonner le nuage.
          for (let k = 0; k < 10; k++) {
            _gr.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar((6 + Math.random() * 8) * H.turb).addScaledVector(n, 4);
            shots.push({ kind: 'gust', p: at.clone(), prev: at.clone(), v: _gr.clone(), age: 0, life: 0.4 + Math.random() * 0.7, g: 0, r: 0.6, cap: 16, gain: 2.8, id: ++shotSeq, mesh: null, dead: 0 });
          }
          bang(0.8, 0.7, 380);
        } else puff(at, n.clone().multiplyScalar(1.6), 4, 0.25, 0.22, '#b8b2a6'); // poussière d'impact
      }
      roomRoot.remove(s.mesh);
      s.mesh.traverse((m) => m.material?.dispose());
      s.v.set(0, 0, 0);
      s.dead = s.kind === 'hado' ? 0.45 : 0.15;
      continue;
    }
    s.mesh.position.copy(s.p);
    if (s.kind === 'hado') {
      // La boule palpite ; sa lampe la suit et éclaire la fumée alentour.
      const fl = 0.85 + 0.15 * Math.sin(s.age * 38 + s.seed) + 0.1 * Math.sin(s.age * 61);
      s.mesh.scale.setScalar(0.2 * fl * Math.min(1, s.age * 8 + 0.3));
      if (s.slot) { s.slot.light.position.copy(s.p); s.slot.light.intensity = 46 * fl; }
      // Étincelles semées dans le sillage, là où naît la fumée noire.
      s.sparkAcc = (s.sparkAcc || 0) + dt * 170;
      const ns = s.sparkAcc | 0;
      s.sparkAcc -= ns;
      if (ns) sparkEmit(s.p, s.v.x * 0.35, s.v.y * 0.35 + 0.4, s.v.z * 0.35, 1.9, ns, 0.75);
      // Grande traînée noire : la boule sème derrière elle, tous les 55 cm,
      // des foyers qui continuent de fumer épais pendant près d'une seconde.
      s.trail = (s.trail ?? 0.55) + s.v.length() * dt;
      while (s.trail >= 0.55) {
        s.trail -= 0.55;
        // Chaque foyer part dans sa propre direction, un peu à côté de l'axe :
        // des paquets de fumée distincts, pas un ruban continu.
        _go.set((Math.random() - 0.5) * 5, (Math.random() - 0.3) * 4.5, (Math.random() - 0.5) * 5).addScaledVector(s.v, 0.1);
        const at = s.p.clone().add(_gr.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.5));
        const H = GUN.hado;
        puff(at, _go.multiplyScalar(0.4 + 0.6 * H.turb), (60 + Math.random() * 70) * H.amount, (0.45 + Math.random() * 0.4) * H.size, (0.5 + Math.random() * 0.6) * H.life, H.color, H.density);
        // Perturbation : une rafale invisible, en travers, brasse le sillage
        // et le déchire en volutes.
        _gr.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar((5 + Math.random() * 7) * H.turb).addScaledVector(s.v, 0.15);
        if (H.turb > 0) shots.push({ kind: 'gust', p: at.clone(), prev: at.clone(), v: _gr.clone(), age: 0, life: 0.35 + Math.random() * 0.7, g: 0, r: 0.5, cap: 14, gain: 2.6, id: ++shotSeq, mesh: null, dead: 0 });
      }
    } else s.mesh.lookAt(_go.copy(s.p).add(s.v));
  }
  for (let i = puffs.length - 1; i >= 0; i--) { puffs[i].age += dt; if (puffs[i].age >= puffs[i].life) puffs.splice(i, 1); }
}
// ---- Gomme de fumée ------------------------------------------------------------
// Un tir de nuage qui se comporte comme une boule de gomme : une sphère
// invisible, remplie d'une fumée très visqueuse (figée dans la boule), qui
// file en accélérant puis se colle à ce qu'elle touche pendant quelques
// secondes. Cette sphère est solide pour le joueur : on peut s'y accrocher,
// grimper dessus et s'y tenir — en vol comme une fois collée.
const GUM = { smoke: 1, density: 2.6, size: 1.2, speed: 9, stick: 60, color: '#ffffff' };
// Silhouette de nuage : un corps et des bosses (base plate, dessus bombé),
// en fractions du rayon. La fumée y est déposée bosse après bosse.
const GUM_LOBES = [[0, 0, 0, 0.8], [0.8, -0.12, 0.1, 0.6], [-0.75, -0.15, -0.1, 0.62], [0.3, 0.42, 0.25, 0.6], [-0.35, 0.32, -0.3, 0.55], [0.05, -0.1, 0.7, 0.52], [-0.1, -0.08, -0.72, 0.5], [1.25, -0.25, -0.05, 0.4], [-1.2, -0.28, 0.15, 0.42]];
try { const sv = JSON.parse(localStorage.getItem('ingaGum4')) || {}; for (const k in GUM) if (typeof sv[k] === typeof GUM[k]) GUM[k] = sv[k]; } catch { /* réglages illisibles */ }
const gums = [];
let gumRide = null; // la gomme sur laquelle le joueur se tient
function throwGum() {
  camera.getWorldDirection(_ballDir);
  if (gums.length >= 30) gums.shift();
  const r = GUM.size;
  const g = { id: ++shotSeq, p: camera.position.clone().addScaledVector(_ballDir, 0.7 + r), prev: new THREE.Vector3(), v: new THREE.Vector3(), vt: _ballDir.clone().multiplyScalar(GUM.speed), age: 0, r, stuck: false, t: 0 };
  g.v.copy(g.vt).multiplyScalar(0.3);
  gums.push(g);
  if (GUM.smoke > 0) puff(g.p, g.vt.clone().multiplyScalar(0.4), 80 * GUM.smoke, r * 0.9, 0.22, GUM.color, GUM.density);
}
function gumsStep(dt) {
  for (let i = gums.length - 1; i >= 0; i--) {
    const g = gums[i];
    g.age += dt;
    if (g.stuck) {
      // Collée : elle tient quelques secondes, puis lâche.
      g.t += dt;
      if (g.t > GUM.stick) { if (gumRide === g) gumRide = null; gums.splice(i, 1); }
      continue;
    }
    // En vol : même élan que le tir de nuage (départ lent, accélération).
    g.vt.multiplyScalar(Math.exp(-0.4 * dt));
    const k = Math.min(1, g.age / 0.4);
    g.v.copy(g.vt).multiplyScalar(0.3 + 0.7 * k * k * (3 - 2 * k));
    g.prev.copy(g.p);
    g.p.addScaledVector(g.v, dt);
    // Le joueur debout dessus est emporté.
    if (gumRide === g) { camera.position.addScaledVector(g.v, dt); _prevStepX += g.v.x * dt; _prevStepZ += g.v.z * dt; }
    // Les gommes se collent aussi entre elles : on peut bâtir un amas, un
    // escalier, un pont, en les lançant les unes sur les autres.
    let glued = false;
    for (const o of gums) {
      if (o === g || !o.stuck) continue;
      const d = g.p.distanceTo(o.p), touch = (g.r + o.r) * 0.8;
      if (d < touch) {
        // Posée contre l'autre, sans s'y enfoncer.
        if (d > 1e-3) g.p.sub(o.p).multiplyScalar(touch / d).add(o.p);
        g.v.set(0, 0, 0);
        g.stuck = true; g.t = 0; glued = true;
        break;
      }
    }
    if (glued) continue;
    const res = paintHit(g.prev, g.p, _ph);
    if (res === 'hit') {
      // Elle se colle : le centre reste un peu en retrait de la surface.
      const dy = g.p.y;
      g.p.copy(_ph.point).addScaledVector(_ph.normal, g.r * 0.55);
      if (gumRide === g) camera.position.y += g.p.y - dy;
      g.v.set(0, 0, 0);
      g.stuck = true; g.t = 0;
    } else if (res === 'lost' || g.age > 8 || g.vt.length() < 0.6) { if (gumRide === g) gumRide = null; gums.splice(i, 1); }
  }
}
// Prise à portée : la surface d'une gomme à moins d'un bras. Renvoie la
// hauteur d'yeux quand on se tient debout sur son sommet.
const _gumHold = { top: 0 };
function gumHold() {
  let top = -Infinity;
  const c = camera.position, feet = c.y - 1.58;
  for (const g of gums) {
    const d = Math.hypot(g.p.x - c.x, g.p.z - c.z);
    if (d > g.r + 0.9 || feet > g.p.y + g.r - 0.05 || c.y < g.p.y - g.r - 0.4) continue;
    top = Math.max(top, g.p.y + g.r + 1.58);
  }
  if (top === -Infinity) return null;
  _gumHold.top = top;
  return _gumHold;
}
// Sol offert par les gommes : le dessus de la sphère sous les pieds.
function gumFloor(x, z, feet) {
  let best = -Infinity, on = null;
  for (const g of gums) {
    const d2 = (g.p.x - x) ** 2 + (g.p.z - z) ** 2, r2 = (g.r * 0.92) ** 2;
    if (d2 >= r2) continue;
    const top = g.p.y + Math.sqrt(g.r * g.r - d2);
    if (top <= feet + 0.5 && top > best) { best = top; on = g; }
  }
  gumFloorOn = on;
  return best;
}
let gumFloorOn = null;
function gumsClear() { gums.length = 0; gumRide = null; }
// ---- Tornade de fumée ----------------------------------------------------------
// Un tourbillon vertical de fumée blanche qui file droit devant en rasant le
// sol : il enroule sa propre fumée en entonnoir, avale celle qu'il croise, et
// laisse un sillage brassé. Il s'arrête contre un mur.
const TORN = { size: 1.1, speed: 11, life: 2.2, swirl: 13, smoke: 1, height: 4.5, color: '#ffffff' };
try { const sv = JSON.parse(localStorage.getItem('ingaTornado')) || {}; for (const k in TORN) if (typeof sv[k] === typeof TORN[k]) TORN[k] = sv[k]; } catch { /* réglages illisibles */ }
const tornados = [];
function throwTornado() {
  camera.getWorldDirection(_ballDir);
  _ballDir.y = 0;
  if (_ballDir.lengthSq() < 1e-6) return;
  _ballDir.normalize();
  if (tornados.length >= 2) tornados.shift();
  const feet = camera.position.y - 1.58;
  tornados.push({ p: new THREE.Vector3(camera.position.x, feet, camera.position.z).addScaledVector(_ballDir, 1.4 + TORN.size), dir: _ballDir.clone(), v: new THREE.Vector3(), age: 0, gust: 0, dying: 0 });
  bang(0.35, 0.9, 700);
}
const _tA = new THREE.Vector3(), _tB = new THREE.Vector3();
function tornadosStep(dt) {
  for (let i = tornados.length - 1; i >= 0; i--) {
    const t = tornados[i];
    t.age += dt;
    if (t.dying > 0) { t.dying -= dt; if (t.dying <= 0) tornados.splice(i, 1); continue; }
    // Avance en suivant le sol ; un obstacle à hauteur de poitrine l'arrête.
    // Elle se lève sur place (0,3 s) puis s'élance en accélérant.
    { const e = Math.min(1, Math.max(0, (t.age - 0.12) / 0.45)); t.v.copy(t.dir).multiplyScalar(TORN.speed * (0.08 + 0.92 * e * e * (3 - 2 * e))); }
    _tA.set(t.p.x, t.p.y + 1.0, t.p.z);
    t.p.addScaledVector(t.v, dt);
    t.p.y = level === 'brutal' ? (brutal.ground(t.p.x, t.p.y + 1.2, t.p.z) ?? t.p.y) : Math.max(hallGround(t.p.x, t.p.z).y, builder.floorAt(t.p.x, t.p.z, t.p.y));
    _tB.set(t.p.x, t.p.y + 1.0, t.p.z);
    const res = paintHit(_tA, _tB, _ph);
    if (res || t.age > TORN.life) {
      // Elle se défait, mais sa fumée garde son élan : le champ continue de
      // la pousser (avance + rotation) pendant qu'il s'efface, et des rafales
      // transmettent cette vitesse au solveur — elle va s'écraser sur le mur.
      t.dying = 0.9;
      // Contre un mur, l'élan de la colonne part le long de la paroi.
      if (res === 'hit') { const n = _ph.normal, sp = t.v.length(); t.v.addScaledVector(n, -t.v.dot(n)); t.v.y = 0; if (t.v.lengthSq() > 0.02 * sp * sp) t.v.setLength(sp * 0.7); else t.v.set(0, 0, 0); }
      const fwd = t.dir.clone().multiplyScalar(TORN.speed);
      for (let k = 0; k < 14; k++) {
        const a = Math.random() * Math.PI * 2, hy = (k + Math.random()) / 14, R = TORN.size * (0.3 + 0.95 * Math.pow(hy, 1.5));
        const at = new THREE.Vector3(t.p.x + Math.cos(a) * R, t.p.y + hy * TORN.height, t.p.z + Math.sin(a) * R);
        const gv = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(TORN.swirl * 0.6).add(fwd);
        shots.push({ kind: 'gust', p: at, prev: at.clone(), v: gv, age: 0, life: 0.7 + Math.random() * 0.7, wall: true, g: 0, r: 0.7, cap: 16, gain: 2.0, id: ++shotSeq, mesh: null, dead: 0 });
      }
      continue;
    }
    // Sillage : des rafales tangentielles laissent l'air tourner derrière elle.
    t.gust += dt;
    while (t.gust > 0.07) {
      t.gust -= 0.07;
      const a = Math.random() * Math.PI * 2, h = Math.random() * TORN.height, R = TORN.size * (0.3 + 0.95 * Math.pow(h / TORN.height, 1.5));
      const at = new THREE.Vector3(t.p.x + Math.cos(a) * R, t.p.y + h, t.p.z + Math.sin(a) * R);
      const gv = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(TORN.swirl * 0.8).addScaledVector(t.v, 0.4);
      shots.push({ kind: 'gust', p: at, prev: at.clone(), v: gv, age: 0, life: 0.3 + Math.random() * 0.4, g: 0, r: 0.5, cap: 16, gain: 2.0, id: ++shotSeq, mesh: null, dead: 0 });
    }
  }
}
// ---- Outils du joueur : 1 à 8 ou la molette pour choisir, clic pour utiliser
const TOOLS = [
  { id: 'ball', name: 'BALLE', use: throwBall },
  { id: 'air', name: 'BOULE D\'AIR', use: throwAir },
  { id: 'paint', name: 'PEINTURE', use: () => { shootPaint(); paintHeld = true; paintTimer = 0; } },
  { id: 'pistol', name: 'PISTOLET', use: () => { fireGun('pistol'); gunHeld = true; gunTimer = 0; } },
  { id: 'musket', name: 'MOUSQUET', use: () => fireGun('musket') },
  { id: 'hado', name: 'HADOKEN', use: fireHadoken },
  { id: 'gum', name: 'GOMME', use: throwGum },
  { id: 'torn', name: 'TORNADE', use: throwTornado },
];
window.addEventListener('mouseup', () => { paintHeld = false; gunHeld = false; });
let toolIndex = 0;
try { toolIndex = Math.max(0, TOOLS.findIndex((t) => t.id === localStorage.getItem('ingaTool'))); } catch { /* stockage indisponible */ }
const toolHud = document.createElement('div');
toolHud.style.cssText = 'position:fixed;bottom:26px;right:18px;z-index:8;display:none;gap:6px;font:10px "DM Sans",sans-serif;letter-spacing:.14em;color:#e4e8de';
document.body.append(toolHud);
function setTool(i) {
  toolIndex = (i + TOOLS.length) % TOOLS.length;
  try { localStorage.setItem('ingaTool', TOOLS[toolIndex].id); } catch { /* quota */ }
  toolHud.textContent = '';
  TOOLS.forEach((t, k) => {
    const d = document.createElement('div');
    d.textContent = `${k + 1} · ${t.name}`;
    d.style.cssText = `padding:7px 10px;border-radius:5px;border:1px solid #ffffff${k === toolIndex ? '88' : '2a'};background:${k === toolIndex ? '#f5f0e933' : '#10151266'};opacity:${k === toolIndex ? 1 : 0.6};backdrop-filter:blur(8px)`;
    toolHud.append(d);
  });
}
setTool(toolIndex);
const toolsActive = () => inRoom() && started && !fogBrush.open && !smokeSrcUI.open && !builder.ui.open && document.pointerLockElement === renderer.domElement;
renderer.domElement.addEventListener('mousedown', (e) => { if (e.button === 0 && toolsActive()) { TOOLS[toolIndex].use(); avatarAct(TOOLS[toolIndex].id); } });
window.addEventListener('keydown', (e) => {
  if (e.repeat || e.target instanceof HTMLInputElement || !inRoom() || !started) return;
  const k = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8'].indexOf(e.code);
  if (k >= 0) setTool(k);
});
window.addEventListener('wheel', (e) => { if (toolsActive()) setTool(toolIndex + (e.deltaY > 0 ? 1 : -1)); });
const _bodyPrev = new THREE.Vector3(), _bodyVel = new THREE.Vector3(), _bodySm = new THREE.Vector3();
if (fogPass) {
  fogPass.uniforms.uSmokeVol.value = bacFogTex;
  fogPass.uniforms.uSmokeMin.value = FL.min;
  fogPass.uniforms.uSmokeInv.value = BAC_FOG_INV;
}
// FFT 3D complexe radix-2, tables précalculées, lignes copiées dans un tampon
// contigu (les accès à grand pas restent bon marché à n=32).
const fft3 = (() => {
  const n = FL.n, bits = Math.round(Math.log2(n));
  const rev = new Uint16Array(n);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b); rev[i] = r; }
  const cosT = new Float64Array(n / 2), sinT = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cosT[i] = Math.cos(2 * Math.PI * i / n); sinT[i] = Math.sin(2 * Math.PI * i / n); }
  const lr = new Float64Array(n), li = new Float64Array(n);
  function axis(re, im, stepI, stepJ, stepK, dir) {
    for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) {
      const base = j * stepJ + k * stepK;
      for (let i = 0; i < n; i++) { const o = base + rev[i] * stepI; lr[i] = re[o]; li[i] = im[o]; }
      for (let len = 2; len <= n; len <<= 1) {
        const half = len >> 1, ts = n / len;
        for (let s = 0; s < n; s += len) for (let q = 0; q < half; q++) {
          const c = cosT[q * ts], sn = dir * sinT[q * ts];
          const a = s + q, b = a + half;
          const xr = lr[b] * c - li[b] * sn, xi = lr[b] * sn + li[b] * c;
          lr[b] = lr[a] - xr; li[b] = li[a] - xi;
          lr[a] += xr; li[a] += xi;
        }
      }
      for (let i = 0; i < n; i++) { const o = base + i * stepI; re[o] = lr[i]; im[o] = li[i]; }
    }
  }
  return (re, im, dir) => {
    axis(re, im, 1, n, n * n, dir);
    axis(re, im, n, 1, n * n, dir);
    axis(re, im, n * n, 1, n, dir);
    if (dir < 0) { const s = 1 / (n * n * n); for (let i = 0; i < re.length; i++) { re[i] *= s; im[i] *= s; } }
  };
})();
// Tampons de vitesse supplémentaires (demi-pas, pré-projection, MacCormack)
// et densité vue par la grille de vitesse (grille fine ou particules).
const flPa = new Float32Array(flN3), flPb = new Float32Array(flN3), flPc = new Float32Array(flN3);
const flTa = new Float32Array(flN3), flTb = new Float32Array(flN3), flTc = new Float32Array(flN3);
const flQa = new Float32Array(flN3), flQb = new Float32Array(flN3), flQc = new Float32Array(flN3);
const flRho = new Float32Array(flN3);
// -- Particules de vorticité (Selle et al. 2005) : chacune porte un vecteur
// tourbillon ω, suit l'écoulement et fait tourner le fluide autour d'elle.
const VP_MAX = 96;
const vpPos = new Float32Array(VP_MAX * 3), vpW = new Float32Array(VP_MAX * 3);
let vpCount = 0;
const _fs = new Float32Array(3);
// Vitesse (trilinéaire) en un point monde → _fs.
function flSample(wx, wy, wz) {
  const n = FL.n, n2 = n * n, nc = n - 1.001;
  const gx = flClamp((wx - FL.min.x) / FL.h.x - 0.5, 0, nc);
  const gy = flClamp((wy - FL.min.y) / FL.h.y - 0.5, 0, nc);
  const gz = flClamp((wz - FL.min.z) / FL.h.z - 0.5, 0, nc);
  const x0 = gx | 0, fx = gx - x0, y0 = gy | 0, fy = gy - y0, z0 = gz | 0, fz = gz - z0;
  const a0 = x0 + n * y0 + n2 * z0, a1 = a0 + n, a2 = a0 + n2, a3 = a1 + n2;
  const q000 = (1 - fx) * (1 - fy) * (1 - fz), q100 = fx * (1 - fy) * (1 - fz);
  const q010 = (1 - fx) * fy * (1 - fz), q110 = fx * fy * (1 - fz);
  const q001 = (1 - fx) * (1 - fy) * fz, q101 = fx * (1 - fy) * fz;
  const q011 = (1 - fx) * fy * fz, q111 = fx * fy * fz;
  _fs[0] = flU[a0] * q000 + flU[a0 + 1] * q100 + flU[a1] * q010 + flU[a1 + 1] * q110 + flU[a2] * q001 + flU[a2 + 1] * q101 + flU[a3] * q011 + flU[a3 + 1] * q111;
  _fs[1] = flV[a0] * q000 + flV[a0 + 1] * q100 + flV[a1] * q010 + flV[a1 + 1] * q110 + flV[a2] * q001 + flV[a2 + 1] * q101 + flV[a3] * q011 + flV[a3 + 1] * q111;
  _fs[2] = flW[a0] * q000 + flW[a0 + 1] * q100 + flW[a1] * q010 + flW[a1 + 1] * q110 + flW[a2] * q001 + flW[a2 + 1] * q101 + flW[a3] * q011 + flW[a3 + 1] * q111;
}
function vortexStep(dt) {
  const n = FL.n, R = 3.2;
  const fade = Math.max(0, 1 - 0.12 * dt);
  for (let k = vpCount - 1; k >= 0; k--) {
    const o = k * 3;
    flSample(vpPos[o], vpPos[o + 1], vpPos[o + 2]);
    vpPos[o] += _fs[0] * dt; vpPos[o + 1] += _fs[1] * dt; vpPos[o + 2] += _fs[2] * dt;
    vpW[o] *= fade; vpW[o + 1] *= fade; vpW[o + 2] *= fade;
    const px = vpPos[o], py = vpPos[o + 1], pz = vpPos[o + 2];
    const out = px < FL.min.x + 2 || px > FL.min.x + FL.size.x - 2 || py < 0.2 || py > FL.min.y + FL.size.y - 2 || pz < FL.min.z + 2 || pz > FL.min.z + FL.size.z - 2;
    if (out || Math.hypot(vpW[o], vpW[o + 1], vpW[o + 2]) < 0.4) {
      const l = --vpCount * 3;
      for (let c = 0; c < 3; c++) { vpPos[o + c] = vpPos[l + c]; vpW[o + c] = vpW[l + c]; }
      continue;
    }
    // Force de rotation ω × r, pondérée par un noyau compact.
    const wx = vpW[o], wy = vpW[o + 1], wz = vpW[o + 2];
    const x0 = Math.max(1, ((px - R - FL.min.x) / FL.h.x - 0.5) | 0), x1 = Math.min(n - 2, Math.ceil((px + R - FL.min.x) / FL.h.x - 0.5));
    const y0 = Math.max(1, ((py - R - FL.min.y) / FL.h.y - 0.5) | 0), y1 = Math.min(n - 2, Math.ceil((py + R - FL.min.y) / FL.h.y - 0.5));
    const z0 = Math.max(1, ((pz - R - FL.min.z) / FL.h.z - 0.5) | 0), z1 = Math.min(n - 2, Math.ceil((pz + R - FL.min.z) / FL.h.z - 0.5));
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const rx = flWxA[x] - px, ry = flWyA[y] - py, rz = flWzA[z] - pz;
      const d2 = (rx * rx + ry * ry + rz * rz) / (R * R);
      if (d2 >= 1) continue;
      const f = dt * (1 - d2) * (1 - d2);
      const i = x + n * (y + n * z);
      flU[i] += f * (wy * rz - wz * ry);
      flV[i] += f * (wz * rx - wx * rz);
      flW[i] += f * (wx * ry - wy * rx);
    }
  }
}
function vortexSeed(px, py, pz, r, count) {
  for (let k = 0; k < count && vpCount < VP_MAX; k++) {
    const o = vpCount++ * 3;
    const a = Math.random() * Math.PI * 2, c = Math.random() * 2 - 1, sn = Math.sqrt(1 - c * c), rr = r * Math.cbrt(Math.random());
    vpPos[o] = px + rr * sn * Math.cos(a); vpPos[o + 1] = py + rr * c; vpPos[o + 2] = pz + rr * sn * Math.sin(a);
    const b = Math.random() * Math.PI * 2, e = Math.random() * 2 - 1, se = Math.sqrt(1 - e * e), m = 2.5 + Math.random() * 3.5;
    vpW[o] = m * se * Math.cos(b); vpW[o + 1] = m * e; vpW[o + 2] = m * se * Math.sin(b);
  }
}
function bacAddForces(dt) {
  const n = FL.n;
  // Poids : la fumée dense tire la colonne d'air vers le bas.
  const g = FL.weight * dt / 255;
  for (let i = 0; i < flN3; i++) { const d = flRho[i]; if (d > 1) flV[i] -= d * g; }
  if (flAlgo.vortex) vortexStep(dt);
  // Confinement de vorticité : repousse l'énergie vers les tourbillons que
  // l'advection semi-lagrangienne et le filtre spectral dissipent.
  const n2 = n * n, ix2 = 0.5 / FL.h.x, iy2 = 0.5 / FL.h.y, iz2 = 0.5 / FL.h.z;
  for (let z = 1; z < n - 1; z++) for (let y = 1; y < n - 1; y++) {
    let j = 1 + n * y + n2 * z;
    for (let x = 1; x < n - 1; x++, j++) {
      const cx = (flW[j + n] - flW[j - n]) * iy2 - (flV[j + n2] - flV[j - n2]) * iz2;
      const cy = (flU[j + n2] - flU[j - n2]) * iz2 - (flW[j + 1] - flW[j - 1]) * ix2;
      const cz = (flV[j + 1] - flV[j - 1]) * ix2 - (flU[j + n] - flU[j - n]) * iy2;
      flCx[j] = cx; flCy[j] = cy; flCz[j] = cz;
      flCm[j] = Math.sqrt(cx * cx + cy * cy + cz * cz);
    }
  }
  const s = FL.swirl * dt;
  for (let z = 1; z < n - 1; z++) for (let y = 1; y < n - 1; y++) {
    let j = 1 + n * y + n2 * z;
    for (let x = 1; x < n - 1; x++, j++) {
      let gx = (flCm[j + 1] - flCm[j - 1]) * ix2;
      let gy = (flCm[j + n] - flCm[j - n]) * iy2;
      let gz = (flCm[j + n2] - flCm[j - n2]) * iz2;
      const m = Math.sqrt(gx * gx + gy * gy + gz * gz) + 1e-6;
      gx /= m; gy /= m; gz /= m;
      flU[j] += s * (gy * flCz[j] - gz * flCy[j]);
      flV[j] += s * (gz * flCx[j] - gx * flCz[j]);
      flW[j] += s * (gx * flCy[j] - gy * flCx[j]);
    }
  }
}
// Advection semi-lagrangienne (inconditionnellement stable) du champ s par le
// champ porteur c, vers d (d ≠ s).
function flAdvect(sU, sV, sW, cU, cV, cW, dt, dU, dV, dW) {
  const n = FL.n, n2 = n * n, nc = n - 1.001;
  const sx = dt / FL.h.x, sy = dt / FL.h.y, sz = dt / FL.h.z;
  let i = 0;
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++, i++) {
    const gx = flClamp(x - cU[i] * sx, 0, nc);
    const gy = flClamp(y - cV[i] * sy, 0, nc);
    const gz = flClamp(z - cW[i] * sz, 0, nc);
    const x0 = gx | 0, fx = gx - x0, y0 = gy | 0, fy = gy - y0, z0 = gz | 0, fz = gz - z0;
    const a0 = x0 + n * y0 + n2 * z0, a1 = a0 + n, a2 = a0 + n2, a3 = a1 + n2;
    const q000 = (1 - fx) * (1 - fy) * (1 - fz), q100 = fx * (1 - fy) * (1 - fz);
    const q010 = (1 - fx) * fy * (1 - fz), q110 = fx * fy * (1 - fz);
    const q001 = (1 - fx) * (1 - fy) * fz, q101 = fx * (1 - fy) * fz;
    const q011 = (1 - fx) * fy * fz, q111 = fx * fy * fz;
    dU[i] = sU[a0] * q000 + sU[a0 + 1] * q100 + sU[a1] * q010 + sU[a1 + 1] * q110 + sU[a2] * q001 + sU[a2 + 1] * q101 + sU[a3] * q011 + sU[a3 + 1] * q111;
    dV[i] = sV[a0] * q000 + sV[a0 + 1] * q100 + sV[a1] * q010 + sV[a1 + 1] * q110 + sV[a2] * q001 + sV[a2 + 1] * q101 + sV[a3] * q011 + sV[a3 + 1] * q111;
    dW[i] = sW[a0] * q000 + sW[a0 + 1] * q100 + sW[a1] * q010 + sW[a1 + 1] * q110 + sW[a2] * q001 + sW[a2 + 1] * q101 + sW[a3] * q011 + sW[a3 + 1] * q111;
  }
}
// Correction MacCormack : d contient l'aller, flQ* l'aller-retour ; la
// correction (s − aller-retour)/2 est bornée à l'intervalle des 8 voisins
// d'origine du point de départ (limiteur : pas d'oscillations).
function flMacCorrect(sU, sV, sW, cU, cV, cW, dt, dU, dV, dW) {
  const n = FL.n, n2 = n * n, nc = n - 1.001;
  const sx = dt / FL.h.x, sy = dt / FL.h.y, sz = dt / FL.h.z;
  let i = 0;
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++, i++) {
    const a0 = (flClamp(x - cU[i] * sx, 0, nc) | 0) + n * (flClamp(y - cV[i] * sy, 0, nc) | 0) + n2 * (flClamp(z - cW[i] * sz, 0, nc) | 0);
    const a1 = a0 + n, a2 = a0 + n2, a3 = a1 + n2;
    let v, mn, mx, r;
    v = sU[a0]; mn = v; mx = v;
    v = sU[a0 + 1]; mn = Math.min(mn, v); mx = Math.max(mx, v);
    v = sU[a1]; mn = Math.min(mn, v); mx = Math.max(mx, v);
    v = sU[a1 + 1]; mn = Math.min(mn, v); mx = Math.max(mx, v);
    v = sU[a2]; mn = Math.min(mn, v); mx = Math.max(mx, v);
    v = sU[a2 + 1]; mn = Math.min(mn, v); mx = Math.max(mx, v);
    v = sU[a3]; mn = Math.min(mn, v); mx = Math.max(mx, v);
    v = sU[a3 + 1]; mn = Math.min(mn, v); mx = Math.max(mx, v);
    r = dU[i] + 0.5 * (sU[i] - flQa[i]);
    dU[i] = Math.min(mx, Math.max(mn, r));
    v = sV[a0]; mn = v; mx = v;
    v = sV[a0 + 1]; mn = Math.min(mn, v); mx = Math.max(mx, v);
    v = sV[a1]; mn = Math.min(mn, v); mx = Math.max(mx, v);
    v = sV[a1 + 1]; mn = Math.min(mn, v); mx = Math.max(mx, v);
    v = sV[a2]; mn = Math.min(mn, v); mx = Math.max(mx, v);
    v = sV[a2 + 1]; mn = Math.min(mn, v); mx = Math.max(mx, v);
    v = sV[a3]; mn = Math.min(mn, v); mx = Math.max(mx, v);
    v = sV[a3 + 1]; mn = Math.min(mn, v); mx = Math.max(mx, v);
    r = dV[i] + 0.5 * (sV[i] - flQb[i]);
    dV[i] = Math.min(mx, Math.max(mn, r));
    v = sW[a0]; mn = v; mx = v;
    v = sW[a0 + 1]; mn = Math.min(mn, v); mx = Math.max(mx, v);
    v = sW[a1]; mn = Math.min(mn, v); mx = Math.max(mx, v);
    v = sW[a1 + 1]; mn = Math.min(mn, v); mx = Math.max(mx, v);
    v = sW[a2]; mn = Math.min(mn, v); mx = Math.max(mx, v);
    v = sW[a2 + 1]; mn = Math.min(mn, v); mx = Math.max(mx, v);
    v = sW[a3]; mn = Math.min(mn, v); mx = Math.max(mx, v);
    v = sW[a3 + 1]; mn = Math.min(mn, v); mx = Math.max(mx, v);
    r = dW[i] + 0.5 * (sW[i] - flQc[i]);
    dW[i] = Math.min(mx, Math.max(mn, r));
  }
}
// MacCormack (Selle et al. 2008) : aller, retour, puis correction limitée.
function flAdvectMac(sU, sV, sW, cU, cV, cW, dt, dU, dV, dW) {
  flAdvect(sU, sV, sW, cU, cV, cW, dt, dU, dV, dW);
  flAdvect(dU, dV, dW, cU, cV, cW, -dt, flQa, flQb, flQc);
  flMacCorrect(sU, sV, sW, cU, cV, cW, dt, dU, dV, dW);
}
// Fourier : diffusion implicite (passe-bas 1/(1+ν·dt·k²)) puis projection sur
// le plan orthogonal à k — c'est elle qui rend le champ incompressible et
// fait naître les volutes. En place, puis masques de parois.
function flProject(a, b, c, vdt) {
  // u et v, réels, voyagent dans UNE transformée complexe z = u + i·v
  // (U = (Z(k) + Z*(−k))/2, V = (Z(k) − Z*(−k))/2i) : deux FFT 3D par sens
  // au lieu de trois. Les modes k et −k, conjugués, sont traités par paire.
  const n = FL.n;
  flWi.fill(0);
  fft3(a, b, 1); fft3(c, flWi, 1);
  for (let z = 0; z < n; z++) { const kz = flKz[z], zj = ((n - z) % n) * n * n; for (let y = 0; y < n; y++) { const ky = flKy[y], kyz = ky * ky + kz * kz, yj = ((n - y) % n) * n + zj; const row = n * (y + n * z); for (let x = 0; x < n; x++) {
    const i = x + row, j = ((n - x) % n) + yj;
    if (j < i) continue;
    const kx = flKx[x], k2 = kx * kx + kyz;
    const f = 1 / (1 + vdt * k2);
    let ur = 0.5 * (a[i] + a[j]) * f, ui = 0.5 * (b[i] - b[j]) * f;
    let vr = 0.5 * (b[i] + b[j]) * f, vi = -0.5 * (a[i] - a[j]) * f;
    let wr = c[i] * f, wi = flWi[i] * f;
    if (k2 > 0) {
      const dr = (kx * ur + ky * vr + kz * wr) / k2;
      const di = (kx * ui + ky * vi + kz * wi) / k2;
      ur -= kx * dr; ui -= kx * di;
      vr -= ky * dr; vi -= ky * di;
      wr -= kz * dr; wi -= kz * di;
    }
    a[i] = ur - vi; b[i] = ui + vr; c[i] = wr; flWi[i] = wi;
    if (j !== i) { a[j] = ur + vi; b[j] = vr - ui; c[j] = wr; flWi[j] = -wi; }
  } } }
  fft3(a, b, -1); fft3(c, flWi, -1);
  for (let i = 0; i < flN3; i++) { a[i] *= flMu[i]; b[i] *= flMv[i]; c[i] *= flMw[i]; }
}
function bacStepVelocity(dt) {
  bacAddForces(dt);
  const adv = flAlgo.mac ? flAdvectMac : flAdvect;
  if (flAlgo.reflect) {
    // Advection-réflexion (Zehnder et al. 2018) : demi-pas, projection,
    // réflexion û = 2·u½ − ũ½ (qui rend l'énergie que la projection a prise),
    // second demi-pas porté par u½, projection finale.
    adv(flU, flV, flW, flU, flV, flW, dt / 2, flUr, flVr, flWr);
    flPa.set(flUr); flPb.set(flVr); flPc.set(flWr);
    flProject(flUr, flVr, flWr, FL.visc * dt / 2);
    for (let i = 0; i < flN3; i++) {
      flPa[i] = 2 * flUr[i] - flPa[i]; flPb[i] = 2 * flVr[i] - flPb[i]; flPc[i] = 2 * flWr[i] - flPc[i];
    }
    adv(flPa, flPb, flPc, flUr, flVr, flWr, dt / 2, flTa, flTb, flTc);
    flProject(flTa, flTb, flTc, FL.visc * dt / 2);
    flU.set(flTa); flV.set(flTb); flW.set(flTc);
  } else {
    adv(flU, flV, flW, flU, flV, flW, dt, flUr, flVr, flWr);
    flProject(flUr, flVr, flWr, FL.visc * dt);
    flU.set(flUr); flV.set(flVr); flW.set(flWr);
  }
}
function bacStepDensity(dt) {
  const n = FL.n, n2 = n * n;
  const { x: dnx, y: dny, z: dnz } = FL.dn;
  const keep = Math.max(0, 1 - FL.dissip * dt);
  const sdx = dnx / FL.size.x, sdy = dny / FL.size.y, sdz = dnz / FL.size.z;
  const cdx = dnx - 1.001, cdy = dny - 1.001, cdz = dnz - 1.001;
  const dyStep = dnx, dzStep = dnx * dny;
  // Le tampon de destination porte encore l'état d'il y a deux pas : on
  // efface sa zone, puis on ne calcule que la zone enfumée élargie de ce que
  // la vitesse maximale peut transporter en un pas.
  if (bbD1[1] >= bbD1[0]) {
    for (let iz = bbD1[4]; iz <= bbD1[5]; iz++) for (let iy = bbD1[2]; iy <= bbD1[3]; iy++) {
      const o = dnx * (iy + dny * iz);
      bacD1.fill(0, o + bbD1[0], o + bbD1[1] + 1);
    }
  }
  bbD1[0] = 1; bbD1[1] = 0;
  if (bbD0[1] < bbD0[0]) { bacFogTex.needsUpdate = true; return 0; }
  let vmax = 0;
  for (let j = 0; j < flN3; j++) {
    const a = Math.abs(flU[j]), b = Math.abs(flV[j]), c = Math.abs(flW[j]);
    if (a > vmax) vmax = a; if (b > vmax) vmax = b; if (c > vmax) vmax = c;
  }
  const mgx = Math.ceil(vmax * dt * sdx) + 2, mgy = Math.ceil(vmax * dt * sdy) + 2, mgz = Math.ceil(vmax * dt * sdz) + 2;
  const ex0 = Math.max(0, bbD0[0] - mgx), ex1 = Math.min(dnx - 1, bbD0[1] + mgx);
  const ey0 = Math.max(0, bbD0[2] - mgy), ey1 = Math.min(dny - 1, bbD0[3] + mgy);
  const ez0 = Math.max(0, bbD0[4] - mgz), ez1 = Math.min(dnz - 1, bbD0[5] + mgz);
  let nx0 = dnx, nx1 = -1, ny0 = dny, ny1 = -1, nz0 = dnz, nz1 = -1;
  const mac = flAlgo.mac;
  if (mac && !bacScr) {
    const c = bacD0.length;
    bacScr = { vx: new Float32Array(c), vy: new Float32Array(c), vz: new Float32Array(c), hat: new Float32Array(c), mn: new Float32Array(c), mx: new Float32Array(c) };
  }
  const scr = bacScr;
  let i = 0, left = 0;
  // Passe 1 : rétro-advection. Seule en semi-lagrangien ; en MacCormack elle
  // range l'« aller », la vitesse de la cellule et l'intervalle des voisins.
  for (let iz = ez0; iz <= ez1; iz++) {
    const gz = dGz[iz], z0 = gz | 0, fz = gz - z0;
    const zo0 = n2 * z0, zo1 = zo0 + n2;
    for (let iy = ey0; iy <= ey1; iy++) {
      const gy = dGy[iy], y0 = gy | 0, fy = gy - y0;
      const b00 = n * y0 + zo0, b10 = b00 + n, b01 = n * y0 + zo1, b11 = b01 + n;
      const w00 = (1 - fy) * (1 - fz), w10 = fy * (1 - fz), w01 = (1 - fy) * fz, w11 = fy * fz;
      i = ex0 + dnx * (iy + dny * iz);
      for (let ix = ex0; ix <= ex1; ix++, i++) {
        if (bacSolid[i]) { if (mac) scr.hat[i] = 0; else { bacD1[i] = 0; bacTexData[i] = 0; } continue; }
        // Vitesse au centre de la cellule (trilinéaire sur la grille 32³).
        const gx = dGx[ix], x0 = gx | 0, fx = gx - x0, fxi = 1 - fx;
        const a0 = x0 + b00, a1 = x0 + b10, a2 = x0 + b01, a3 = x0 + b11;
        const q000 = w00 * fxi, q100 = w00 * fx, q010 = w10 * fxi, q110 = w10 * fx;
        const q001 = w01 * fxi, q101 = w01 * fx, q011 = w11 * fxi, q111 = w11 * fx;
        const vu = flU[a0] * q000 + flU[a0 + 1] * q100 + flU[a1] * q010 + flU[a1 + 1] * q110 + flU[a2] * q001 + flU[a2 + 1] * q101 + flU[a3] * q011 + flU[a3 + 1] * q111;
        const vv = flV[a0] * q000 + flV[a0 + 1] * q100 + flV[a1] * q010 + flV[a1 + 1] * q110 + flV[a2] * q001 + flV[a2 + 1] * q101 + flV[a3] * q011 + flV[a3 + 1] * q111;
        const vw = flW[a0] * q000 + flW[a0 + 1] * q100 + flW[a1] * q010 + flW[a1 + 1] * q110 + flW[a2] * q001 + flW[a2 + 1] * q101 + flW[a3] * q011 + flW[a3 + 1] * q111;
        // Rétro-advection dans la grille densité, bornée à la coquille vide.
        const hx = flClamp((dWx[ix] - vu * dt - FL.min.x) * sdx - 0.5, 0, cdx);
        const hy = flClamp((dWy[iy] - vv * dt - FL.min.y) * sdy - 0.5, 0, cdy);
        const hz = flClamp((dWz[iz] - vw * dt - FL.min.z) * sdz - 0.5, 0, cdz);
        const X0 = hx | 0, FX = hx - X0, Y0 = hy | 0, FY = hy - Y0, Z0 = hz | 0, FZ = hz - Z0;
        const c0 = X0 + dyStep * Y0 + dzStep * Z0, c1 = c0 + dyStep, c2 = c0 + dzStep, c3 = c1 + dzStep;
        const FXI = 1 - FX;
        const e0 = bacD0[c0], e1 = bacD0[c0 + 1], e2 = bacD0[c1], e3 = bacD0[c1 + 1], e4 = bacD0[c2], e5 = bacD0[c2 + 1], e6 = bacD0[c3], e7 = bacD0[c3 + 1];
        let d = (e0 * FXI + e1 * FX) * (1 - FY) * (1 - FZ)
          + (e2 * FXI + e3 * FX) * FY * (1 - FZ)
          + (e4 * FXI + e5 * FX) * (1 - FY) * FZ
          + (e6 * FXI + e7 * FX) * FY * FZ;
        if (mac) {
          scr.vx[i] = vu; scr.vy[i] = vv; scr.vz[i] = vw; scr.hat[i] = d;
          let mn = e0, mx = e0;
          mn = Math.min(mn, e1); mx = Math.max(mx, e1);
          mn = Math.min(mn, e2); mx = Math.max(mx, e2);
          mn = Math.min(mn, e3); mx = Math.max(mx, e3);
          mn = Math.min(mn, e4); mx = Math.max(mx, e4);
          mn = Math.min(mn, e5); mx = Math.max(mx, e5);
          mn = Math.min(mn, e6); mx = Math.max(mx, e6);
          mn = Math.min(mn, e7); mx = Math.max(mx, e7);
          scr.mn[i] = mn; scr.mx[i] = mx;
          continue;
        }
        d *= keep;
        if (d < 0.5) d = 0;
        else {
          left++;
          if (ix < nx0) nx0 = ix; if (ix > nx1) nx1 = ix;
          if (iy < ny0) ny0 = iy; if (iy > ny1) ny1 = iy;
          if (iz < nz0) nz0 = iz; if (iz > nz1) nz1 = iz;
        }
        bacD1[i] = d;
        bacTexData[i] = d >= 255 ? 255 : d | 0;
      }
    }
  }
  if (mac) {
    // Passe 2 (MacCormack) : on ramène l'« aller » en arrière dans le temps ;
    // l'écart avec la densité d'origine est l'erreur de flou, retirée à
    // moitié, puis bornée à l'intervalle des voisins (pas d'oscillations).
    const hat = scr.hat;
    for (let iz = ez0; iz <= ez1; iz++) for (let iy = ey0; iy <= ey1; iy++) {
      i = ex0 + dnx * (iy + dny * iz);
      for (let ix = ex0; ix <= ex1; ix++, i++) {
        if (bacSolid[i]) { bacD1[i] = 0; bacTexData[i] = 0; continue; }
        const hx = flClamp((dWx[ix] + scr.vx[i] * dt - FL.min.x) * sdx - 0.5, 0, cdx);
        const hy = flClamp((dWy[iy] + scr.vy[i] * dt - FL.min.y) * sdy - 0.5, 0, cdy);
        const hz = flClamp((dWz[iz] + scr.vz[i] * dt - FL.min.z) * sdz - 0.5, 0, cdz);
        const X0 = hx | 0, FX = hx - X0, Y0 = hy | 0, FY = hy - Y0, Z0 = hz | 0, FZ = hz - Z0;
        const c0 = X0 + dyStep * Y0 + dzStep * Z0, c1 = c0 + dyStep, c2 = c0 + dzStep, c3 = c1 + dzStep;
        const FXI = 1 - FX;
        const tilde = (hat[c0] * FXI + hat[c0 + 1] * FX) * (1 - FY) * (1 - FZ)
          + (hat[c1] * FXI + hat[c1 + 1] * FX) * FY * (1 - FZ)
          + (hat[c2] * FXI + hat[c2 + 1] * FX) * (1 - FY) * FZ
          + (hat[c3] * FXI + hat[c3 + 1] * FX) * FY * FZ;
        let d = hat[i] + 0.5 * (bacD0[i] - tilde);
        if (d < scr.mn[i]) d = scr.mn[i]; else if (d > scr.mx[i]) d = scr.mx[i];
        d *= keep;
        if (d < 0.5) d = 0;
        else {
          left++;
          if (ix < nx0) nx0 = ix; if (ix > nx1) nx1 = ix;
          if (iy < ny0) ny0 = iy; if (iy > ny1) ny1 = iy;
          if (iz < nz0) nz0 = iz; if (iz > nz1) nz1 = iz;
        }
        bacD1[i] = d;
        bacTexData[i] = d >= 255 ? 255 : d | 0;
      }
    }
    // L'« aller » doit rester nul hors de la zone traitée au pas suivant.
    for (let iz = ez0; iz <= ez1; iz++) for (let iy = ey0; iy <= ey1; iy++) {
      const o = dnx * (iy + dny * iz);
      hat.fill(0, o + ex0, o + ex1 + 1);
    }
  }
  const tmp = bacD0; bacD0 = bacD1; bacD1 = tmp;
  for (let k = 0; k < 6; k++) bbD1[k] = bbD0[k];
  bbD0[0] = nx0; bbD0[1] = nx1; bbD0[2] = ny0; bbD0[3] = ny1; bbD0[4] = nz0; bbD0[5] = nz1;
  bacFogTex.needsUpdate = true;
  return left;
}
// -- Bruit advecté : deux champs de déplacement D(x) = X(x) − x sur la grille
// de vitesse, où X est la position d'origine du fluide arrivé en x. Chacun
// est remis à zéro tous les DET_T secondes, en opposition de phase ; le
// shader lit le bruit en p + D et fond les deux lectures (Neyret 2003).
const DET_T = 3.2;
const det = { d: [null, null], t: [null, null], tex: [null, null], half: [null, null], age: [0, DET_T / 2], noise: null };
function detInit() {
  if (det.noise) return;
  for (let k = 0; k < 2; k++) {
    det.d[k] = [new Float32Array(flN3), new Float32Array(flN3), new Float32Array(flN3)];
    det.half[k] = new Uint16Array(flN3 * 4);
    const t = new THREE.Data3DTexture(det.half[k], FL.n, FL.n, FL.n);
    t.format = THREE.RGBAFormat; t.type = THREE.HalfFloatType;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    det.tex[k] = t;
  }
  // Texture de bruit 64³ répétable : rgb = vecteur de déformation (2 octaves),
  // a = détail scalaire (3 octaves). Une lecture remplace 8 hachages GLSL.
  const N = 64, data = new Uint8Array(N * N * N * 4);
  const lat = (period) => { const a = new Float32Array(period ** 3); for (let i = 0; i < a.length; i++) a[i] = Math.random(); return a; };
  const smp = (a, P, x, y, z) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
    let fx = x - x0, fy = y - y0, fz = z - z0;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
    const xa = x0 % P, xb = (x0 + 1) % P, ya = (y0 % P) * P, yb = ((y0 + 1) % P) * P, za = (z0 % P) * P * P, zb = ((z0 + 1) % P) * P * P;
    const l = (p, q, f) => p + (q - p) * f;
    return l(l(l(a[xa + ya + za], a[xb + ya + za], fx), l(a[xa + yb + za], a[xb + yb + za], fx), fy),
      l(l(a[xa + ya + zb], a[xb + ya + zb], fx), l(a[xa + yb + zb], a[xb + yb + zb], fx), fy), fz);
  };
  const L = [0, 1, 2].map(() => [lat(4), lat(8)]), A = [lat(8), lat(16), lat(32)];
  let o = 0;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++, o += 4) {
    for (let c = 0; c < 3; c++) data[o + c] = 255 * (0.62 * smp(L[c][0], 4, x / 16, y / 16, z / 16) + 0.38 * smp(L[c][1], 8, x / 8, y / 8, z / 8));
    data[o + 3] = 255 * (0.5 * smp(A[0], 8, x / 8, y / 8, z / 8) + 0.3 * smp(A[1], 16, x / 4, y / 4, z / 4) + 0.2 * smp(A[2], 32, x / 2, y / 2, z / 2));
  }
  const nt = new THREE.Data3DTexture(data, N, N, N);
  nt.format = THREE.RGBAFormat;
  nt.minFilter = nt.magFilter = THREE.LinearFilter;
  nt.wrapS = nt.wrapT = nt.wrapR = THREE.RepeatWrapping;
  nt.needsUpdate = true;
  det.noise = nt;
  if (fogPass) {
    fogPass.uniforms.uDet0.value = det.tex[0];
    fogPass.uniforms.uDet1.value = det.tex[1];
    fogPass.uniforms.uNoise.value = nt;
  }
}
function detReset() {
  if (!det.noise) return;
  for (let k = 0; k < 2; k++) { for (const a of det.d[k]) a.fill(0); det.half[k].fill(0); det.tex[k].needsUpdate = true; }
  det.age[0] = 0; det.age[1] = DET_T / 2;
}
function detStep(dt) {
  detInit();
  for (let k = 0; k < 2; k++) {
    const [dx, dy, dz] = det.d[k];
    det.age[k] += dt;
    if (det.age[k] >= DET_T) { det.age[k] -= DET_T; dx.fill(0); dy.fill(0); dz.fill(0); }
    // D'(x) = D(x − u·dt) − u·dt
    flAdvect(dx, dy, dz, flU, flV, flW, dt, flTa, flTb, flTc);
    const h = det.half[k];
    for (let i = 0, o = 0; i < flN3; i++, o += 4) {
      const a = dx[i] = flTa[i] - flU[i] * dt, b = dy[i] = flTb[i] - flV[i] * dt, c = dz[i] = flTc[i] - flW[i] * dt;
      h[o] = THREE.DataUtils.toHalfFloat(a); h[o + 1] = THREE.DataUtils.toHalfFloat(b); h[o + 2] = THREE.DataUtils.toHalfFloat(c);
    }
    det.tex[k].needsUpdate = true;
  }
  if (fogPass) {
    const w0 = 1 - Math.abs(2 * det.age[0] / DET_T - 1);
    fogPass.uniforms.uDetW.value.set(w0, 1 - w0);
  }
}
// -- Fumée en particules : la densité est portée par des points qui suivent
// la vitesse de la grille. Aucune interpolation de densité, donc aucune
// diffusion numérique ; le poids vient d'un dépôt des particules sur la
// grille de vitesse.
const PT_MAX = 240000;
const pt = { pos: null, alpha: null, count: 0, points: null };
function ptInit() {
  if (pt.points) return;
  pt.pos = new Float32Array(PT_MAX * 3);
  pt.alpha = new Float32Array(PT_MAX);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pt.pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(pt.alpha, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setDrawRange(0, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSize: { value: 0.42 }, uScale: { value: 600 }, uOpacity: { value: 0.02 } },
    vertexShader: `attribute float aAlpha; uniform float uSize; uniform float uScale; varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float s = uSize * uScale / -mv.z;
        // Sous le pixel, la taille est bornée et l'opacité compense.
        vA = aAlpha * min(1.0, s * s / 2.25);
        gl_PointSize = max(s, 1.5);
      }`,
    fragmentShader: `uniform float uOpacity; varying float vA;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float f = max(0.0, 1.0 - dot(c, c) * 4.0);
        gl_FragColor = vec4(vec3(0.74, 0.77, 0.82), f * f * vA * uOpacity);
      }`,
    transparent: true, depthWrite: false, fog: false,
  });
  pt.points = new THREE.Points(geo, mat);
  pt.points.frustumCulled = false;
  pt.points.visible = false;
  sandboxRoot.add(pt.points);
}
function ptSpawn(px, py, pz, r, count) {
  ptInit();
  for (let k = 0; k < count && pt.count < PT_MAX; k++) {
    // Rejet : profil de densité (1 − d²)², comme la boule de la grille.
    let x, y, z, d2;
    do {
      x = Math.random() * 2 - 1; y = Math.random() * 2 - 1; z = Math.random() * 2 - 1;
      d2 = x * x + y * y + z * z;
    } while (d2 >= 1 || Math.random() > (1 - d2) * (1 - d2));
    const o = pt.count * 3;
    pt.pos[o] = px + x * r; pt.pos[o + 1] = py + y * r; pt.pos[o + 2] = pz + z * r;
    pt.alpha[pt.count++] = 1;
  }
}
// Dépôt sur la grille de vitesse : flRho en unités de la densité grille
// (≈ 260 au cœur d'une boule fraîche de `ptRef` particules de rayon r).
let ptRhoK = 1;
function ptStep(dt) {
  const n = FL.n, n2 = n * n, nc = n - 1.001;
  const ihx = 1 / FL.h.x, ihy = 1 / FL.h.y, ihz = 1 / FL.h.z;
  const x0m = FL.min.x, y0m = FL.min.y, z0m = FL.min.z;
  const xLo = x0m + 0.6, xHi = x0m + FL.size.x - 0.6, yHi = y0m + FL.size.y - 0.6, zLo = z0m + 0.6, zHi = z0m + FL.size.z - 0.6;
  const fade = Math.max(0, 1 - FL.dissip * dt);
  const pos = pt.pos, al = pt.alpha;
  flRho.fill(0);
  for (let k = pt.count - 1; k >= 0; k--) {
    const o = k * 3;
    let x = pos[o], y = pos[o + 1], z = pos[o + 2];
    const gx = flClamp((x - x0m) * ihx - 0.5, 0, nc), gy = flClamp((y - y0m) * ihy - 0.5, 0, nc), gz = flClamp((z - z0m) * ihz - 0.5, 0, nc);
    const X0 = gx | 0, fx = gx - X0, Y0 = gy | 0, fy = gy - Y0, Z0 = gz | 0, fz = gz - Z0;
    const a0 = X0 + n * Y0 + n2 * Z0, a1 = a0 + n, a2 = a0 + n2, a3 = a1 + n2;
    const q000 = (1 - fx) * (1 - fy) * (1 - fz), q100 = fx * (1 - fy) * (1 - fz);
    const q010 = (1 - fx) * fy * (1 - fz), q110 = fx * fy * (1 - fz);
    const q001 = (1 - fx) * (1 - fy) * fz, q101 = fx * (1 - fy) * fz;
    const q011 = (1 - fx) * fy * fz, q111 = fx * fy * fz;
    x += dt * (flU[a0] * q000 + flU[a0 + 1] * q100 + flU[a1] * q010 + flU[a1 + 1] * q110 + flU[a2] * q001 + flU[a2 + 1] * q101 + flU[a3] * q011 + flU[a3 + 1] * q111);
    y += dt * (flV[a0] * q000 + flV[a0 + 1] * q100 + flV[a1] * q010 + flV[a1 + 1] * q110 + flV[a2] * q001 + flV[a2 + 1] * q101 + flV[a3] * q011 + flV[a3 + 1] * q111);
    z += dt * (flW[a0] * q000 + flW[a0 + 1] * q100 + flW[a1] * q010 + flW[a1 + 1] * q110 + flW[a2] * q001 + flW[a2 + 1] * q101 + flW[a3] * q011 + flW[a3 + 1] * q111);
    const a = al[k] * fade;
    if (a < 0.04) {
      const l = --pt.count, lo = l * 3;
      pos[o] = pos[lo]; pos[o + 1] = pos[lo + 1]; pos[o + 2] = pos[lo + 2]; al[k] = al[l];
      continue;
    }
    x = x < xLo ? xLo : x > xHi ? xHi : x; y = y < 0.03 ? 0.03 : y > yHi ? yHi : y; z = z < zLo ? zLo : z > zHi ? zHi : z;
    pos[o] = x; pos[o + 1] = y; pos[o + 2] = z; al[k] = a;
    // Dépôt trilinéaire de la masse sur les 8 cellules voisines.
    const m = a * ptRhoK;
    flRho[a0] += m * q000; flRho[a0 + 1] += m * q100; flRho[a1] += m * q010; flRho[a1 + 1] += m * q110;
    flRho[a2] += m * q001; flRho[a2 + 1] += m * q101; flRho[a3] += m * q011; flRho[a3 + 1] += m * q111;
  }
  const geo = pt.points.geometry;
  geo.attributes.position.needsUpdate = true;
  geo.attributes.aAlpha.needsUpdate = true;
  geo.setDrawRange(0, pt.count);
  return pt.count;
}
let bacDirty = false, bacAcc = 0, bacMs = 0;
// 30 Hz suffit à de la fumée et laisse le budget CPU au raymarcheur ; la
// stabilité inconditionnelle du solveur tolère le dt double.
function bacFluidTick(frameDt) {
  const emitting = flDomain === 'hall' && smokeSources.some((s) => s.on);
  if (emitting) bacDirty = true;
  if (!bacDirty) return;
  bacAcc += frameDt;
  // Cadence adaptative : un pas coûteux (advection-réflexion…) s'espace pour
  // ne jamais prendre plus de ~40 % du temps ; le dt suit jusqu'à 1/12 s.
  if (bacAcc < Math.max(1 / 34, bacMs * 0.0025)) return;
  const dt = Math.min(bacAcc, 1 / 12);
  bacAcc = 0;
  const t0 = performance.now();
  if (emitting) smokeEmit(dt);
  let left;
  if (flAlgo.particles) {
    // Les particles déposent leur masse (flRho) en avançant ; la vitesse du
    // pas suivant s'en sert pour le poids.
    bacStepVelocity(dt);
    left = ptStep(dt);
  } else {
    // Densité vue par la grille de vitesse : cellule fine la plus proche.
    const n = FL.n;
    let i = 0;
    for (let z = 0; z < n; z++) { const oz = velDz[z]; for (let y = 0; y < n; y++) { const oy = velDy[y] + oz; for (let x = 0; x < n; x++, i++) flRho[i] = bacD0[velDx[x] + oy]; } }
    bacStepVelocity(dt);
    if (flAlgo.shade === 2) detStep(dt);
    left = bacStepDensity(dt);
  }
  bacMs += (performance.now() - t0 - bacMs) * 0.1;
  // Plus de fumée ni de source : le solveur s'endort jusqu'à la prochaine.
  if (left === 0 && !emitting) bacClear();
}
// ---- Sources de fumée (galerie) ---------------------------------------------
// Un point posé par l'utilisateur qui alimente le fluide en continu : à chaque
// pas, une boule de densité (débit) et un jet qui ramène la vitesse locale
// vers direction × vitesse de sortie. La turbulence fait osciller l'axe et
// pulser le jet — la projection FFT enroule le reste en volutes.
const SMOKE_SRC_DEFAULTS = { on: true, rate: 4, speed: 2.5, radius: 0.6, el: 90, az: 0, turb: 0.35 };
const smokeSources = [];
// Aspirateurs : boules posées dans la galerie qui avalent l'air (et la fumée).
const smokeVacs = [];
const VAC_DEFAULTS = { q: 6, r: 0.45, range: 4 };
// gpu / focus : 1 = activé (stockés en nombres, comme le reste).
const SMOKE_VIEW = smokeNums({ gain: 20, lum: 0.6, dist: 4, gpu: 1, focus: 1, res: 128, turb: 1, body: 1, airSize: 0.8, airSpeed: 12, airSmoke: 1, airCloud: 0.85, airAccel: 0.35, full: 0, lightFull: 0, vel64: 0, simHz: 20, march: 1 }, smokeSaved.view);
let smokeClock = 0;
function smokeEmit(dt) {
  smokeClock += dt;
  const { x: dnx, y: dny, z: dnz } = FL.dn;
  const kx = dnx / FL.size.x, ky = dny / FL.size.y, kz = dnz / FL.size.z;
  for (const s of smokeSources) {
    if (!s.on) continue;
    const t = smokeClock + s.phase;
    if (s.rate > 0) {
      const r = Math.max(s.radius, 0.3);
      const x0 = Math.max(1, ((s.x - r - FL.min.x) * kx) | 0), x1 = Math.min(dnx - 2, Math.ceil((s.x + r - FL.min.x) * kx));
      const y0 = Math.max(1, ((s.y - r - FL.min.y) * ky) | 0), y1 = Math.min(dny - 2, Math.ceil((s.y + r - FL.min.y) * ky));
      const z0 = Math.max(1, ((s.z - r - FL.min.z) * kz) | 0), z1 = Math.min(dnz - 2, Math.ceil((s.z + r - FL.min.z) * kz));
      const add = s.rate * 255 * dt;
      bbAdd(bbD0, x0, x1, y0, y1, z0, z1);
      for (let iz = z0; iz <= z1; iz++) for (let iy = y0; iy <= y1; iy++) for (let ix = x0; ix <= x1; ix++) {
        const d = Math.hypot(dWx[ix] - s.x, dWy[iy] - s.y, dWz[iz] - s.z) / r;
        if (d >= 1) continue;
        const i = ix + dnx * (iy + dny * iz);
        if (!bacSolid[i]) bacD0[i] = Math.min(340, bacD0[i] + add * (1 - d * d) * (1 - d * d));
      }
    }
    // Jet : axe (élévation/azimut) perturbé par la turbulence, vitesse pulsée.
    const el = s.el * Math.PI / 180, az = s.az * Math.PI / 180;
    let ax = Math.cos(el) * Math.sin(az) + s.turb * 0.6 * Math.sin(t * 1.31);
    let ay = Math.sin(el) + s.turb * 0.3 * Math.sin(t * 1.93 + 1.7);
    let az2 = Math.cos(el) * Math.cos(az) + s.turb * 0.6 * Math.sin(t * 1.67 + 4.1);
    const al = Math.hypot(ax, ay, az2) || 1;
    const sp = s.speed * (1 + 0.35 * s.turb * Math.sin(t * 3.1)) / al;
    ax *= sp; ay *= sp; az2 *= sp;
    const rv = Math.max(s.radius * 1.6, 1.15);
    const k = Math.min(1, 9 * dt);
    const n = FL.n;
    const u0 = Math.max(0, ((s.x - rv - FL.min.x) / FL.h.x - 0.5) | 0), u1 = Math.min(n - 1, Math.ceil((s.x + rv - FL.min.x) / FL.h.x - 0.5));
    const v0 = Math.max(0, ((s.y - rv - FL.min.y) / FL.h.y - 0.5) | 0), v1 = Math.min(n - 1, Math.ceil((s.y + rv - FL.min.y) / FL.h.y - 0.5));
    const w0 = Math.max(0, ((s.z - rv - FL.min.z) / FL.h.z - 0.5) | 0), w1 = Math.min(n - 1, Math.ceil((s.z + rv - FL.min.z) / FL.h.z - 0.5));
    for (let z = w0; z <= w1; z++) for (let y = v0; y <= v1; y++) for (let x = u0; x <= u1; x++) {
      const d = Math.hypot(flWxA[x] - s.x, flWyA[y] - s.y, flWzA[z] - s.z) / rv;
      if (d >= 1) continue;
      const f = k * (1 - d * d) * (1 - d * d);
      const i = x + n * (y + n * z);
      flU[i] += (ax - flU[i]) * f;
      flV[i] += (ay - flV[i]) * f;
      flW[i] += (az2 - flW[i]) * f;
    }
  }
}
function bacSpawn() {
  const px = BAC.cx + (Math.random() - 0.5) * 14;
  const py = 12 + Math.random() * 5;
  const pz = BAC.cz + (Math.random() - 0.5) * 14;
  const r = 5.2;
  if (flAlgo.particles) {
    // Calibrage du dépôt : cœur d'une boule fraîche ≈ 260, comme la grille.
    const n0 = BAC_VIEW.particles / (4 * Math.PI * r * r * r * 0.0762);
    ptRhoK = 260 / (n0 * FL.h.x * FL.h.y * FL.h.z);
    ptSpawn(px, py, pz, r, BAC_VIEW.particles);
    pt.points.material.uniforms.uOpacity.value = 0.02 * BAC_VIEW.gain / 1.8 * Math.sqrt(40000 / BAC_VIEW.particles);
  } else {
    // Une boule de densité douce sur la grille fine…
    const { x: dnx, y: dny, z: dnz } = FL.dn;
    const x0 = Math.max(1, ((px - r - FL.min.x) * dnx / FL.size.x) | 0), x1 = Math.min(dnx - 2, Math.ceil((px + r - FL.min.x) * dnx / FL.size.x));
    const y0 = Math.max(1, ((py - r - FL.min.y) * dny / FL.size.y) | 0), y1 = Math.min(dny - 2, Math.ceil((py + r - FL.min.y) * dny / FL.size.y));
    const z0 = Math.max(1, ((pz - r - FL.min.z) * dnz / FL.size.z) | 0), z1 = Math.min(dnz - 2, Math.ceil((pz + r - FL.min.z) * dnz / FL.size.z));
    bbAdd(bbD0, x0, x1, y0, y1, z0, z1);
    for (let iz = z0; iz <= z1; iz++) for (let iy = y0; iy <= y1; iy++) for (let ix = x0; ix <= x1; ix++) {
      const d = Math.hypot(dWx[ix] - px, dWy[iy] - py, dWz[iz] - pz) / r;
      if (d >= 1) continue;
      const f = (1 - d * d) * (1 - d * d);
      const i = ix + dnx * (iy + dny * iz);
      if (!bacSolid[i]) bacD0[i] = Math.min(340, bacD0[i] + 260 * f);
    }
  }
  if (flAlgo.vortex) vortexSeed(px, py, pz, r * 0.8, 14);
  // …et son impulsion : une bouffée vers le bas, vrillée d'une rotation
  // aléatoire — c'est elle que la projection FFT déroule en volutes.
  const rv = 7;
  const spin = (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 6);
  const push = 3.5 + Math.random() * 3;
  let i = 0;
  for (let z = 0; z < FL.n; z++) for (let y = 0; y < FL.n; y++) for (let x = 0; x < FL.n; x++, i++) {
    const dx = flWxA[x] - px, dy = flWyA[y] - py, dz = flWzA[z] - pz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) / rv;
    if (d >= 1) continue;
    const f = (1 - d * d) * (1 - d * d);
    flV[i] -= push * f;
    flU[i] -= dz / rv * spin * f;
    flW[i] += dx / rv * spin * f;
  }
  bacDirty = true;
}
function bacClear() {
  bacD0.fill(0); bacD1.fill(0); bacTexData.fill(0);
  bbD0[0] = bbD1[0] = 1; bbD0[1] = bbD1[1] = 0;
  flU.fill(0); flV.fill(0); flW.fill(0); flRho.fill(0);
  if (bacScr) bacScr.hat.fill(0);
  vpCount = 0;
  detReset();
  pt.count = 0;
  if (pt.points) { pt.points.geometry.setDrawRange(0, 0); pt.points.visible = flDomain === 'bac' && flAlgo.particles; }
  bacDirty = false;
  bacFogTex.needsUpdate = true;
}
function bacSetAlgo(id) {
  bacAlgoId = id;
  if (flDomain !== 'bac') return;
  Object.assign(flAlgo, { gpu: null }, BAC_ALGOS[id]);
  if (flAlgo.gpu) smoke3d.setMode(flAlgo.gpu); else smoke3d.clear();
  if (flAlgo.particles) ptInit();
  if (flAlgo.shade === 2) detInit();
  bacClear();
}
// Panneau des sources (V, galerie seulement) : on vise, clic gauche pour poser
// une source au repère, clic droit pour retirer celle qu'on vise. Les
// curseurs règlent la source sélectionnée (et servent de modèle à la
// suivante) ; le bas du panneau règle le fluide lui-même.
{
  const MAX_SOURCES = 12;
  const template = { ...SMOKE_SRC_DEFAULTS, color: '#ffffff' };
  let sel = -1;
  const cur = () => smokeSources[sel] || template;
  // Sélection multiple (Maj+clic sur les numéros) : les réglages s'appliquent
  // à toutes les sources sélectionnées ; les curseurs affichent la principale.
  const multi = new Set();
  const isSel = (o, i) => i === sel || multi.has(o);
  const targets = () => { const t = smokeSources.filter(isSel); return t.length ? t : [template]; };
  const LO = ROOM_LO, HI = ROOM_HI; // emprise de la pièce courante
  const save = () => {
    try {
      localStorage.setItem('ingaSmoke', JSON.stringify({
        sources: (srcKey === 'room' ? smokeSources : srcSets.room?.s || []).map(({ phase, ...o }) => o),
        vacs: srcKey === 'room' ? smokeVacs : srcSets.room?.v || [],
        brutal: {
          sources: (srcKey === 'brutal' ? smokeSources : srcSets.brutal?.s || smokeSaved.brutal?.sources || []).map(({ phase, ...o }) => o),
          vacs: srcKey === 'brutal' ? smokeVacs : srcSets.brutal?.v || smokeSaved.brutal?.vacs || [],
        },
        sim: SMOKE_SIM, view: SMOKE_VIEW,
      }));
    } catch { /* quota */ }
  };
  const mkSource = (x, y, z, from) => ({
    ...smokeNums(SMOKE_SRC_DEFAULTS, from), on: from.on !== false,
    color: typeof from.color === 'string' ? from.color : '#ffffff',
    x: flClamp(x, LO.x, HI.x), y: flClamp(y, LO.y, HI.y), z: flClamp(z, LO.z, HI.z),
    phase: Math.random() * 60,
  });
  if (Array.isArray(smokeSaved.sources)) {
    for (const o of smokeSaved.sources.slice(0, MAX_SOURCES)) {
      if (o && [o.x, o.y, o.z].every(Number.isFinite)) smokeSources.push(mkSource(o.x, o.y, o.z, o));
    }
  }

  // Repères 3D : visibles seulement panneau ouvert, la galerie reste propre.
  const markers = new THREE.Group();
  markers.visible = false;
  roomRoot.add(markers);
  const dotGeo = new THREE.SphereGeometry(0.09, 14, 10);
  const gizmo = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 10),
    new THREE.MeshBasicMaterial({ color: 0xffb060, wireframe: true, transparent: true, opacity: 0.45, depthWrite: false, fog: false }));
  gizmo.visible = false;
  roomRoot.add(gizmo);
  const srcDir = (o) => {
    const el = o.el * Math.PI / 180, az = o.az * Math.PI / 180;
    return new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  };
  function rebuildMarkers() {
    for (const c of [...markers.children]) {
      markers.remove(c);
      c.traverse((m) => { if (m.geometry && m.geometry !== dotGeo) m.geometry.dispose(); m.material?.dispose?.(); });
    }
    smokeSources.forEach((o, i) => {
      const color = isSel(o, i) ? 0xffffff : o.on ? 0xffb060 : 0x777777;
      const g = new THREE.Group();
      g.position.set(o.x, o.y, o.z);
      g.add(new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color, fog: false })));
      const arrow = new THREE.ArrowHelper(srcDir(o), new THREE.Vector3(), 0.35 + 0.12 * o.speed, color, 0.16, 0.09);
      arrow.traverse((m) => { if (m.material) m.material.fog = false; });
      g.add(arrow);
      markers.add(g);
    });
  }

  const fp = document.createElement('div');
  fp.style.cssText = 'position:fixed;top:64px;right:18px;width:260px;max-height:calc(100vh - 90px);overflow:auto;background:#10151299;color:#e4e8de;font:11px "DM Sans",sans-serif;padding:14px 16px;border:1px solid #ffffff2a;border-radius:10px;z-index:9;display:none;backdrop-filter:blur(12px)';
  fp.innerHTML = '<div style="letter-spacing:.16em;font-size:10px;margin-bottom:4px">SOURCES DE FUMÉE</div>'
    + '<div style="opacity:.6;margin-bottom:8px">V pour fermer · Clic gauche : poser une source au repère<br>Clic droit : retirer la source visée · Molette : distance<br>Échap libère la souris pour les réglages<br>Maj+clic sur un numéro : sélection multiple</div>'
    + (fogPass ? '' : '<div style="color:#ffb060;margin-bottom:8px">La fumée passe par le brouillard volumétrique, actif seulement en qualité ÉLEVÉE (menu Échap).</div>');
  document.body.appendChild(fp);
  const refreshers = [];
  const heading = (txt) => {
    const d = document.createElement('div');
    d.style.cssText = 'letter-spacing:.16em;font-size:10px;opacity:.7;margin:14px 0 4px';
    d.textContent = txt;
    fp.append(d);
    return d;
  };
  const slider = (label, min, max, step, get, set) => {
    const w = document.createElement('div');
    w.style.cssText = 'margin:7px 0 2px';
    const lab = document.createElement('div');
    lab.style.cssText = 'display:flex;justify-content:space-between;letter-spacing:.05em';
    const nameEl = document.createElement('span');
    nameEl.textContent = label;
    const valEl = document.createElement('span');
    valEl.style.opacity = '.7';
    const inp = document.createElement('input');
    inp.type = 'range';
    inp.min = min; inp.max = max; inp.step = step;
    inp.style.cssText = 'width:100%;accent-color:#ffb060';
    inp.addEventListener('input', () => { valEl.textContent = (+inp.value).toFixed(2); set(+inp.value); save(); });
    lab.append(nameEl, valEl);
    w.append(lab, inp);
    fp.append(w);
    refreshers.push(() => { inp.value = get(); valEl.textContent = (+get()).toFixed(2); });
  };
  const button = (parent, label, on) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'margin:8px 6px 0 0;background:#f5f0e916;border:1px solid #ffffff44;color:#e4e8de;padding:6px 10px;border-radius:5px;cursor:pointer;font:11px "DM Sans",sans-serif';
    b.addEventListener('click', on);
    parent.append(b);
    return b;
  };
  const srcSlider = (label, key, min, max, step) => slider(label, min, max, step, () => cur()[key], (v) => {
    for (const o of targets()) o[key] = v;
    template[key] = v;
    rebuildMarkers();
  });

  const selTitle = heading('');
  const list = document.createElement('div');
  fp.append(list);
  const onLab = document.createElement('label');
  onLab.style.cssText = 'display:flex;align-items:center;gap:8px;margin:8px 0 2px;cursor:pointer;letter-spacing:.05em';
  const onBox = document.createElement('input');
  onBox.type = 'checkbox';
  onBox.style.accentColor = '#ffb060';
  onBox.addEventListener('change', () => { for (const o of targets()) o.on = onBox.checked; refresh(); save(); });
  onLab.append(onBox, document.createTextNode('Émet de la fumée'));
  fp.append(onLab);
  // Couleur de la fumée émise par cette source.
  const colLab = document.createElement('label');
  colLab.style.cssText = 'display:flex;align-items:center;gap:10px;margin:8px 0 2px;cursor:pointer;letter-spacing:.05em';
  const colBox = document.createElement('input');
  colBox.type = 'color';
  colBox.style.cssText = 'width:42px;height:24px;border:1px solid #ffffff44;border-radius:4px;background:none;padding:0;cursor:pointer';
  colBox.addEventListener('input', () => { for (const o of targets()) o.color = colBox.value; template.color = colBox.value; save(); });
  colLab.append(colBox, document.createTextNode('Couleur de la fumée'));
  fp.append(colLab);
  srcSlider('Quantité (débit)', 'rate', 0, 10, 0.1);
  srcSlider('Vitesse de sortie (m/s)', 'speed', 0, 12, 0.1);
  srcSlider('Taille de la bouche (m)', 'radius', 0.3, 3, 0.05);
  srcSlider('Élévation (90 = vers le haut)', 'el', -90, 90, 1);
  srcSlider('Azimut', 'az', 0, 360, 1);
  srcSlider('Turbulence', 'turb', 0, 1.5, 0.05);
  const srcBtns = document.createElement('div');
  fp.append(srcBtns);
  button(srcBtns, 'Supprimer', () => {
    const gone = new Set(smokeSources.filter(isSel));
    if (!gone.size) return;
    for (let i = smokeSources.length - 1; i >= 0; i--) if (gone.has(smokeSources[i])) smokeSources.splice(i, 1);
    multi.clear(); sel = -1;
    refresh(); save();
  });
  button(srcBtns, 'Tout supprimer', () => { smokeSources.length = 0; multi.clear(); sel = -1; refresh(); save(); });

  heading('FUMÉE (TOUTES LES SOURCES)');
  refreshers.push(globalCheck(fp, '#ffb060'));
  smokeSrcUI.save = save;
  const simSlider = (label, key, min, max, step) => slider(label, min, max, step, () => SMOKE_SIM[key], (v) => {
    SMOKE_SIM[key] = v;
    if (flDomain === 'hall') FL[key] = v;
    if (roomSmoke()) { roomSmoke().params[key] = v; roomSmoke().setSim(); }
  });
  simSlider('Poids (négatif = elle monte)', 'weight', -6, 10, 0.1);
  simSlider('Dissipation', 'dissip', 0, 1.5, 0.01);
  simSlider('Tourbillons', 'swirl', 0, 8, 0.1);
  simSlider('Viscosité', 'visc', 0, 0.5, 0.01);
  slider('Opacité', 0.5, 40, 0.5, () => SMOKE_VIEW.gain, (v) => { SMOKE_VIEW.gain = v; });
  slider('Luminosité', 0.05, 1.5, 0.01, () => SMOKE_VIEW.lum, (v) => { SMOKE_VIEW.lum = v; });
  slider('Distance du repère (m)', 0.5, 25, 0.1, () => SMOKE_VIEW.dist, (v) => { SMOKE_VIEW.dist = v; });
  const simBtns = document.createElement('div');
  fp.append(simBtns);
  button(simBtns, 'Vider la fumée', () => { bacClear(); roomSmoke()?.clear(); });
  // ---- Aspirateurs
  heading('ASPIRATEURS');
  let placeVac = false, vacSel = -1;
  const vacTemplate = { ...VAC_DEFAULTS };
  const vacCur = () => smokeVacs[vacSel] || vacTemplate;
  // Sélection multiple (Maj+clic), comme pour les sources.
  const vacMulti = new Set();
  const vacIsSel = (o, i) => i === vacSel || vacMulti.has(o);
  const vacTargets = () => { const t = smokeVacs.filter(vacIsSel); return t.length ? t : [vacTemplate]; };
  const vacGroup = new THREE.Group();
  roomRoot.add(vacGroup);
  const vacGeo = new THREE.SphereGeometry(1, 24, 16);
  function rebuildVacs() {
    for (const c of [...vacGroup.children]) { vacGroup.remove(c); c.material.dispose(); }
    smokeVacs.forEach((o, i) => {
      const m = new THREE.Mesh(vacGeo, new THREE.MeshStandardMaterial({ color: smokeSrcUI.open && vacIsSel(o, i) ? '#6fb8c5' : '#17181a', roughness: 0.35, metalness: 0.6 }));
      m.position.set(o.x, o.y, o.z);
      m.scale.setScalar(Math.max(0.12, o.r * 0.55));
      m.castShadow = true;
      vacGroup.add(m);
    });
  }
  const modeRow = document.createElement('div');
  fp.append(modeRow);
  const modeBtn = button(modeRow, '', () => { placeVac = !placeVac; refresh(); });
  const vacList = document.createElement('div');
  fp.append(vacList);
  const vacSlider = (label, key, min, max, step) => slider(label, min, max, step, () => vacCur()[key], (v) => { for (const o of vacTargets()) o[key] = v; vacTemplate[key] = v; rebuildVacs(); });
  vacSlider('Force d\'aspiration (m/s à la bouche)', 'q', 0, 25, 0.5);
  vacSlider('Taille de la bouche (m)', 'r', 0.2, 1.5, 0.05);
  vacSlider('Portée (m)', 'range', 1, 15, 0.25);
  const vacBtns = document.createElement('div');
  fp.append(vacBtns);
  button(vacBtns, 'Supprimer', () => {
    const gone = new Set(smokeVacs.filter(vacIsSel));
    if (!gone.size) return;
    for (let i = smokeVacs.length - 1; i >= 0; i--) if (gone.has(smokeVacs[i])) smokeVacs.splice(i, 1);
    vacMulti.clear(); vacSel = -1;
    refresh(); save();
  });
  button(vacBtns, 'Tout supprimer', () => { smokeVacs.length = 0; vacMulti.clear(); vacSel = -1; refresh(); save(); });
  function addVac(x, y, z, from = vacCur()) {
    if (smokeVacs.length >= 6) return;
    smokeVacs.push({ ...smokeNums(VAC_DEFAULTS, from), x: flClamp(x, LO.x, HI.x), y: flClamp(y, LO.y, HI.y), z: flClamp(z, LO.z, HI.z) });
    vacMulti.clear();
    vacSel = smokeVacs.length - 1;
    refresh();
    save();
  }
  if (Array.isArray(smokeSaved.vacs)) for (const o of smokeSaved.vacs.slice(0, 6)) if (o && [o.x, o.y, o.z].every(Number.isFinite)) smokeVacs.push({ ...smokeNums(VAC_DEFAULTS, o), x: o.x, y: o.y, z: o.z });
  rebuildVacs();
  smokeSrcUI.refreshVacs = () => {
    modeBtn.textContent = placeVac ? 'Le clic pose : ASPIRATEUR' : 'Le clic pose : SOURCE';
    modeBtn.style.background = placeVac ? '#6fb8c540' : '#f5f0e916';
    vacList.textContent = '';
    smokeVacs.forEach((o, i) => {
      const b = button(vacList, `A${i + 1}`, (e) => {
        if (e.shiftKey) {
          if (smokeVacs[vacSel]) vacMulti.add(smokeVacs[vacSel]);
          if (vacMulti.has(o)) {
            vacMulti.delete(o);
            if (vacSel === i) vacSel = smokeVacs.findIndex((x) => vacMulti.has(x));
          } else { vacMulti.add(o); vacSel = i; }
        } else { vacMulti.clear(); vacSel = vacSel === i ? -1 : i; }
        refresh();
      });
      b.style.background = vacIsSel(o, i) ? (i === vacSel ? '#6fb8c566' : '#6fb8c538') : '#f5f0e916';
    });
    rebuildVacs();
  };
  heading('MANNEQUIN DE TEST');
  {
    const row = document.createElement('div');
    fp.append(row);
    const sel2 = document.createElement('select');
    sel2.style.cssText = 'width:100%;margin:6px 0;background:#10151299;color:#e4e8de;border:1px solid #ffffff44;border-radius:5px;padding:5px;font:11px "DM Sans",sans-serif';
    const fill = () => {
      sel2.textContent = '';
      for (const n of mannequin.clips) { const o = document.createElement('option'); o.value = n; o.textContent = n.replace(/_Loop$/, '').replace(/_/g, ' '); sel2.append(o); }
      sel2.value = mannequin.current;
    };
    button(row, 'Poser devant moi', () => { placeDummy().then(fill); });
    button(row, 'Retirer', () => mannequin.remove());
    sel2.addEventListener('change', () => mannequin.play(sel2.value));
    fp.append(sel2);
    const quick = document.createElement('div');
    fp.append(quick);
    for (const [label, clip] of [['Repos', 'Idle_Loop'], ['Marcher', 'Walk_Loop'], ['Courir', 'Jog_Fwd_Loop'], ['S\'asseoir', 'Sitting_Enter'], ['Se lever', 'Sitting_Exit'], ['Sauter', 'Jump_Start'], ['Tomber', 'Death01'], ['Danser', 'Dance_Loop']]) {
      button(quick, label, () => { if (!mannequin.placed) placeDummy().then(() => { fill(); mannequin.play(clip); sel2.value = clip; }); else { mannequin.play(clip); sel2.value = clip; } });
    }
  }
  heading('TORNADE (OUTIL 8)');
  {
    const saveT = () => { try { localStorage.setItem('ingaTornado', JSON.stringify(TORN)); } catch { /* quota */ } };
    const ts = (label, key, min, max, step) => slider(label, min, max, step, () => TORN[key], (v) => { TORN[key] = v; saveT(); });
    ts('Rayon (m)', 'size', 0.4, 3, 0.05);
    ts('Hauteur (m)', 'height', 1.5, 7, 0.1);
    ts('Vitesse d\'avance (m/s)', 'speed', 2, 30, 0.5);
    ts('Durée (s)', 'life', 0.5, 8, 0.1);
    ts('Force du tourbillon', 'swirl', 2, 30, 0.5);
    ts('Quantité de fumée', 'smoke', 0, 4, 0.1);
  }
  heading('GOMME DE FUMÉE (OUTIL 7)');
  {
    const saveGum = () => { try { localStorage.setItem('ingaGum4', JSON.stringify(GUM)); } catch { /* quota */ } };
    const cl = document.createElement('label');
    cl.style.cssText = 'display:flex;align-items:center;gap:10px;margin:8px 0 2px;cursor:pointer;letter-spacing:.05em';
    const ci = document.createElement('input');
    ci.type = 'color'; ci.value = GUM.color;
    ci.style.cssText = 'width:42px;height:24px;border:1px solid #ffffff44;border-radius:4px;background:none;padding:0;cursor:pointer';
    ci.addEventListener('input', () => { GUM.color = ci.value; saveGum(); });
    cl.append(ci, document.createTextNode('Couleur de sa fumée'));
    fp.append(cl);
    const gs = (label, key, min, max, step) => slider(label, min, max, step, () => GUM[key], (v) => { GUM[key] = v; saveGum(); });
    gs('Taille de la boule (m)', 'size', 0.3, 2.5, 0.05);
    gs('Vitesse (m/s)', 'speed', 2, 30, 0.5);
    gs('Durée collée (s)', 'stick', 1, 300, 1);
    gs('Quantité de fumée', 'smoke', 0, 5, 0.1);
    gs('Densité de la fumée', 'density', 0.3, 8, 0.1);
    const row = document.createElement('div');
    fp.append(row);
    button(row, 'Retirer toutes les gommes', () => gumsClear());
  }
  heading('FUMÉE DES ARMES (OUTILS 4 · 5 · 6)');
  {
    const saveGun = () => { try { localStorage.setItem('ingaGun2', JSON.stringify(GUN)); } catch { /* quota */ } };
    // Une arme à la fois : les curseurs règlent la fumée de l'arme choisie.
    let wsel = 'musket';
    const names = { pistol: 'Pistolet', musket: 'Mousquet', hado: 'Hadoken' };
    const row = document.createElement('div');
    fp.append(row);
    const wbtn = {};
    const cur2 = () => GUN[wsel];
    const paintW = () => { for (const k in wbtn) wbtn[k].style.background = k === wsel ? '#ffb06066' : '#f5f0e916'; ci2.value = cur2().color; for (const r of refreshers) r(); };
    for (const k in names) wbtn[k] = button(row, names[k], () => { wsel = k; paintW(); });
    const cl = document.createElement('label');
    cl.style.cssText = 'display:flex;align-items:center;gap:10px;margin:8px 0 2px;cursor:pointer;letter-spacing:.05em';
    const ci2 = document.createElement('input');
    ci2.type = 'color';
    ci2.style.cssText = 'width:42px;height:24px;border:1px solid #ffffff44;border-radius:4px;background:none;padding:0;cursor:pointer';
    ci2.addEventListener('input', () => { cur2().color = ci2.value; saveGun(); });
    cl.append(ci2, document.createTextNode('Couleur de la fumée'));
    fp.append(cl);
    const ws = (label, key, min, max, step) => slider(label, min, max, step, () => cur2()[key], (v) => { cur2()[key] = v; saveGun(); });
    ws('Quantité', 'amount', 0, 6, 0.1);
    ws('Densité (opacité)', 'density', 0.3, 10, 0.1);
    ws('Perturbation', 'turb', 0, 3, 0.05);
    ws('Durée', 'life', 0.2, 4, 0.05);
    ws('Taille des bouffées', 'size', 0.4, 3, 0.05);
    slider('Vitesse des balles', 0.2, 2, 0.05, () => GUN.speed, (v) => { GUN.speed = v; saveGun(); });
    refreshers.push(() => { for (const k in wbtn) wbtn[k].style.background = k === wsel ? '#ffb06066' : '#f5f0e916'; ci2.value = cur2().color; });
  }
  heading('PISTOLET À PEINTURE (OUTIL 3)');
  {
    const savePaint = () => { try { localStorage.setItem('ingaPaint', JSON.stringify({ color: PAINT.color, random: PAINT.random, life: PAINT.life, smoke: PAINT.smoke, bubbles: PAINT.bubbles, size: PAINT.size })); } catch { /* quota */ } };
    const lab = document.createElement('label');
    lab.style.cssText = 'display:flex;align-items:center;gap:8px;margin:6px 0 2px;cursor:pointer;letter-spacing:.05em';
    const rnd = document.createElement('input');
    rnd.type = 'checkbox'; rnd.style.accentColor = '#ffb060'; rnd.checked = PAINT.random;
    rnd.addEventListener('change', () => { PAINT.random = rnd.checked; savePaint(); });
    lab.append(rnd, document.createTextNode('Couleur au hasard à chaque tir'));
    fp.append(lab);
    const cl = document.createElement('label');
    cl.style.cssText = 'display:flex;align-items:center;gap:10px;margin:8px 0 2px;cursor:pointer;letter-spacing:.05em';
    const ci = document.createElement('input');
    ci.type = 'color'; ci.value = PAINT.color;
    ci.style.cssText = 'width:42px;height:24px;border:1px solid #ffffff44;border-radius:4px;background:none;padding:0;cursor:pointer';
    ci.addEventListener('input', () => { PAINT.color = ci.value; PAINT.random = false; rnd.checked = false; savePaint(); });
    cl.append(ci, document.createTextNode('Couleur de la peinture'));
    fp.append(cl);
    slider('Taille de l\'éclatement', 0.4, 3, 0.05, () => PAINT.size, (v) => { PAINT.size = v; savePaint(); });
    slider('Quantité de fumée des taches', 0, 8, 0.1, () => PAINT.smoke, (v) => { PAINT.smoke = v; savePaint(); });
    slider('Durée du bouillonnement (s)', 0, 30, 0.5, () => PAINT.life, (v) => { PAINT.life = v; savePaint(); });
    slider('Bulles', 0, 3, 0.05, () => PAINT.bubbles, (v) => { PAINT.bubbles = v; savePaint(); });
    const row = document.createElement('div');
    fp.append(row);
    button(row, 'Effacer la peinture', () => paintClear());
  }
  heading('TIR DE NUAGE · BOULE D\'AIR (OUTIL 2)');
  slider('Taille du tir (m)', 0.3, 4, 0.05, () => SMOKE_VIEW.airSize, (v) => { SMOKE_VIEW.airSize = v; });
  slider('Vitesse du tir (m/s)', 2, 45, 0.5, () => SMOKE_VIEW.airSpeed, (v) => { SMOKE_VIEW.airSpeed = v; });
  slider('Taille du nuage dans la boule', 0.3, 1.6, 0.05, () => SMOKE_VIEW.airCloud, (v) => { SMOKE_VIEW.airCloud = v; });
  slider('Durée de l\'accélération (s)', 0.05, 1.5, 0.05, () => SMOKE_VIEW.airAccel, (v) => { SMOKE_VIEW.airAccel = v; });
  slider('Fumée blanche emportée', 0, 4, 0.1, () => SMOKE_VIEW.airSmoke, (v) => { SMOKE_VIEW.airSmoke = v; });
  if (roomSmoke()) {
    heading('SIMULATION GPU (DENSITÉ FINE)');
    const check = (label, key, after) => {
      const lab = document.createElement('label');
      lab.style.cssText = 'display:flex;align-items:center;gap:8px;margin:6px 0 2px;cursor:pointer;letter-spacing:.05em';
      const inp = document.createElement('input');
      inp.type = 'checkbox'; inp.style.accentColor = '#ffb060';
      inp.addEventListener('change', () => { SMOKE_VIEW[key] = inp.checked ? 1 : 0; after?.(); save(); });
      lab.append(inp, document.createTextNode(label));
      fp.append(lab);
      refreshers.push(() => { inp.checked = !!SMOKE_VIEW[key]; });
    };
    check('Densité sur le GPU', 'gpu', () => { bacClear(); roomSmoke().clear(); });
    check('Grille resserrée autour du joueur', 'focus');
    slider('Turbulence sous-maille', 0, 3, 0.05, () => SMOKE_VIEW.turb, (v) => { SMOKE_VIEW.turb = v; });
    slider('Effet du joueur sur la fumée', 0, 3, 0.05, () => SMOKE_VIEW.body, (v) => { SMOKE_VIEW.body = v; });
    const resRow = document.createElement('div');
    fp.append(resRow);
    const resBtns = {};
    const paint = () => { for (const r in resBtns) resBtns[r].style.background = +r === SMOKE_VIEW.res ? '#ffb06066' : '#f5f0e916'; };
    for (const r of [96, 128, 160, 192, 256, 320, 384, 512, 640, 704, 768]) {
      resBtns[r] = button(resRow, `Grille ${r}${roomSmoke().mono(r) ? ' · sans couleur' : ''}`, () => { if (!roomSmoke().setRes(r)) return; SMOKE_VIEW.res = r; paint(); save(); });
      // Au-delà, le volume ne tient plus dans une texture de ce GPU.
      if (!roomSmoke().fits(r)) { resBtns[r].disabled = true; resBtns[r].style.opacity = '.35'; }
      resBtns[r].title = `≈ ${roomSmoke().vram(r).toFixed(1)} Go de mémoire vidéo`;
    }
    paint();
    heading('QUALITÉ MAXIMALE');
    check('Rendu en pleine résolution', 'full');
    check('Volume de lumière fin', 'lightFull', () => roomSmoke().setLightFull(!!SMOKE_VIEW.lightFull));
    check('Vitesse 64³ (solveur ≈ 8× plus lent)', 'vel64', () => roomSmoke().setVelN(SMOKE_VIEW.vel64 ? 64 : 32));
    slider('Pas de simulation par seconde', 10, 60, 1, () => SMOKE_VIEW.simHz, (v) => { SMOKE_VIEW.simHz = v; });
    slider('Finesse du lancer de rayons', 1, 3, 0.25, () => SMOKE_VIEW.march, (v) => { SMOKE_VIEW.march = v; });
    const stat = document.createElement('div');
    stat.style.cssText = 'opacity:.7;margin-top:8px';
    fp.append(stat);
    setInterval(() => {
      if (!smokeSrcUI.open) return;
      const st = roomSmoke().stats;
      stat.textContent = SMOKE_VIEW.gpu ? `${st.hz.toFixed(0)} pas/s · cellule près de vous ${(st.cell * 100).toFixed(1)} cm · Worker ${st.workerMs.toFixed(1)} ms · ≈ ${roomSmoke().vram(SMOKE_VIEW.res).toFixed(1)} Go` : 'Solveur CPU d\'origine';
    }, 400);
  }

  function refresh() {
    const nSel = smokeSources.filter(isSel).length;
    selTitle.textContent = nSel > 1 ? `${nSel} SOURCES SÉLECTIONNÉES` : smokeSources[sel] ? `SOURCE ${sel + 1} / ${smokeSources.length}` : 'PROCHAINE SOURCE (MODÈLE)';
    list.textContent = '';
    smokeSources.forEach((o, i) => {
      const b = button(list, String(i + 1), (e) => {
        if (e.shiftKey) {
          // Maj+clic : ajoute ou retire cette source de la sélection.
          if (smokeSources[sel]) multi.add(smokeSources[sel]);
          if (multi.has(o)) {
            multi.delete(o);
            if (sel === i) sel = smokeSources.findIndex((x) => multi.has(x));
          } else { multi.add(o); sel = i; }
        } else { multi.clear(); sel = sel === i ? -1 : i; }
        refresh();
      });
      b.style.background = isSel(o, i) ? (i === sel ? '#ffb06066' : '#ffb06038') : '#f5f0e916';
      b.style.opacity = o.on ? '1' : '.5';
    });
    smokeSrcUI.refresh = refresh;
    smokeSrcUI.resetSel = () => { sel = -1; multi.clear(); vacSel = -1; vacMulti.clear(); if (smokeSrcUI.open) refresh(); else { rebuildMarkers(); rebuildVacs(); } };
    onBox.checked = cur().on;
    colBox.value = cur().color || '#ffffff';
    smokeSrcUI.refreshVacs?.();
    for (const r of refreshers) r();
    rebuildMarkers();
  }
  function removeAt(i) {
    multi.delete(smokeSources[i]);
    smokeSources.splice(i, 1);
    sel = Math.min(sel, smokeSources.length - 1);
    refresh();
    save();
  }
  function add(x, y, z) {
    if (smokeSources.length >= MAX_SOURCES) return null;
    const o = mkSource(x, y, z, cur());
    smokeSources.push(o);
    multi.clear();
    sel = smokeSources.length - 1;
    refresh();
    save();
    return o;
  }
  const _dir = new THREE.Vector3(), _pt = new THREE.Vector3(), _to = new THREE.Vector3();
  // Point de pose : à « distance » dans l'axe du regard, arrêté par les
  // parois du hall (viser le sol pose la source au sol).
  function aimPoint() {
    camera.getWorldDirection(_dir);
    const p = camera.position;
    let t = SMOKE_VIEW.dist;
    if (p.x > LO.x && p.x < HI.x && p.y > LO.y && p.y < HI.y && p.z > LO.z && p.z < HI.z) {
      for (const a of ['x', 'y', 'z']) {
        if (_dir[a] > 1e-5) t = Math.min(t, (HI[a] - p[a]) / _dir[a]);
        else if (_dir[a] < -1e-5) t = Math.min(t, (LO[a] - p[a]) / _dir[a]);
      }
    }
    // Dans la ville, le repère s'arrête sur la première surface visée.
    if (level === 'brutal') t = Math.max(0.3, Math.min(t, brutal.rayDist(p, _dir, t) - 0.15));
    return _pt.copy(p).addScaledVector(_dir, t).clamp(LO, HI);
  }
  const locked = () => document.pointerLockElement === renderer.domElement;
  function setOpen(open) {
    if (open === smokeSrcUI.open) return;
    smokeSrcUI.open = open;
    fp.style.display = open ? 'block' : 'none';
    markers.visible = open;
    gizmo.visible = false;
    smokeSrcUI.refreshVacs?.();
    if (open) { refresh(); devMenuSuppress = performance.now(); document.exitPointerLock?.(); }
  }
  smokeSrcUI.close = () => setOpen(false);
  smokeSrcUI.add = add;
  smokeSrcUI.update = () => {
    if (!smokeSrcUI.open) return;
    gizmo.visible = locked();
    if (gizmo.visible) {
      gizmo.position.copy(aimPoint());
      gizmo.scale.setScalar(Math.max(0.45, cur().radius));
    }
  };
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyV' || e.repeat || e.target instanceof HTMLInputElement) return;
    if (!smokeSrcUI.open && (!started || !inRoom() || fogBrush.open || builder.ui.open)) return;
    setOpen(!smokeSrcUI.open);
  });
  window.addEventListener('mousedown', (e) => {
    // Souris libre = réglages ; le clic qui la recapture ne pose rien.
    if (!smokeSrcUI.open || !locked()) return;
    if (e.button === 0) { if (placeVac) addVac(aimPoint().x, _pt.y, _pt.z); else add(aimPoint().x, _pt.y, _pt.z); }
    else if (e.button === 2) {
      // Retire ce qui est visé : source ou aspirateur, le plus dans l'axe.
      camera.getWorldDirection(_dir);
      let best = -1, bestVac = false, bestCos = Math.cos(8 * Math.PI / 180);
      const scan = (list, vac) => list.forEach((o, i) => {
        const c = _to.set(o.x, o.y, o.z).sub(camera.position).normalize().dot(_dir);
        if (c > bestCos) { bestCos = c; best = i; bestVac = vac; }
      });
      scan(smokeSources, false); scan(smokeVacs, true);
      if (best >= 0 && bestVac) { vacMulti.delete(smokeVacs[best]); smokeVacs.splice(best, 1); vacSel = Math.min(vacSel, smokeVacs.length - 1); refresh(); save(); }
      else if (best >= 0) removeAt(best);
    }
  });
  window.addEventListener('wheel', (e) => {
    if (!smokeSrcUI.open || !locked()) return;
    SMOKE_VIEW.dist = flClamp(SMOKE_VIEW.dist * (e.deltaY > 0 ? 0.9 : 1.1), 0.5, 25);
    for (const r of refreshers) r();
    save();
  });
}
// Panneau du bac : dimension (3D / 2D), algorithme, réglages, coût mesuré.
{
  const saved = (() => { try { return JSON.parse(localStorage.getItem('ingaBac')) || {}; } catch { return {}; } })();
  if (BAC_ALGOS[saved.algo]) bacAlgoId = saved.algo;
  if (['stam', 'mac', 'reflect'].includes(saved.scheme)) smoke2d.params.scheme = saved.scheme;
  if ([256, 512, 1024].includes(saved.width)) smoke2d.params.width = saved.width;
  bac2d.on = saved.dim === '2d';
  const save = () => {
    try { localStorage.setItem('ingaBac', JSON.stringify({ algo: bacAlgoId, dim: bac2d.on ? '2d' : '3d', scheme: smoke2d.params.scheme, width: smoke2d.params.width })); } catch { /* quota */ }
  };
  const fp = document.createElement('div');
  fp.style.cssText = 'position:fixed;top:64px;left:18px;width:285px;max-height:calc(100vh - 150px);overflow:auto;background:#101512cc;color:#e4e8de;font:11px "DM Sans",sans-serif;padding:14px 16px;border:1px solid #ffffff2a;border-radius:10px;z-index:9;display:none;backdrop-filter:blur(12px)';
  document.body.appendChild(fp);
  smokeUI.panel = fp;
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
  const refreshers = [];
  const slider = (parent, label, min, max, step, get, set) => {
    const w = el(parent, 'margin:7px 0 2px');
    const lab = el(w, 'display:flex;justify-content:space-between;letter-spacing:.05em');
    const nameEl = document.createElement('span'); nameEl.textContent = label;
    const valEl = document.createElement('span'); valEl.style.opacity = '.7';
    lab.append(nameEl, valEl);
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step;
    inp.style.cssText = 'width:100%;accent-color:#6fb8c5';
    const fmt = (v) => (step >= 1 ? String(Math.round(v)) : (+v).toFixed(2));
    inp.addEventListener('input', () => { valEl.textContent = fmt(+inp.value); set(+inp.value); });
    w.append(inp);
    refreshers.push(() => { inp.value = get(); valEl.textContent = fmt(get()); });
  };
  el(fp, 'letter-spacing:.16em;font-size:10px;margin-bottom:6px', 'BAC À FUMÉE');
  const dimRow = el(fp, '');
  const dimBtns = { '3d': button(dimRow, '3D · volume', () => setDim(false)), '2d': button(dimRow, '2D · coupe', () => setDim(true)) };
  const cost = el(fp, 'opacity:.75;margin:2px 0 0');
  refreshers.push(globalCheck(fp, '#6fb8c5'));
  // Mode global : toute retouche dans ce panneau met à jour la référence commune.
  for (const ev of ['input', 'click']) fp.addEventListener(ev, () => { if (globalParams) setTimeout(shareFromBac, 0); });
  {
    const lab = document.createElement('label');
    lab.style.cssText = 'display:flex;align-items:center;gap:8px;margin:8px 0 0;cursor:pointer;letter-spacing:.04em';
    const inp = document.createElement('input');
    inp.type = 'checkbox'; inp.style.accentColor = '#6fb8c5'; inp.checked = BAC.open;
    inp.addEventListener('change', () => {
      BAC.open = inp.checked;
      try { localStorage.setItem('ingaBacOpen', BAC.open ? '1' : '0'); } catch { /* quota */ }
      // Parois différentes : masques du solveur, Worker et shaders à refaire.
      if (flDomain === 'bac') { flConfigure('bac', true); bacSetAlgo(bacAlgoId); }
      smoke3d.setUniform('uBacOpen', BAC.open ? 1 : 0);
      smoke3d.reconfigure();
      smoke2d.setOpen(BAC.open);
    });
    lab.append(inp, document.createTextNode('Bac ouvert (deux parois retirées)'));
    fp.append(lab);
  }

  // ---- 3D
  const p3 = el(fp, '');
  heading(p3, 'ALGORITHME');
  const algoRow = el(p3, '');
  const algoBtns = {};
  for (const id in BAC_ALGOS) algoBtns[id] = button(algoRow, BAC_ALGOS[id].name, () => { bacSetAlgo(id); refresh(); save(); });
  const info = el(p3, 'opacity:.72;line-height:1.45;margin:2px 0 4px');
  if (!fogPass) el(p3, 'color:#ffb060;margin:4px 0', 'Le rendu volumique demande la qualité ÉLEVÉE (menu Échap). « Fumée en particules » et le bac 2D fonctionnent à toutes les qualités.');
  const bacSim = (key) => (v) => { FL_DOMAINS.bac.sim[key] = v; if (flDomain === 'bac') FL[key] = v; smoke3d.params[key] = v; smoke3d.setSim(); };
  slider(p3, 'Poids', -4, 12, 0.1, () => FL_DOMAINS.bac.sim.weight, bacSim('weight'));
  slider(p3, 'Tourbillons (confinement)', 0, 8, 0.1, () => FL_DOMAINS.bac.sim.swirl, bacSim('swirl'));
  slider(p3, 'Dissipation', 0, 0.6, 0.01, () => FL_DOMAINS.bac.sim.dissip, bacSim('dissip'));
  slider(p3, 'Viscosité', 0, 0.3, 0.005, () => FL_DOMAINS.bac.sim.visc, bacSim('visc'));
  slider(p3, 'Opacité', 0.2, 8, 0.1, () => BAC_VIEW.gain, (v) => { BAC_VIEW.gain = v; });
  slider(p3, 'Force du détail (bruit advecté)', 0, 2.5, 0.05, () => BAC_VIEW.detail, (v) => { BAC_VIEW.detail = v; });
  slider(p3, 'Particules par bouffée', 5000, 120000, 5000, () => BAC_VIEW.particles, (v) => { BAC_VIEW.particles = v; });

  // ---- Options de la filière GPU (toutes débrayables pour mesurer)
  const pg = el(p3, '');
  heading(pg, 'ASTUCES GPU');
  const check = (parent, label, get, set) => {
    const lab = document.createElement('label');
    lab.style.cssText = 'display:flex;align-items:center;gap:8px;margin:5px 0;cursor:pointer;letter-spacing:.04em';
    const inp = document.createElement('input');
    inp.type = 'checkbox'; inp.style.accentColor = '#6fb8c5';
    inp.addEventListener('change', () => set(inp.checked));
    lab.append(inp, document.createTextNode(label));
    parent.append(lab);
    refreshers.push(() => { inp.checked = !!get(); });
  };
  const G = smoke3d.params;
  check(pg, 'Boîte qui suit la fumée', () => G.follow, (v) => { G.follow = v; smoke3d.clear(); });
  check(pg, 'Grille resserrée vers la caméra (densité fine)', () => G.focus, (v) => { G.focus = v; });
  check(pg, 'Interpolation entre les pas', () => G.interp, (v) => { G.interp = v; });
  check(pg, 'Rendu demi-résolution accumulé', () => G.halfRes, (v) => { G.halfRes = v; });
  check(pg, 'Auto-ombrage (volume de lumière)', () => G.shadows, (v) => { G.shadows = v; });
  check(pg, 'Volume de lumière fin', () => G.lightFull, (v) => { smoke3d.setLightFull(v); });
  check(pg, 'Vitesse 64³ (Worker ≈ 8× plus lent)', () => G.velN === 64, (v) => { smoke3d.setVelN(v ? 64 : 32); });
  slider(pg, 'Finesse du lancer de rayons', 1, 3, 0.25, () => G.march, (v) => { G.march = v; });
  slider(pg, 'Turbulence sous-maille', 0, 3, 0.05, () => G.turb, (v) => { G.turb = v; });
  slider(pg, 'Pas de simulation par seconde', 8, 60, 1, () => G.simHz, (v) => { G.simHz = v; });
  slider(pg, 'Itérations de pression (solveur complet)', 6, 60, 1, () => G.jacobi, (v) => { G.jacobi = v; });
  heading(pg, 'GRILLE DE DENSITÉ');
  const gresRow = el(pg, '');
  const gresBtns = {};
  for (const r of [96, 128, 160, 192, 256, 320, 384, 512, 640, 704, 768]) {
    gresBtns[r] = button(gresRow, String(r), () => { smoke3d.setRes(r); refresh(); });
    if (!smoke3d.fits(r)) { gresBtns[r].disabled = true; gresBtns[r].style.opacity = '.35'; }
    gresBtns[r].title = `≈ ${smoke3d.vram(r).toFixed(1)} Go de mémoire vidéo`;
  }
  heading(pg, 'GRILLE DE VITESSE (SOLVEUR COMPLET)');
  const gvRow = el(pg, '');
  const gvBtns = {};
  for (const r of [48, 64, 96, 128]) gvBtns[r] = button(gvRow, String(r), () => { smoke3d.setVelRes(r); refresh(); });
  heading(pg, 'PARTICULES');
  const gptRow = el(pg, '');
  const gptBtns = {};
  for (const [sz, label] of [[512, '262 000'], [1024, '1 million'], [1448, '2 millions'], [2048, '4 millions']]) gptBtns[sz] = button(gptRow, label, () => { smoke3d.setParticles(sz); refresh(); });

  // ---- 2D
  const p2 = el(fp, '');
  heading(p2, 'SCHÉMA D\'ADVECTION');
  const schRow = el(p2, '');
  const SCHEMES = { stam: 'Stam', mac: 'MacCormack', reflect: 'Advection-réflexion' };
  const schBtns = {};
  for (const id in SCHEMES) schBtns[id] = button(schRow, SCHEMES[id], () => { smoke2d.params.scheme = id; refresh(); save(); });
  heading(p2, 'RÉSOLUTION (LARGEUR)');
  const resRow = el(p2, '');
  const resBtns = {};
  for (const w of [256, 512, 1024]) resBtns[w] = button(resRow, String(w), () => { smoke2d.setWidth(w); refresh(); save(); });
  el(p2, 'opacity:.72;line-height:1.45;margin:2px 0 4px', 'Solveur entièrement sur GPU (Jacobi pour la pression). En 2D la grille peut être très fine pour un coût minime : c\'est la référence « haute résolution ».');
  slider(p2, 'Poids', -4, 12, 0.1, () => smoke2d.params.weight, (v) => { smoke2d.params.weight = v; });
  slider(p2, 'Tourbillons (confinement)', 0, 40, 0.5, () => smoke2d.params.swirl, (v) => { smoke2d.params.swirl = v; });
  slider(p2, 'Dissipation', 0, 0.6, 0.01, () => smoke2d.params.dissip, (v) => { smoke2d.params.dissip = v; });
  slider(p2, 'Itérations de pression', 5, 80, 1, () => smoke2d.params.iterations, (v) => { smoke2d.params.iterations = v; });
  slider(p2, 'Opacité', 0.3, 8, 0.1, () => smoke2d.params.opacity, (v) => smoke2d.setOpacity(v));

  const hl = (b, on) => { b.style.background = on ? '#6fb8c540' : '#f5f0e916'; };
  function refresh() {
    smokeUI.refresh = refresh;
    hl(dimBtns['3d'], !bac2d.on); hl(dimBtns['2d'], bac2d.on);
    p3.style.display = bac2d.on ? 'none' : 'block';
    p2.style.display = bac2d.on ? 'block' : 'none';
    for (const id in algoBtns) hl(algoBtns[id], id === bacAlgoId);
    for (const id in schBtns) hl(schBtns[id], id === smoke2d.params.scheme);
    for (const w in resBtns) hl(resBtns[w], +w === smoke2d.params.width);
    info.textContent = BAC_ALGOS[bacAlgoId].info;
    pg.style.display = BAC_ALGOS[bacAlgoId].gpu ? 'block' : 'none';
    for (const r in gresBtns) hl(gresBtns[r], +r === G.res);
    for (const r in gvBtns) hl(gvBtns[r], +r === G.vres);
    for (const sz in gptBtns) hl(gptBtns[sz], +sz === G.particles);
    for (const r of refreshers) r();
  }
  function setDim(is2d) {
    bac2d.on = is2d;
    smoke2d.clear();
    smoke3d.clear();
    bacClear();
    smokeUI.applyDim();
    refresh();
    save();
  }
  // Caméra et visibilité selon la dimension (appelé aussi par setLevel).
  smokeUI.applyDim = () => {
    smoke2d.mesh.visible = bac2d.on;
    if (pt.points) pt.points.visible = !bac2d.on && flAlgo.particles;
    if (bac2d.on) {
      // Décalé vers la gauche : le panneau ne recouvre pas la coupe.
      camera.position.set(smoke2d.center.x - 5, smoke2d.center.y, smoke2d.center.z + 31);
      bacControls.target.copy(smoke2d.center).x -= 5;
    } else {
      camera.position.set(BAC.cx + 20, 16, BAC.cz + 34);
      bacControls.target.set(BAC.cx, 1.5, BAC.cz);
    }
    bacControls.update();
    refresh();
  };
  setInterval(() => {
    if (fp.style.display === 'none') return;
    cost.textContent = bac2d.on
      ? `Simulation sur GPU · ${smoke2d.params.width}×${Math.round(smoke2d.params.width * 22 / 40)}`
      : flAlgo.gpu
        ? `GPU · ${smoke3d.stats.hz.toFixed(0)} pas/s · cellule ${(smoke3d.stats.cell * 100).toFixed(0)} cm` + (flAlgo.gpu === 'full' ? ' · CPU 0 ms' : ` · Worker ${smoke3d.stats.workerMs.toFixed(1)} ms`)
        : `Simulation CPU : ${bacDirty ? bacMs.toFixed(1) : '—'} ms / pas`;
  }, 400);
}
// Caméra orbitale du bac : rotation au glisser, molette pour zoomer,
// clic droit pour décaler la cible. Active uniquement dans ce niveau
// (le pointer lock y est déjà désactivé partout).
const bacControls = new OrbitControls(camera, renderer.domElement);
bacControls.enabled = false;
bacControls.enableDamping = true;
bacControls.dampingFactor = 0.08;
bacControls.minDistance = 6;
bacControls.maxDistance = 90;
bacControls.maxPolarAngle = Math.PI / 2 - 0.03; // jamais sous le sol
bacControls.target.set(BAC.cx, 1.5, BAC.cz);
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
const HAZE_FOG = scene.fog;
const BAC_BG = new THREE.Color('#020202');

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
MIST_RANGE.x = VALLEY.y - 2;
MIST_RANGE.y = VALLEY.y + 4;
const MIST = { color: new THREE.Color('#e7e3db') };
function addGroundMist(mat) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(mat, sh, r);
    sh.uniforms.uMistTime = mistUniforms.uMistTime;
    sh.uniforms.uMistColor = { value: MIST.color };
    sh.uniforms.uMistRange = { value: MIST_RANGE };
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
  if (globalParams && lv === 'smoke') shareToBac();
  try { localStorage.setItem('inga-level', lv); } catch { /* stockage indisponible */ }
  const valley = lv === 'valley';
  const smoke = lv === 'smoke';
  const atelier = lv === 'atelier';
  const brutalLv = lv === 'brutal';
  paintClear(); // la peinture appartient au niveau que l'on quitte
  gumsClear();
  // Le bac et l'atelier remplacent le monde : on masque tous les enfants de
  // la scène sauf lumières et racines dédiées, en mémorisant leur visibilité.
  const blank = smoke || atelier || brutalLv;
  if (blank !== worldHidden) {
    worldHidden = blank;
    fogGround = null; // terrain map differs per level; rebuilt lazily
    for (const c of scene.children) {
      if (c === sandboxRoot || c === atelierRoot || c === roomRoot || c === brutal.root || c.isLight || c === sun.target || c === fogBrushGizmo) continue;
      if (blank) { c.userData._lvVis = c.visible; c.visible = false; }
      else if ('_lvVis' in c.userData) { c.visible = c.userData._lvVis; delete c.userData._lvVis; }
    }
  }
  sandboxRoot.visible = smoke;
  atelierRoot.visible = atelier;
  roomRoot.visible = lv === 'hall' || atelier || brutalLv;
  brutal.root.visible = brutalLv;
  setSceneLite(brutalLv);
  if (!brutalLv && (brutal.ready || brutal.loading)) {
    // On quitte la ville : mémoire rendue (elle se rechargera en ~5 s).
    const i = ssrSelects.indexOf(brutal.groundMesh);
    if (i >= 0) ssrSelects.splice(i, 1);
    Promise.resolve(brutal.loading).then(() => { if (level !== 'brutal') brutal.unload(); });
    paintClear();
  }
  sky.visible = !blank; // ni dôme ni soleil visible dans les niveaux à part
  setSunRig(brutalLv);
  if (inRoom()) swapSources(brutalLv ? 'brutal' : 'room');
  if (smoke !== (flDomain === 'bac')) {
    // Le solveur change de domaine avec le niveau (bac ↔ pièce) : on repart
    // d'un fluide vide. (flConfigure réalloue la texture de densité.)
    flConfigure(smoke ? 'bac' : 'hall');
    if (smoke) bacSetAlgo(bacAlgoId); else { bacClear(); smoke3d.clear(); }
    smoke2d.clear();
  } else if (!smoke) bacClear();
  smoke3dHall?.clear(); smoke3dBrutal?.clear();
  // Bac et atelier : le brouillard peint du monde est débranché.
  if (fogPass) fogPass.uniforms.uFogVol.value = blank ? emptyFogTex : fogVolTex;
  if (!inRoom()) { smokeSrcUI.close?.(); builder.close(); }
  scene.background = smoke ? BAC_BG : atelier ? ATELIER_BG : brutalLv ? BRUTAL_BG : HAZE_COLOR;
  scene.fog = smoke || atelier ? null : brutalLv ? BRUTAL_FOG : HAZE_FOG;
  if (bloomPass) bloomPass.strength = brutalLv ? 0.3 : 0.22;
  smokeUI.style.display = smoke ? 'flex' : 'none';
  smokeUI.panel.style.display = smoke ? 'block' : 'none';
  bacControls.enabled = smoke;
  if (smoke) { devMenuSuppress = performance.now(); document.exitPointerLock?.(); }
  if (fogPass) fogPass.enabled = !valley;
  sun.castShadow = valley ? false : sunShadow0;
  sun.intensity = valley ? 1.9 : 3.6;
  valleyHemi.intensity = valley ? 1.0 : smoke ? 0.8 : atelier ? 0.5 : brutalLv ? 1.5 : HALL_SKY_HEMI;
  bayFill.intensity = valley || blank ? 0 : 0.42;
  scene.environmentIntensity = brutalLv ? 0.6 : valley ? 0.3 : 0.08;
  camera.far = 450;
  camera.updateProjectionMatrix();
  dust.visible = lv === 'hall';
  bayDust.visible = lv === 'hall';
  if (valley) {
    const sx2 = dsMeander(95) + 10;
    camera.position.set(VALLEY.x + sx2, VALLEY.y + dsHeight(sx2, 95) + 1.58, VALLEY.z + 95);
  } else if (smoke) {
    // Pas de joueur dans le bac : OrbitControls orbite autour du bassin.
    smokeUI.applyDim();
  } else if (brutalLv) {
    brutal._placed = false;
    camera.position.copy(brutal.spawn);
    brutal.load().then(() => {
      if (level === 'brutal' && brutal.custom && !brutal._placed) {
        // Carte personnelle : le départ n'est connu qu'une fois le fichier lu.
        brutal._placed = true;
        const g = brutal.ground(brutal.spawn.x, brutal.spawn.y, brutal.spawn.z);
        camera.position.set(brutal.spawn.x, (g ?? brutal.spawn.y) + 1.58, brutal.spawn.z);
        yaw = brutal.spawnYaw; pitch = 0; verticalVelocity = 0;
        _prevCam.copy(camera.position);
      }
      if (level === 'brutal') brutalRebase(true);
      applyCity();
    });
  } else if (atelier) {
    camera.position.set(0, 1.58, HALL.north - 3);
  } else {
    camera.position.set(0, 1.58, HALL.north - 1.5);
  }
  // Chaque pièce a sa construction (murs, lampes, soleil) ; ailleurs, le
  // soleil d'origine revient.
  applyCity();
  setRoomBounds();
  // Ciel couvert : une lumière froide et diffuse remplace le soleil doré
  // (réglage posé une fois ; ensuite l'outil B garde la main).
  if (brutalLv) {
    try {
      if (localStorage.getItem('ingaBrutalMood') !== 'gris1') {
        const cur = JSON.parse(localStorage.getItem('ingaBuild:brutal') || 'null') || { boxes: [], lights: [] };
        cur.sun = { color: '#dfe6f5', intensity: 2.6, az: 140, el: 46 };
        localStorage.setItem('ingaBuild:brutal', JSON.stringify(cur));
        localStorage.setItem('ingaBrutalMood', 'gris1');
      }
    } catch { /* stockage indisponible */ }
  }
  if (inRoom()) applyRoomParams();
  if (inRoom()) builder.load(lv); else applyBuild({ boxes: [], lights: [], sun: SUN_DEFAULTS }, false);
  yaw = brutalLv ? brutal.spawnYaw : 0;
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
  if (level === 'atelier') return { y: 0, surface: 'stone' };
  const ax = Math.abs(x);
  const onSouthBridge = ax <= 2.1 && z >= -5.06 && z <= -3.74;
  const onThreshold = ax <= DOOR_HALF - 0.1 && z >= CHANNEL.iz1 - 0.15;
  const inCanal = (ax > CHANNEL.ix1 || z < CHANNEL.iz0 || z > CHANNEL.iz1) && z > HALL.doorZ && !onSouthBridge && !onThreshold;
  if (inCanal) return { y: CANAL_BED_Y + 0.04, surface: 'water' };
  const h = rockHeight(x, z);
  if (h > 0.015) return { y: ROCK_BASE_Y + h, surface: 'moss' };
  return { y: 0, surface: 'stone' };
}
const _mvA = new THREE.Vector3(), _mvD = new THREE.Vector3();
function canOccupy(x, z) {
  if (level === 'smoke') return Math.abs(x) < 44 && Math.abs(z - 9) < 44;
  if (level === 'valley') return Math.hypot(x - VALLEY.x, z - VALLEY.z) < VALLEY.radius;
  if (builder.blocked(x, z, inRoom() ? camera.position.y - 1.58 : 0)) return false;
  if (level === 'brutal') {
    // Un rayon à hauteur de poitrine, de la position actuelle à la cible :
    // les murs arrêtent, les marches (plus basses) se montent.
    _mvA.set(camera.position.x, camera.position.y - 0.62, camera.position.z);
    _mvD.set(x - _mvA.x, 0, z - _mvA.z);
    const d = _mvD.length();
    if (d < 1e-5) return true;
    return brutal.rayDist(_mvA, _mvD.divideScalar(d), d + 0.35) === Infinity;
  }
  if (level === 'atelier') return x > ROOM_LO.x && x < ROOM_HI.x && z > ROOM_LO.z && z < ROOM_HI.z;
  if (z <= HALL.doorZ) return Math.abs(x) <= WALK.corridorHalf && z >= WALK.corridorZMin;
  const onBridge = Math.abs(x) <= WALK.bridgeHalf && z >= WALK.bridgeZMin && z <= WALK.bridgeZMax;
  const ax = Math.abs(x);
  const m = WALK.islandMargin;
  const inIsland = ax > PATH_HALF - m && ax < ISLAND.x1 + m && z > ISLAND.z0 - m && z < ISLAND.z1 + m;
  // The whole interior is walkable now: marble, moss islands, and the canal
  // itself (you wade in it), right up to the walls and the glass.
  const onFloor = ax <= HALL.x - 0.3 && z >= HALL.doorZ + 0.3 && z <= HALL.north - 0.1;
  // Through the open sliding door and out onto the balcony.
  const onDoor = door.angle > DOOR_OPEN_ANGLE * 0.85 && ax <= DOOR_HALF - 0.3 && z >= WALK.floorZMax - 0.2 && z <= BAL.z0 + 0.2
    && Math.abs(x - DOOR_PIVOT_X) > 0.3;
  const col = TERRACE.column;
  const onBalcony = ax <= BAL.halfW - 0.4 && z >= BAL.z0 - 0.05 && z <= TERRACE.walkZMax
    && (!col || Math.hypot(x - col.x, z - col.z) > col.r + 0.35)
    && !(door.angle > 0.2 && Math.abs(x - DOOR_PIVOT_X) < 0.3 && z < HALL.north + 0.3 + DOOR_LEAF_W * 0.75 + 0.3);
  return onBridge || onFloor || onDoor || onBalcony;
}

let yaw = 0, pitch = 0, verticalVelocity = 0, grounded = true, started = false, activeWork = null;
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

function enter(fadeDelay = 0) {
  const intro = document.querySelector('#intro');
  setTimeout(() => intro.classList.add('leaving'), fadeDelay);
  setTimeout(() => { intro.style.display = 'none'; }, fadeDelay + 700);
  started = true;
  // Each dev resumes in the level they were working on (menu Échap).
  try {
    const sl = localStorage.getItem('inga-level');
    // La ville est lourde : on n'y revient jamais automatiquement au chargement.
    if (sl && sl !== 'hall' && sl !== 'brutal' && sl !== level) setLevel(sl);
  } catch { /* stockage indisponible */ }
  if (level !== 'smoke' && matchMedia('(pointer:fine)').matches) renderer.domElement.requestPointerLock?.();
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
  if (e.code === 'KeyG' && !e.repeat && !(e.target instanceof HTMLInputElement)) {
    godMode = !godMode;
    verticalVelocity = 0;
  }
});
document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'KeyE') releasePrompt(true);
});
renderer.domElement.addEventListener('click', () => {
  if (started && level !== 'smoke' && matchMedia('(pointer:fine)').matches && !panel.matches(':hover')) renderer.domElement.requestPointerLock?.();
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === renderer.domElement) {
    yaw -= e.movementX * 0.0021;
    pitch = Math.max(-1.35, Math.min(1.35, pitch - e.movementY * 0.0021));
  }
});
// God mode: free flight, no collision, no gravity. Space/C climb and dive.
let godMode = false;
function jump() { if (godMode || !grounded || !started) return; verticalVelocity = 4.6; grounded = false; }
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
  devMenuSuppress = performance.now();
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
  g.gain.exponentialRampToValueAtTime(0.035 * level, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
  src.connect(hp).connect(g).connect(AUD.fx);
  src.start(t0);
  for (let k = 0; k < 3; k++) {
    const td = t0 + 0.18 + Math.random() * 0.35;
    const d = ctx.createOscillator();
    d.frequency.setValueAtTime(700 + Math.random() * 500, td); d.frequency.exponentialRampToValueAtTime(1300 + Math.random() * 400, td + 0.04);
    const dg = ctx.createGain();
    dg.gain.setValueAtTime(0.0001, td); dg.gain.exponentialRampToValueAtTime(0.012 * level, td + 0.006); dg.gain.exponentialRampToValueAtTime(0.0001, td + 0.06);
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
    const dEdge = Math.min(cx - CHANNEL.ix0, CHANNEL.ix1 - cx, cz - CHANNEL.iz0, CHANNEL.iz1 - cz);
    canalVol = cz <= HALL.doorZ ? 0.08 : 0.12 + 0.5 * Math.max(0, 1 - dEdge / 8);
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

// ---- Menu dev (Échap) -------------------------------------------------------
// Escape while playing releases the mouse and opens this menu: level
// selector (each dev works in their own sandbox), quality presets and live
// lighting toggles. Escape again (or REPRENDRE) returns to the game.
{
  const LEVELS = [['hall', 'GALERIE'], ['valley', 'VALLÉE'], ['smoke', 'BAC À FUMÉE'], ['atelier', 'ATELIER'], ['brutal', 'BRUTALISME']];
  const dm = document.createElement('div');
  dm.style.cssText = 'position:fixed;inset:0;z-index:30;display:none;background:#0a0b0a66;backdrop-filter:blur(6px);font:12px "DM Sans",sans-serif;color:#e4e8de';
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:330px;background:#101512f2;border:1px solid #ffffff2a;border-radius:12px;padding:20px 24px 24px';
  dm.appendChild(box);
  document.body.appendChild(dm);
  const section = (txt) => {
    const d = document.createElement('div');
    d.style.cssText = 'letter-spacing:.16em;font-size:10px;opacity:.7;margin:16px 0 7px';
    d.textContent = txt;
    box.append(d);
  };
  const row = () => {
    const d = document.createElement('div');
    d.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
    box.append(d);
    return d;
  };
  const btn = (parent, label, on) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'background:#f5f0e916;border:1px solid #ffffff44;color:#e4e8de;padding:8px 12px;border-radius:5px;cursor:pointer;font:11px "DM Sans",sans-serif;letter-spacing:.08em';
    b.addEventListener('click', on);
    parent.append(b);
    return b;
  };
  const slider = (label, min, max, step, get, set) => {
    const w = document.createElement('div');
    w.style.cssText = 'margin:7px 0 2px';
    const lab = document.createElement('div');
    lab.style.cssText = 'display:flex;justify-content:space-between;letter-spacing:.05em';
    const nameEl = document.createElement('span');
    nameEl.textContent = label;
    const valEl = document.createElement('span');
    valEl.style.opacity = '.7';
    const inp = document.createElement('input');
    inp.type = 'range';
    inp.min = min; inp.max = max; inp.step = step;
    inp.style.cssText = 'width:100%;accent-color:#6fb8c5';
    inp.addEventListener('input', () => { valEl.textContent = (+inp.value).toFixed(2); set(+inp.value); });
    lab.append(nameEl, valEl);
    w.append(lab, inp);
    box.append(w);
    return () => { inp.value = get(); valEl.textContent = (+get()).toFixed(2); };
  };
  const check = (label, get, set) => {
    const lab = document.createElement('label');
    lab.style.cssText = 'display:flex;align-items:center;gap:8px;margin:6px 0;cursor:pointer;letter-spacing:.05em';
    const inp = document.createElement('input');
    inp.type = 'checkbox';
    inp.style.accentColor = '#6fb8c5';
    inp.addEventListener('change', () => set(inp.checked));
    lab.append(inp, document.createTextNode(label));
    box.append(lab);
    return () => { inp.checked = !!get(); };
  };

  const title = document.createElement('div');
  title.style.cssText = 'letter-spacing:.2em;font-size:12px';
  title.textContent = 'INGA · MENU DÉVELOPPEMENT';
  box.append(title);

  section('NIVEAU');
  const lvlRow = row();
  const lvlBtns = new Map();
  for (const [id, name] of LEVELS) {
    lvlBtns.set(id, btn(lvlRow, name, () => { setLevel(id); closeDevMenu(); }));
  }

  section('QUALITÉ (recharge la page)');
  const qRow = row();
  for (const q of QUALITIES) {
    const b = btn(qRow, QUALITY_LABEL[q], () => {
      const url = new URL(location.href);
      url.searchParams.set('q', q);
      location.href = url.toString();
    });
    if (q === QUALITY) b.style.background = '#6fb8c540';
  }

  section('LUMIÈRE');
  const refreshers = [
    slider('Soleil', 0, 7, 0.05, () => sun.intensity, (v) => { sun.intensity = v; }),
    slider('Ciel (hémisphérique)', 0, 3, 0.02, () => valleyHemi.intensity, (v) => { valleyHemi.intensity = v; }),
    slider('Ambiance (envmap)', 0, 1, 0.01, () => scene.environmentIntensity, (v) => { scene.environmentIntensity = v; }),
    check('Ombres du soleil', () => sun.castShadow, (v) => { sun.castShadow = v; }),
  ];
  if (gtaoPass) {
    // Occlusion ambiante : assombrit les creux et les angles (coins de murs,
    // pied des objets). Force et rayon réglables.
    const AO = { on: true, strength: 1.8, radius: 1.6 };
    try { Object.assign(AO, JSON.parse(localStorage.getItem('ingaAO')) || {}); } catch { /* réglages illisibles */ }
    const applyAO = () => {
      gtaoPass.enabled = AO.on;
      gtaoPass.updateGtaoMaterial({ scale: AO.strength, radius: AO.radius });
      try { localStorage.setItem('ingaAO', JSON.stringify(AO)); } catch { /* quota */ }
    };
    applyAO();
    refreshers.push(check('Occlusion ambiante', () => AO.on, (v) => { AO.on = v; applyAO(); }));
    refreshers.push(slider('Occlusion · force', 0, 4, 0.05, () => AO.strength, (v) => { AO.strength = v; applyAO(); }));
    refreshers.push(slider('Occlusion · rayon (m)', 0.3, 6, 0.05, () => AO.radius, (v) => { AO.radius = v; applyAO(); }));
  }
  refreshers.push(slider('Ville · luminosité', 0.4, 3, 0.05, () => CITY.bright, (v) => { CITY.bright = v; applyCity(); }));
  refreshers.push(slider('Ville · pluie', 0, 1, 0.05, () => CITY.rain, (v) => { CITY.rain = v; applyCity(); }));
  if (bloomPass) refreshers.push(check('Bloom', () => bloomPass.enabled, (v) => { bloomPass.enabled = v; }));
  if (fogPass) refreshers.push(check('Brouillard volumétrique', () => fogPass.enabled, (v) => { fogPass.enabled = v; }));

  const foot = document.createElement('div');
  foot.style.cssText = 'opacity:.55;margin-top:14px;line-height:1.5';
  foot.innerHTML = 'F · pinceau brouillard &nbsp; V · sources de fumée<br>B · construction &nbsp; T · 3e personne &nbsp; 1 à 8 · outil<br>Gomme : Espace grimper · C descendre<br>Clic · utiliser &nbsp; G · vol libre &nbsp; Échap · reprendre';
  box.append(foot);
  const resumeRow = row();
  resumeRow.style.marginTop = '12px';
  btn(resumeRow, 'REPRENDRE', () => closeDevMenu());

  let dmOpen = false;
  function refreshDM() {
    for (const [id, b] of lvlBtns) b.style.background = id === level ? '#6fb8c540' : '#f5f0e916';
    for (const r of refreshers) r();
  }
  function openDevMenu() {
    dmOpen = true;
    dm.style.display = 'block';
    refreshDM();
    devMenuSuppress = performance.now();
    document.exitPointerLock?.();
  }
  function closeDevMenu() {
    dmOpen = false;
    dm.style.display = 'none';
    // May be refused right after an Escape unlock; the next canvas click
    // relocks anyway.
    if (started && level !== 'smoke' && matchMedia('(pointer:fine)').matches) {
      try { renderer.domElement.requestPointerLock?.()?.catch?.(() => {}); } catch { /* geste requis */ }
    }
  }
  // Escape inside pointer lock never reaches keydown: the browser only
  // releases the lock. Catch that release and open the menu — unless the
  // unlock came from a panel (suppress window) or another tool is up.
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement || !started || dmOpen || fogBrush.open || smokeSrcUI.open || builder.ui.open) return;
    if (performance.now() - devMenuSuppress < 400) return;
    if (panel.style.display === 'block') return;
    openDevMenu();
  });
  // Capture phase: runs before the art-panel Escape handler, so an open
  // panel swallows this Escape instead of also opening the menu.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || e.repeat) return;
    if (dmOpen) { closeDevMenu(); return; }
    if (!started || document.pointerLockElement || fogBrush.open || smokeSrcUI.open || builder.ui.open) return;
    if (panel.style.display === 'block') return;
    openDevMenu();
  }, true);
}

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

if (import.meta.env.DEV) window.__inga = { throwTornado, tornados, throwGum, gums, fireGun, fireHadoken, shots, paintDecals, renderer, brutalLevel: brutal, gtaoPass, GTAOPass, sun, mannequin, placeDummy, shootPaint, paintSplats, builder, vacs: smokeVacs, throwBall, throwAir, airBalls, setTool, balls, smoke: { get hall3d() { return roomSmoke(); }, s3d: smoke3d, setAlgo: bacSetAlgo, spawn: bacSpawn, s2d: smoke2d, bac2d, ms: () => bacMs, sources: smokeSources, ui: smokeSrcUI, FL, tick: bacFluidTick, density: () => bacD0 }, camera, canOccupy, scene, dsHeight, dsMeander, VALLEY, look: (y, p) => { yaw = y; pitch = p; }, setLevel, quality: QUALITY, scale: () => renderScale };

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
    const pace = 0.2 + 0.8 * Math.max(0, Math.sin(t * (f.cat ? 0.07 : 0.11) + f.phase * 2.3)) ** 0.6;
    const v = f.speed * pace * boost;
    f.dist += v * dt;
    const dir = sampleLoop(f.dist, _fishPos);
    _fishPerp.set(-dir.z, 0, dir.x);
    _fishPos.addScaledVector(_fishPerp, f.lane + Math.sin(t * 0.3 + f.phase) * 0.12 + wig);
    _fishPos.y = f.depth + Math.sin(t * 0.5 + f.phase) * 0.015;
    let lift = 0;
    if (f.jump) {
      const u = (t - f.jump.t0) / f.jump.dur;
      if (u >= 1) { f.jump = null; splashAt(_fishPos, 0.6); }
      else lift = (CANAL_WATER_Y - f.depth) + Math.sin(Math.PI * u) * f.jump.h;
    }
    _fishPos.y += lift;
    f.group.position.copy(_fishPos);
    _fishAhead.copy(_fishPos).addScaledVector(dir, v >= 0 ? 1 : -1);
    if (f.jump) _fishAhead.y += Math.cos(Math.PI * ((t - f.jump.t0) / f.jump.dur)) * 0.9;
    f.group.lookAt(_fishAhead);
    // Tail beat follows speed.
    f.mat.userData.swim.uAmp.value = (f.cat ? 0.05 : 0.07) * (0.5 + 0.5 * Math.min(2, Math.abs(v) / Math.abs(f.speed || 1)));
    // Their wake on the surface (deep catfish barely touch it).
    if (ri < RIPPLE_N - 1) rippleData[ri++].set(_fishPos.x, _fishPos.z, (f.cat ? 0.05 : 0.14) * Math.min(2.5, Math.abs(v) * 4) * (f.jump ? 3 : 1), f.phase);
  }
  // Your own feet in the water.
  rippleData[RIPPLE_N - 1].set(camera.position.x, camera.position.z, playerInWater ? Math.min(0.9, playerSpeed * 0.5) : 0, 0);
  // Now and then one fish leaps.
  fishJumpTimer -= dt;
  if (fishJumpTimer <= 0) {
    fishJumpTimer = 7 + Math.random() * 12;
    const f = fish[(Math.random() * fish.length) | 0];
    if (!f.jump && !f.cat) {
      f.jump = { t0: t, dur: 0.55 + Math.random() * 0.25, h: 0.28 + Math.random() * 0.25 };
      splashAt(f.group.position, 0.45);
      f.group.position.y = CANAL_WATER_Y;
    }
  }
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
    const dirL = sampleLoop(L.dist, _fishPos);
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
    if (!fogPass.uniforms.tShadow.value && sun.shadow.map) fogPass.uniforms.tShadow.value = sun.shadow.map.texture;
    fogPass.uniforms.uTime.value = t;
    fogPass.uniforms.uProjInv.value.copy(camera.projectionMatrixInverse);
    fogPass.uniforms.uViewInv.value.copy(camera.matrixWorld);
    fogPass.uniforms.uCamPos.value.copy(camera.position);
  }
  if (fogBrush.open) {
    camera.getWorldDirection(_fbDir);
    fogBrushGizmo.position.copy(camera.position).addScaledVector(_fbDir, fogBrush.dist);
    fogBrushGizmo.scale.setScalar(fogBrush.radius);
    if (fogBrush.btn === 0 || fogBrush.btn === 2) {
      paintFog(fogBrushGizmo.position, fogBrush.radius, (fogBrush.btn === 0 ? 1.6 : -1.6) * fogBrush.strength * dt);
      fogBrush.dirty = true;
    }
  }
  const fogOn = fogPass && fogPass.enabled;
  if (level === 'smoke') {
    // Le bac 2D et la fumée en particules ne dépendent pas du brouillard
    // volumétrique : ils tournent à toutes les qualités.
    if (bac2d.on) smoke2d.step(dt);
    else if (flAlgo.gpu) {
      smoke3d.params.gain = BAC_VIEW.gain; smoke3d.params.lum = BAC_VIEW.lum;
      smoke3d.step(dt, camera);
    } else if (flAlgo.particles || fogOn) bacFluidTick(dt);
    if (pt.points) pt.points.material.uniforms.uScale.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
  } else if (fogOn) {
    fogSimTick();
    if (inRoom() && !(roomSmoke() && SMOKE_VIEW.gpu)) bacFluidTick(dt);
  }
  if (inRoom() && balls.length) ballsStep(Math.min(dt, 1 / 30));
  paintDecals?.update(dt, inRoom());
  if (inRoom() && airBalls.length) airStep(Math.min(dt, 1 / 30));
  if (inRoom()) {
    // Tir continu tant que le bouton est tenu.
    if (paintHeld && toolsActive() && TOOLS[toolIndex].id === 'paint') { paintTimer += dt; while (paintTimer > 0.5) { paintTimer -= 0.5; shootPaint(); } }
    if (paintShots.length || paintSplats.length) paintStep(Math.min(dt, 1 / 30));
    if (gunHeld && toolsActive() && TOOLS[toolIndex].id === 'pistol') { gunTimer += dt; while (gunTimer > 0.17) { gunTimer -= 0.17; fireGun('pistol'); } }
    if (shots.length || puffs.length) shotsStep(Math.min(dt, 1 / 30));
    if (gums.length) gumsStep(Math.min(dt, 1 / 30));
    if (tornados.length) tornadosStep(Math.min(dt, 1 / 30));
    if (sparks.n || sparkGeo.drawRange.count) sparksStep(Math.min(dt, 1 / 30));
    if (pp.length || ppMesh.count) ppStep(Math.min(dt, 1 / 30));
    if (paintSplats.length || bubbleMesh.count) paintBubbles();

  }
  toolHud.style.display = inRoom() && started ? 'flex' : 'none';
  builder.update();
  mannequin.update(dt);
  if (level === 'brutal') {
    brutalRebase(false);
    brutal.update(dt, camera);
    neonUpdate(dt);
    // Les ombres suivent le joueur dans la ville.
    sun.target.position.set(Math.round(camera.position.x / 4) * 4, 0, Math.round(camera.position.z / 4) * 4);
    sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, sunDist());
  }
  const hallGpu = !!roomSmoke() && !!SMOKE_VIEW.gpu && inRoom() && (level !== 'brutal' || brutal.ready);
  if (hallGpu) {
    // Galerie en « densité fine » : les sources alimentent la densité GPU,
    // leurs jets partent au Worker avec chaque pas de vitesse.
    if (!roomSmoke()._ready) {
      roomSmoke()._ready = true; hallGpuReady = true;
      Object.assign(roomSmoke().params, SMOKE_SIM, { res: roomSmoke().fits(SMOKE_VIEW.res) ? SMOKE_VIEW.res : 128, lightFull: !!SMOKE_VIEW.lightFull });
      roomSmoke().setMode('hybrid');
      if (SMOKE_VIEW.vel64) roomSmoke().setVelN(64);
    }
    const P = roomSmoke().params;
    // 0,123 : même opacité qu'avec le rendu d'origine pour un réglage égal.
    P.gain = SMOKE_VIEW.gain * GAIN_K; P.lum = SMOKE_VIEW.lum; P.turb = SMOKE_VIEW.turb; P.focus = !!SMOKE_VIEW.focus;
    P.dissip = SMOKE_SIM.dissip;
    P.halfRes = !SMOKE_VIEW.full; P.simHz = SMOKE_VIEW.simHz; P.march = SMOKE_VIEW.march;
    smokeClock += dt;
    const list = [];
    for (const o of smokeSources) {
      if (!o.on) continue;
      const t = smokeClock + o.phase, el = o.el * Math.PI / 180, az = o.az * Math.PI / 180;
      let ax = Math.cos(el) * Math.sin(az) + o.turb * 0.6 * Math.sin(t * 1.31);
      let ay = Math.sin(el) + o.turb * 0.3 * Math.sin(t * 1.93 + 1.7);
      let az2 = Math.cos(el) * Math.cos(az) + o.turb * 0.6 * Math.sin(t * 1.67 + 4.1);
      const sp = o.speed * (1 + 0.35 * o.turb * Math.sin(t * 3.1)) / (Math.hypot(ax, ay, az2) || 1);
      _sunC.set(o.color || '#ffffff');
      list.push({ x: o.x, y: o.y, z: o.z, rate: o.rate, radius: o.radius, jx: ax * sp, jy: ay * sp, jz: az2 * sp, r: _sunC.r, g: _sunC.g, b: _sunC.b });
    }
    // La boule d'air garde un cœur de fumée blanche pendant qu'elle accélère.
    if (SMOKE_VIEW.airSmoke > 0) for (const a of airBalls) {
      if (a.age > 0.5 || list.length >= 24) continue;
      const f = 1 - a.age / 0.5;
      list.push({ x: a.p.x, y: a.p.y, z: a.p.z, rate: 60 * SMOKE_VIEW.airSmoke * f, radius: a.r * SMOKE_VIEW.airCloud * 0.9, jx: a.v.x, jy: a.v.y, jz: a.v.z, r: 1, g: 1, b: 1, cap: 2.6 });
    }
    // Bouffées des armes (bouche, bassinet, impacts, explosions)…
    for (const q of puffs) {
      if (list.length >= 24) break;
      const f = 1 - q.age / q.life;
      list.push({ x: q.x, y: q.y, z: q.z, rate: q.rate * f, radius: q.radius, jx: q.jx * f, jy: q.jy * f, jz: q.jz * f, r: q.r, g: q.g, b: q.b, cap: q.cap });
    }
    // …et la traînée de fumée noire derrière chaque boule de feu.
    const dyn = [];
    for (const q of shots) {
      if (q.kind !== 'hado') continue;
      dyn.push({ x: q.p.x, y: q.p.y, z: q.p.z, range: 11, r: 5.2 * (q.dead > 0 ? q.dead * 4 : 1), g: 2.2 * (q.dead > 0 ? q.dead * 4 : 1), b: 0.5 * (q.dead > 0 ? q.dead * 4 : 1) });
      if (q.dead > 0 || list.length >= 24) continue;
      list.push({ x: q.p.x - q.v.x * 0.045, y: q.p.y - q.v.y * 0.045, z: q.p.z - q.v.z * 0.045, rate: 90 * GUN.hado.amount, radius: 0.5 * GUN.hado.size, jx: q.v.x * 0.25, jy: q.v.y * 0.25 + 0.6, jz: q.v.z * 0.25, r: _sunC.set(GUN.hado.color).r, g: _sunC.g, b: _sunC.b, cap: GUN.hado.density });
    }
    // Les boules de feu éclairent la fumée, en plus des lampes fixes.
    if (dyn.length || fireLit) roomSmoke().setLights(dyn.concat(roomLamps).slice(0, 8));
    fireLit = dyn.length > 0;
    // Les taches de peinture fraîches fument un peu, de leur couleur, de
    // moins en moins fort ; les plus récentes d'abord s'il manque de la place.
    for (let i = paintSplats.length - 1; i >= 0 && list.length < 24; i--) {
      const sp = paintSplats[i];
      if (sp.age >= PAINT.life) break;
      if (!sp.emit) continue; // les éclaboussures ne fument pas
      const f = 1 - sp.age / PAINT.life;
      list.push({ x: sp.x, y: sp.y, z: sp.z, rate: 2.2 * f * f * PAINT.smoke, radius: 0.7 * PAINT.size, jx: sp.nx * 0.5, jy: sp.ny * 0.5 + 0.25, jz: sp.nz * 0.5, r: sp.r, g: sp.g, b: sp.b });
    }
    // Nuages rapides : leur position et celle d'où ils seront dans 0,7 s.
    const ahead = [];
    for (const a of airBalls) if (a.age < 2.5) ahead.push({ x: a.p.x, y: a.p.y, z: a.p.z, radius: a.r + 1 }, { x: a.p.x + a.v.x * 0.7, y: a.p.y + a.v.y * 0.7, z: a.p.z + a.v.z * 0.7, radius: a.r + 1 });
    for (const t of tornados) ahead.push({ x: t.p.x, y: t.p.y + TORN.height / 2, z: t.p.z, radius: TORN.height / 2 + 2 }, { x: t.p.x + t.v.x * 0.7, y: t.p.y + TORN.height / 2, z: t.p.z + t.v.z * 0.7, radius: TORN.height / 2 + 2 });
    for (const g of gums) ahead.push({ x: g.p.x, y: g.p.y, z: g.p.z, radius: g.r + 1 }, { x: g.p.x + g.v.x * 0.7, y: g.p.y + g.v.y * 0.7, z: g.p.z + g.v.z * 0.7, radius: g.r + 1 });
    for (const q of shots) if (q.kind === 'hado' && !q.dead) ahead.push({ x: q.p.x + q.v.x * 0.6, y: q.p.y + q.v.y * 0.6, z: q.p.z + q.v.z * 0.6, radius: 1.5 });
    roomSmoke().setKeep(ahead);
    // Tornades : la colonne est alimentée en fumée sur toute sa hauteur, et
    // son champ tourbillonnaire est transmis aux shaders d'advection.
    _sunC.set(TORN.color);
    for (const t of tornados) {
      const f = t.dying > 0 ? t.dying / 0.9 : Math.min(1, t.age / 0.15);
      // L'entonnoir monte du sol ; la fumée sort en filets fins posés SUR la
      // paroi, sur trois bras qui tournent avec l'air (donc qui se vrillent).
      // Elle naît déjà lancée : colonne entière dès la première image. Une
      // petite bouche au pied soulève la poussière (et réveille la simulation).
      const H = TORN.height;
      if (TORN.smoke > 0 && t.dying <= 0 && list.length < 24) list.push({ x: t.p.x, y: t.p.y + 0.3, z: t.p.z, rate: 30 * TORN.smoke, radius: 0.4 * TORN.size, jx: t.v.x, jy: 0, jz: t.v.z, r: _sunC.r, g: _sunC.g, b: _sunC.b, cap: 2.5 });
      t._H = H;
      t._f = f;
    }
    roomSmoke().setVortices(tornados.map((t) => ({ x: t.p.x, y: t.p.y, z: t.p.z, R: TORN.size, H: t._H, swirl: TORN.swirl, up: TORN.swirl * 0.22, w: t._f, vx: t.v.x, vy: t.age * 5, vz: t.v.z, spin: t.age * Math.min(14, TORN.swirl * 0.85 / TORN.size), rate: t.dying > 0 ? 0 : 90 * TORN.smoke, cap: 4.5 * Math.min(1.5, TORN.smoke), r: _sunC.r, g: _sunC.g, b: _sunC.b })));
    // Gommes : chacune garde sa boule pleine de fumée (source au centre) et
    // un attracteur la retient ; à l'intérieur, la fumée est figée à la
    // vitesse de la boule (voir setBalls) — c'est ce qui la rend visqueuse.
    _sunC.set(GUM.color);
    if (GUM.smoke > 0) for (const g of gums) {
      if (list.length >= 24) break;
      const f = g.stuck ? Math.min(1, (GUM.stick - g.t) / 0.6) : 1;
      // Une bosse tirée au hasard à chaque pas ; la fumée étant figée dans
      // la boule, les bosses s'additionnent en un petit cumulus (orienté
      // différemment d'une boule à l'autre).
      const L = GUM_LOBES[Math.floor(Math.random() * GUM_LOBES.length)], ya = g.id * 2.4, cy = Math.cos(ya), sy = Math.sin(ya);
      list.push({ x: g.p.x + (L[0] * cy - L[2] * sy) * g.r, y: g.p.y + L[1] * g.r, z: g.p.z + (L[0] * sy + L[2] * cy) * g.r, rate: (g.stuck ? 30 : 160) * GUM.smoke * Math.max(0, f), radius: g.r * L[3], jx: g.v.x, jy: g.v.y, jz: g.v.z, r: _sunC.r, g: _sunC.g, b: _sunC.b, cap: GUM.density });
    }
    roomSmoke().setVacs(smokeVacs.concat(gums.slice(-Math.max(0, 12 - smokeVacs.length)).map((g) => ({ x: g.p.x, y: g.p.y, z: g.p.z, r: g.r * 0.5, q: 3.5, range: g.r * 2.1, hold: true }))));
    roomSmoke().setSources(list);
    // Le joueur bouscule la fumée : sa vitesse (lissée) et la position de
    // ses pieds partent au solveur et aux shaders d'advection.
    if (dt > 0) {
      _bodyVel.subVectors(camera.position, _bodyPrev).divideScalar(dt);
      if (_bodyVel.length() > 14) _bodyVel.set(0, 0, 0); // téléportation
      _bodySm.lerp(_bodyVel, Math.min(1, dt * 10));
      _bodyPrev.copy(camera.position);
    }
    roomSmoke().setBody({ x: camera.position.x, y: camera.position.y - 1.58, z: camera.position.z, vx: _bodySm.x, vy: _bodySm.y, vz: _bodySm.z, r: 0.42, h: 1.8, k: SMOKE_VIEW.body });
    // Rayon d'influence sur l'air plus large que la balle elle-même.
    // Les boules d'air passent d'abord : elles ne doivent jamais manquer de place.
    // Projectiles rapides d'abord : l'air qu'ils entraînent est plafonné
    // (une balle à 100 m/s n'emporte pas la fumée à 100 m/s), mais leur
    // trajet complet depuis le pas précédent est balayé.
    const fast = shots.map((q) => {
      const sp = q.v.length(), k = sp > q.cap ? q.cap / sp : 1;
      return { id: q.id, x: q.p.x, y: q.p.y, z: q.p.z, vx: q.v.x * k, vy: q.v.y * k, vz: q.v.z * k, r: q.r, gain: q.gain };
    });
    // Les gommes d'abord : dans leur sphère, la fumée ne bouge qu'avec elles.
    const gumBalls = gums.slice().sort((a, b) => a.p.distanceToSquared(camera.position) - b.p.distanceToSquared(camera.position)).map((g) => ({ id: g.id, x: g.p.x, y: g.p.y, z: g.p.z, vx: g.v.x, vy: g.v.y, vz: g.v.z, r: g.r * 1.45, gain: 1.6 }));
    roomSmoke().setBalls(gumBalls.concat(fast).concat(airBalls.map((a) => ({ x: a.p.x, y: a.p.y, z: a.p.z, vx: a.v.x, vy: a.v.y, vz: a.v.z, r: a.r, gain: 1.6 })))
      .concat(balls.map((b) => ({ x: b.p.x, y: b.p.y, z: b.p.z, vx: b.v.x, vy: b.v.y, vz: b.v.z, r: 0.4, gain: 0.6 }))));
    roomSmoke().step(dt, camera);
  }
  for (const inst of [smoke3dHall, smoke3dBrutal]) if (inst) inst.pass.enabled = hallGpu && inst === roomSmoke() && inst.volume;
  smoke3d.pass.enabled = level === 'smoke' && !bac2d.on && !!flAlgo.gpu && smoke3d.volume;
  if (fogPass) {
    const u = fogPass.uniforms;
    const bac = level === 'smoke';
    const vol = bacDirty && !flAlgo.particles && !flAlgo.gpu && !(bac && bac2d.on) && !hallGpu;
    u.uSmokeGain.value = !vol ? 0 : bac ? BAC_VIEW.gain : inRoom() ? SMOKE_VIEW.gain : 0;
    u.uSmokeLum.value = bac ? BAC_VIEW.lum : SMOKE_VIEW.lum;
    u.uSmokeMode.value = flAlgo.shade;
    u.uSmokeScale.value = bac ? 0.5 : 1;
    u.uSmokeStep.value = bac ? 0.3 : 0.15;
    u.uDetAmp.value = BAC_VIEW.detail;
  }
  smokeSrcUI.update?.();
  if (level === 'smoke') bacControls.update();
  if (started && panel.style.display !== 'block') {
    const forward = (keys.KeyW || keys.KeyZ || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + movement.y;
    const sideways = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.KeyQ || keys.ArrowLeft ? 1 : 0) + movement.x;
    move.set(sideways, forward);
    if (move.length() > 1) move.normalize();
    if (level === 'smoke') {
      // Pas de joueur dans le bac : caméra fixe posée par setLevel.
    } else if (godMode) {
      const gs = (keys.ShiftLeft ? 38 : 13) * dt;
      const cp = Math.cos(pitch);
      camera.position.x += (Math.cos(yaw) * move.x - Math.sin(yaw) * cp * move.y) * gs;
      camera.position.z += (-Math.sin(yaw) * move.x - Math.cos(yaw) * cp * move.y) * gs;
      camera.position.y += (Math.sin(pitch) * move.y + (keys.Space ? 1 : 0) - (keys.KeyC ? 1 : 0)) * gs;
      verticalVelocity = 0;
      grounded = true;
      playerSpeed = 0;
      _prevStepX = camera.position.x; _prevStepZ = camera.position.z;
      camera.rotation.set(pitch, yaw, 0);
    } else {
    const surfSlow = level === 'hall' ? (playerSurface === 'water' ? 0.62 : playerSurface === 'moss' ? 0.88 : 1) : 1;
    const speed = (keys.ShiftLeft ? 5.3 : 3.25) * surfSlow * dt;
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
    // Gommes de fumée collées : à portée de main on s'y accroche. Plus de
    // gravité ; Espace monte, C descend, sinon on reste suspendu.
    const hold = inRoom() ? gumHold() : null;
    if (hold) {
      verticalVelocity = (keys.Space ? 2.6 : 0) - (keys.KeyC ? 2.6 : 0);
      if (camera.position.y > hold.top && verticalVelocity > 0) verticalVelocity = 0;
    } else verticalVelocity -= 9.3 * dt;
    camera.position.y += verticalVelocity * dt;
    let floorY;
    if (level === 'valley') {
      floorY = VALLEY.y + dsHeight(camera.position.x - VALLEY.x, camera.position.z - VALLEY.z) + 1.58;
      playerSurface = 'valley';
    } else if (level === 'smoke') {
      floorY = 1.58; playerSurface = 'stone';
    } else if (level === 'brutal') {
      // Sol sous les pieds, cherché depuis 1 m au-dessus d'eux (escaliers).
      const g = brutal.ground(camera.position.x, camera.position.y - 0.58, camera.position.z);
      floorY = (g ?? 0) + 1.58; playerSurface = 'stone';
    } else if (camera.position.z > HALL.north) {
      floorY = 1.58; playerSurface = 'stone';
    } else {
      const gr = hallGround(camera.position.x, camera.position.z);
      floorY = gr.y + 1.58; playerSurface = gr.surface;
    }
    if (inRoom()) {
      // On peut se tenir sur les constructions.
      const top = builder.floorAt(camera.position.x, camera.position.z, camera.position.y - 1.58);
      if (top + 1.58 > floorY) { floorY = top + 1.58; playerSurface = 'stone'; }
      // …et sur les gommes (sphères invisibles), en vol ou collées.
      const gt = gumFloor(camera.position.x, camera.position.z, camera.position.y - 1.58);
      gumRide = null;
      if (gt + 1.58 > floorY) { floorY = gt + 1.58; playerSurface = 'stone'; if (camera.position.y <= floorY + 0.06) gumRide = gumFloorOn; }
    }
    playerInWater = playerSurface === 'water';
    playerSpeed = dt > 0 ? Math.hypot(x - _prevStepX, z - _prevStepZ) / dt : 0;
    _prevStepX = x; _prevStepZ = z;
    if (camera.position.y <= floorY + 0.001) {
      // Step up gently onto moss mounds; drop by gravity into the water.
      camera.position.y += (floorY - camera.position.y) * Math.min(1, dt * 12);
      if (camera.position.y > floorY - 0.02) camera.position.y = Math.max(camera.position.y, floorY - 0.02);
      verticalVelocity = 0;
      grounded = true;
    }
    camera.rotation.set(pitch, yaw, 0);
    }
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
  // Dans la ville, l'ombre (encore un rendu complet) n'est refaite qu'une image sur quatre.
  if (frameCount % (level === 'brutal' ? 4 : Q.shadowEvery) === 0) renderer.shadowMap.needsUpdate = true;
  tpBegin(dt);
  composer.render();
  tpEnd();
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
