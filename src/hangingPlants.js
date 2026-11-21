// ---- Plantes suspendues : jardinières et rideaux qui poussent --------------
// Des plantes qui retombent — de jardinières de béton accrochées au plafond,
// ou directement des bords du plafond (fentes de lumière, couloir d'entrée,
// bord du toit du balcon). Elles poussent par règles, comme dans le domaine
// PLANTES (L-systèmes, liane) : chaque tige avance pas à pas, la gravité la
// courbe, elle se ramifie selon l'espèce. Références : les jardins suspendus
// de l'éco-brutalisme (Barbican Conservatory, Londres ; jardinières
// suspendues de Guto Requena, São Paulo).
//   • pothos doré : longues tiges, feuilles en cœur panachées ;
//   • rhipsalis (cactus-gui) : tiges fines qui se divisent en deux ;
//   • fille de l'air (Tillandsia usneoides) : barbes gris-vert en zigzag ;
//   • chapelet de perles (Senecio) : fils ponctués de petites perles.
// Croissance : sur leur propre ligne de temps (pas l'heure du monde), dès que
// le visiteur entre : les tiges s'allongent depuis l'attache, les feuilles
// apparaissent, et au bout de quelques minutes de jolies fleurs éclosent.
// Tout se balance doucement dans l'air (plus fort vers le bout).
import * as THREE from 'three';

function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Balancement et croissance : en espace monde, nul à l'attache, croissant
// vers le bout (aHang) ; chaque élément apparaît quand la croissance (uGrow)
// dépasse son rang (aGrow), en grandissant depuis son point d'attache.
function swayMaterial(mat, U) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.uniforms.uGrow = U.uGrow;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aHang; attribute float aPhase; attribute float aGrow; uniform float uTime; uniform float uGrow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed *= clamp( ( uGrow - aGrow ) * 9.0, 0.0, 1.0 );')
      .replace('#include <project_vertex>', `
        vec4 mvPosition = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        mvPosition = modelMatrix * mvPosition;
        float hh = aHang * aHang;
        mvPosition.x += ( sin( uTime * 0.55 + mvPosition.z * 0.6 + aPhase ) * 0.06 + sin( uTime * 1.7 + aPhase * 3.0 ) * 0.012 ) * hh;
        mvPosition.z += ( cos( uTime * 0.47 + mvPosition.x * 0.5 + aPhase ) * 0.05 ) * hh;
        mvPosition = viewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`);
  };
  mat.customProgramCacheKey = () => 'inga-hanging-sway-grow';
  return mat;
}

function heartTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const heart = () => { x.beginPath(); x.moveTo(64, 120); x.bezierCurveTo(6, 82, 4, 20, 64, 38); x.bezierCurveTo(124, 20, 122, 82, 64, 120); };
  x.fillStyle = '#74a83e'; heart(); x.fill();
  x.save(); heart(); x.clip();
  x.strokeStyle = '#d9cf6a'; x.lineWidth = 7; x.globalAlpha = 0.55;
  for (let i = 0; i < 6; i++) { x.beginPath(); x.moveTo(64, 112); x.quadraticCurveTo(30 + i * 14, 70, 20 + i * 18, 30); x.stroke(); }
  x.restore();
  x.strokeStyle = '#c9d98a'; x.lineWidth = 3; x.globalAlpha = 0.8;
  x.beginPath(); x.moveTo(64, 116); x.lineTo(64, 42); x.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// Une fleur : cinq pétales autour d'un cœur, légèrement en coupe.
