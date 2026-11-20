import * as THREE from 'three/webgpu';
import { attribute, texture, uv } from 'three/tsl';

// Things the character can do, after the INGA prototype's tools.
//
//   Smoke ball: a ball of air, full of white smoke. It sets off slowly,
//     speeds up, and runs out of breath; against a surface it bursts and
//     its breath spreads out along it. It is nothing but moving air, so it
//     works through the vine's air (air.js): leaves in its path are blown
//     about, dead ones are torn off, hanging stems swing.
//   Ball: a ball that bounces off whatever is there.
//
// Smoke is drawn as soft puffs carried by the air.

const BALL = { r: 0.16, max: 8, life: 14, speed: 15 };
const PUFFS = 700;

export function createAbilities({ scene, camera, settings }) {
  // `settings` holds the smoke ball's size, speed and so on (see smoke.js).
  const AIR = { get size() { return settings.airSize; }, get speed() { return settings.airSpeed; }, get accel() { return settings.airAccel; } };
  const airBalls = [], balls = [], gusts = [];
  let gustId = 0;
  const dir = new THREE.Vector3(), from = new THREE.Vector3();
  const normal = [0, 0, 0];
  const gradient = (field, x, y, z) => {
    const e = 0.05;
    normal[0] = field(x + e, y, z) - field(x - e, y, z);
    normal[1] = field(x, y + e, z) - field(x, y - e, z);
    normal[2] = field(x, y, z + e) - field(x, y, z - e);
    const l = Math.hypot(normal[0], normal[1], normal[2]) || 1;
    normal[0] /= l; normal[1] /= l; normal[2] /= l;
    return normal;
  };

  // --- Smoke puffs --------------------------------------------------------
  const puff = { x: new Float32Array(PUFFS * 3), v: new Float32Array(PUFFS * 3), age: new Float32Array(PUFFS).fill(1e9), life: new Float32Array(PUFFS), size: new Float32Array(PUFFS), spin: new Float32Array(PUFFS), next: 0 };
  const soft = new Uint8Array(64 * 64 * 4);
  for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
    const r = Math.hypot(i - 31.5, j - 31.5) / 31.5;
    const a = Math.max(0, 1 - r * r);
    soft.set([255, 255, 255, 255 * a * a], (i + j * 64) * 4);
  }
  const softMap = new THREE.DataTexture(soft, 64, 64, THREE.RGBAFormat);
  softMap.magFilter = softMap.minFilter = THREE.LinearFilter;
  softMap.needsUpdate = true;
  const geometry = new THREE.BufferGeometry();
  const P = new THREE.BufferAttribute(new Float32Array(PUFFS * 12), 3).setUsage(THREE.DynamicDrawUsage);
  const A = new THREE.BufferAttribute(new Float32Array(PUFFS * 4), 1).setUsage(THREE.DynamicDrawUsage);
  const U = new Float32Array(PUFFS * 8), I = new Uint32Array(PUFFS * 6);
  for (let k = 0; k < PUFFS; k++) {
    U.set([0, 0, 1, 0, 1, 1, 0, 1], k * 8);
    I.set([k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3], k * 6);
  }
  geometry.setAttribute('position', P);
  geometry.setAttribute('alpha', A);
  geometry.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  geometry.setIndex(new THREE.BufferAttribute(I, 1));
  const smokeMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, color: '#eef1f2' });
  smokeMaterial.opacityNode = texture(softMap, uv()).a.mul(attribute('alpha', 'float'));
  const smoke = new THREE.Mesh(geometry, smokeMaterial);
  smoke.frustumCulled = false;
  smoke.renderOrder = 5;
  scene.add(smoke);
  const emit = (p, v, count, radius, spread, life) => {
    for (let n = 0; n < count; n++) {
      const k = puff.next;
      puff.next = (puff.next + 1) % PUFFS;
      // Somewhere inside the ball.
      let x, y, z;
      do {
        x = Math.random() * 2 - 1; y = Math.random() * 2 - 1; z = Math.random() * 2 - 1;
      } while (x * x + y * y + z * z > 1);
      puff.x.set([p.x + x * radius, p.y + y * radius, p.z + z * radius], k * 3);
      puff.v.set([v.x + x * spread, v.y + y * spread, v.z + z * spread], k * 3);
      puff.age[k] = 0;
      puff.life[k] = life * (0.7 + 0.6 * Math.random());
      puff.size[k] = radius * (0.5 + 0.5 * Math.random());
      puff.spin[k] = Math.random() * 6.28;
    }
  };

  // `smoke` is INGA's smoke, once it is running; without it, smoke is drawn
  // as the soft puffs above.
  const api = { airBalls, balls, gusts, smoke: null, tool: 0, tools: [{ id: 'air', name: 'SMOKE BALL' }, { id: 'ball', name: 'BALL' }, { id: 'seed', name: 'PLANT A VINE' }] };

  // Thrown from the eye, along the line of sight.
  api.throwAir = (eye, look) => {
    const a = airBalls.length >= 4 ? airBalls.shift() : { p: new THREE.Vector3(), v: new THREE.Vector3(), vt: new THREE.Vector3() };
    a.r = AIR.size;
    a.p.copy(eye).addScaledVector(look, 0.4 + AIR.size);
    a.vt.copy(look).multiplyScalar(AIR.speed); // cruising speed: it starts slowly, then speeds up
    a.v.copy(a.vt).multiplyScalar(0.3);
    a.age = 0;
    airBalls.push(a);
    // A ball full of white smoke: a compact cloud is born inside it, and the
    // ball carries it off and passes through it as it speeds up.
    if (api.smoke) {
      if (settings.airSmoke > 0) api.smoke.puff(a.p, a.vt.clone().multiplyScalar(0.5), 80 * settings.airSmoke, AIR.size * settings.airCloud, 0.22, '#ffffff', 2.6);
    } else emit(a.p, a.vt.clone().multiplyScalar(0.5), 80, AIR.size * 0.85, 0.22, 2.6);
  };
  const ballGeometry = new THREE.SphereGeometry(BALL.r, 20, 14);
  const ballMaterial = new THREE.MeshStandardMaterial({ color: '#d9cdb8', roughness: 0.55 });
  api.throwBall = (eye, look, carry) => {
    let b = balls.length >= BALL.max ? balls.shift() : null;
    if (!b) {
      b = { mesh: new THREE.Mesh(ballGeometry, ballMaterial), p: new THREE.Vector3(), v: new THREE.Vector3(), age: 0 };
      b.mesh.castShadow = true;
      scene.add(b.mesh);
    }
    b.p.copy(eye).addScaledVector(look, 0.5);
    b.p.y -= 0.12;
    b.v.copy(look).multiplyScalar(BALL.speed).add(carry);
    b.age = 0;
    b.mesh.visible = true;
    balls.push(b);
  };

  api.update = (dt, sim) => {
    const field = sim.distance, air = sim.air;
    // Smoke balls.
    for (let i = airBalls.length - 1; i >= 0; i--) {
      const a = airBalls[i];
      a.age += dt;
      // Up to speed in a third of a second, then slowly out of breath.
      a.vt.multiplyScalar(Math.exp(-0.55 * dt));
      const k = Math.min(1, a.age / AIR.accel);
      a.v.copy(a.vt).multiplyScalar(0.3 + 0.7 * k * k * (3 - 2 * k));
      from.copy(a.p);
      a.p.addScaledVector(a.v, dt);
      const speed = a.vt.length();
      // It carries the air with it, and its smoke.
      air?.blow(a.p.x, a.p.y, a.p.z, a.v.x, a.v.y, a.v.z, a.r * 2, Math.min(1, dt * 30));
      if (!api.smoke && a.age < 1.2 && Math.random() < dt * 40) emit(a.p, a.v.clone().multiplyScalar(0.6), 1, a.r * 0.6, 0.3, 2.2);
      const hit = field(a.p.x, a.p.y, a.p.z) < a.r * 0.35;
      if (hit) {
        // It bursts, and its breath spreads out along the surface.
        const n = gradient(field, a.p.x, a.p.y, a.p.z);
        const t1 = new THREE.Vector3(n[1], n[2], n[0]);
        const nv = new THREE.Vector3(n[0], n[1], n[2]);
        t1.addScaledVector(nv, -t1.dot(nv)).normalize();
        const t2 = new THREE.Vector3().crossVectors(nv, t1);
        for (let q = 0; q < 9; q++) {
          const ang = ((q + Math.random() * 0.6) / 9) * Math.PI * 2, v = speed * (0.45 + 0.35 * Math.random());
          dir.copy(t1).multiplyScalar(Math.cos(ang) * v).addScaledVector(t2, Math.sin(ang) * v).addScaledVector(nv, 0.8);
          air?.blow(a.p.x + dir.x * 0.12, a.p.y + dir.y * 0.12, a.p.z + dir.z * 0.12, dir.x, dir.y, dir.z, a.r * 1.4, 0.8);
          if (api.smoke) gusts.push({ id: ++gustId, p: a.p.clone().addScaledVector(nv, Math.min(0.5, a.r * 0.5)), v: dir.clone(), age: 0, life: 0.35 + Math.random() * 0.4, r: Math.max(0.35, a.r * 0.6), cap: 16, gain: 2.2 });
          else emit(a.p, dir.clone().multiplyScalar(0.55), 5, a.r * 0.5, 0.4, 2.4);
        }
      }
      if (hit || speed < 1.2 || a.age > 5) airBalls.splice(i, 1);
    }
    // The gusts a burst sends out along the surface: short-lived, they only move air.
    for (let i = gusts.length - 1; i >= 0; i--) {
      const q = gusts[i];
      q.age += dt;
      q.p.addScaledVector(q.v, dt);
      if (q.age > q.life || field(q.p.x, q.p.y, q.p.z) < 0) gusts.splice(i, 1);
    }
    // Balls: two half-steps, so a fast one does not pass through anything.
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      b.age += dt;
      if (b.age > BALL.life || b.p.y < -20) {
        b.mesh.visible = false;
        balls.splice(i, 1);
        scene.remove(b.mesh);
        continue;
      }
      for (let k = 0; k < 2; k++) {
        const h = dt / 2;
        b.v.y -= 9.3 * h;
        b.p.addScaledVector(b.v, h);
        const d = field(b.p.x, b.p.y, b.p.z);
        if (d < BALL.r) {
          const n = gradient(field, b.p.x, b.p.y, b.p.z);
          const vn = b.v.x * n[0] + b.v.y * n[1] + b.v.z * n[2];
          b.p.x += n[0] * (BALL.r - d); b.p.y += n[1] * (BALL.r - d); b.p.z += n[2] * (BALL.r - d);
          if (vn < 0) {
            b.v.x -= 1.55 * vn * n[0]; b.v.y -= 1.55 * vn * n[1]; b.v.z -= 1.55 * vn * n[2];
            b.v.multiplyScalar(0.9);
            if (n[1] > 0.7 && Math.abs(b.v.y) < 0.7) {
              b.v.y = 0;
              b.v.multiplyScalar(Math.max(0, 1 - 2.2 * h)); // rolling
            }
          }
        }
      }
      air?.blow(b.p.x, b.p.y, b.p.z, b.v.x, b.v.y, b.v.z, 0.7, Math.min(1, dt * 6));
      b.mesh.position.copy(b.p);
    }
    // Smoke: carried by the air, spreading and thinning. Each puff is a
    // soft square turned to face the camera.
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const pos = P.array, alpha = A.array;
    for (let k = 0; k < PUFFS; k++) {
      const o = k * 3;
      if (puff.age[k] >= puff.life[k]) {
        alpha.fill(0, k * 4, k * 4 + 4);
        continue;
      }
      puff.age[k] += dt;
      const w = air ? air.at(puff.x[o], puff.x[o + 1], puff.x[o + 2]) : sim.wind;
      const follow = Math.min(1, dt * 2.5);
      puff.v[o] += (w[0] - puff.v[o]) * follow;
      puff.v[o + 1] += (w[1] + 0.25 - puff.v[o + 1]) * follow;
      puff.v[o + 2] += (w[2] - puff.v[o + 2]) * follow;
      for (let q = 0; q < 3; q++) puff.x[o + q] += puff.v[o + q] * dt;
      // Smoke does not go through rock.
      const d = field(puff.x[o], puff.x[o + 1], puff.x[o + 2]);
      if (d < 0.15) {
        const n = gradient(field, puff.x[o], puff.x[o + 1], puff.x[o + 2]);
        for (let q = 0; q < 3; q++) puff.x[o + q] += n[q] * (0.15 - d);
      }
      const t = puff.age[k] / puff.life[k];
      const size = puff.size[k] * (1 + 2.2 * t);
      const c = Math.cos(puff.spin[k]) * size, s = Math.sin(puff.spin[k]) * size;
      const ax = right.x * c + up.x * s, ay = right.y * c + up.y * s, az = right.z * c + up.z * s;
      const bx = up.x * c - right.x * s, by = up.y * c - right.y * s, bz = up.z * c - right.z * s;
      const x = puff.x[o], y = puff.x[o + 1], z = puff.x[o + 2];
      pos.set([x - ax - bx, y - ay - by, z - az - bz, x + ax - bx, y + ay - by, z + az - bz, x + ax + bx, y + ay + by, z + az + bz, x - ax + bx, y - ay + by, z - az + bz], k * 12);
      alpha.fill(0.5 * Math.min(1, puff.age[k] * 8) * (1 - t) * (1 - t), k * 4, k * 4 + 4);
    }
    P.needsUpdate = A.needsUpdate = true;
  };
  return api;
}
