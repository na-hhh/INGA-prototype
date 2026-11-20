// Peinture projetée. Chaque éclaboussure est une boîte invisible ; pour chaque
// pixel qu'elle couvre à l'écran, on relit la profondeur de la scène, on
// retrouve le point réel de la surface et on ne peint que s'il est dans la
// boîte. La peinture épouse donc exactement la géométrie : rien ne dépasse
// d'un bord de mur, elle tourne dans les angles et descend les marches.
// Le motif est calculé (contour irrégulier, gouttelettes), s'étale en une
// fraction de seconde, puis coule lentement vers le bas sur les parois.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const MAX = 1800;

export function createPaintDecals({ camera, depthTexture }) {
  const geo = new THREE.InstancedBufferGeometry();
  const box = new THREE.BoxGeometry(2, 2, 2);
  geo.index = box.index;
  geo.setAttribute('position', box.attributes.position);
  const attr = (name, size) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX * size), size).setUsage(THREE.DynamicDrawUsage); geo.setAttribute(name, a); return a; };
  const aC = attr('iCenter', 3), aX = attr('iX', 3), aY = attr('iY', 3), aS = attr('iSize', 4), aCol = attr('iColor', 3), aM = attr('iMisc', 4), aD = attr('iDir', 3), aO = attr('iOff', 2);
  geo.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    uniforms: { tDepth: { value: null }, tScene: { value: null }, uProjInv: { value: new THREE.Matrix4() }, uViewInv: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 } },
    vertexShader: `
      attribute vec3 iCenter; attribute vec3 iX; attribute vec3 iY; attribute vec4 iSize; attribute vec3 iColor; attribute vec4 iMisc; attribute vec3 iDir; attribute vec2 iOff;
      varying vec2 vO;
      varying vec3 vC; varying vec3 vX; varying vec3 vY; varying vec3 vN; varying vec4 vS; varying vec3 vCol; varying vec4 vM; varying vec3 vD;
      void main() {
        vec3 n = cross(iX, iY);
        vD = iDir; vO = iOff;
        vC = iCenter; vX = iX; vY = iY; vN = n; vS = iSize; vCol = iColor; vM = iMisc;
        vec3 w = iCenter + iX * position.x * iSize.x + iY * position.y * iSize.y + n * position.z * iSize.z;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: `
      precision highp float;
      uniform sampler2D tDepth; uniform sampler2D tScene; uniform mat4 uProjInv; uniform mat4 uViewInv; uniform vec2 uRes; uniform float uTime;
      varying vec3 vC; varying vec3 vX; varying vec3 vY; varying vec3 vN; varying vec4 vS; varying vec3 vCol; varying vec4 vM; varying vec3 vD; varying vec2 vO;
      float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
      vec3 worldAt(vec2 uv) {
        float d = texture2D(tDepth, uv).x;
        vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
        return (uViewInv * vec4(v.xyz / v.w, 1.0)).xyz;
      }
      void main() {
        vec2 uv = gl_FragCoord.xy / uRes;
        vec3 w = worldAt(uv);
        vec3 d = w - vC;
        vec3 l = vec3(dot(d, vX), dot(d, vY), dot(d, vN));     // mètres, repère de la tache
        if (abs(l.x) > vS.x || abs(l.y) > vS.y || abs(l.z) > vS.z) discard;
        // vM.z : 0 sol, 1 paroi, +2 pour une petite tache « simple » (ni
        // satellites ni coulures : il y en a des milliers).
        float seed = vM.x, age = uTime - vM.y, wall = mod(vM.z, 2.0), R = vS.w;
        bool simple = vM.z > 1.5;
        vec2 q = l.xy - vO;                                    // relatif au point d'impact
        // Étalement : la tache atteint sa taille en ~0,25 s.
        float grow = 1.0 - exp(-age * 9.0);
        // La peinture part du point d'impact et s'étale VERS L'AVANT, dans le
        // sens du tir : plus l'angle est rasant (g → 1), plus la tache est
        // une longue langue dont l'arrière reste près de l'impact.
        vec2 du = vD.xy, dv = vec2(-du.y, du.x);
        float g = vD.z;
        float La = R * (1.0 + 1.9 * g), Lb = R * (1.0 - 0.3 * g);   // demi-axes : long, large
        float cOff = La - R * (1.0 - 0.45 * g);                      // centre en avant de l'impact
        vec2 e = vec2((dot(q, du) - cOff * grow) / (La * grow + 1e-4), dot(q, dv) / (Lb * grow + 1e-4));
        float r = length(e), a = atan(e.y, e.x);
        // Bord irrégulier, effilé vers l'avant quand le tir est rasant.
        float edge = 0.78 + 0.13 * sin(a * 3.0 + seed) + 0.08 * sin(a * 7.0 + seed * 2.3) + 0.05 * sin(a * 13.0 + seed * 0.7) + 0.035 * sin(a * 29.0 + seed * 1.9);
        edge *= 1.0 - 0.28 * g * max(0.0, cos(a)) * (0.5 + 0.5 * sin(a * 5.0 + seed));
        float m = 1.0 - smoothstep(edge - 0.03, edge, r);
        // Gouttelettes satellites, projetées surtout vers l'avant.
        for (int i = 0; i < 9; i++) {
          if (simple || r > 1.5) break; // hors de portée des gouttelettes : rien à calculer
          float h = hash(seed + float(i) * 3.7);
          float ang = (hash(seed * 1.3 + float(i)) * 2.0 - 1.0) * 3.14159 * (1.0 - 0.62 * g);
          float far = 0.92 + 0.36 * h;
          vec2 c = (du * (cOff + cos(ang) * La * far) + dv * sin(ang) * Lb * far) * grow;
          float rr = R * (0.035 + 0.09 * hash(seed + float(i) * 9.1));
          m = max(m, 1.0 - smoothstep(rr * 0.8, rr, length(q - c)));
        }
        // Coulures : sur une paroi, des filets descendent lentement.
        if (!simple && wall > 0.5 && q.y < 0.0) {
          float cw = R * 0.16, id = floor(q.x / cw), fx = fract(q.x / cw) - 0.5;
          float h = hash(id * 1.7 + seed);
          float reach = sqrt(max(0.0, 1.0 - pow(abs((id + 0.5) * cw) / (R * 0.85), 2.0)));   // sous le bord de la tache
          float len = reach * R * 0.8 + h * h * (0.25 + 1.5 * R) * (1.0 - exp(-max(age - 0.25, 0.0) * 0.45));
          float wdt = (0.16 + 0.26 * h) * (1.0 - 0.45 * clamp(-q.y / max(len, 1e-3), 0.0, 1.0));
          if (reach > 0.0 && h > 0.35 && -q.y < len) m = max(m, 1.0 - smoothstep(wdt * 0.75, wdt, abs(fx)));
        }
        // Les surfaces vues de profil (tranche d'un mur…) ne reçoivent que ce
        // qui les touche vraiment : fondu selon l'épaisseur et l'orientation.
        vec3 sn = normalize(cross(dFdx(w), dFdy(w)));
        float facing = abs(dot(sn, vN));
        float fade = smoothstep(0.08, 0.35, facing) * (1.0 - smoothstep(0.75, 1.0, abs(l.z) / vS.z));
        float alpha = m * fade;
        if (alpha < 0.02) discard;
        // La peinture prend l'éclairage de ce qu'elle recouvre (ombres, néons).
        vec3 sc = texture2D(tScene, uv).rgb;
        float luma = dot(sc, vec3(0.3, 0.59, 0.11));
        gl_FragColor = vec4(vCol * (0.12 + 2.1 * luma) + sc * 0.06, alpha * 0.96);
      }`,
    transparent: true, depthTest: false, depthWrite: false, side: THREE.BackSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const copy = new THREE.ShaderMaterial({
    uniforms: { t: { value: null } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D t; varying vec2 vUv; void main() { gl_FragColor = texture2D(t, vUv); }',
    depthTest: false, depthWrite: false,
  });
  const fsq = new FullScreenQuad(copy);
  let count = 0, cursor = 0, time = 0;

  class PaintPass extends Pass {
    render(renderer, writeBuffer, readBuffer) {
      copy.uniforms.t.value = readBuffer.texture;
      renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
      fsq.render(renderer);
      const u = mat.uniforms;
      u.tDepth.value = depthTexture(); u.tScene.value = readBuffer.texture;
      u.uProjInv.value.copy(camera.projectionMatrixInverse); u.uViewInv.value.copy(camera.matrixWorld);
      u.uRes.value.set(writeBuffer.width, writeBuffer.height); u.uTime.value = time;
      const ac = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(scene, camera);
      renderer.autoClear = ac;
    }
  }
  const pass = new PaintPass();
  pass.enabled = false;
  const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _c2 = new THREE.Vector3(), _c = new THREE.Color();
  return {
    pass, MAX,
    // active : seulement dans le niveau où la peinture a été posée.
    update(dt, active = true) { time += dt; pass.enabled = active && count > 0; },
    // pos : point d'impact ; n : normale ; t : sens du tir le long de la
    // surface ; R : rayon de l'éclat ; graze : 0 = tir de face, 1 = tir rasant.
    add(pos, n, t, color, R, graze, simple = false) {
      const wall = Math.abs(n.y) < 0.6;
      if (wall) { _y.set(0, 1, 0).addScaledVector(n, -n.y).normalize(); _x.crossVectors(_y, n); }
      else { _x.copy(t).addScaledVector(n, -t.dot(n)); if (_x.lengthSq() < 1e-4) _x.set(1, 0, 0).addScaledVector(n, -n.x); _x.normalize(); _y.crossVectors(n, _x); }
      const drip = wall && !simple ? 0.4 + 1.7 * R : 0;
      // Sens du tir dans le repère de la tache.
      _c2.copy(t).addScaledVector(n, -t.dot(n));
      if (_c2.lengthSq() < 1e-6) _c2.copy(_x);
      _c2.normalize();
      const ux = _c2.dot(_x), uy = _c2.dot(_y);
      // Boîte au plus juste : chaque pixel couvert coûte un calcul par image,
      // la boîte ne doit donc contenir que la tache (langue vers l'avant,
      // gouttelettes, coulures), pas un grand carré autour.
      const La = R * (1 + 1.9 * graze), Lb = R * (1 - 0.3 * graze), cOff = La - R * (1 - 0.45 * graze);
      const k = simple ? 1.06 : 1.34;
      const fwd = cOff + La * k, back = La * k - cOff, side = Lb * k;
      // Étendue de l'ellipse (axes du, dv) projetée sur les axes de la boîte.
      const ex = Math.abs(ux) * (fwd + back) / 2 + Math.abs(uy) * side, ey = Math.abs(uy) * (fwd + back) / 2 + Math.abs(ux) * side;
      const cx = ux * (fwd - back) / 2, cy = uy * (fwd - back) / 2; // centre de la boîte, depuis l'impact
      const sx = ex, sy = ey + drip / 2;
      aD.setXYZ(cursor, ux, uy, graze);
      aO.setXY(cursor, -cx, -cy + drip / 2);
      const i = cursor;
      cursor = (cursor + 1) % MAX;
      count = Math.min(MAX, count + 1);
      // Sur une paroi la boîte descend pour laisser la place aux coulures.
      aC.setXYZ(i, pos.x + _x.x * cx + _y.x * (cy - drip / 2), pos.y + _x.y * cx + _y.y * (cy - drip / 2), pos.z + _x.z * cx + _y.z * (cy - drip / 2));
      aX.setXYZ(i, _x.x, _x.y, _x.z); aY.setXYZ(i, _y.x, _y.y, _y.z);
      aS.setXYZW(i, sx, sy, Math.min(0.9, 0.3 + R * 0.5), R * (wall ? 1 : 1));
      _c.set(color);
      aCol.setXYZ(i, _c.r, _c.g, _c.b);
      aM.setXYZW(i, Math.random() * 100, time, (wall ? 1 : 0) + (simple ? 2 : 0), drip / 2);
      for (const a of [aC, aX, aY, aS, aCol, aM, aD, aO]) a.needsUpdate = true;
      geo.instanceCount = count;
    },
    clear() { count = 0; cursor = 0; geo.instanceCount = 0; },
  };
}
