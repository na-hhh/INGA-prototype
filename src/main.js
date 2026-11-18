import * as THREE from 'three';
import './style.css';

const app = document.querySelector('#app');
app.innerHTML = `<div id="hud"><div id="brand">INGA</div><div id="subtitle">A LIVING SPACE — STUDY 01</div><button id="sound">SON : OFF</button><div id="help">ZQSD / WASD · se déplacer<br>SOURIS · regarder autour<br>ESPACE · léviter &nbsp; · &nbsp; E · découvrir une œuvre</div><div id="hint"></div><div id="mobile"><div id="joystick"><div id="knob"></div></div><button id="jump">↑</button><div id="looknote">Glisser à droite pour regarder</div></div></div><div id="intro"><div class="inner"><h1>INGA</h1><p>Un espace à habiter.<br>Le béton, la lumière, l'eau et les traces de vie.</p><button id="enter">ENTRER DANS INGA</button><small>Étude architecturale interactive 01<br>Œuvres et matières provisoires · Son facultatif</small></div></div><div id="artPanel"><button id="close">FERMER ×</button><div class="eyebrow">INGA / COLLECTION 01</div><h2 id="artTitle"></h2><p id="artText"></p><p style="font-size:11px;opacity:.6">Œuvre provisoire — à remplacer par une création originale.</p></div>`;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#c5c3bc');
scene.fog = new THREE.FogExp2('#c5c3bc', 0.0052);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.48;
app.prepend(renderer.domElement);

const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.08, 220);
camera.position.set(0, 1.58, -10.6);
camera.rotation.order = 'YXZ';

scene.add(new THREE.HemisphereLight('#eaf3ff', '#6e6558', 2.05));
const sun = new THREE.DirectionalLight('#fff1d9', 1.55);
sun.position.set(-8, 22, 42);
sun.target.position.set(0, 0, 34);
scene.add(sun.target);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.left = -70;
sun.shadow.camera.right = 70;
sun.shadow.camera.top = 70;
sun.shadow.camera.bottom = -70;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 140;
sun.shadow.bias = -0.00035;
sun.shadow.normalBias = 0.045;
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun);
const bounce = new THREE.DirectionalLight('#e1eaf4', 0.72);
bounce.position.set(14, 8, 24);
scene.add(bounce);

