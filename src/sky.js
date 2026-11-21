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
// Seconde planète, bleue (façon Neptune), plus proche et plus petite.
uniform vec3 uNep; uniform float uNepR, uNepD, uNepOn; uniform mat3 uNepRot;
uniform sampler2D uNepMap; uniform vec3 uBelt1, uBelt2; // normales des deux ceintures d'astéroïdes
uniform mat3 uPlanetRot; uniform sampler2D uPlanetMap, uRingMap;
// Troisième planète : une géante pâle, immense (4 à 5 fois Jupiter), posée
// sur l'horizon devant le balcon : on n'en voit qu'à peu près la moitié.
uniform vec3 uGiant; uniform float uGiantR, uGiantOn; uniform mat3 uGiantRot;
varying vec3 vDir;
float h1( vec3 p ) { return fract( sin( dot( p, vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 ); }
float n3( vec3 p ) {
  vec3 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( h1( i ), h1( i + vec3( 1, 0, 0 ) ), f.x ), mix( h1( i + vec3( 0, 1, 0 ) ), h1( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( h1( i + vec3( 0, 0, 1 ) ), h1( i + vec3( 1, 0, 1 ) ), f.x ), mix( h1( i + vec3( 0, 1, 1 ) ), h1( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
// Lecture d'une carte sphérique sans couture : à la jointure (atan), les
// dérivées sautent d'un tour entier, ce qui dessinait une ligne verticale.
vec4 sphTex( sampler2D m, vec2 uv ) {
  vec2 dx = dFdx( uv ), dy = dFdy( uv );
  dx.x -= floor( dx.x + 0.5 ); dy.x -= floor( dy.x + 0.5 );
  return textureGrad( m, uv, dx, dy );
}
float fbm3( vec3 p ) { float s = 0.0, a = 0.5; for ( int i = 0; i < 5; i ++ ) { s += a * n3( p ); p = p * 2.03 + vec3( 1.7, 9.2, 3.1 ); a *= 0.5; } return s; }
// L'atmosphère de la planète bleue : des courants. Chaque latitude tourne à
// sa vitesse (vents zonaux), les nuages sont étirés en longitude et tordus
// par un second bruit (tourbillons), des cirrus blancs filent par-dessus, et
// une grande tache sombre dérive avec son nuage blanc compagnon.
vec3 neptuneSurface( vec3 ln ) {
  float lat = ln.y;
  float w = uTime * ( 0.03 + 0.028 * cos( lat * 6.0 ) );
  float cw = cos( w ), sw = sin( w );
  vec3 q = vec3( cw * ln.x - sw * ln.z, ln.y, sw * ln.x + cw * ln.z );
  vec3 p = vec3( q.x * 2.2, q.y * 7.5, q.z * 2.2 );
  float warp = fbm3( p * 0.85 + vec3( 0.0, uTime * 0.012, 0.0 ) );
  float f = fbm3( p + vec3( warp * 2.4, warp * 0.5, -warp * 1.8 ) );
  float bands = 0.5 + 0.5 * sin( lat * 15.0 + f * 4.5 );
  vec3 col = mix( vec3( 0.015, 0.06, 0.22 ), vec3( 0.06, 0.25, 0.7 ), smoothstep( 0.25, 0.72, f ) );
  col = mix( col, vec3( 0.32, 0.64, 0.98 ), bands * 0.38 * smoothstep( 0.4, 0.8, f ) );
  // La vraie Neptune (texture) entraînée par les mêmes vents, mêlée aux courants.
  vec2 tuv = vec2( atan( q.z, q.x ) / 6.2831853 + 0.5 + warp * 0.02, asin( clamp( q.y, -1.0, 1.0 ) ) / 3.14159265 + 0.5 );
  col = mix( col, sphTex( uNepMap, tuv ).rgb * 0.9, 0.5 );
  float cirrus = smoothstep( 0.6, 0.82, fbm3( vec3( p.x * 2.4, p.y * 1.4, p.z * 2.4 ) + vec3( warp * 3.0 ) ) );
  col = mix( col, vec3( 0.88, 0.95, 1.0 ), cirrus * 0.72 );
  float sa = uTime * 0.02;
  vec3 spotC = normalize( vec3( cos( sa ), -0.36, sin( sa ) ) );
  float ds = length( ln - spotC );
  col *= 1.0 - 0.6 * exp( -ds * ds * 70.0 );
  vec3 compC = normalize( spotC + vec3( 0.0, -0.08, 0.0 ) + 0.12 * normalize( cross( spotC, vec3( 0, 1, 0 ) ) ) );
  col = mix( col, vec3( 0.92, 0.97, 1.0 ), 0.75 * exp( -pow( length( ln - compC ), 2.0 ) * 400.0 ) );
  // Un peu moins bleue : désaturée et tirée vers un cyan grisé.
  float lum = dot( col, vec3( 0.3, 0.55, 0.15 ) );
  col = mix( vec3( lum ), col, 0.32 ) * vec3( 0.97, 1.0, 0.98 ) * 1.08; // à peine teintée : gris-bleu pâle
  return col;
}
// Une ceinture d'astéroïdes : des milliers de grains dans un anneau autour
// de la planète bleue, qui tournent ; très légère. Renvoie l'éclat, et la
// distance au point d'impact dans t.
float beltDots( vec3 v, vec3 C, float R, vec3 N, float a, float b, float speed, float seed, out float t ) {
  t = 1e9;
  float dn = dot( v, N );
  if ( abs( dn ) < 1e-4 ) return 0.0;
  float tt = dot( C, N ) / dn;
  if ( tt <= 0.0 ) return 0.0;
  vec3 hp = v * tt - C;
  float r = length( hp ) / R;
  if ( r < a || r > b ) return 0.0;
  vec3 u = normalize( cross( N, abs( N.y ) < 0.9 ? vec3( 0, 1, 0 ) : vec3( 1, 0, 0 ) ) ), w = cross( N, u );
  float ang = atan( dot( hp, w ), dot( hp, u ) ) + uTime * speed;
  vec2 g = vec2( ang / 6.2831853 * 900.0, ( r - a ) / ( b - a ) * 7.0 );
  vec2 id = floor( g ), f = fract( g ) - 0.5;
  float h = h1( vec3( id, seed ) );
  if ( h < 0.72 ) return 0.0;
  vec2 o = ( vec2( h1( vec3( id, seed + 1.0 ) ), h1( vec3( id, seed + 2.0 ) ) ) - 0.5 ) * 0.5;
  float px = max( fwidth( g.x ), 1e-4 );
  float d = length( ( f - o ) * vec2( 1.0, 0.45 ) );
  t = tt;
  float edge = smoothstep( 0.0, 0.18, r - a ) * smoothstep( 0.0, 0.18, b - r );
  return ( 1.0 - smoothstep( 0.08, 0.08 + px * 1.5, d ) ) * ( 0.4 + 0.6 * h ) * edge;
}
// La géante (références : la géante bleue vue de Pandora) : des courants
// tourbillonnants, plusieurs cyclones, des bandes blanches et cyan, et une
// bande violet-rose. Les cyclones tordent les coordonnées autour de leur
// centre (plus fort au cœur) ; puis un bruit replié sur lui-même (domain
// warping) dessine les volutes, étirées le long des latitudes.
vec3 rotAround( vec3 p, vec3 ax, float a ) {
  return p * cos( a ) + cross( ax, p ) * sin( a ) + ax * dot( ax, p ) * ( 1.0 - cos( a ) );
}
vec3 giantSurface( vec3 ln ) {
  vec3 p = ln;
  // Cyclones : centre, taille, force.
  vec4 cy[ 4 ];
  cy[ 0 ] = vec4( normalize( vec3( 0.35, 0.12, 0.93 ) ), 0.16 );
  cy[ 1 ] = vec4( normalize( vec3( -0.5, -0.28, 0.82 ) ), 0.09 );
  cy[ 2 ] = vec4( normalize( vec3( 0.75, -0.42, 0.5 ) ), 0.07 );
  cy[ 3 ] = vec4( normalize( vec3( -0.1, 0.45, 0.89 ) ), 0.06 );
  for ( int i = 0; i < 4; i ++ ) {
    float d = length( p - cy[ i ].xyz );
    float k = exp( -d * d / ( cy[ i ].w * cy[ i ].w ) );
    p = rotAround( p, cy[ i ].xyz, k * ( 5.5 + float( i ) ) + uTime * 0.02 * k );
  }
  float lat = p.y;
  float w = uTime * 0.004;
  vec3 q = vec3( p.x * 2.6, p.y * 9.0, p.z * 2.6 );
  float w1 = fbm3( q * 0.7 + vec3( w, 0.0, 0.0 ) );
  float w2 = fbm3( q * 1.4 + vec3( w1 * 2.2, w1, -w1 * 1.6 ) );
  float f = fbm3( q * 1.1 + vec3( w2 * 3.0, w2 * 0.6, -w2 * 2.4 ) );
  float bands = 0.5 + 0.5 * sin( lat * 13.0 + f * 5.0 );
  vec3 deep = vec3( 0.10, 0.26, 0.70 ), cyan = vec3( 0.36, 0.72, 0.96 ), white = vec3( 0.90, 0.95, 1.0 ), violet = vec3( 0.66, 0.50, 0.86 ), rose = vec3( 0.86, 0.6, 0.82 );
  vec3 col = mix( deep, cyan, smoothstep( 0.3, 0.72, f ) );
  col = mix( col, white, smoothstep( 0.62, 0.92, f * 0.8 + bands * 0.3 ) * 0.55 );
  // Une large bande violette, liserée de rose, vers le haut.
  float vb = smoothstep( 0.18, 0.02, abs( lat - 0.42 + ( f - 0.5 ) * 0.12 ) );
  col = mix( col, mix( violet, rose, smoothstep( 0.4, 0.7, w2 ) ), vb * 0.7 );
  // Fines volutes claires et petites taches blanches (orages).
  col += white * smoothstep( 0.74, 0.92, fbm3( q * 3.5 + w2 * 4.0 ) ) * 0.18;
  return col;
}
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
// Quelques étoiles brillantes, bleues ou orangées, avec leurs aigrettes (la
// croix de diffraction des photos de référence).
vec3 brightStars( vec3 d ) {
  vec3 p = d * 26.0; vec3 id = floor( p ); vec3 f = fract( p );
  float h = h1( id + 31.0 );
  if ( h > 0.012 ) return vec3( 0.0 );
  h /= 0.012;
  vec3 c = vec3( h1( id + 4.3 ), h1( id + 8.1 ), h1( id + 2.2 ) ) * 0.5 + 0.25;
  vec3 r = f - c;
  float px = max( fwidth( p.x ), 1e-4 );
  float core = exp( -dot( r, r ) / ( px * px * 1.6 ) );
  // Aigrettes : deux traits fins en croix, qui s'effacent vite.
  vec3 ar = abs( r );
  float sp = exp( -ar.x / ( px * 0.45 ) ) * exp( -( ar.y + ar.z ) / ( px * 4.5 ) ) + exp( -ar.y / ( px * 0.45 ) ) * exp( -( ar.x + ar.z ) / ( px * 4.5 ) );
  float t = h1( id + 17.0 );
  vec3 col = t < 0.45 ? vec3( 0.65, 0.78, 1.0 ) : t < 0.75 ? vec3( 1.0, 0.95, 0.88 ) : vec3( 1.0, 0.78, 0.5 );
  float tw = 0.8 + 0.2 * sin( uTime * ( 1.0 + h * 20.0 ) + h * 50.0 );
  return col * ( core * 1.4 + sp * 0.3 ) * tw * ( 0.35 + 0.65 * h );
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
    // Voie lactée en couleur (références) : bleutée dans ses parties
    // faibles, chaude (orangée, crème) là où elle est dense ; les poussières
    // restent sombres.
    float ml = dot( mw * mw, vec3( 0.3, 0.55, 0.15 ) );
    vec3 mwc = mix( vec3( 0.6, 0.7, 0.85 ), vec3( 1.0, 0.76, 0.5 ), smoothstep( 0.05, 0.3, ml ) ) * ml * 1.7;
    // Le fond du ciel n'est pas uni : de grandes nappes bleu nuit, violettes
    // et un peu sarcelle.
    float c1 = fbm3( s * 1.6 + 3.0 ), c2 = fbm3( s * 2.3 + 11.0 );
    // Bleu marine et un peu de sarcelle (pas de violet).
    vec3 tint = vec3( 0.006, 0.012, 0.032 ) * smoothstep( 0.35, 0.75, c1 ) + vec3( 0.0, 0.012, 0.018 ) * smoothstep( 0.45, 0.8, c2 );
    vec3 night = mwc * uMilkyGain + tint + ( starLayer( s, 80.0, 0.028 ) + starLayer( s, 190.0, 0.022 ) * 0.6 + brightStars( s ) ) * uStars;
    col += night * uNight * ext;
    float md = max( dot( v, uMoon ), 0.0 );
    col += vec3( 0.5, 0.62, 0.85 ) * ( pow( md, 30.0 ) * 0.18 + pow( md, 300.0 ) * 0.3 ) * uNight * uMoonOn * step( -0.05, uMoon.y );
  }
  // La géante pâle, la plus lointaine : dessinée d'abord, les deux autres
  // passent devant. Très voilée par l'atmosphère (on la voit à travers le
  // ciel), un liseré clair sur le bord, et sous l'horizon elle se fond dans
  // la brume : on n'en voit que la moitié haute.
  if ( uGiantOn > 0.5 ) {
    vec3 C = uGiant; float R = uGiantR;
    float b = dot( v, C ), disc = b * b - ( dot( C, C ) - R * R );
    if ( disc > 0.0 ) {
      float tP = b - sqrt( disc );
      vec3 n = normalize( v * tP - C );
      vec3 sc = giantSurface( uGiantRot * n );
      vec3 Lp = normalize( normalize( -C ) + vec3( 0.55, 0.4, 0.0 ) );
      float lit = smoothstep( -0.4, 0.55, dot( n, Lp ) );
      float rim = pow( 1.0 - max( dot( n, -v ), 0.0 ), 3.0 );
      vec3 pc = sc * ( lit * 1.2 + 0.1 ) + vec3( 0.55, 0.8, 1.0 ) * rim * 0.5 * ( 0.4 + 0.6 * lit );
      // La nuit aussi elle éclaire le ciel (comme sur les références) : un
      // peu moins tamisée que les autres.
      pc *= mix( 0.26, 0.95, uDay );
      pc = mix( pc, col, 0.16 * uDay ); // un peu d'air devant elle, le jour
      float pa = smoothstep( 0.0, max( fwidth( disc ) * 1.5, 1e-6 ), disc );
      float haze = mix( 0.95, 0.8, uDay ) * smoothstep( -0.22, 0.06, v.y );
      col = mix( col, pc, pa * haze );
    }
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
      vec3 band = pow( sphTex( uPlanetMap, uv ).rgb, vec3( 1.12 ) ) * 1.08;
      // Éclairage de mise en scène, fixe : la planète est toujours vue aux
      // trois quarts éclairée (jamais sa face nocturne noire sur le ciel noir).
      // Presque de face : un croissant d'ombre fin sur le bord seulement (sinon
      // la planète paraissait coupée en deux).
      vec3 Lp = normalize( normalize( -C ) + vec3( -0.22, 0.2, 0.0 ) );
      float ndl = dot( n, Lp );
      float lit = smoothstep( -0.35, 0.4, ndl );
      float rim = pow( 1.0 - max( dot( n, -v ), 0.0 ), 2.5 );
      pc = band * ( lit * 1.35 + 0.06 ) + vec3( 0.95, 0.78, 0.55 ) * rim * 0.35 * ( 0.25 + 0.75 * lit );
      // La nuit, l'œil s'adapte (exposition plus forte) : on la tamise pour
      // garder ses bandes ocre et brunes au lieu d'un disque blanc.
      pc *= mix( 0.22, 1.0, uDay );
      // Palette commune des trois planètes : voilées par le ciel qui est
      // devant elles (un peu de sa couleur), tons ocre adoucis.
      pc = mix( pc, mix( vec3( dot( pc, vec3( 0.3, 0.55, 0.15 ) ) ), pc, 0.8 ), 0.6 );
      pc = mix( pc, col, 0.22 );
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
          rc = mix( vec3( 0.62, 0.57, 0.5 ), vec3( 0.95, 0.9, 0.8 ), t.r ) * 0.95;
          rc *= mix( 0.2, 1.0, uDay );
          rc = mix( rc, col, 0.18 );
          ra = t.a * mix( 0.4, 0.6, uDay );
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
  // La planète bleue, plus proche : par-dessus Jupiter si elles se croisent.
  if ( uNepOn > 0.5 ) {
    vec3 C = uNep * uNepD; float R = uNepR;
    vec3 Cn = normalize( C );
    float b = dot( v, C ), disc = b * b - ( dot( C, C ) - R * R );
    vec3 Lp = normalize( -Cn + vec3( -0.55, 0.32, 0.0 ) );
    float haze = mix( 1.0, 0.72, uDay ) * smoothstep( -0.3, 0.12, v.y );
    // Halo d'atmosphère autour du disque (lumière diffusée sur le bord).
    float ang = acos( clamp( dot( v, Cn ), -1.0, 1.0 ) ), rad = asin( R / uNepD );
    float halo = exp( -max( ang - rad, 0.0 ) * 55.0 ) * smoothstep( rad * 1.6, rad, ang );
    col += vec3( 0.5, 0.68, 0.85 ) * halo * 0.3 * mix( 0.5, 1.0, uDay ) * haze * ( disc > 0.0 ? 0.0 : 1.0 );
    float tP = disc > 0.0 ? b - sqrt( disc ) : 1e9;
    float t1, t2;
    float d1 = beltDots( v, C, R, uBelt1, 1.6, 1.78, 0.018, 3.0, t1 );
    float d2 = beltDots( v, C, R, uBelt2, 2.05, 2.2, -0.011, 7.0, t2 );
    vec3 beltCol = vec3( 0.78, 0.8, 0.82 ) * mix( 0.5, 1.0, uDay );
    if ( t1 > tP ) col = mix( col, beltCol, d1 * 0.45 * haze );
    if ( t2 > tP ) col = mix( col, beltCol, d2 * 0.4 * haze );
    if ( disc > 0.0 ) {
      float t = tP;
      vec3 n = normalize( v * t - C );
      vec3 sc = neptuneSurface( uNepRot * n );
      float ndl = dot( n, Lp );
      float lit = smoothstep( -0.2, 0.45, ndl );
      float rim = pow( 1.0 - max( dot( n, -v ), 0.0 ), 2.2 );
      vec3 pc = sc * ( lit * 1.45 + 0.05 ) + vec3( 0.55, 0.72, 0.85 ) * rim * 0.45 * ( 0.3 + 0.7 * lit );
      pc *= mix( 0.25, 1.0, uDay );
      pc = mix( pc, col, 0.22 );
      float pa = smoothstep( 0.0, max( fwidth( disc ) * 1.5, 1e-6 ), disc );
      col = mix( col, pc, pa * haze );
    }
    if ( t1 <= tP ) col = mix( col, beltCol, d1 * 0.45 * haze );
    if ( t2 <= tP ) col = mix( col, beltCol, d2 * 0.4 * haze );
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
    uPlanetR: { value: Math.sin(THREE.MathUtils.degToRad(12)) }, uPlanetOn: { value: 1 }, uDay: { value: 1 },
    uPlanetRot: { value: new THREE.Matrix3() },
    uNepMap: { value: tex('2k_neptune.jpg') },
    uBelt1: { value: new THREE.Vector3(0.18, 0.95, 0.25).normalize() }, uBelt2: { value: new THREE.Vector3(-0.3, 0.9, -0.12).normalize() },
    uNep: { value: new THREE.Vector3() }, uNepD: { value: 0.85 }, uNepR: { value: 0.85 * Math.sin(THREE.MathUtils.degToRad(6)) }, uNepOn: { value: 1 },
    uNepRot: { value: new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-0.25, 0.4, 0.18))) },
    uGiant: { value: new THREE.Vector3() }, uGiantR: { value: Math.sin(THREE.MathUtils.degToRad(50)) }, uGiantOn: { value: 1 },
    uGiantRot: { value: new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.22, 0.0, -0.18))) },
    uPlanetMap: { value: tex('2k_jupiter.jpg') }, uRingMap: { value: new THREE.TextureLoader().load(BASE + '2k_saturn_ring_alpha.png') },
  };
  dome.material = new THREE.ShaderMaterial({ uniforms: U, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false });
  for (const c of dome.children) c.visible = false; // l'ancien disque du soleil

  const R = 360;
  const moonU = { uMap: { value: tex('2k_moon.jpg') }, uSun: U.uSun, uDay: { value: 0 } };
  const moon = new THREE.Mesh(new THREE.SphereGeometry(11, 64, 32), new THREE.ShaderMaterial({ uniforms: moonU, vertexShader: BODY_VERT, fragmentShader: MOON_FRAG, transparent: true, depthWrite: false, fog: false }));
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
  // Direction d'après l'azimut (depuis +z, vers +x) et la hauteur, en degrés.
  const dirAt = (out, az, el) => {
    const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
    return out.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
  };
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
      // Trois planètes bien espacées, vues du balcon (vers +z ; +x à gauche) :
      // la bleue à gauche, Jupiter haut au milieu, la géante pâle à droite,
      // posée sur l'horizon. Elles dérivent à peine au fil du jour.
      const drift = Math.sin(st.starAngle) * 0.06;
      dirAt(U.uPlanet.value, 16 + drift * 20, 31);
      dirAt(U.uNep.value, 55 + drift * 30, 20);
      dirAt(U.uGiant.value, -48 + drift * 10, -2);
      U.uNepOn.value = U.uGiantOn.value = flags.planet ? 1 : 0;
      U.uDay.value = st.day;
    },
  };
}
