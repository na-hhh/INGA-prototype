import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// A character to walk about with, seen over the shoulder: the mannequin,
// movement and camera of the INGA prototype (walk 3.25, run 5.3, jump 4.6,
// gravity 9.3, eyes at 1.58, camera 3.6 behind), standing on whatever the
// vine climbs. The world is known only as a distance to the nearest
// surface, so standing, bumping into things and keeping the camera out of
// the rock are all questions put to that one function.

const EYE = 1.58, RADIUS = 0.3;
const NEXT = { Jump_Start: 'Jump_Loop' }; // after a one-off animation

// The animated mannequin ("Universal Animation Library" by Quaternius, CC0).
function createAvatar(parent) {
  const api = { ready: false, current: '' };
  const root = new THREE.Group();
  root.visible = false;
  parent.add(root);
  let mixer = null, active = null, loading = null;
  const actions = {};
  api.load = () =>
    (loading ??= (async () => {
      const gltf = await new GLTFLoader().loadAsync('/assets/dummy/mannequin.glb');
      const model = gltf.scene;
      // 1.78 tall, feet at the origin.
      const box = new THREE.Box3().setFromObject(model);
      const k = 1.78 / Math.max(0.01, box.max.y - box.min.y);
      model.scale.setScalar(k);
      model.position.y = -box.min.y * k;
      model.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = o.receiveShadow = true;
          o.frustumCulled = false;
        }
      });
      root.add(model);
      mixer = new THREE.AnimationMixer(model);
      for (const clip of gltf.animations) {
        const a = mixer.clipAction(clip);
        if (!/_Loop$|Idle|Aim/.test(clip.name)) {
          a.setLoop(THREE.LoopOnce, 1);
          a.clampWhenFinished = true;
        }
        actions[clip.name] = a;
      }
      mixer.addEventListener('finished', (e) => {
        const name = e.action.getClip().name;
        const next = name in NEXT ? NEXT[name] : 'Idle_Loop';
        if (next && e.action === active) api.play(next);
      });
      api.ready = true;
      api.play('Idle_Loop');
    })());
  api.play = (name) => {
    const a = actions[name];
    if (!a) return;
    a.reset().setEffectiveWeight(1).fadeIn(0.25).play();
    if (active && active !== a) active.fadeOut(0.25);
    active = a;
    api.current = name;
  };
  api.show = (on) => (root.visible = on);
  api.update = (dt) => mixer?.update(dt);
  api.root = root;
  return api;
}

// What the avatar does when an ability is used: [animation, seconds].
const GESTURES = { air: ['Spell_Simple_Shoot', 0.6], ball: ['Punch_Cross', 0.55], seed: ['Punch_Jab', 0.45] };