function flowerGeometry() {
  const petals = [];
  for (let i = 0; i < 5; i++) {
    const p = new THREE.PlaneGeometry(0.5, 0.9).translate(0, 0.45, 0);
    p.rotateX(-0.55); p.rotateY((i / 5) * Math.PI * 2);
    petals.push(p);
  }
  const g = new THREE.BufferGeometry();
  const pos = [], uv = [];
  for (const p of petals) { const pi = p.toNonIndexed(); pos.push(...pi.attributes.position.array); uv.push(...pi.attributes.uv.array); }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

export function createHangingPlants({ scene, lite, shadows, planterMat }) {
  const U = { uTime: { value: 0 }, uGrow: { value: 0 } };
  const group = new THREE.Group();
  scene.add(group);
  const segGeo = new THREE.CylinderGeometry(1, 1, 1, lite ? 3 : 5, 1, true).translate(0, 0.5, 0);
  const pearlGeo = new THREE.IcosahedronGeometry(1, lite ? 0 : 1);
  // Feuille en volume (attache en haut) : pliée le long de la nervure et
  // recourbée vers la pointe, pour qu'elle accroche la lumière de deux
  // façons et ne fasse plus « carte plate » quand on tourne autour.
  const leafGeo = new THREE.PlaneGeometry(1, 1, lite ? 2 : 4, lite ? 2 : 4).translate(0, -0.5, 0);
  {
    const lp = leafGeo.attributes.position;
    for (let i = 0; i < lp.count; i++) {
      const x = lp.getX(i), y = lp.getY(i);
      lp.setZ(i, Math.abs(x) * 0.42 + y * y * 0.32 - Math.abs(x) * y * 0.15);
      lp.setX(i, x * (1 - 0.12 * y * y));
    }
    leafGeo.computeVertexNormals();
  }
  const stems = [], leaves = [], pearls = [], flowers = [];
  const _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _m = new THREE.Matrix4(), _s = new THREE.Vector3();
  const steel = new THREE.MeshStandardMaterial({ color: '#2e3134', metalness: 0.8, roughness: 0.4 });

  const grow = (rnd, p0, dir, len, step, droop, wiggle) => {
    const pts = [p0.clone()], d = dir.clone().normalize(), p = p0.clone();
    for (let l = 0; l < len; l += step) {
      d.y -= droop; d.x += (rnd() - 0.5) * wiggle; d.z += (rnd() - 0.5) * wiggle; d.normalize();
      p.addScaledVector(d, step); pts.push(p.clone());
    }
    return pts;
  };

  // Une touffe de plantes. a : { x, z, y, rot, planter, len (échelle des
  // longueurs), dens (densité), ceil (hauteur du plafond pour les tiges),
  // width, grown (déjà poussée) }.
  function cluster(a, seed) {
    const rnd = rng(seed);
    // Sans jardinière, la « boîte » est une fine bande collée au plafond.
    const L = a.width ?? 1.5, Wd = 0.32, Hd = a.planter ? 0.3 : 0.02;
    const y = a.planter ? a.y : a.y - Hd / 2;
    const rotY = a.rot || 0;
    if (a.planter) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(L, Hd, Wd), planterMat);
      box.position.set(a.x, y, a.z); box.rotation.y = rotY; box.castShadow = box.receiveShadow = true;
      group.add(box);
      for (const sx of [-L * 0.4, L * 0.4]) {
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, a.ceil - y, 6), steel);
        const off = new THREE.Vector3(sx, 0, 0).applyAxisAngle(_up, rotY);
        rod.position.set(a.x + off.x, (a.ceil + y) / 2, a.z + off.z);
        group.add(rod);
      }
    }
    const toW = (lx, ly, lz) => new THREE.Vector3(lx, ly, lz).applyAxisAngle(_up, rotY).add(new THREE.Vector3(a.x, y, a.z));
    const out = (side) => new THREE.Vector3(0, 0, side).applyAxisAngle(_up, rotY);
    const k = (lite ? 0.55 : 1) * (a.dens ?? 1), ls = a.len ?? 1;
    // Chaque touffe démarre un peu à son heure ; a.grown : déjà poussée et
    // fleurie (rangs négatifs, toujours visibles).
    const pre = a.grown ? -2 : 0, delay = pre + rnd() * 0.12;
    const g0 = (f) => delay + f * 0.72; // rang de croissance le long d'une tige
    const flower = (p, hang, ph) => { if (rnd() < 0.6) flowers.push({ p, hang, phase: ph, grow: pre + 0.84 + rnd() * 0.14, size: 0.035 + rnd() * 0.025, col: (rnd() * 4) | 0, yaw: rnd() * 6.28 }); };
    const leaf = (p, size, hang, ph, gr, tilt = 0.5 + rnd() * 0.6, yaw = rnd() * Math.PI * 2) => leaves.push({ p, size, yaw, tilt, hang, phase: ph, grow: gr });
    // Grappe de baies (rouges, orangées ou blanches) qui pendent d'un nœud.
    const berries = (p, hang, ph, gr) => {
      const col = 3 + ((rnd() * 3) | 0);
      for (let b = 0, n = 3 + ((rnd() * 5) | 0); b < n; b++) {
        pearls.push({ p: p.clone().add(new THREE.Vector3((rnd() - 0.5) * 0.05, -0.01 - rnd() * 0.05, (rnd() - 0.5) * 0.05)), r: 0.007 + rnd() * 0.005, hang, phase: ph, col, grow: gr });
      }
    };
    // Lierre qui grimpe depuis l'eau, plaqué au mur (comme la liane du
    // domaine PLANTES, en petit) : des tiges qui montent en ondulant, de
    // petites feuilles à plat contre le mur, et de courtes racines aériennes
    // qui cherchent la paroi. a.ivy : { tx, tz } (le long du mur), { nx, nz }
    // (la normale du mur), a.width, a.height (hauteur maximale).
    if (a.ivy) {
      const T = new THREE.Vector3(a.tx, 0, a.tz), Nw = new THREE.Vector3(a.nx, 0, a.nz), base = new THREE.Vector3(a.x, a.y, a.z);
      const wallYaw = Math.atan2(a.nx, a.nz);
      const n = Math.round((a.stems ?? 7) * (lite ? 0.6 : 1));
      for (let i = 0; i < n; i++) {
        let u = (rnd() - 0.5) * a.width, v = 0, du = (rnd() - 0.5) * 0.6;
        const L = a.height * (0.35 + 0.65 * rnd()), ph = rnd() * 6, st = delay + rnd() * 0.15;
        const pts = [base.clone().addScaledVector(T, u).addScaledVector(Nw, 0.012)];
        while (v < L) {
          du = du * 0.8 + (rnd() - 0.5) * 0.5;
          u += du * 0.05; v += 0.045 * (0.7 + 0.5 * rnd());
          pts.push(base.clone().addScaledVector(T, u).addScaledVector(Nw, 0.012 + rnd() * 0.004).add(new THREE.Vector3(0, v, 0)));
        }
        const total = pts.length - 1;
        for (let j = 0; j < total; j++) {
          const f = j / total, gr = st + f * 0.8;
          seg(pts[j], pts[j + 1], 0.0035 * (1 - 0.5 * f), 0.04, ph, 4, gr);
          if (j % 2 === 1) leaf(pts[j + 1].clone().addScaledVector(Nw, 0.008), (0.035 + rnd() * 0.025) * (1 - 0.3 * f), 0.04, ph, gr + 0.03, 0.15 + rnd() * 0.3, wallYaw + (rnd() - 0.5) * 0.9);
          // Racines aériennes : courtes, brunes, vers la paroi et le bas.
          if (rnd() < 0.18) {
            const r0 = pts[j + 1], r1 = r0.clone().addScaledVector(T, (rnd() - 0.5) * 0.05).add(new THREE.Vector3(0, -0.02 - rnd() * 0.04, 0)).addScaledVector(Nw, -0.006);
            seg(r0, r1, 0.0012, 0.02, ph, 5, gr + 0.05);
          }
        }
      }
      return;
    }
    // Rideau (références : passages couverts de lianes qui tombent jusqu'à
    // l'eau) : une rangée serrée de longues tiges presque droites, couvertes
    // de petites feuilles ; a.len est ici la longueur en mètres, a.gap une
    // ouverture au milieu (on passe dessous), où les tiges restent courtes.
    if (a.curtain) {
      // Pas une rangée : les tiges partent d'une ligne qui serpente, en
      // touffes (longues ici, courtes là), avec de la profondeur ; a.clear
      // ({ x0, x1 } en monde) garde un passage où elles restent courtes.
      const n = Math.round(L * (lite ? 13 : 24) * (a.dens ?? 1));
      const f1 = rnd() * 6.3, f2 = rnd() * 6.3, w1 = 1.1 + rnd() * 1.4, w2 = 3 + rnd() * 3;
      const clump = (u) => 0.5 + 0.32 * Math.sin(u * w1 + f1) + 0.18 * Math.sin(u * w2 + f2);
      for (let i = 0; i < n; i++) {
        const lx = (rnd() - 0.5) * L;
        const lz = Math.sin(lx * 0.9 + f2) * 0.35 * Math.min(1, L / 2) + (rnd() - 0.5) * 0.55;
        const base = toW(lx, 0, lz);
        let len = a.len * (0.2 + 0.8 * clump(lx)) * (0.65 + 0.35 * rnd()) * (rnd() < 0.2 ? 0.45 : 1);
        if (a.clear && base.x > a.clear.x0 && base.x < a.clear.x1) {
          const e = Math.min(base.x - a.clear.x0, a.clear.x1 - base.x);
          len = Math.min(len, 0.35 + rnd() * 0.9 + (e < 0.35 ? rnd() * 0.8 : 0));
        }
        const d0 = new THREE.Vector3((rnd() - 0.5) * 0.25, -1, (rnd() - 0.5) * 0.25);
        const pts = grow(rnd, base, d0, len, 0.075, 0, 0.11);
        const total = pts.length - 1, ph = rnd() * 6;
        for (let j = 0; j < total; j++) {
          const f = j / total;
          seg(pts[j], pts[j + 1], 0.0026, f, ph, 0, g0(f));
          const hg = (j + 1) / total, gl = g0(f) + 0.02;
          // Trois ou quatre feuilles par nœud : le rideau doit être plein.
          for (let q = 0, nq = lite ? 3 : 4 + (rnd() < 0.5 ? 1 : 0); q < nq; q++) {
            // Écartées de la tige tout autour (en volume), pas dans un plan.
            const ay = rnd() * Math.PI * 2, ar = 0.02 + rnd() * 0.06;
            leaf(pts[j + 1].clone().add(new THREE.Vector3(Math.cos(ay) * ar, (rnd() - 0.5) * 0.03, Math.sin(ay) * ar)), (0.085 + rnd() * 0.05) * (1 - 0.25 * f), hg, ph, gl, 0.5 + rnd() * 0.9, -ay + Math.PI / 2 + (rnd() - 0.5) * 0.8);
          }
          if (rnd() < 0.025) berries(pts[j + 1], hg, ph, gl + 0.1);
        }
      }
      return;
    }
    // Une touffe de feuilles à l'attache : du volume, et elle cache le départ
    // des tiges.
    for (let i = 0; i < Math.round(40 * k * L); i++) {
      leaf(toW((rnd() - 0.5) * L * 1.1, (rnd() - 0.5) * Hd - 0.03 - rnd() * 0.12, (rnd() - 0.5) * Wd * 2), 0.12 + rnd() * 0.09, 0.05, rnd() * 6, delay + rnd() * 0.2, 0.9 + rnd() * 0.9);
    }
    // Pothos : une feuille à chaque nœud, de part et d'autre.
    for (let i = 0; i < Math.round(10 * k); i++) {
      const side = rnd() < 0.5 ? -1 : 1;
      const p0 = toW((rnd() - 0.5) * L * 0.9, Hd / 2, side * Wd / 2);
      const pts = grow(rnd, p0, out(side).add(new THREE.Vector3(0, a.planter ? -0.4 : -1.5, 0)), (1.2 + rnd() * 1.4) * ls, 0.07, 0.07, 0.25);
      const total = pts.length - 1, ph = rnd() * 6;
      for (let j = 0; j < total; j++) {
        seg(pts[j], pts[j + 1], 0.006, j / total, ph, 0, g0(j / total));
        if (j > 0) {
          const sz = 0.19 * (1 - 0.4 * j / total);
          leaf(pts[j], sz * (0.8 + rnd() * 0.4), j / total, ph, g0(j / total) + 0.02);
          leaf(pts[j], sz * (0.7 + rnd() * 0.4), j / total, ph, g0(j / total) + 0.02);
          if (!lite) leaf(pts[j], sz * (0.6 + rnd() * 0.3), j / total, ph, g0(j / total) + 0.02);
          if (rnd() < 0.04) berries(pts[j], j / total, ph, g0(j / total) + 0.12);
        }
      }
      flower(pts[total], 1, ph);
    }
    // Rhipsalis.
    const rhips = (p, d, depth, r, ph, gr) => {
      const len = 0.09 + rnd() * 0.07;
      const nd = d.clone(); nd.y -= 0.35; nd.x += (rnd() - 0.5) * 0.3; nd.z += (rnd() - 0.5) * 0.3; nd.normalize();
      const q = p.clone().addScaledVector(nd, len);
      const hang = Math.min(1, (y - q.y) / 1.6);
      seg(p, q, r, hang, ph, 1, gr);
      leaf(q, 0.09 + rnd() * 0.06, hang, ph, gr + 0.03);
      if (rnd() < 0.03) berries(q, hang, ph, gr + 0.1);
      const ng = gr + 0.72 / 9;
      if (depth <= 0) { if (rnd() < 0.25) pearls.push({ p: q, r: 0.009, hang, phase: ph, col: 2, grow: ng }); else flower(q, hang, ph); return; }
      if (rnd() < 0.55) {
        const sideV = new THREE.Vector3(-nd.z, 0, nd.x).normalize().multiplyScalar(0.6);
        rhips(q, nd.clone().add(sideV), depth - 1, r * 0.9, ph, ng);
        rhips(q, nd.clone().sub(sideV), depth - 1, r * 0.9, ph, ng);
      } else rhips(q, nd, depth - 1, r * 0.95, ph, ng);
    };
    for (let i = 0; i < Math.round(6 * k); i++) {
      const side = rnd() < 0.5 ? -1 : 1;
      rhips(toW((rnd() - 0.5) * L * 0.8, Hd / 2, side * Wd * 0.35), out(side).add(new THREE.Vector3(0, a.planter ? 0.3 : -0.6, 0)), lite ? 6 : 8, 0.0045, rnd() * 6, delay);
    }
    // Fille de l'air.
    for (let i = 0; i < Math.round(9 * k); i++) {
      const p0 = toW((rnd() - 0.5) * L, -Hd / 2, (rnd() - 0.5) * Wd);
      const pts = grow(rnd, p0, new THREE.Vector3(0, -1, 0), (0.5 + rnd() * 1.0) * ls, 0.045, 0.02, 0.9);
      const total = pts.length - 1, ph = rnd() * 6;
      for (let j = 0; j < total; j++) seg(pts[j], pts[j + 1], 0.0022, (j + 1) / total, ph, 3, g0((j + 1) / total));
    }
    // Chapelet de perles.
    for (let i = 0; i < Math.round(5 * k); i++) {
      const side = rnd() < 0.5 ? -1 : 1;
      const p0 = toW((rnd() - 0.5) * L * 0.9, Hd / 2, side * Wd / 2);
      const pts = grow(rnd, p0, out(side).add(new THREE.Vector3(0, -1.2, 0)), (0.6 + rnd() * 1.0) * ls, 0.028, 0.03, 0.12);
      const total = pts.length - 1, ph = rnd() * 6;
      for (let j = 0; j < total; j++) {
        seg(pts[j], pts[j + 1], 0.0018, j / total, ph, 0, g0(j / total));
        pearls.push({ p: pts[j + 1], r: 0.0085 + rnd() * 0.002, hang: (j + 1) / total, phase: ph, col: 0, grow: g0((j + 1) / total) + 0.01 });
        if (rnd() < 0.3) leaf(pts[j + 1], 0.05 + rnd() * 0.03, (j + 1) / total, ph, g0((j + 1) / total) + 0.02);
      }
      flower(pts[total], 1, ph);
    }
  }
  function seg(a, b, r, hang, phase, col, gr) { stems.push({ a: a.clone(), b: b.clone(), r, hang, phase, col, grow: gr }); }

  const attrs = (geo, list) => {
    geo.setAttribute('aHang', new THREE.InstancedBufferAttribute(new Float32Array(list.map((o) => o.hang)), 1));
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array(list.map((o) => o.phase)), 1));
    geo.setAttribute('aGrow', new THREE.InstancedBufferAttribute(new Float32Array(list.map((o) => o.grow)), 1));
  };
  const STEM_COL = [new THREE.Color('#4a6b2a'), new THREE.Color('#8fae5a'), new THREE.Color('#f2efe2'), new THREE.Color('#9aa58c'), new THREE.Color('#5e5234'), new THREE.Color('#8a6a48')];
  const FLOWER_COL = [new THREE.Color('#fbf6ee'), new THREE.Color('#f4c9d2'), new THREE.Color('#f6e7a8'), new THREE.Color('#d9c9ef')];
  return {
    build(anchors) {
      anchors.forEach((a, i) => cluster(a, 1000 + i * 77));
      const sm = new THREE.InstancedMesh(segGeo.clone(), swayMaterial(new THREE.MeshStandardMaterial({ roughness: 0.75 }), U), stems.length);
      stems.forEach((st, i) => {
        const d = st.b.clone().sub(st.a), len = d.length();
        _q.setFromUnitVectors(_up, d.normalize());
        _s.set(st.r, len, st.r);
        sm.setMatrixAt(i, _m.compose(st.a, _q, _s));
        sm.setColorAt(i, STEM_COL[st.col]);
      });
      attrs(sm.geometry, stems);
      const lm = new THREE.InstancedMesh(leafGeo.clone(), swayMaterial(new THREE.MeshStandardMaterial({ map: heartTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55 }), U), leaves.length);
      const e = new THREE.Euler(), c = new THREE.Color();
      leaves.forEach((lf, i) => {
        e.set(lf.tilt, lf.yaw, 0, 'YXZ'); _q.setFromEuler(e); _s.setScalar(lf.size);
        lm.setMatrixAt(i, _m.compose(lf.p, _q, _s));
        lm.setColorAt(i, c.setHSL(0.22 + Math.random() * 0.07, 0.35 + Math.random() * 0.25, 0.8 + Math.random() * 0.2));
      });
      attrs(lm.geometry, leaves);
      const pm = new THREE.InstancedMesh(pearlGeo.clone(), swayMaterial(new THREE.MeshStandardMaterial({ roughness: 0.4 }), U), pearls.length);
      const pearlCol = [new THREE.Color('#7fae55'), null, new THREE.Color('#f3f0e6'), new THREE.Color('#c2311f'), new THREE.Color('#e8892c'), new THREE.Color('#f1e9d8')];
      pearls.forEach((pl, i) => { _s.setScalar(pl.r); pm.setMatrixAt(i, _m.compose(pl.p, _q.identity(), _s)); pm.setColorAt(i, pearlCol[pl.col]); });
      attrs(pm.geometry, pearls);
      // Les fleurs : elles éclosent en dernier, tournées vers le bas.
      const fm = new THREE.InstancedMesh(flowerGeometry(), swayMaterial(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.6, emissive: '#2a2018', emissiveIntensity: 0.15 }), U), flowers.length);
      flowers.forEach((f, i) => {
        e.set(Math.PI + (Math.random() - 0.5) * 0.8, f.yaw, 0, 'YXZ'); _q.setFromEuler(e); _s.setScalar(f.size);
        fm.setMatrixAt(i, _m.compose(f.p, _q, _s));
        fm.setColorAt(i, FLOWER_COL[f.col]);
      });
      attrs(fm.geometry, flowers);
      for (const m of [sm, lm, pm, fm]) {
        m.frustumCulled = false; group.add(m);
        if (!shadows) continue;
        // L'ombre suit la croissance : sans ces matériaux, les plantes pas
        // encore poussées projetteraient déjà leur ombre.
        const map = m === lm ? lm.material.map : null, at = map ? 0.5 : 0;
        m.castShadow = true;
        m.customDepthMaterial = swayMaterial(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: at }), U);
        m.customDistanceMaterial = swayMaterial(new THREE.MeshDistanceMaterial({ map, alphaTest: at }), U);
      }
    },
    // grow : 0 (rien) → 1 (tout a poussé, fleurs écloses).
    update(t, grow) { U.uTime.value = t; U.uGrow.value = grow; },
    group,
  };
}

