import * as T from 'three'; // the classic WebGL build of three.js, which INGA's smoke is written for
import { createSmoke3D } from '../../../src/smoke3d.js';

// The smoke of the INGA prototype, running here as it does there: its
// velocity solver in a worker, its density, light and ray-marching on the
// graphics card (src/smoke3d.js and src/smokeVelWorker.js at the root of this repository).
//
// That code is written for three.js's WebGL renderer and the vine is drawn
// with the newer one, so the smoke gets a canvas of its own, transparent,
// laid exactly over the vine's. For the smoke to pass behind things, what
// can hide it is drawn again into this canvas's depth: the support, the
// ground and the character. (Leaves and stems are not, so smoke behind a
// leaf shows in front of it.) And so that smoke cannot blow through rock,
// the support is handed to the smoke as a block of filled and empty cells.

const MIN = [-32, 0, -14], SIZE = [64, 32, 32], VOX = 0.5;
const N = [SIZE[0] / VOX, SIZE[1] / VOX, SIZE[2] / VOX];
const GAIN_K = 0.123; // INGA's opacity setting to this renderer's

// INGA's settings, under INGA's names.
export const smokeDefaults = () => ({
  on: true,
  gain: 20, lum: 0.6, turb: 1, // opacity, brightness in shade, fine turbulence
  weight: 3, swirl: 3, dissip: 0.08, visc: 0.05, // how it moves
  res: 128, simHz: 20, march: 1, full: false, focus: true, body: 1, // quality
  airSize: 0.8, airSpeed: 12, airAccel: 0.35, airSmoke: 1, airCloud: 0.85, // the smoke ball
});

