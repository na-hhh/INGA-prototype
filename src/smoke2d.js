// Bac à fumée 2D : solveur de fluide entièrement sur GPU (cibles de rendu
// demi-flottantes), une coupe verticale du bac. En 2D la grille peut être
// très fine (jusqu'à 1024 de large) pour un coût dérisoire : c'est la version
// « résolution ridicule » qui sert de référence visuelle aux astuces 3D.
//
// Schémas d'advection au choix :
//  - 'stam'    : semi-lagrangien (Stam, « Stable Fluids », 1999)
//  - 'mac'     : MacCormack inconditionnellement stable (Selle et al., 2008)
//  - 'reflect' : advection-réflexion (Zehnder, Narain, Thomaszewski, 2018),
//                avec MacCormack pour le transport
// Projection : Jacobi sur la pression, parois solides (sol + murs du bac).
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
// Domaine : dom.x × dom.y mètres. Sol épais d'1 m, deux murs du bac, bord
// du domaine fermé. Tout est analytique : pas de texture d'obstacles.
const COMMON = `
  precision highp float;
  varying vec2 vUv;
  uniform vec2 px;
  uniform vec2 dom;
  uniform float open;
  uniform vec4 bac; // demi-largeur intérieure, épaisseur du mur, hauteur du mur, épaisseur du sol
  float solid(vec2 uv) {
    if (uv.x < px.x || uv.x > 1.0 - px.x || uv.y > 1.0 - px.y) return 1.0;
    vec2 w = uv * dom;
    if (w.y < bac.w) return 1.0;
    float ax = abs(w.x - dom.x * 0.5);
    // open : la paroi de droite est retirée, la fumée sort du bac.
    if (w.y < bac.w + bac.z && ax > bac.x && ax < bac.x + bac.y && (open < 0.5 || w.x < dom.x * 0.5)) return 1.0;
    return 0.0;
  }`;
const frag = (body) => COMMON + body;

const F_ADVECT = frag(`
  uniform sampler2D tQ; uniform sampler2D tVel; uniform float dt; uniform float keep;
  void main() {
    if (solid(vUv) > 0.5) { gl_FragColor = vec4(0.0); return; }
    vec2 v = texture2D(tVel, vUv).xy;
    gl_FragColor = texture2D(tQ, vUv - dt * v / dom) * keep;
  }`);
// MacCormack : q̂ = A(q), q̃ = A⁻¹(q̂), q' = q̂ + (q − q̃)/2, ramené à q̂ quand
// la correction sort de l'intervalle des 4 texels d'origine (limiteur).
const F_MAC = frag(`
  uniform sampler2D tQ; uniform sampler2D tHat; uniform sampler2D tTilde; uniform sampler2D tVel;
  uniform float dt; uniform float keep;
  void main() {
    if (solid(vUv) > 0.5) { gl_FragColor = vec4(0.0); return; }
    vec2 v = texture2D(tVel, vUv).xy;
    vec2 b = vUv - dt * v / dom;
    vec2 c = (floor(b / px - 0.5) + 0.5) * px;
    vec4 q0 = texture2D(tQ, c), q1 = texture2D(tQ, c + vec2(px.x, 0.0));
    vec4 q2 = texture2D(tQ, c + vec2(0.0, px.y)), q3 = texture2D(tQ, c + px);
    vec4 mn = min(min(q0, q1), min(q2, q3)), mx = max(max(q0, q1), max(q2, q3));
    vec4 hat = texture2D(tHat, vUv);
    vec4 r = hat + 0.5 * (texture2D(tQ, vUv) - texture2D(tTilde, vUv));
    vec4 ok = step(mn, r) * step(r, mx);
    gl_FragColor = mix(hat, r, ok) * keep;
  }`);
const F_CURL = frag(`
  uniform sampler2D tVel;
  void main() {
    float l = texture2D(tVel, vUv - vec2(px.x, 0.0)).y, r = texture2D(tVel, vUv + vec2(px.x, 0.0)).y;
    float b = texture2D(tVel, vUv - vec2(0.0, px.y)).x, t = texture2D(tVel, vUv + vec2(0.0, px.y)).x;
    vec2 h = dom * px;
    gl_FragColor = vec4((r - l) / (2.0 * h.x) - (t - b) / (2.0 * h.y), 0.0, 0.0, 1.0);
  }`);
