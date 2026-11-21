// ---- Ciel : jour, crépuscule, nuit étoilée, lune, géante gazeuse ------------
// Le dôme (sphère qui suit la caméra) est peint dans un shader : dégradé du
// zénith à l'horizon selon l'heure, halo et disque du soleil, puis la nuit :
// la Voie lactée (photo Solar System Scope, CC BY 4.0) et des étoiles
// procédurales nettes, de couleurs et d'éclats variés, qui scintillent et
// s'éteignent près de l'horizon. Tout tourne lentement autour d'un axe
// incliné. La lune (texture réelle) et la géante gazeuse sont de vraies
// sphère éclairée par le soleil (ses phases viennent d'elle-même) ; la géante
// gazeuse est calculée dans le shader du ciel, à l'infini.
import * as THREE from 'three';

const BASE = import.meta.env.BASE_URL + 'assets/ciel/';

const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position.z = gl_Position.w; // toujours au fond
}`;
const SKY_FRAG = `
uniform vec3 uSun, uMoon, uZenith, uHorizon, uGlow, uSunCol;
uniform float uNight, uTime, uStars, uMilkyGain, uMoonOn;
uniform mat3 uStarRot;
uniform sampler2D uMilky;
// Géante gazeuse (Jupiter) à l'infini : direction, rayon apparent (sinus), repère.
uniform vec3 uPlanet, uRingN; uniform float uPlanetR, uPlanetOn, uDay;
uniform mat3 uPlanetRot; uniform sampler2D uPlanetMap, uRingMap;
varying vec3 vDir;
float h1( vec3 p ) { return fract( sin( dot( p, vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 ); }
// Un calque d'étoiles : au plus une par cellule, éclat en loi de puissance
// (beaucoup de faibles, quelques brillantes), anticrénelée à l'écran.
vec3 starLayer( vec3 d, float scale, float density ) {
  vec3 p = d * scale; vec3 id = floor( p ); vec3 f = fract( p );
  float h = h1( id );
  if ( h > density ) return vec3( 0.0 );
  vec3 c = vec3( h1( id + 1.3 ), h1( id + 2.7 ), h1( id + 5.1 ) ) * 0.6 + 0.2;
  float px = max( fwidth( p.x ), 1e-4 );
  float r = px * 1.3;
  float s = 1.0 - smoothstep( 0.0, r, length( f - c ) );
  float mag = pow( h1( id + 9.1 ), 7.0 ) * 2.2 + 0.06;
  float tw = 0.7 + 0.3 * sin( uTime * ( 1.2 + h1( id + 4.0 ) * 3.0 ) + h * 70.0 );
  float t = h1( id + 7.7 );
  vec3 col = t < 0.18 ? vec3( 0.68, 0.78, 1.0 ) : t < 0.75 ? vec3( 1.0, 0.97, 0.92 ) : vec3( 1.0, 0.8, 0.58 );
  return col * s * mag * tw;
}
void main() {
  vec3 v = normalize( vDir );
  float up = max( v.y, 0.0 );
  vec3 col = mix( uHorizon, uZenith, pow( up, 0.45 ) );
  float sd = max( dot( v, uSun ), 0.0 );
  col += uGlow * ( pow( sd, 5.0 ) * 0.45 + pow( sd, 42.0 ) * 0.55 );
  col += uSunCol * smoothstep( 0.99962, 0.99975, sd ) * 8.0 * step( -0.02, uSun.y );
  col = mix( col, uHorizon, exp( -abs( v.y ) * 16.0 ) * 0.45 );
  if ( v.y < 0.0 ) col = mix( uHorizon, uHorizon * 0.5, min( 1.0, -v.y * 3.0 ) );
  if ( uNight > 0.001 ) {
    vec3 s = uStarRot * v;
    vec2 uv = vec2( atan( s.z, s.x ) / 6.2831853 + 0.5, asin( clamp( s.y, -1.0, 1.0 ) ) / 3.14159265 + 0.5 );
    vec3 mw = texture2D( uMilky, uv ).rgb;
    float ext = smoothstep( -0.02, 0.3, v.y ); // absorption près de l'horizon
    vec3 night = mw * mw * 1.8 * uMilkyGain + ( starLayer( s, 95.0, 0.07 ) + starLayer( s, 230.0, 0.05 ) * 0.65 ) * uStars;
    col += night * uNight * ext;
    float md = max( dot( v, uMoon ), 0.0 );
    col += vec3( 0.5, 0.62, 0.85 ) * ( pow( md, 30.0 ) * 0.18 + pow( md, 300.0 ) * 0.3 ) * uNight * uMoonOn * step( -0.05, uMoon.y );
  }
  // La géante gazeuse, si loin qu'elle est à l'infini, si grande qu'elle
  // semble toute proche : sphère et anneau calculés pour chaque rayon de vue.
  if ( uPlanetOn > 0.5 ) {
    vec3 C = uPlanet; float R = uPlanetR;
    float b = dot( v, C ), disc = b * b - ( dot( C, C ) - R * R );
    float tP = 1e9; vec3 pc = vec3( 0.0 ); float pa = 0.0;
    if ( disc > 0.0 ) {
      tP = b - sqrt( disc );
      vec3 n = normalize( v * tP - C );
      vec3 ln = uPlanetRot * n;
      vec2 uv = vec2( atan( ln.z, ln.x ) / 6.2831853 + 0.5 + uTime * 0.0012, asin( clamp( ln.y, -1.0, 1.0 ) ) / 3.14159265 + 0.5 );
      // Les vraies bandes de Jupiter, un peu contrastées.
      vec3 band = pow( texture2D( uPlanetMap, uv ).rgb, vec3( 1.12 ) ) * 1.08;
      // Éclairage de mise en scène, fixe : la planète est toujours vue aux
      // trois quarts éclairée (jamais sa face nocturne noire sur le ciel noir).
      vec3 Lp = normalize( normalize( -C ) + vec3( -0.62, 0.3, 0.0 ) );
      float ndl = dot( n, Lp );
      float lit = smoothstep( -0.18, 0.45, ndl );
      float rim = pow( 1.0 - max( dot( n, -v ), 0.0 ), 2.5 );
      pc = band * ( lit * 1.35 + 0.06 ) + vec3( 0.95, 0.78, 0.55 ) * rim * 0.35 * ( 0.25 + 0.75 * lit );
      // La nuit, l'œil s'adapte (exposition plus forte) : on la tamise pour
      // garder ses bandes ocre et brunes au lieu d'un disque blanc.
      pc *= mix( 0.42, 1.0, uDay );
      pa = smoothstep( 0.0, max( fwidth( disc ) * 1.5, 1e-6 ), disc );
    }
    // Anneau dans le plan équatorial ; devant ou derrière la planète.
    vec3 rc = vec3( 0.0 ); float ra = 0.0; float tR = 1e9;
    float dn = dot( v, uRingN );
    if ( abs( dn ) > 1e-4 ) {
      tR = dot( C, uRingN ) / dn;
      if ( tR > 0.0 ) {
        float r = length( v * tR - C ) / R;
        if ( r > 1.35 && r < 2.25 ) {
          vec4 t = texture2D( uRingMap, vec2( ( r - 1.35 ) / 0.9, 0.5 ) );
          rc = mix( vec3( 0.5, 0.46, 0.4 ), vec3( 0.86, 0.8, 0.7 ), t.r ) * 0.85;
          rc *= mix( 0.45, 1.0, uDay );
          ra = t.a * 0.3;
        }
      }
    }
    // Le jour, l'atmosphère pâlit la planète (comme la lune) ; près de
    // l'horizon, la brume l'avale.
    float haze = mix( 1.0, 0.72, uDay ) * smoothstep( -0.3, 0.12, v.y );
    if ( tR > tP ) col = mix( col, rc, ra * haze );          // anneau derrière
    col = mix( col, pc, pa * haze );
    if ( tR <= tP ) col = mix( col, rc, ra * haze );         // anneau devant
  }
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Lune : texture réelle, éclairée par le soleil (phase), un peu de lumière
// cendrée, pâlie en plein jour.
const BODY_VERT = `
varying vec3 vN; varying vec2 vUv; varying vec3 vV;
void main() {
  vUv = uv;
  vN = normalize( mat3( modelMatrix ) * normal );
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vV = normalize( cameraPosition - wp.xyz );
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const MOON_FRAG = `
uniform sampler2D uMap; uniform vec3 uSun; uniform float uDay;
varying vec3 vN; varying vec2 vUv;
void main() {
  vec3 tex = texture2D( uMap, vUv ).rgb;
  float lit = smoothstep( -0.05, 0.25, dot( vN, uSun ) );
  vec3 col = tex * ( lit * 1.7 + 0.025 ) * vec3( 1.0, 0.98, 0.95 );
  gl_FragColor = vec4( col, mix( 1.0, 0.35, uDay ) );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
export function createCelestialSky({ dome, lite }) {
  const loader = new THREE.TextureLoader();
  const tex = (f) => { const t = loader.load(BASE + f); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const U = {
    uSun: { value: new THREE.Vector3(0, 1, 0) }, uMoon: { value: new THREE.Vector3(0, -1, 0) },
    uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() },
    uNight: { value: 0 }, uTime: { value: 0 }, uStars: { value: 1 }, uMilkyGain: { value: 1 }, uMoonOn: { value: 1 },
    uStarRot: { value: new THREE.Matrix3() },
    uMilky: { value: tex(lite ? '2k_stars_milky_way.jpg' : '4k_stars_milky_way.jpg') },
    uPlanet: { value: new THREE.Vector3(0, 0.4, 0.9) }, uRingN: { value: new THREE.Vector3(0, 1, 0) },
    uPlanetR: { value: Math.sin(THREE.MathUtils.degToRad(22)) }, uPlanetOn: { value: 1 }, uDay: { value: 1 },
    uPlanetRot: { value: new THREE.Matrix3() },
    uPlanetMap: { value: tex('2k_jupiter.jpg') }, uRingMap: { value: new THREE.TextureLoader().load(BASE + '2k_saturn_ring_alpha.png') },
  };
  dome.material = new THREE.ShaderMaterial({ uniforms: U, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false });
  for (const c of dome.children) c.visible = false; // l'ancien disque du soleil

  const R = 360;
  const moonU = { uMap: { value: tex('2k_moon.jpg') }, uSun: U.uSun, uDay: { value: 0 } };
  const moon = new THREE.Mesh(new THREE.SphereGeometry(6.5, 48, 24), new THREE.ShaderMaterial({ uniforms: moonU, vertexShader: BODY_VERT, fragmentShader: MOON_FRAG, transparent: true, depthWrite: false, fog: false }));
  moon.renderOrder = -9;
  dome.add(moon);

  // Repère de la planète : axe incliné ; l'anneau suit son équateur.
  const planetQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.42, 0, 0.36));
  const _ax = new THREE.Vector3();
  U.uPlanetRot.value.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(planetQ.clone().invert()));
  U.uRingN.value.copy(_ax.set(0, 1, 0).applyQuaternion(planetQ));

  const axis = new THREE.Vector3(0.25, 0.92, 0.3).normalize(); // axe du ciel nocturne
  const _q = new THREE.Quaternion(), _m4 = new THREE.Matrix4();
  const flags = { moon: true, planet: true };
  return {
    uniforms: U, flags,
    setPlanetSize(deg) { U.uPlanetR.value = Math.sin(THREE.MathUtils.degToRad(deg)); },
    update(st, t) {
      U.uSun.value.copy(st.sunDir); U.uMoon.value.copy(st.moonDir);
      U.uZenith.value.copy(st.zenith); U.uHorizon.value.copy(st.horizon); U.uGlow.value.copy(st.glow); U.uSunCol.value.copy(st.sunCol);
      U.uNight.value = st.night; U.uTime.value = t;
      U.uMoonOn.value = flags.moon ? 1 : 0;
      _q.setFromAxisAngle(axis, st.starAngle);
      U.uStarRot.value.setFromMatrix4(_m4.makeRotationFromQuaternion(_q));
      moon.visible = flags.moon && st.moonDir.y > -0.08;
      moon.position.copy(st.moonDir).multiplyScalar(R);
      moonU.uDay.value = st.day;
      U.uPlanetOn.value = flags.planet ? 1 : 0;
      U.uPlanet.value.copy(st.planetDir);
      U.uDay.value = st.day;
    },
  };
}