export function createPlayer({ scene, camera, canvas, distance }) {
  const avatar = createAvatar(scene);
  const keys = {};
  const feet = new THREE.Vector3(), eye = new THREE.Vector3(), look = new THREE.Vector3();
  const api = { active: false, thirdPerson: true, eye, look, feet, speed: 0, grounded: true, velocity: new THREE.Vector3() };
  let yaw = 0, pitch = 0, vertical = 0;
  let gesture = '', gestureUntil = 0, anim = '';
  let field = distance;
  let saved = null;

  api.setWorld = (d) => (field = d);

  // The height of the ground under a point, looking from a little above the feet.
  const groundBelow = (x, y, z) => {
    let top = y + 1;
    for (let n = 0; n < 60 && top > y - 3; n++) {
      const d = field(x, top, z);
      if (d < 0.02) break;
      top -= Math.max(0.02, d * 0.9);
    }
    return top;
  };
  // Whether the body fits somewhere: knee, waist and chest all clear.
  const canStand = (x, y, z) => field(x, y + 0.75, z) > RADIUS && field(x, y + 1.15, z) > RADIUS && field(x, y + 1.55, z) > RADIUS * 0.8;

  api.enter = (x, z) => {
    if (api.active) return;
    api.active = true;
    saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), fov: camera.fov };
    // Start in the open, facing the support.
    // Come down onto whatever is there.
    let y = 30;
    for (let n = 0; n < 500 && y > 0; n++) {
      const d = field(x, y, z);
      if (d < 0.02) break;
      y -= Math.max(0.02, d * 0.9);
    }
    feet.set(x, Math.max(0, y), z);
    yaw = 0; pitch = 0.12; vertical = 0;
    camera.fov = 68;
    camera.updateProjectionMatrix();
    avatar.load();
    // Only allowed straight after a key or a click; otherwise the next click asks again.
    try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* needs a gesture */ }
  };
  api.exit = () => {
    if (!api.active) return;
    api.active = false;
    avatar.show(false);
    if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    camera.position.copy(saved.position);
    camera.quaternion.copy(saved.quaternion);
    camera.fov = saved.fov;
    camera.updateProjectionMatrix();
  };
  api.gesture = (id) => {
    const g = GESTURES[id];
    if (!g) return;
    gesture = g[0];
    gestureUntil = performance.now() + g[1] * 1000;
    anim = '';
    if (avatar.ready) avatar.play(gesture);
  };
  const jump = () => {
    if (!api.active || !api.grounded) return;
    vertical = 4.6;
    api.grounded = false;
  };

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    keys[e.code] = true;
    if (!api.active) return;
    if (e.code === 'Space') {
      e.preventDefault();
      jump();
    }
    if (e.code === 'KeyT' && !e.repeat) api.thirdPerson = !api.thirdPerson;
  });
  window.addEventListener('keyup', (e) => (keys[e.code] = false));
  document.addEventListener('mousemove', (e) => {
    if (!api.active || document.pointerLockElement !== canvas) return;
    yaw -= e.movementX * 0.0021;
    pitch = Math.max(-1.35, Math.min(1.35, pitch - e.movementY * 0.0021));
  });

  api.update = (dt) => {
    if (!api.active) return;
    // Walk: W/A/S/D by position on the keyboard (so Z/Q/S/D on AZERTY), Shift to run.
    const mx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    const my = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    const l = Math.hypot(mx, my) || 1;
    const step = (keys.ShiftLeft ? 5.3 : 3.25) * dt;
    const nx = feet.x + ((Math.cos(yaw) * mx - Math.sin(yaw) * my) / l) * step;
    const nz = feet.z + ((-Math.sin(yaw) * mx - Math.cos(yaw) * my) / l) * step;
    const fromX = feet.x, fromZ = feet.z;
    // Blocked: slide along whichever way is free. A low step can be walked up.
    for (const [x, z] of [[nx, nz], [nx, feet.z], [feet.x, nz]]) {
      const lift = Math.max(feet.y, Math.min(groundBelow(x, feet.y, z), feet.y + 0.55));
      if (!canStand(x, lift, z)) continue;
      feet.x = x;
      feet.z = z;
      break;
    }
    const far = Math.hypot(feet.x, feet.z);
    if (far > 75) feet.multiplyScalar(75 / far).setY(feet.y);
    // Fall, and land.
    vertical -= 9.3 * dt;
    feet.y += vertical * dt;
    const floor = groundBelow(feet.x, feet.y, feet.z);
    api.speed = dt > 0 ? Math.hypot(feet.x - fromX, feet.z - fromZ) / dt : 0;
    api.velocity.set((feet.x - fromX) / (dt || 1), vertical, (feet.z - fromZ) / (dt || 1));
    if (feet.y <= floor + 0.001) {
      feet.y += (floor - feet.y) * Math.min(1, dt * 12);
      if (feet.y > floor - 0.02) feet.y = Math.max(feet.y, floor - 0.02);
      vertical = 0;
      api.grounded = true;
    } else if (feet.y > floor + 0.25) api.grounded = false;
    // A ceiling stops a jump.
    if (vertical > 0 && field(feet.x, feet.y + 1.85, feet.z) < 0.1) vertical = 0;

    eye.set(feet.x, feet.y + EYE, feet.z);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    camera.position.copy(eye);
    camera.getWorldDirection(look);

    avatar.show(api.thirdPerson);
    if (api.thirdPerson) {
      avatar.root.position.copy(feet);
      avatar.root.rotation.y = yaw + Math.PI;
      const want = !api.grounded ? 'Jump_Loop' : api.speed > 4.2 ? 'Jog_Fwd_Loop' : api.speed > 0.4 ? 'Walk_Loop' : 'Idle_Loop';
      if (avatar.ready && performance.now() > gestureUntil && want !== anim) {
        anim = want;
        avatar.play(want);
      }
      avatar.update(dt);
      // The camera stands back over the shoulder, as far as the rock allows.
      let back = 0.3;
      while (back < 3.6 && field(eye.x - look.x * (back + 0.3), eye.y - look.y * (back + 0.3) + 0.35, eye.z - look.z * (back + 0.3)) > 0.3) back += 0.15;
      camera.position.addScaledVector(look, -Math.max(0.6, back));
      camera.position.y += 0.35;
    }
  };

  // The point being looked at: the first surface along the line of sight.
  api.aim = (reach = 60) => {
    for (let t = 0.6, n = 0; t < reach && n < 300; n++) {
      const x = eye.x + look.x * t, y = eye.y + look.y * t, z = eye.z + look.z * t;
      const d = field(x, y, z);
      if (d < 0.05) return new THREE.Vector3(x, y, z);
      t += Math.max(0.04, d * 0.9);
    }
    return new THREE.Vector3().copy(eye).addScaledVector(look, 12);
  };
  return api;
}