// Poids de la fumée + confinement de vorticité (Fedkiw et al., 2001).
const F_FORCE = frag(`
  uniform sampler2D tVel; uniform sampler2D tDen; uniform sampler2D tCurl;
  uniform float dt; uniform float weight; uniform float swirl;
  void main() {
    if (solid(vUv) > 0.5) { gl_FragColor = vec4(0.0); return; }
    vec2 v = texture2D(tVel, vUv).xy;
    v.y -= weight * texture2D(tDen, vUv).r * dt;
    float c = texture2D(tCurl, vUv).r;
    float l = abs(texture2D(tCurl, vUv - vec2(px.x, 0.0)).r), r = abs(texture2D(tCurl, vUv + vec2(px.x, 0.0)).r);
    float b = abs(texture2D(tCurl, vUv - vec2(0.0, px.y)).r), t = abs(texture2D(tCurl, vUv + vec2(0.0, px.y)).r);
    vec2 g = vec2(r - l, t - b);
    g /= length(g) + 1e-5;
    vec2 h = dom * px;
    v += swirl * h.x * dt * vec2(g.y, -g.x) * c;
    gl_FragColor = vec4(v, 0.0, 1.0);
  }`);
const F_DIV = frag(`
  uniform sampler2D tVel;
  vec2 vel(vec2 uv) { return solid(uv) > 0.5 ? vec2(0.0) : texture2D(tVel, uv).xy; }
  void main() {
    vec2 h = dom * px;
    float d = (vel(vUv + vec2(px.x, 0.0)).x - vel(vUv - vec2(px.x, 0.0)).x) / (2.0 * h.x)
            + (vel(vUv + vec2(0.0, px.y)).y - vel(vUv - vec2(0.0, px.y)).y) / (2.0 * h.y);
    gl_FragColor = vec4(d, 0.0, 0.0, 1.0);
  }`);
const F_JACOBI = frag(`
  uniform sampler2D tP; uniform sampler2D tDiv;
  float pr(vec2 uv, float pc) { return solid(uv) > 0.5 ? pc : texture2D(tP, uv).r; }
  void main() {
    float pc = texture2D(tP, vUv).r;
    vec2 h = dom * px;
    float ax = 1.0 / (h.x * h.x), ay = 1.0 / (h.y * h.y);
    float s = ax * (pr(vUv + vec2(px.x, 0.0), pc) + pr(vUv - vec2(px.x, 0.0), pc))
            + ay * (pr(vUv + vec2(0.0, px.y), pc) + pr(vUv - vec2(0.0, px.y), pc));
    gl_FragColor = vec4((s - texture2D(tDiv, vUv).r) / (2.0 * (ax + ay)), 0.0, 0.0, 1.0);
  }`);
const F_GRAD = frag(`
  uniform sampler2D tP; uniform sampler2D tVel;
  float pr(vec2 uv, float pc) { return solid(uv) > 0.5 ? pc : texture2D(tP, uv).r; }
  void main() {
    if (solid(vUv) > 0.5) { gl_FragColor = vec4(0.0); return; }
    float pc = texture2D(tP, vUv).r;
    vec2 h = dom * px;
    vec2 g = vec2(pr(vUv + vec2(px.x, 0.0), pc) - pr(vUv - vec2(px.x, 0.0), pc),
                  pr(vUv + vec2(0.0, px.y), pc) - pr(vUv - vec2(0.0, px.y), pc)) / (2.0 * h);
    gl_FragColor = vec4(texture2D(tVel, vUv).xy - g, 0.0, 1.0);
  }`);
const F_REFLECT = frag(`
  uniform sampler2D tA; uniform sampler2D tB;
  void main() { gl_FragColor = 2.0 * texture2D(tA, vUv) - texture2D(tB, vUv); }`);
// Bouffée : gaussienne de densité, ou impulsion (poussée + rotation).
const F_SPLAT = frag(`
  uniform sampler2D tQ; uniform vec2 at; uniform float radius; uniform vec4 amount; uniform float spin;
  void main() {
    vec2 d = (vUv - at) * dom;
    float f = exp(-dot(d, d) / (radius * radius));
    vec4 add = amount + vec4(-d.y, d.x, 0.0, 0.0) * spin / radius;
    gl_FragColor = texture2D(tQ, vUv) + (solid(vUv) > 0.5 ? vec4(0.0) : add * f);
  }`);