function noiseTexture(base = '#bdbab1', variation = 16) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = base;
  x.fillRect(0, 0, 256, 256);
  const d = x.getImageData(0, 0, 256, 256);
  for (let i = 0; i < d.data.length; i += 4) {
    const n = (Math.random() - 0.5) * variation;
    d.data[i] += n;
    d.data[i + 1] += n;
    d.data[i + 2] += n;
  }
  x.putImageData(d, 0, 0);
  for (let i = 0; i < 18; i++) {
    x.strokeStyle = 'rgba(70,68,64,.025)';
    x.lineWidth = Math.random() * 1.4;
    x.beginPath();
    x.moveTo(Math.random() * 256, Math.random() * 256);
    x.lineTo(Math.random() * 256, Math.random() * 256);
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

const concrete = new THREE.MeshStandardMaterial({ map: noiseTexture('#b5b3ac', 26), roughness: 0.94 });
const floorMat = new THREE.MeshStandardMaterial({ map: noiseTexture('#c9c6bd', 15), roughness: 0.77 });
const darkConcrete = new THREE.MeshStandardMaterial({ color: '#8e8d84', roughness: 0.95 });
const wood = new THREE.MeshStandardMaterial({ color: '#655044', roughness: 0.86 });
const linen = new THREE.MeshStandardMaterial({ color: '#bcb4a5', roughness: 1, side: THREE.DoubleSide });
const moss = new THREE.MeshStandardMaterial({ color: '#51643b', roughness: 1 });
const black = new THREE.MeshStandardMaterial({ color: '#292b29', roughness: 0.9 });

const hallFloorTex = noiseTexture('#c8c4bb', 14);
hallFloorTex.repeat.set(17, 23);
const hallFloorMat = new THREE.MeshStandardMaterial({ map: hallFloorTex, roughness: 0.86 });
const hallWallTex = noiseTexture('#b7b4ac', 20);
hallWallTex.repeat.set(10, 2);
const hallConcrete = new THREE.MeshStandardMaterial({ map: hallWallTex, roughness: 0.95 });
const bedTex = noiseTexture('#6d716c', 16);
bedTex.repeat.set(12, 16);
const bedMat = new THREE.MeshStandardMaterial({ map: bedTex, color: '#9a9d96', roughness: 1 });
const bridgeMat = new THREE.MeshStandardMaterial({ map: noiseTexture('#c3bfb5', 12), roughness: 0.7 });
const jointMat = new THREE.MeshStandardMaterial({
  color: '#aeaaa0',
  roughness: 1,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
});

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

const waterMat = new THREE.MeshPhysicalMaterial({
  color: '#7e918b',
  metalness: 0.02,
  roughness: 0.18,
  transparent: true,
  opacity: 0.62,
  clearcoat: 0.72,
  clearcoatRoughness: 0.38,
  envMap: softWaterEnv(),
  envMapIntensity: 0.62,
  side: THREE.DoubleSide,
  depthWrite: false,
});

function box(w, h, d, x, y, z, mat = concrete, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
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

// Clear hall: 56 m wide, ~77 m deep, ceiling kept low (5.72 m) so the monumentality is horizontal.
// The narrow canal is a recess at the foot of the walls. It never crosses the floor.
const HALL = {
  x: 28,
  doorZ: -4.85,
  north: 72,
  channel: 0.88,
  wallT: 0.46,
  wallTop: 5.72,
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

// Entry passage, unchanged: intimate, textile, inhabited.
box(3.3, 0.25, 6.7, 0, -0.16, -8.2, floorMat);
box(0.25, 3.05, 6.7, -1.65, 1.5, -8.2);
box(0.25, 3.05, 6.7, 1.65, 1.5, -8.2);
box(3.3, 0.24, 6.7, 0, 3.08, -8.2);
box(3.3, 3, 0.25, 0, 1.5, -11.6);
box(1.18, 0.16, 2.05, -1.1, 0.47, -8.5, wood);
for (const z of [-9.25, -7.78]) box(0.11, 0.42, 0.13, -1.1, 0.23, z, wood);
const fabric = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.25, 14, 18), linen);
const fabricPos = fabric.geometry.attributes.position;
for (let i = 0; i < fabricPos.count; i++) {
  const x = fabricPos.getX(i);
  const y = fabricPos.getY(i);
  fabricPos.setZ(i, Math.sin(x * 14 + y * 6) * 0.038);
}
fabric.rotation.y = Math.PI / 2;
fabric.position.set(-0.92, 1.65, -7.5);
scene.add(fabric);
const drape = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.86, 12, 12), linen);
drape.rotation.set(-0.5, 0.3, 0.2);
drape.position.set(-1.03, 0.57, -8.8);
scene.add(drape);
const shoeMat = new THREE.MeshStandardMaterial({ color: '#3a3029', roughness: 0.73 });
for (const x of [0.25, 0.65]) {
  const s = sphere(0.17, x, 0.14, -8.6, shoeMat);
  s.scale.set(0.8, 0.48, 1.6);
  const sock = sphere(0.095, x, 0.09, -8.05, new THREE.MeshStandardMaterial({ color: '#ddd6c9' }));
  sock.scale.set(0.8, 0.38, 1.5);
}
for (const [x, z, rot] of [[-1.48, -9.8, Math.PI / 2], [1.48, -8.1, -Math.PI / 2]]) {
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

const opening = 1.72;
const southCenterZ = HALL.doorZ - HALL.wallT / 2;
const jambW = outerX - opening;
box(jambW, wallH, HALL.wallT, -(outerX + opening) / 2, wallY, southCenterZ, hallConcrete);
box(jambW, wallH, HALL.wallT, (outerX + opening) / 2, wallY, southCenterZ, hallConcrete);
const soffitH = HALL.wallTop - 3.22;
box(opening * 2, soffitH, HALL.wallT, 0, 3.22 + soffitH / 2, southCenterZ, hallConcrete);

const floorW = CHANNEL.ix1 - CHANNEL.ix0;
const floorD = CHANNEL.iz1 - CHANNEL.iz0;
const floorCenterZ = (CHANNEL.iz0 + CHANNEL.iz1) / 2;
box(floorW, 0.28, floorD, 0, -0.18, floorCenterZ, hallFloorMat, false);

const jointY = -0.028;
for (const x of [-20, -12, -4, 4, 12, 20]) {
  box(0.018, 0.012, floorD - 1.2, x, jointY, floorCenterZ, jointMat, false);
}
for (let z = 4; z <= 68; z += 8) {
  box(floorW - 1.2, 0.012, 0.018, 0, jointY, z, jointMat, false);
}

// Ceiling is a concrete grid with open slots, so daylight actually reaches the floor.
const ceilT = 0.4;
const ceilY = HALL.wallTop + ceilT / 2;
const ceilZ0 = sideZ0;
const ceilZ1 = sideZ1;
const ceilLen = ceilZ1 - ceilZ0;
const ceilCenter = (ceilZ0 + ceilZ1) / 2;
const slotHalfX = 8;
box(outerX - slotHalfX, ceilT, ceilLen, -(outerX + slotHalfX) / 2, ceilY, ceilCenter, hallConcrete);
box(outerX - slotHalfX, ceilT, ceilLen, (outerX + slotHalfX) / 2, ceilY, ceilCenter, hallConcrete);
const slots = [];
for (let z = 0; z <= 70; z += 5) slots.push(z);
let edge = ceilZ0;
for (const z of slots) {
  const a = z - 0.52;
  if (a - edge > 0.04) box(slotHalfX * 2 + 0.2, ceilT, a - edge, 0, ceilY, (edge + a) / 2, hallConcrete);
  edge = z + 0.52;
  box(slotHalfX * 2 + 0.15, 0.1, 0.11, 0, HALL.wallTop - 0.04, z - 0.58, darkConcrete);
  box(slotHalfX * 2 + 0.15, 0.1, 0.11, 0, HALL.wallTop - 0.04, z + 0.58, darkConcrete);
}
if (ceilZ1 - edge > 0.04) box(slotHalfX * 2 + 0.2, ceilT, ceilZ1 - edge, 0, ceilY, (edge + ceilZ1) / 2, hallConcrete);

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

box(2.8, 0.055, 1.28, 0, -0.045, -4.4, bridgeMat);

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
box(3.2, 0.32, 1.15, -8, 0.45, 11, new THREE.MeshStandardMaterial({ color: '#a7a398', roughness: 0.95 }));
box(2.6, 0.7, 0.3, -8, 1, 11.5, new THREE.MeshStandardMaterial({ color: '#aaa69a', roughness: 1 }));
box(1.2, 0.12, 0.7, -7, 0.48, 8, wood);
const stone = new THREE.MeshStandardMaterial({ color: '#97958b', roughness: 1 });
const rock = sphere(0.72, 8, 0.45, 17, stone, 9);
rock.scale.set(1.5, 0.7, 0.85);

const crackMat = new THREE.LineBasicMaterial({ color: '#6d7961', transparent: true, opacity: 0.75 });
for (const [sx, sz] of [[-10, 3], [-9, 22], [8, 5], [9, 25], [-4, 27], [-20, 42], [16, 51], [-6, 63]]) {
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
tuft(-26.9, 67.4);
tuft(26.85, 41);

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
artwork('Étude minérale', 'Une recherche sur la matière, la lumière et le temps.', -27.9, 2.45, 9, -1, '#aca79a', '#5f6456');
artwork('Surface intérieure', 'Une composition silencieuse entre forme et texture.', 27.9, 2.45, 34, 1, '#c7b6a0', '#77766a');
artwork('Trace', 'L’empreinte d’une présence dans un espace habité.', -27.9, 2.45, 52, -1, '#aaa398', '#524c46');

const essenceMat = new THREE.MeshBasicMaterial({ color: '#f1eee4', transparent: true, opacity: 0.18, depthWrite: false });
const essence = sphere(0.075, 0, 0, 0, essenceMat, 24);
essence.castShadow = false;

const WALK = {
  corridorHalf: 1.25,
  corridorZMin: -11.15,
  bridgeHalf: 1.25,
  bridgeZMin: -5.06,
  bridgeZMax: -3.7,
  floorHalf: 26.78,
  floorZMin: -3.9,
  floorZMax: 70.72,
};
function canOccupy(x, z) {
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
  if (!activeWork) return;
  document.querySelector('#artTitle').textContent = activeWork.name;
  document.querySelector('#artText').textContent = activeWork.desc;
  panel.style.display = 'block';
  document.exitPointerLock?.();
}

let audioCtx, audioNode, audioGain;
document.querySelector('#sound').onclick = () => {
  const b = document.querySelector('#sound');
  if (audioCtx) {
    if (audioCtx.state === 'running') { audioCtx.suspend(); b.textContent = 'SON : OFF'; }
    else { audioCtx.resume(); b.textContent = 'SON : ON'; }
    return;
  }
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const length = audioCtx.sampleRate * 12;
  const buf = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  let slow = 0;
  for (let i = 0; i < length; i++) {
    slow = slow * 0.996 + (Math.random() * 2 - 1) * 0.004;
    data[i] = slow * 0.3 + (Math.random() * 2 - 1) * 0.016;
  }
  audioNode = audioCtx.createBufferSource();
  audioNode.buffer = buf;
  audioNode.loop = true;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 520;
  audioGain = audioCtx.createGain();
  audioGain.gain.value = 0.45;
  audioNode.connect(filter).connect(audioGain).connect(audioCtx.destination);
  audioNode.start();
  b.textContent = 'SON : ON';
};

const clock = new THREE.Clock();
let t = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.045);
  t += dt;
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
    if (camera.position.y <= 1.58) {
      camera.position.y = 1.58;
      verticalVelocity = 0;
      grounded = true;
    }
    camera.rotation.set(pitch, yaw, 0);
  }
  let nearest = null;
  let dist = 3.1;
  for (const w of works) {
    const d = camera.position.distanceTo(w.pos);
    if (d < dist) { dist = d; nearest = w; }
  }
  activeWork = nearest;
  hint.classList.toggle('visible', !!nearest && panel.style.display !== 'block' && started);
  hint.textContent = nearest ? `${nearest.name} · ${matchMedia('(pointer:coarse)').matches ? 'Touchez ici pour découvrir' : 'E pour découvrir'}` : '';
  essence.position.copy(camera.position);
  essence.position.y -= 0.25;
  essence.position.add(new THREE.Vector3(0, Math.sin(t * 1.4) * 0.02, -0.35).applyEuler(camera.rotation));
  renderer.render(scene, camera);
}
animate();
hint.addEventListener('click', interact);
hint.style.pointerEvents = 'auto';
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

if (import.meta.env.DEV) window.__inga = { camera, canOccupy, scene };
