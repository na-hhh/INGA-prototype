// ---- Brouillard des îles ----------------------------------------------------
// Des volutes de brume, dans l'esprit du domaine FUMÉE : de grandes nappes
// douces (une texture de nuage en bruit fractal) tournées vers la caméra, qui
// tournoient et dérivent sur des courants lents (comme la fumée du bac), et
// respirent. Elles s'accrochent à la taille et sous le ventre de chaque île,
// et forment de grands bancs sous la galerie et entre les îles. Leur couleur
// suit l'heure (dorée au soleil, bleutée la nuit) ; elles s'effacent près de
// la caméra pour ne jamais boucher la vue.
import * as THREE from 'three';

function puffTexture(size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d');
  const img = x.createImageData(size, size);
  // Bruit de valeur fractal, enveloppe radiale douce.
  const hash = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
  const noise = (u, v) => {
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
    const a = hash(i, j), b = hash(i + 1, j), c2 = hash(i, j + 1), d = hash(i + 1, j + 1);
    const su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
    return a + (b - a) * su + (c2 - a) * sv + (a - b - c2 + d) * su * sv;
  };
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const u = px / size, v = py / size;
    let n = 0, amp = 0.55, f = 4;
    for (let o = 0; o < 5; o++) { n += amp * noise(u * f + o * 7.1, v * f + o * 3.3); amp *= 0.5; f *= 2; }
    const r = Math.hypot(u - 0.5, v - 0.5) * 2;
    const env = Math.max(0, 1 - r) ** 1.6;
    const a = Math.max(0, Math.min(1, (n - 0.32) * 1.9)) * env;
    const o = (py * size + px) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
    img.data[o + 3] = Math.round(a * 255);
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const VERT = `
attribute vec3 aPos; attribute vec4 aData; // aData : taille, rotation, graine, opacité
attribute float aShade; // 1 au soleil, ~0.3 dans l'ombre d'une île
uniform float uTime; uniform vec3 uSunW;
varying vec2 vUv; varying float vA; varying float vLit; varying vec2 vQ; varying vec3 vSunV; varying float vShade;
void main() {
  vUv = uv;
  float s = aData.z;
  // Courants lents qui tournoient (comme la fumée du bac) : chaque volute
  // dérive sur une petite boucle, et respire.
  vec3 c = aPos + vec3( sin( uTime * 0.045 + s * 6.0 ) * 9.0 + sin( uTime * 0.11 + s * 13.0 ) * 3.0,
                        sin( uTime * 0.07 + s * 9.0 ) * 2.0,
                        cos( uTime * 0.04 + s * 4.0 ) * 9.0 + cos( uTime * 0.13 + s * 17.0 ) * 3.0 );
  float size = aData.x * ( 0.85 + 0.15 * sin( uTime * 0.2 + s * 30.0 ) );
  float rot = aData.y + uTime * 0.02 * ( fract( s * 7.0 ) - 0.5 );
  vec4 mv = modelViewMatrix * vec4( c, 1.0 );
  vec2 q = position.xy * size;
  q = vec2( q.x * cos( rot ) - q.y * sin( rot ), q.x * sin( rot ) + q.y * cos( rot ) );
  mv.xy += q;
  gl_Position = projectionMatrix * mv;
  float d = -mv.z;
  vA = aData.w * smoothstep( 6.0, 40.0, d ) * ( 1.0 - smoothstep( 380.0, 450.0, d ) );
  vLit = 0.5 + 0.5 * position.y; // le haut de la volute reçoit plus de lumière
  // Pour l'éclairer comme une boule de brume : sa position dans le disque
  // (à l'écran) et la direction du soleil vue de la caméra.
  vQ = q / size * 2.0;
  vSunV = normalize( ( viewMatrix * vec4( uSunW, 0.0 ) ).xyz );
  vShade = aShade;
}`;
const FRAG = `
uniform sampler2D uMap; uniform vec3 uLit, uShade, uGlow; uniform float uOpacity;
varying vec2 vUv; varying float vA; varying float vLit; varying vec2 vQ; varying vec3 vSunV; varying float vShade;
void main() {
  float tex = texture2D( uMap, vUv ).a;
  float a = tex * vA * uOpacity;
  if ( a < 0.004 ) discard;
  // La volute est éclairée comme une boule : le côté tourné vers le soleil
  // prend sa couleur, l'autre garde celle du ciel ; dans l'ombre d'une île,
  // elle reste dans le ton de l'ombre. À contre-jour, ses bords minces
  // s'allument (la lumière traverse la brume).
  vec2 q = vQ; float r2 = min( dot( q, q ), 1.0 );
  vec3 n = normalize( vec3( q, sqrt( 1.0 - r2 ) + 0.2 ) );
  float lam = clamp( dot( n, vSunV ) * 0.6 + 0.45, 0.0, 1.0 ) * mix( 0.8, 1.05, vLit );
  vec3 col = mix( uShade, uLit, lam * vShade );
  float fwd = pow( max( -vSunV.z, 0.0 ), 3.0 );
  col += uGlow * fwd * ( 1.0 - tex ) * 1.4 * vShade;
  gl_FragColor = vec4( col, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createIslandFog({ scene, lite }) {
  const U = {
    uTime: { value: 0 }, uMap: { value: puffTexture(lite ? 96 : 128) },
    uLit: { value: new THREE.Color() }, uShade: { value: new THREE.Color() }, uOpacity: { value: 0.55 },
    uGlow: { value: new THREE.Color() }, uSunW: { value: new THREE.Vector3(0, 1, 0) },
  };
  const mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: false });
  let mesh = null, shadeAttr = null, P0 = [], isles = [], nextShade = 0;
  const rnd = (a, b) => a + (b - a) * Math.random();
  // Ombre des îles sur chaque volute (recalculée de temps en temps : le soleil
  // bouge lentement). Pas en LÉGER.
  const _c = new THREE.Vector3(), _s = new THREE.Vector3();
  function shadeAll(sun) {
    if (!shadeAttr) return;
    const a = shadeAttr.array;
    for (let i = 0; i < a.length; i++) {
      let sh = 1;
      if (!lite) for (const I of isles) {
        _c.set(I.x - P0[i * 3], I.y - I.depth * 0.25 - P0[i * 3 + 1], I.z - P0[i * 3 + 2]);
        const t = _c.dot(sun);
        if (t <= 0) continue;
        const d = _s.copy(sun).multiplyScalar(t).sub(_c).length();
        sh *= 0.3 + 0.7 * THREE.MathUtils.smoothstep(d, I.radius * 0.55, I.radius * 1.3);
      }
      a[i] = sh;
    }
    shadeAttr.needsUpdate = true;
  }
  return {
    uniforms: U,
    // islands : [{ x, y, z, radius, depth }] ; reconstruit les volutes.
    build(islands) {
      const P = [], D = [];
      const add = (x, y, z, size, op) => { P.push(x, y, z); D.push(size, rnd(0, 6.28), Math.random(), op); };
      const per = lite ? 0.5 : 1;
      for (const I of islands) {
        const r = I.radius || 20, dep = I.depth || r * 2.5;
        // Collerette à la taille de l'île, et voiles sous son ventre.
        const n = Math.round((6 + r * 0.25) * per);
        for (let k = 0; k < n; k++) {
          const a = rnd(0, Math.PI * 2), rr = r * rnd(1.05, 1.45);
          add(I.x + Math.cos(a) * rr, I.y - rnd(0.05, 0.35) * dep, I.z + Math.sin(a) * rr, r * rnd(0.7, 1.3), rnd(0.35, 0.65));
        }
        for (let k = 0; k < Math.round(3 * per) + 1; k++) add(I.x + rnd(-r, r) * 0.5, I.y - dep * rnd(0.5, 0.85), I.z + rnd(-r, r) * 0.5, r * rnd(1.0, 1.6), rnd(0.25, 0.45));
        // Piliers (hauts et étroits) : des écharpes de brume tout du long,
        // à plusieurs hauteurs, qui les enveloppent (références).
        if (dep > r * 3.5) {
          const bands = Math.round((dep / 22) * per);
          for (let k = 0; k < bands; k++) {
            const yb = I.y - rnd(0.08, 0.9) * dep, a0 = rnd(0, Math.PI * 2);
            for (let j = 0; j < 3; j++) {
              const a = a0 + j * rnd(0.6, 1.2), rr = r * rnd(0.9, 1.5);
              add(I.x + Math.cos(a) * rr, yb + rnd(-4, 4), I.z + Math.sin(a) * rr, r * rnd(0.9, 1.6), rnd(0.35, 0.6));
            }
          }
        }
      }
      // Un voile léger devant le balcon (vers +z), entre la galerie et les îles.
      for (let k = 0; k < (lite ? 10 : 22); k++) add(rnd(-70, 70), rnd(-28, 6), rnd(45, 135), rnd(18, 34), rnd(0.16, 0.3));
      // Grands bancs partout : sous la galerie et entre les îles.
      for (let k = 0; k < (lite ? 40 : 90); k++) {
        const a = rnd(0, Math.PI * 2), d = rnd(40, 330);
        add(Math.cos(a) * d, rnd(-110, -25), Math.sin(a) * d, rnd(28, 60), rnd(0.25, 0.5));
      }
      const g = new THREE.InstancedBufferGeometry();
      const base = new THREE.PlaneGeometry(1, 1);
      g.index = base.index;
      g.setAttribute('position', base.attributes.position);
      g.setAttribute('uv', base.attributes.uv);
      g.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(P), 3));
      g.setAttribute('aData', new THREE.InstancedBufferAttribute(new Float32Array(D), 4));
      g.instanceCount = P.length / 3;
      P0 = P; isles = islands;
      shadeAttr = new THREE.InstancedBufferAttribute(new Float32Array(P.length / 3).fill(1), 1);
      g.setAttribute('aShade', shadeAttr);
      nextShade = 0;
      if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
      mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      scene.add(mesh);
    },
    // Couleur selon l'heure : la lumière du soleil (ou de la lune) dessus,
    // la couleur de l'horizon dans l'ombre.
    update(t, look) {
      U.uTime.value = t;
      U.uSunW.value.copy(look.sunDir);
      if (U.uSunW.value.y < -0.05) U.uSunW.value.y = -0.05;
      U.uSunW.value.normalize();
      U.uGlow.value.copy(look.glow).lerp(look.sunCol, 0.3).multiplyScalar(0.3 + 0.7 * look.day);
      if (t > nextShade) { nextShade = t + 0.5; shadeAll(U.uSunW.value); }
      U.uShade.value.copy(look.zenith).lerp(look.horizon, 0.6).multiplyScalar(0.55 + 0.3 * look.day);
      U.uLit.value.copy(look.horizon).lerp(look.sunCol, 0.6 * look.day).multiplyScalar(0.75 + 0.5 * look.day);
    },
    get mesh() { return mesh; },
  };
}
