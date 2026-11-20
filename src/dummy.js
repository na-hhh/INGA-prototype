// Mannequin de test animé (« Universal Animation Library » de Quaternius,
// CC0) : 43 animations — marcher, courir, s'asseoir, se relever, sauter,
// tomber… On le pose devant soi et on choisit l'animation dans le panneau V.
import * as THREE from 'three';

export function createDummy({ parent }) {
  const api = { ready: false, clips: [], current: '', placed: false };
  const root = new THREE.Group();
  root.visible = false;
  parent.add(root);
  let mixer = null, actions = {}, active = null, loading = null;
  // Après une animation jouée une fois, on enchaîne sur la pose qui suit.
  const NEXT = { Sitting_Enter: 'Sitting_Idle_Loop', Jump_Start: 'Jump_Loop', Spell_Simple_Enter: 'Spell_Simple_Idle_Loop', Death01: null };

  api.load = () => {
    if (loading) return loading;
    loading = (async () => {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const gltf = await new GLTFLoader().loadAsync('/assets/dummy/mannequin.glb');
      const model = gltf.scene;
      // Taille normalisée à 1,78 m, pieds à l'origine.
      const bb = new THREE.Box3().setFromObject(model);
      const k = 1.78 / Math.max(0.01, bb.max.y - bb.min.y);
      model.scale.setScalar(k);
      model.position.y = -bb.min.y * k;
      model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
      root.add(model);
      mixer = new THREE.AnimationMixer(model);
      for (const clip of gltf.animations) {
        const a = mixer.clipAction(clip);
        if (!/_Loop$|Idle|Aim/.test(clip.name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
        actions[clip.name] = a;
      }
      api.clips = gltf.animations.map((c) => c.name).filter((n) => n !== 'A_TPose');
      mixer.addEventListener('finished', (e) => {
        const name = e.action.getClip().name;
        const next = name in NEXT ? NEXT[name] : 'Idle_Loop';
        if (next && e.action === active) api.play(next);
      });
      api.ready = true;
      api.play('Idle_Loop');
    })();
    return loading;
  };
  api.play = (name) => {
    const a = actions[name];
    if (!a) return;
    a.reset().setEffectiveWeight(1).fadeIn(0.25).play();
    if (active && active !== a) active.fadeOut(0.25);
    active = a;
    api.current = name;
  };
  // Pose le mannequin (pieds en `pos`), tourné vers `faceTo` s'il est donné.
  api.place = (pos, faceTo) => {
    root.position.copy(pos);
    if (faceTo) root.rotation.y = Math.atan2(faceTo.x - pos.x, faceTo.z - pos.z);
    root.visible = true;
    api.placed = true;
    return api.load();
  };
  api.remove = () => { root.visible = false; api.placed = false; };
  api.setYaw = (y) => { root.rotation.y = y; };
  api.update = (dt) => { if (mixer && root.visible) mixer.update(dt); };
  api.position = root.position;
  return api;
}