// Affichage : absorption + un relief bon marché tiré du gradient de densité.
const F_SHOW = frag(`
  uniform sampler2D tDen; uniform float opacity;
  void main() {
    if (solid(vUv) > 0.5) { gl_FragColor = vec4(vec3(0.045, 0.045, 0.042), 1.0); return; }
    float d = texture2D(tDen, vUv).r;
    float gx = texture2D(tDen, vUv + vec2(px.x, 0.0)).r - texture2D(tDen, vUv - vec2(px.x, 0.0)).r;
    float gy = texture2D(tDen, vUv + vec2(0.0, px.y)).r - texture2D(tDen, vUv - vec2(0.0, px.y)).r;
    float lit = clamp(0.72 + dot(vec2(gx, gy), vec2(-0.55, -0.83)) * 2.2, 0.35, 1.25);
    float a = 1.0 - exp(-max(d, 0.0) * opacity);
    gl_FragColor = vec4(vec3(0.80, 0.82, 0.86) * lit, a);
  }`);

export function createSmoke2D(renderer, { cx = 0, cz = 0, half = 14, wallT = 2, wallH = 4.5, open = false } = {}) {
  const DOM = new THREE.Vector2(40, 22);
  const FLOOR = 1;
  const params = { scheme: 'mac', width: 512, weight: 5.5, swirl: 12, dissip: 0.07, iterations: 30, opacity: 2.4 };
  const shared = {
    px: { value: new THREE.Vector2() },
    dom: { value: DOM },
    bac: { value: new THREE.Vector4(half, wallT, wallH, FLOOR) },
    open: { value: open ? 1 : 0 },
  };
  const mat = (fragmentShader, uniforms) => new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader, uniforms: { ...shared, ...uniforms }, depthTest: false, depthWrite: false,
  });
  const M = {
    advect: mat(F_ADVECT, { tQ: { value: null }, tVel: { value: null }, dt: { value: 0 }, keep: { value: 1 } }),
    mac: mat(F_MAC, { tQ: { value: null }, tHat: { value: null }, tTilde: { value: null }, tVel: { value: null }, dt: { value: 0 }, keep: { value: 1 } }),
    curl: mat(F_CURL, { tVel: { value: null } }),
    force: mat(F_FORCE, { tVel: { value: null }, tDen: { value: null }, tCurl: { value: null }, dt: { value: 0 }, weight: { value: 0 }, swirl: { value: 0 } }),
    div: mat(F_DIV, { tVel: { value: null } }),
    jacobi: mat(F_JACOBI, { tP: { value: null }, tDiv: { value: null } }),
    grad: mat(F_GRAD, { tP: { value: null }, tVel: { value: null } }),
    reflect: mat(F_REFLECT, { tA: { value: null }, tB: { value: null } }),
    splat: mat(F_SPLAT, { tQ: { value: null }, at: { value: new THREE.Vector2() }, radius: { value: 1 }, amount: { value: new THREE.Vector4() }, spin: { value: 0 } }),
  };
  const quad = new FullScreenQuad(M.advect);
  let rt = null; // { v: [4], d: [3], p: [2], div, curl }
  let active = false;
  const mkRT = (w, h) => new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false, stencilBuffer: false,
  });
  function allocate() {
    if (rt) for (const t of [...rt.v, ...rt.d, ...rt.p, rt.div, rt.curl]) t.dispose();
    const w = params.width, h = Math.round(w * DOM.y / DOM.x);
    shared.px.value.set(1 / w, 1 / h);
    rt = { v: [0, 1, 2, 3].map(() => mkRT(w, h)), d: [0, 1, 2].map(() => mkRT(w, h)), p: [mkRT(w, h), mkRT(w, h)], div: mkRT(w, h), curl: mkRT(w, h) };
    clear();
  }
  const run = (material, target) => {
    quad.material = material;
    renderer.setRenderTarget(target);
    quad.render(renderer);
  };
  function clear() {
    if (!rt) return;
    const prev = renderer.getRenderTarget();
    const col = renderer.getClearColor(new THREE.Color()), al = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    for (const t of [...rt.v, ...rt.d, ...rt.p, rt.div, rt.curl]) { renderer.setRenderTarget(t); renderer.clear(true, false, false); }
    renderer.setClearColor(col, al);
    renderer.setRenderTarget(prev);
    active = false;
    show.uniforms.tDen.value = rt.d[0].texture;
  }
  // Transport de q par vel : résultat dans `out` ; `s1`, `s2` sont des tampons.
  function transport(q, vel, dt, keep, out, s1, s2, useMac) {
    if (!useMac) {
      const u = M.advect.uniforms;
      u.tQ.value = q.texture; u.tVel.value = vel.texture; u.dt.value = dt; u.keep.value = keep;
      run(M.advect, out);
      return;
    }
    const u = M.advect.uniforms;
    u.tQ.value = q.texture; u.tVel.value = vel.texture; u.dt.value = dt; u.keep.value = 1;
    run(M.advect, s1);
    u.tQ.value = s1.texture; u.dt.value = -dt;
    run(M.advect, s2);
    const m = M.mac.uniforms;
    m.tQ.value = q.texture; m.tHat.value = s1.texture; m.tTilde.value = s2.texture; m.tVel.value = vel.texture; m.dt.value = dt; m.keep.value = keep;
    run(M.mac, out);
  }
  // Projection à divergence nulle : vel → out (la pression précédente sert
  // d'estimation initiale, ce qui autorise peu d'itérations).
  function project(vel, out) {
    M.div.uniforms.tVel.value = vel.texture;
    run(M.div, rt.div);
    M.jacobi.uniforms.tDiv.value = rt.div.texture;
    for (let i = 0; i < params.iterations; i++) {
      M.jacobi.uniforms.tP.value = rt.p[0].texture;
      run(M.jacobi, rt.p[1]);
      rt.p.reverse();
    }
    M.grad.uniforms.tP.value = rt.p[0].texture; M.grad.uniforms.tVel.value = vel.texture;
    run(M.grad, out);
  }
  function step(frameDt) {
    if (!rt) allocate();
    if (!active) return;
    const dt = Math.min(frameDt, 1 / 30);
    const prev = renderer.getRenderTarget();
    const [v0, v1, v2, v3] = rt.v;
    const [d0, d1, d2] = rt.d;
    const useMac = params.scheme !== 'stam';
    // Forces : v0 → v1
    M.curl.uniforms.tVel.value = v0.texture;
    run(M.curl, rt.curl);
    const f = M.force.uniforms;
    f.tVel.value = v0.texture; f.tDen.value = d0.texture; f.tCurl.value = rt.curl.texture;
    f.dt.value = dt; f.weight.value = params.weight; f.swirl.value = params.swirl;
    run(M.force, v1);
    let vel; // vitesse finale du pas
    if (params.scheme === 'reflect') {
      transport(v1, v1, dt / 2, 1, v0, v2, v3, true); // ũ½ dans v0
      project(v0, v2);                                 // u½ dans v2
      M.reflect.uniforms.tA.value = v2.texture; M.reflect.uniforms.tB.value = v0.texture;
      run(M.reflect, v3);                              // û = 2u½ − ũ½ dans v3
      transport(v3, v2, dt / 2, 1, v0, v1, rt.curl, true);
      project(v0, v1);
      vel = v1;
    } else {
      transport(v1, v1, dt, 1, v0, v2, v3, useMac);
      project(v0, v1);
      vel = v1;
    }
    transport(d0, vel, dt, Math.max(0, 1 - params.dissip * dt), d1, d2, rt.curl, useMac);
    // Remise en ordre : la vitesse courante en v[0], la densité en d[0].
    rt.v = [vel, ...rt.v.filter((t) => t !== vel)];
    rt.d = [d1, d0, d2];
    show.uniforms.tDen.value = rt.d[0].texture;
    renderer.setRenderTarget(prev);
  }
  function splat(target, x, y, radius, amount, spin) {
    const u = M.splat.uniforms;
    u.tQ.value = target[0].texture; u.at.value.set(x / DOM.x, y / DOM.y); u.radius.value = radius;
    u.amount.value.fromArray(amount); u.spin.value = spin;
    run(M.splat, target[1]);
    const t = target[0]; target[0] = target[1]; target[1] = t;
  }
  function spawn() {
    if (!rt) allocate();
    const prev = renderer.getRenderTarget();
    const x = DOM.x / 2 + (Math.random() - 0.5) * 16, y = 13 + Math.random() * 5;
    splat(rt.d, x, y, 2.6, [1.1, 0, 0, 0], 0);
    splat(rt.v, x, y, 3.4, [(Math.random() - 0.5) * 3, -(3.5 + Math.random() * 3), 0, 0], (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 6));
    show.uniforms.tDen.value = rt.d[0].texture;
    renderer.setRenderTarget(prev);
    active = true;
  }
  const show = new THREE.ShaderMaterial({
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: F_SHOW,
    uniforms: { ...shared, tDen: { value: null }, opacity: { value: params.opacity } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(DOM.x, DOM.y), show);
  mesh.position.set(cx, DOM.y / 2 - FLOOR, cz);
  mesh.visible = false;
  return {
    mesh, params, step, spawn, clear,
    center: new THREE.Vector3(cx, DOM.y / 2 - FLOOR, cz),
    setWidth(w) { params.width = w; allocate(); },
    setOpen(v) { shared.open.value = v ? 1 : 0; clear(); },
    setOpacity(v) { params.opacity = v; show.uniforms.opacity.value = v; },
    get active() { return active; },
  };
}
