// ---- Oiseaux ----------------------------------------------------------------
// Des vols de petits oiseaux qui tournent autour des îles, quelques oiseaux
// moyens, et deux grands rapaces qui planent très haut en battant rarement
// des ailes. Une seule géométrie instanciée (corps + deux ailes) ; le
// battement est fait dans le shader (chaque oiseau son rythme), l'inclinaison
// dans les virages sur le processeur. Ils disparaissent la nuit.
import * as THREE from 'three';

function birdGeometry() {
  // x : envergure, y : haut, z : avant. aWing = 0 au corps, 1 au bout des ailes.
  const P = [], W = [];
  const tri = (a, b, c, wa, wb, wc) => { P.push(...a, ...b, ...c); W.push(wa, wb, wc); };
  // Ailes (légèrement en flèche), chacune en deux triangles pour plier un peu.
  for (const sx of [-1, 1]) {
    tri([0, 0, 0.12], [0, 0, -0.08], [sx * 0.28, 0.01, 0.02], 0, 0, 0.55);
    tri([sx * 0.28, 0.01, 0.02], [0, 0, -0.08], [sx * 0.5, 0, -0.1], 0.55, 0, 1);
  }
  // Corps (un fuseau vertical) et queue.
  tri([0, 0.025, 0.2], [0, 0.02, -0.18], [0, -0.035, 0.02], 0, 0, 0);
  tri([0, 0.01, -0.16], [0.06, 0, -0.3], [-0.06, 0, -0.3], 0, 0, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(W, 1));
  g.computeVertexNormals();
  return g;
}

export function createBirds({ scene, lite }) {
  const geo = birdGeometry();
  const flocks = [];
  const rnd = (a, b) => a + (b - a) * Math.random();
  const N_SMALL = lite ? 4 : 7;
  const members = [];
  const makeFlock = (center, radius, height, speed, size, n, kind) => {
    const f = { center, radius, height, speed, size, kind, a0: rnd(0, Math.PI * 2), dir: Math.random() < 0.5 ? -1 : 1, members: [] };
    for (let i = 0; i < n; i++) {
      f.members.push({ dr: rnd(-6, 6) * (kind === 'raptor' ? 0 : 1), dy: rnd(-3, 3), da: rnd(-0.12, 0.12), scale: size * rnd(0.8, 1.2), phase: rnd(0, 10), flap: kind === 'raptor' ? rnd(1.2, 1.6) : rnd(7, 11), wob: rnd(0, 10) });
    }
    flocks.push(f);
    members.push(...f.members.map((m) => ({ f, m })));
  };
  const mesh = { obj: null };
  const build = (centers) => {
    flocks.length = 0; members.length = 0;
    const pick = () => centers[(Math.random() * centers.length) | 0] || new THREE.Vector3(rnd(-150, 150), 0, rnd(-150, 150));
    for (let i = 0; i < N_SMALL; i++) { const c = pick(); makeFlock(c.clone(), rnd(25, 70), c.y + rnd(10, 45), rnd(7, 11), rnd(0.55, 0.85), 6 + ((Math.random() * 8) | 0), 'small'); }
    for (let i = 0; i < (lite ? 2 : 4); i++) { const c = pick(); makeFlock(c.clone(), rnd(40, 90), c.y + rnd(20, 60), rnd(9, 13), rnd(1.2, 1.6), 2 + ((Math.random() * 3) | 0), 'medium'); }
    for (let i = 0; i < 2; i++) makeFlock(new THREE.Vector3(rnd(-60, 60), 0, rnd(-40, 120)), rnd(110, 180), rnd(80, 130), rnd(8, 11), rnd(2.6, 3.3), 1, 'raptor');
    // Devant le balcon (vers +z) : des vols qui passent tout près, à hauteur
    // des yeux ou un peu au-dessus, sur de larges boucles devant la vue.
    for (let i = 0; i < (lite ? 2 : 3); i++) makeFlock(new THREE.Vector3(rnd(-12, 12), 0, rnd(50, 58)), rnd(16, 24), rnd(-3, 9), rnd(6, 9), rnd(0.55, 0.85), 5 + ((Math.random() * 6) | 0), 'small');
    makeFlock(new THREE.Vector3(rnd(-20, 20), 0, rnd(62, 75)), rnd(26, 34), rnd(4, 14), rnd(8, 10), rnd(1.2, 1.5), 2 + ((Math.random() * 2) | 0), 'medium');
    if (mesh.obj) { scene.remove(mesh.obj); mesh.obj.dispose(); }
    const ig = geo.clone();
    const phase = new Float32Array(members.length * 2);
    members.forEach(({ m }, i) => { phase[i * 2] = m.phase; phase[i * 2 + 1] = m.flap; });
    ig.setAttribute('aFlapP', new THREE.InstancedBufferAttribute(phase, 2));
    const mat = new THREE.MeshStandardMaterial({ color: '#2b2824', roughness: 0.9, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = U.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aWing; attribute vec2 aFlapP; uniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        // Battement : les rapaces planent et ne battent que par moments.
        float glide = aFlapP.y < 2.0 ? smoothstep( 0.6, 1.0, sin( uTime * 0.35 + aFlapP.x ) ) : 1.0;
        float flap = sin( uTime * aFlapP.y + aFlapP.x ) * glide;
        transformed.y += flap * aWing * 0.28 - aWing * 0.04;
        transformed.x *= 1.0 - abs( flap ) * aWing * 0.12;`);
    };
    const im = new THREE.InstancedMesh(ig, mat, members.length);
    im.frustumCulled = false;
    im.castShadow = false;
    mesh.obj = im;
    scene.add(im);
  };
  const U = { uTime: { value: 0 } };
  const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _s = new THREE.Vector3(), _m = new THREE.Matrix4();
  return {
    build,
    // vis : 0 (nuit) → 1 (jour) ; les oiseaux rétrécissent puis disparaissent.
    update(t, vis) {
      const im = mesh.obj;
      if (!im) return;
      U.uTime.value = t;
      im.visible = vis > 0.02;
      if (!im.visible) return;
      members.forEach(({ f, m }, i) => {
        const w = (f.speed / f.radius) * f.dir;
        const a = f.a0 + t * w + m.da;
        const r = f.radius + m.dr + Math.sin(t * 0.3 + m.wob) * 3;
        _p.set(f.center.x + Math.cos(a) * r, f.height + m.dy + Math.sin(t * 0.5 + m.wob) * 1.5, f.center.z + Math.sin(a) * r);
        // Cap tangent au cercle, inclinaison vers l'intérieur du virage.
        const yaw = Math.atan2(-Math.sin(a) * f.dir, Math.cos(a) * f.dir);
        _e.set(Math.sin(t * 0.7 + m.wob) * 0.08, yaw, -f.dir * 0.35);
        _q.setFromEuler(_e);
        _s.setScalar(m.scale * vis);
        im.setMatrixAt(i, _m.compose(_p, _q, _s));
      });
      im.instanceMatrix.needsUpdate = true;
    },
  };
}