export function createIngaSmoke({ viewport, canvas, settings }) {
  const overlay = document.createElement('canvas');
  overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
  canvas.after(overlay);
  const renderer = new T.WebGLRenderer({ canvas: overlay, alpha: true, premultipliedAlpha: true, antialias: false });
  renderer.setClearColor(0x000000, 0);
  const camera = new T.PerspectiveCamera();
  camera.matrixAutoUpdate = false;
  const sunDir = new T.Vector3(0.4, 0.8, 0.4);

  // What can hide the smoke.
  const occluders = new T.Scene();
  const hidden = new T.MeshBasicMaterial({ colorWrite: false });
  const supportGroup = new T.Group();
  const ground = new T.Mesh(new T.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), hidden);
  const body = new T.Mesh(new T.CapsuleGeometry(0.28, 1.2, 4, 12), hidden);
  body.visible = false;
  occluders.add(supportGroup, ground, body);
  let depthTarget = null;
  const black = new T.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  black.needsUpdate = true;

  // The support as filled and empty cells.
  const occ = new Uint8Array(N[0] * N[1] * N[2]);
  const occTex = new T.Data3DTexture(occ, N[0], N[1], N[2]);
  occTex.format = T.RedFormat;
  occTex.minFilter = occTex.magFilter = T.NearestFilter;
  occTex.unpackAlignment = 1;
  occTex.needsUpdate = true;

  const smoke = createSmoke3D(renderer, {
    domain: { min: MIN, size: SIZE },
    solidGLSL: `uniform highp sampler3D uOcc;
    float solidW(vec3 p) {
      if (p.y < 0.0) return 1.0;
      vec3 u = (p - vec3(${MIN.map((v) => v.toFixed(1)).join(', ')})) / vec3(${SIZE.map((v) => v.toFixed(1)).join(', ')});
      if (all(greaterThan(u, vec3(0.0))) && all(lessThan(u, vec3(1.0))) && texture(uOcc, u).r > 0.5) return 1.0;
      return boxSolid(p);
    }`,
    uniforms: { uOcc: { value: occTex } },
    sunDir,
    velConfig: () => ({ min: MIN, size: SIZE, geom: { kind: 'voxels', occ: occ.slice(), nx: N[0], ny: N[1], nz: N[2], vox: VOX } }),
    depthTexture: () => depthTarget?.depthTexture ?? null,
    defaults: { focus: true, follow: true },
    overlay: true,
  });
  smoke.pass.camera = camera;
  smoke.pass.renderToScreen = true;
  let ready = false;

  const api = { smoke, settings, failed: false };

  // A new support: what hides the smoke, and what stops it.
  api.setWorld = (distance, group) => {
    supportGroup.clear();
    group.updateMatrixWorld(true);
    group.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      // The same vertex data, wrapped for this renderer.
      const source = o.geometry, position = source.attributes.position;
      const geometry = new T.BufferGeometry();
      let array = position.array;
      if (position.isInterleavedBufferAttribute || position.itemSize !== 3) {
        array = new Float32Array(position.count * 3);
        for (let i = 0; i < position.count; i++) array.set([position.getX(i), position.getY(i), position.getZ(i)], i * 3);
      }
      geometry.setAttribute('position', new T.BufferAttribute(array, 3));
      if (source.index) geometry.setIndex(new T.BufferAttribute(source.index.array, 1));
      const mesh = new T.Mesh(geometry, hidden);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.fromArray(o.matrixWorld.elements);
      mesh.frustumCulled = false;
      supportGroup.add(mesh);
    });
    let c = 0;
    for (let k = 0; k < N[2]; k++) for (let j = 0; j < N[1]; j++) for (let i = 0; i < N[0]; i++, c++) {
      occ[c] = distance(MIN[0] + (i + 0.5) * VOX, MIN[1] + (j + 0.5) * VOX, MIN[2] + (k + 0.5) * VOX) < 0.12 ? 255 : 0;
    }
    occTex.needsUpdate = true;
    if (ready) {
      smoke.clear();
      smoke.reconfigure(false);
    }
  };

  const resize = () => {
    const w = viewport.clientWidth, h = viewport.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    const size = renderer.getDrawingBufferSize(new T.Vector2());
    depthTarget?.dispose();
    depthTarget = new T.WebGLRenderTarget(size.x, size.y, { depthTexture: new T.DepthTexture(size.x, size.y, T.UnsignedIntType) });
    smoke.pass.setSize(size.x, size.y);
  };
  new ResizeObserver(resize).observe(viewport);
  resize();

  const color = new T.Color();
  const puffs = [];
  api.puff = (pos, vel, rate, radius, life, hex = '#ffffff', cap = 1.33) => {
    color.set(hex);
    puffs.push({ x: pos.x, y: pos.y, z: pos.z, jx: vel.x, jy: vel.y, jz: vel.z, rate, radius, life, age: 0, r: color.r, g: color.g, b: color.b, cap });
  };
  api.clear = () => smoke.clear();

  // Once a frame. `view` is the vine's camera; `feed` is what is moving in
  // the air: { airBalls, gusts, balls, player, sun, lamps }.
  api.update = (dt, view, feed) => {
    if (api.failed) return;
    try {
      const S = settings;
      if (!ready) {
        ready = true;
        Object.assign(smoke.params, { weight: S.weight, swirl: S.swirl, dissip: S.dissip, visc: S.visc, res: smoke.fits(S.res) ? S.res : 128 });
        smoke.setMode('hybrid');
      }
      const P = smoke.params;
      if (P.weight !== S.weight || P.swirl !== S.swirl || P.visc !== S.visc) {
        P.weight = S.weight; P.swirl = S.swirl; P.visc = S.visc;
        smoke.setSim();
      }
      if (P.res !== S.res && smoke.fits(S.res)) smoke.setRes(S.res);
      P.gain = S.gain * GAIN_K; P.lum = S.lum; P.turb = S.turb; P.focus = !!S.focus; P.dissip = S.dissip;
      P.halfRes = !S.full; P.simHz = S.simHz; P.march = S.march;

      // The same camera, for this renderer.
      camera.fov = view.fov; camera.aspect = view.aspect; camera.near = view.near; camera.far = view.far;
      camera.updateProjectionMatrix();
      camera.matrixWorld.fromArray(view.matrixWorld.elements);
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      camera.position.setFromMatrixPosition(camera.matrixWorld);
      sunDir.fromArray(feed.sun).normalize();
      smoke.setLights((feed.lamps ?? []).slice(0, 8));

      // What puts smoke into the air, as INGA's main loop lists it.
      const list = [];
      if (S.airSmoke > 0) for (const a of feed.airBalls) {
        if (a.age > 0.5 || list.length >= 24) continue;
        const f = 1 - a.age / 0.5; // the ball keeps a core of white smoke while it speeds up
        list.push({ x: a.p.x, y: a.p.y, z: a.p.z, rate: 60 * S.airSmoke * f, radius: a.r * S.airCloud * 0.9, jx: a.v.x, jy: a.v.y, jz: a.v.z, r: 1, g: 1, b: 1, cap: 2.6 });
      }
      for (let i = puffs.length - 1; i >= 0; i--) {
        const q = puffs[i];
        q.age += dt;
        if (q.age >= q.life) {
          puffs.splice(i, 1);
          continue;
        }
        if (list.length >= 24) continue;
        const f = 1 - q.age / q.life;
        list.push({ x: q.x, y: q.y, z: q.z, rate: q.rate * f, radius: q.radius, jx: q.jx * f, jy: q.jy * f, jz: q.jz * f, r: q.r, g: q.g, b: q.b, cap: q.cap });
      }
      smoke.setSources(list);
      // What pushes the smoke about: the character, and everything thrown.
      const p = feed.player;
      if (p) smoke.setBody({ x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz, r: 0.42, h: 1.8, k: S.body });
      const fast = feed.gusts.map((q) => {
        const sp = q.v.length(), k = sp > q.cap ? q.cap / sp : 1;
        return { id: q.id, x: q.p.x, y: q.p.y, z: q.p.z, vx: q.v.x * k, vy: q.v.y * k, vz: q.v.z * k, r: q.r, gain: q.gain };
      });
      smoke.setBalls(fast.concat(feed.airBalls.map((a) => ({ x: a.p.x, y: a.p.y, z: a.p.z, vx: a.v.x, vy: a.v.y, vz: a.v.z, r: a.r, gain: 1.6 })))
        .concat(feed.balls.map((b) => ({ x: b.p.x, y: b.p.y, z: b.p.z, vx: b.v.x, vy: b.v.y, vz: b.v.z, r: 0.4, gain: 0.6 }))));
      smoke.step(dt, camera);

      renderer.setRenderTarget(null);
      renderer.clear();
      if (!smoke.volume || !S.on) return;
      body.visible = !!(p && p.shown);
      if (p) body.position.set(p.x, p.y + 0.9, p.z);
      renderer.setRenderTarget(depthTarget);
      renderer.clear();
      renderer.render(occluders, camera);
      smoke.pass.render(renderer, null, { texture: black });
      renderer.setRenderTarget(null);
    } catch (error) {
      console.error('INGA smoke stopped:', error);
      api.failed = true;
      overlay.style.display = 'none';
    }
  };
  return api;
}