// ---- Graminées hautes ----
// De longues herbes fines (comme le long des allées d'eau des références),
// en touffes plantées dans l'eau ou au bord. Chaque brin est un ruban
// effilé, courbé, qui ploie au vent (plus fort vers la pointe).
export function createReeds({ scene, lite }) {
  const U = { uTime: { value: 0 } };
  // Un brin : ruban de 6 segments, large à la base, en pointe au sommet.
  const g = new THREE.BufferGeometry();
  const pos = [], idx = [], N = 6;
  for (let i = 0; i <= N; i++) {
    const t = i / N, w = 0.006 * (1 - t * 0.9);
    pos.push(-w, t, 0, w, t, 0);
    if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.7 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aBend; uniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float t = position.y;
        transformed.z += aBend * t * t;
        transformed.z += sin( uTime * 1.3 + aBend * 40.0 + instanceMatrix[3].x * 2.0 ) * 0.05 * t * t;`);
  };
  mat.customProgramCacheKey = () => 'inga-reeds';
  let mesh = null;
  return {
    // tufts : [{ x, y, z, n, h }] (n brins, hauteur h en mètres).
    build(tufts) {
      const mats = [], bends = [], cols = [];
      const d = new THREE.Object3D(), c = new THREE.Color();
      for (const T of tufts) {
        const n = Math.round(T.n * (lite ? 0.5 : 1));
        for (let i = 0; i < n; i++) {
          const r = Math.sqrt(Math.random()) * (T.r ?? 0.12), a = Math.random() * 6.28;
          d.position.set(T.x + Math.cos(a) * r, T.y, T.z + Math.sin(a) * r);
          d.rotation.set(0, Math.random() * 6.28, 0);
          const h = T.h * (0.6 + Math.random() * 0.5);
          d.scale.set(1, h, 1);
          d.updateMatrix(); mats.push(d.matrix.clone());
          bends.push((0.1 + Math.random() * 0.35) / h);
          cols.push(c.setHSL(0.2 + Math.random() * 0.06, 0.4 + Math.random() * 0.2, 0.3 + Math.random() * 0.2).clone());
        }
      }
      const geo = g.clone();
      geo.setAttribute('aBend', new THREE.InstancedBufferAttribute(new Float32Array(bends), 1));
      mesh = new THREE.InstancedMesh(geo, mat, mats.length);
      mats.forEach((m, i) => { mesh.setMatrixAt(i, m); mesh.setColorAt(i, cols[i]); });
      mesh.frustumCulled = false;
      scene.add(mesh);
    },
    update(t) { U.uTime.value = t; },
  };
}
