// Niveau « BRUTALISME » : dix bâtiments brutalistes à l'échelle réelle, avec
// intérieurs (pack CC0 « Brutalist themed buildings » de loafbrr), habillés de
// leurs textures de béton PBR. Le module charge le modèle, construit une
// structure d'accélération (BVH) pour les collisions — sol, murs, peinture,
// balles — et une grille d'occupation en voxels pour que la fumée bute sur
// l'architecture.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const VOX = 0.25; // taille d'un voxel d'occupation (m)
// Néons : la palette de la ville, la nuit.
const NEON = ['#ff2bd6', '#19e3ff', '#ffb000', '#7a4dff', '#ff3355', '#39ff9c'];

export function createBrutalLevel({ renderer }) {
  const root = new THREE.Group();
  root.visible = false;
  const api = { root, ready: false, loading: null, neons: [], groundMesh: null, rain: null, spawn: new THREE.Vector3(60, 1.58, 44), spawnYaw: -1.2 };
  let bvh = null;
  let occ = null, occMin = null, occN = null; // grille globale d'occupation
  const _ray = new THREE.Ray(), _d = new THREE.Vector3();

  function tex(url, srgb) {
    const t = new THREE.TextureLoader().load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }
  function materials() {
    const B = '/assets/brutal/';
    const c = { map: tex(B + 'concrete_base.jpg', true), normalMap: tex(B + 'concrete_normal.jpg'), roughnessMap: tex(B + 'concrete_rough.jpg') };
    const t = { map: tex(B + 'trim_base.jpg', true), normalMap: tex(B + 'trim_normal.jpg'), roughnessMap: tex(B + 'trim_rough.jpg'), aoMap: tex(B + 'trim_ao.jpg') };
    const mk = (maps, color, extra = {}) => new THREE.MeshStandardMaterial({ ...maps, color, roughness: 1, metalness: 0, side: THREE.DoubleSide, ...extra });
    return {
      Wall_Outer: mk(c, '#b9b5ae'),
      Wall_Inner: mk(c, '#c8c4bc'),
      // Planchers et plafonds occupent le même plan dans ce modèle (dalles sans
      // épaisseur) : dessinés des deux côtés ils scintillent l'un dans
      // l'autre. Chacun n'est donc visible que de son côté.
      // Le plancher intérieur repose aussi sur la dalle extérieure, dans le même
      // plan : un décalage de profondeur le fait toujours gagner.
      Floor_Inner: mk(c, '#6f6c67', { side: THREE.FrontSide, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 }),
      Floor_Outer: mk(c, '#55534f', { side: THREE.FrontSide, roughness: 0.42, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3 }), // dalles mouillées
      Ceiling: mk(c, '#9d9a94', { side: THREE.FrontSide }),
      ConcretesTrim: mk(t, '#bdb9b2'),
      Glass: new THREE.MeshStandardMaterial({ color: '#0d1014', roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
    };
  }

  api.load = () => {
    if (api.loading) return api.loading;
    api.loading = (async () => {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      // Une carte personnelle prime : déposer un fichier public/assets/brutal/map.glb
      // (avec ses propres matériaux) suffit ; map.json peut préciser
      // { "scale": 1, "spawn": [x, y, z], "yaw": 0 }.
      let custom = false, meta = {};
      try { const r = await fetch('/assets/brutal/map.glb', { method: 'HEAD' }); custom = r.ok && !/text\/html/.test(r.headers.get('content-type') || ''); } catch { /* pas de carte personnelle */ }
      if (custom) { try { const r = await fetch('/assets/brutal/map.json'); if (r.ok) meta = await r.json(); } catch { /* facultatif */ } }
      const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.loadAsync(custom ? '/assets/brutal/map.glb' : '/assets/brutal/buildings.glb');
      if (custom && meta.scale) gltf.scene.scale.setScalar(meta.scale);
      const mats = custom ? null : materials();
      const parts = [];
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        const name = Array.isArray(o.material) ? o.material[0].name : o.material.name;
        if (mats) o.material = mats[name] || mats.Wall_Outer;
        if (!mats) {
          // Carte personnelle : on garde ses matériaux, en les rendant sûrs
          // pour ce moteur (feuillages et grilles découpés plutôt que fondus,
          // surfaces humides, pas de métal parasite).
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            if (m.userData.fixed) continue;
            m.userData.fixed = true;
            const cut = m.map && (m.transparent || m.alphaTest > 0);
            if (cut) { m.transparent = false; m.alphaTest = 0.5; m.depthWrite = true; m.side = THREE.DoubleSide; }
            m.metalness = 0;
            m.roughness = Math.min(m.roughness ?? 1, 0.62);
            if (m.map) m.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
          }
        }
        const glass = mats ? name === 'Glass' : !!o.material.transparent;
        o.castShadow = !glass; o.receiveShadow = !glass;
        // Fenêtres : la plupart sont noires, quelques-unes allumées.
        if (false && mats && glass) {
          o.material = o.material.clone();
          o.material.emissive = new THREE.Color(NEON[Math.random() * NEON.length | 0]);
          o.material.emissiveIntensity = 0.5 + Math.random() * 1.4;
          o.material.opacity = 0.85;
        }
        // Positions monde en flottants, triangle par triangle (les fichiers
        // compressés stockent des entiers quantifiés + une matrice).
        const pa = o.geometry.attributes.position, ix = o.geometry.index;
        const n = ix ? ix.count : pa.count, out = new Float32Array(n * 3), v = new THREE.Vector3();
        for (let i = 0; i < n; i++) { v.fromBufferAttribute(pa, ix ? ix.getX(i) : i).applyMatrix4(o.matrixWorld); out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z; }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(out, 3));
        parts.push(g);
      });
      root.add(gltf.scene);
      // Sol de la ville : une grande dalle sombre.
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.MeshStandardMaterial({ color: '#34363b', roughness: 0.24, metalness: 0.0 })); // asphalte mouillé
      ground.rotation.x = -Math.PI / 2;
      // Nettement sous les dalles des bâtiments (qui sont à y = 0) : deux
      // surfaces presque confondues scintillent au loin.
      ground.position.set(70, -0.12, 45);
      ground.receiveShadow = true;
      root.add(ground);
      ground.updateMatrixWorld(true);
      const gg = ground.geometry.clone().applyMatrix4(ground.matrixWorld).toNonIndexed();
      for (const k of Object.keys(gg.attributes)) if (k !== 'position') gg.deleteAttribute(k);
      // Boîte englobante des bâtiments seuls, puis une seule fusion (dalle
      // comprise, en dernier) : pas de copie supplémentaire en mémoire.
      const bb = new THREE.Box3();
      for (const g of parts) { g.computeBoundingBox(); bb.union(g.boundingBox); }
      parts.push(gg);
      const merged = mergeGeometries(parts);
      parts.length = 0;
      // Voxels : on échantillonne chaque triangle (hors dalle) tous les 12 cm.
      occMin = new THREE.Vector3(Math.floor(bb.min.x) - 4, -1, Math.floor(bb.min.z) - 4);
      occN = [Math.ceil((bb.max.x + 4 - occMin.x) / VOX), Math.ceil((bb.max.y + 3 - occMin.y) / VOX), Math.ceil((bb.max.z + 4 - occMin.z) / VOX)];
      occ = new Uint8Array(occN[0] * occN[1] * occN[2]);
      const P = merged.attributes.position.array;
      const mark = (x, y, z) => {
        const ix = ((x - occMin.x) / VOX) | 0, iy = ((y - occMin.y) / VOX) | 0, iz = ((z - occMin.z) / VOX) | 0;
        if (ix >= 0 && iy >= 0 && iz >= 0 && ix < occN[0] && iy < occN[1] && iz < occN[2]) occ[ix + occN[0] * (iy + occN[1] * iz)] = 1;
      };
      for (let i = 0; i < P.length - 54; i += 9) { // sans les 6 triangles de la dalle
        const ax = P[i], ay = P[i + 1], az = P[i + 2], bx = P[i + 3] - ax, by = P[i + 4] - ay, bz = P[i + 5] - az, cx = P[i + 6] - ax, cy = P[i + 7] - ay, cz = P[i + 8] - az;
        const nu = Math.max(1, Math.ceil(Math.hypot(bx, by, bz) / 0.12)), nv = Math.max(1, Math.ceil(Math.hypot(cx, cy, cz) / 0.12));
        for (let u = 0; u <= nu; u++) for (let v = 0; v <= nv - u * nv / nu; v++) {
          const s = u / nu, t = v / nv;
          mark(ax + bx * s + cx * t, ay + by * s + cy * t, az + bz * s + cz * t);
        }
      }
      bvh = new MeshBVH(merged);
      api.groundMesh = ground;
      dress(bb, 0); // plus d'enseignes au néon posées au hasard : seulement la pluie
      if (custom) {
        // Départ : celui de map.json, sinon au centre de la carte, posé au sol.
        const c = bb.getCenter(new THREE.Vector3());
        if (Array.isArray(meta.spawn)) api.spawn.fromArray(meta.spawn);
        else { ground.position.y = bb.min.y - 0.12; api.spawn.set(c.x, bb.max.y + 2, c.z); }
        api.spawnYaw = meta.yaw || 0;
        api.custom = true;
      }
      api.ready = true;
    })();
    return api.loading;
  };

  // Habillage nocturne : enseignes au néon accrochées aux façades (chacune
  // cherche un mur par lancer de rayon) et pluie qui s'arrête aux toits.
  function dress(bb, neonCount) {
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const o = new THREE.Vector3(), d = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), t = new THREE.Vector3();
    for (let tries = 0; tries < 900 && api.neons.length < neonCount; tries++) {
      o.set(bb.min.x + Math.random() * (bb.max.x - bb.min.x), 2.2 + Math.random() * Math.random() * 14, bb.min.z + Math.random() * (bb.max.z - bb.min.z));
      const k = Math.random() * 4 | 0;
      d.set(k === 0 ? 1 : k === 1 ? -1 : 0, 0, k === 2 ? 1 : k === 3 ? -1 : 0);
      _ray.origin.copy(o); _ray.direction.copy(d);
      // Le point de départ doit être à l'air libre (rien juste au-dessus ni derrière).
      const h = bvh.raycastFirst(_ray, THREE.DoubleSide, 0.6, 22);
      if (!h || Math.abs(h.face.normal.y) > 0.3) continue;
      const n = h.face.normal.clone();
      if (n.dot(d) > 0) n.negate();
      const color = new THREE.Color(NEON[Math.random() * NEON.length | 0]);
      const vertical = Math.random() < 0.35, len = 1.2 + Math.random() * 4.2;
      const bar = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2.6), toneMapped: false, fog: false }));
      t.crossVectors(up, n).normalize();
      bar.position.copy(h.point).addScaledVector(n, 0.09);
      bar.scale.set(Math.abs(t.x) > 0.5 ? (vertical ? 0.1 : len) : 0.1, vertical ? len : 0.1, Math.abs(t.z) > 0.5 ? (vertical ? 0.1 : len) : 0.1);
      if (bar.position.y - bar.scale.y / 2 < 1.6) bar.position.y = 1.6 + bar.scale.y / 2;
      root.add(bar);
      api.neons.push({ x: bar.position.x + n.x * 0.5, y: bar.position.y, z: bar.position.z + n.z * 0.5, color: '#' + color.getHexString() });
    }
    // Carte des toits (hauteur du plus haut voxel plein par colonne) : la
    // pluie disparaît dessous, il ne pleut donc pas dans les bâtiments.
    const W = occN[0], D = occN[2], roof = new Float32Array(W * D);
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
      let top = 0;
      for (let y = occN[1] - 1; y >= 0; y--) if (occ[x + W * (y + occN[1] * z)]) { top = occMin.y + (y + 1) * VOX; break; }
      roof[x + W * z] = top;
    }
    const roofTex = new THREE.DataTexture(roof, W, D, THREE.RedFormat, THREE.FloatType);
    roofTex.minFilter = roofTex.magFilter = THREE.NearestFilter;
    roofTex.needsUpdate = true;
    // Pluie : des rubans fins face à la caméra (et non des traits d'un
    // pixel), plus clairs en tête, fondus en queue, étirés par la vitesse.
    const N = 16000, pos = new Float32Array(N * 12), corner = new Float32Array(N * 8), idx = new Uint32Array(N * 6);
    for (let i = 0; i < N; i++) {
      const x = Math.random(), y = Math.random(), z = Math.random();
      for (let k = 0; k < 4; k++) pos.set([x, y, z], i * 12 + k * 3);
      corner.set([-1, 0, 1, 0, -1, 1, 1, 1], i * 8);
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const rain = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uRoof: { value: roofTex }, uRoofMin: { value: new THREE.Vector2(occMin.x, occMin.z) }, uRoofSize: { value: new THREE.Vector2(W * VOX, D * VOX) }, uAmount: { value: 0.6 } },
      vertexShader: `
        attribute vec2 aCorner; uniform vec3 uCam; uniform float uTime; uniform sampler2D uRoof; uniform vec2 uRoofMin; uniform vec2 uRoofSize; uniform float uAmount;
        varying float vA; varying float vU;
        const vec3 BOX = vec3(30.0, 24.0, 30.0);
        void main() {
          vec3 b = position;
          float rnd = fract(b.x * 13.7 + b.z * 5.1);
          // Moins de gouttes quand la pluie faiblit.
          if (rnd > uAmount * 1.25) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; vU = 0.0; return; }
          float speed = 19.0 + 5.0 * rnd;
          vec3 fall = normalize(vec3(0.16, -1.0, 0.07));
          // Gouttes fixes dans le monde, répétées en pavé autour de la caméra.
          float y = mod(b.y * BOX.y - uTime * speed, BOX.y);
          vec3 p;
          p.xz = uCam.xz + mod(b.xz * BOX.xz + fall.xz * (BOX.y - y) - uCam.xz + BOX.xz * 0.5, BOX.xz) - BOX.xz * 0.5;
          p.y = uCam.y - 8.0 + y;
          float roof = texture2D(uRoof, (p.xz - uRoofMin) / uRoofSize).r;
          float dist = length(p - uCam);
          float len = 0.55 + 0.5 * fract(b.z * 7.1);
          vec3 P = p - fall * len * aCorner.y; // la queue traîne au-dessus de la tête
          vec3 side = normalize(cross(fall, uCam - P));
          P += side * aCorner.x * max(0.0045, dist * 0.0007);
          vA = (p.y > roof + 0.1 ? 1.0 : 0.0) * smoothstep(15.0, 9.0, dist) * smoothstep(0.4, 1.4, dist) * (1.0 - aCorner.y) * (0.5 + 0.5 * fract(b.y * 9.3));
          vU = aCorner.x;
          gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
        }`,
      fragmentShader: `varying float vA; varying float vU; void main() { float a = vA * (1.0 - vU * vU) * 0.26; if (a < 0.004) discard; gl_FragColor = vec4(0.72, 0.8, 0.95, a); }`,
      transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    }));
    rain.frustumCulled = false;
    rain.renderOrder = 30;
    root.add(rain);
    api.rain = rain;
  }
  // Libère tout (géométrie, textures, structures de collision) en quittant le
  // niveau : la scène pèse lourd en mémoire vive et vidéo.
  api.unload = () => {
    root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      for (const m of o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []) {
        for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose();
        if (m.uniforms) for (const k in m.uniforms) if (m.uniforms[k].value && m.uniforms[k].value.isTexture) m.uniforms[k].value.dispose();
        m.dispose();
      }
    });
    for (const c of [...root.children]) if (!c.isLight) root.remove(c);
    bvh = null; occ = null;
    api.ready = false; api.loading = null; api.rain = null; api.groundMesh = null; api.neons.length = 0;
  };
  api.update = (dt, camera) => {
    if (!api.rain) return;
    const u = api.rain.material.uniforms;
    u.uTime.value += dt;
    u.uCam.value.copy(camera.position);
  };
  // Hauteur du sol sous (x, z), cherchée vers le bas depuis yFrom.
  api.ground = (x, yFrom, z) => {
    if (!bvh) return 0;
    _ray.origin.set(x, yFrom, z); _ray.direction.set(0, -1, 0);
    const h = bvh.raycastFirst(_ray, THREE.DoubleSide, 0, 60);
    return h ? h.point.y : null;
  };
  // Premier obstacle sur le segment a → b ; remplit out.point / out.normal.
  api.segHit = (a, b, out) => {
    if (!bvh) return false;
    _d.subVectors(b, a);
    const len = _d.length();
    if (len < 1e-6) return false;
    _ray.origin.copy(a); _ray.direction.copy(_d).divideScalar(len);
    const h = bvh.raycastFirst(_ray, THREE.DoubleSide, 0, len);
    if (!h) return false;
    if (out) {
      out.point.copy(h.point);
      out.normal.copy(h.face.normal);
      if (out.normal.dot(_ray.direction) > 0) out.normal.negate(); // face au tireur
    }
    return true;
  };
  api.rayDist = (origin, dir, max) => {
    if (!bvh) return Infinity;
    _ray.origin.copy(origin); _ray.direction.copy(dir);
    const h = bvh.raycastFirst(_ray, THREE.DoubleSide, 0, max);
    return h ? h.distance : Infinity;
  };
  // Fenêtre d'occupation (nx × ny × nz voxels de 25 cm) à partir d'un coin
  // aligné sur la grille ; le dessous du sol est plein.
  api.VOX = VOX;
  api.occupancy = (min, nx, ny, nz) => {
    const out = new Uint8Array(nx * ny * nz);
    if (!occ) return out;
    const ox = Math.round((min.x - occMin.x) / VOX), oy = Math.round((min.y - occMin.y) / VOX), oz = Math.round((min.z - occMin.z) / VOX);
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
      const gy = y + oy, gz = z + oz, wy = min.y + (y + 0.5) * VOX;
      const row = nx * (y + ny * z);
      if (wy < 0) { out.fill(255, row, row + nx); continue; }
      if (gy < 0 || gz < 0 || gy >= occN[1] || gz >= occN[2]) continue;
      const src = occN[0] * (gy + occN[1] * gz);
      for (let x = 0; x < nx; x++) { const gx = x + ox; if (gx >= 0 && gx < occN[0] && occ[src + gx]) out[row + x] = 255; }
    }
    return out;
  };
  return api;
}
