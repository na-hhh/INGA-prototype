import * as THREE from 'three/webgpu';

// The weather: sky, haze, light, rain and how wet everything is. An
// ambiance is a set of values to head for; the weather eases towards them
// over a couple of seconds, so changing it never snaps.
//
//   fog    how thick the haze is
//   rain   how hard it rains, 0 to 1
//   wind   what the weather does to the wind set under Physics (a multiplier)
//   gusts  how much sharper its bursts are

export const AMBIANCES = {
  Clear: { sky: '#b9d4e8', fog: 0.0015, sun: '#fff3dc', sunPower: 3, hemiSky: '#dcebff', hemiGround: '#7f8f5a', hemiPower: 1.5, rain: 0, wind: 1, gusts: 0 },
  Overcast: { sky: '#a9b3bb', fog: 0.006, sun: '#e9ecf0', sunPower: 1.5, hemiSky: '#d3dbe3', hemiGround: '#6f7a58', hemiPower: 2.1, rain: 0, wind: 1.15, gusts: 0.15 },
  Rain: { sky: '#8a96a1', fog: 0.011, sun: '#dfe5ec', sunPower: 1.1, hemiSky: '#c9d4df', hemiGround: '#6a765a', hemiPower: 2.3, rain: 0.55, wind: 1.4, gusts: 0.35 },
  Storm: { sky: '#5d6772', fog: 0.018, sun: '#cfd8e2', sunPower: 0.55, hemiSky: '#a3b0be', hemiGround: '#566150', hemiPower: 1.8, rain: 1, wind: 2.3, gusts: 1 },
};
const NUMBERS = ['fog', 'sunPower', 'hemiPower', 'rain', 'wind', 'gusts'];
const COLOURS = ['sky', 'sun', 'hemiSky', 'hemiGround'];

const DROPS = 9000; // raindrops in the air in the heaviest rain
const SPLASHES = 500;
const SPLASH_TIME = 0.2; // seconds a splash lasts
const HALF = 26; // the rain falls in a box this far each way from what the camera looks at
const TOP = 30; // and this high

export class Weather {
  // `surfaces` are materials that darken and shine when wet, each with the
  // colour and roughness it has when dry.
  constructor(scene, sun, hemi, surfaces, ambiance = 'Clear') {
    this.scene = scene;
    this.sun = sun;
    this.hemi = hemi;
    this.surfaces = surfaces.map(({ material, wetColor, wetRoughness }) => ({ material, dry: material.color.clone(), dryRoughness: material.roughness, wet: new THREE.Color(wetColor), wetRoughness }));
    this.goal = {};
    this.now = {};
    this.set(ambiance);
    for (const k of NUMBERS) this.now[k] = this.goal[k];
    for (const k of COLOURS) this.now[k] = this.goal[k].clone();
    this.wet = 0;
    scene.background = new THREE.Color();
    scene.fog = new THREE.FogExp2('#ffffff', 0);

    // Rain: every drop is a short streak, drawn as one line.
    const material = new THREE.LineBasicNodeMaterial({ color: '#e3ebf3', transparent: true, opacity: 0.27, depthWrite: false });
    this.drop = new Float32Array(DROPS * 3);
    this.fall = new Float32Array(DROPS); // each drop falls at its own speed
    for (let i = 0; i < DROPS; i++) {
      this.drop[i * 3] = (Math.random() * 2 - 1) * HALF;
      this.drop[i * 3 + 1] = Math.random() * TOP;
      this.drop[i * 3 + 2] = (Math.random() * 2 - 1) * HALF;
      this.fall[i] = 19 + Math.random() * 8;
    }
    this.streaks = new THREE.BufferAttribute(new Float32Array(DROPS * 6), 3).setUsage(THREE.DynamicDrawUsage);
    const geometry = new THREE.BufferGeometry().setAttribute('position', this.streaks);
    geometry.setDrawRange(0, 0);
    this.rain = new THREE.LineSegments(geometry, material);
    this.rain.frustumCulled = false;

    // Splashes: where a drop lands, three short spokes that jump up and out.
    this.splashAt = new Float32Array(SPLASHES * 4).fill(-10); // x, y, z, and the moment it landed
    this.spokes = new THREE.BufferAttribute(new Float32Array(SPLASHES * 18), 3).setUsage(THREE.DynamicDrawUsage);
    this.splashes = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', this.spokes), material);
    this.splashes.frustumCulled = false;
    this.nextSplash = 0;
    this.clock = 0;
    scene.add(this.rain, this.splashes);
    this.draw(0, null, new THREE.Vector3());
  }

  set(ambiance) {
    const a = AMBIANCES[ambiance];
    for (const k of NUMBERS) this.goal[k] = a[k];
    for (const k of COLOURS) this.goal[k] = new THREE.Color(a[k]);
  }

  // Moves the weather on by dt seconds and tells the vine about it.
  step(dt, sim) {
    const ease = 1 - Math.exp(-dt / 0.9);
    const now = this.now, goal = this.goal;
    for (const k of NUMBERS) now[k] += (goal[k] - now[k]) * ease;
    for (const k of COLOURS) now[k].lerp(goal[k], ease);
    // Things get wet quickly in rain and dry slowly after it, sooner in wind.
    this.wet = Math.min(1, Math.max(0, this.wet + dt * (now.rain * 0.14 - Math.max(0, 1 - now.rain * 4) * 0.012 * (1 + now.wind))));
    if (sim) {
      sim.rain = now.rain;
      sim.wet = this.wet;
      sim.windScale = now.wind;
      sim.gustiness = now.gusts;
    }
  }

  // Shows the weather as it now is. `focus` is what the camera looks at:
  // the rain falls around it.
  draw(dt, sim, focus) {
    const now = this.now;
    this.scene.background.copy(now.sky);
    this.scene.fog.color.copy(now.sky);
    this.scene.fog.density = now.fog;
    this.sun.color.copy(now.sun);
    this.sun.intensity = now.sunPower;
    this.hemi.color.copy(now.hemiSky);
    this.hemi.groundColor.copy(now.hemiGround);
    this.hemi.intensity = now.hemiPower;
    for (const s of this.surfaces) {
      s.material.color.copy(s.dry).lerp(s.wet, this.wet);
      s.material.roughness = s.dryRoughness + (s.wetRoughness - s.dryRoughness) * this.wet;
    }

    this.clock += dt;
    const count = Math.round(DROPS * Math.pow(now.rain, 1.3));
    const P = this.drop, S = this.streaks.array;
    // Rain is carried along by the wind, so it slants the way the wind blows.
    const wx = sim ? sim.wind[0] * 4.5 : 0, wz = sim ? sim.wind[2] * 4.5 : 0;
    const STREAK = 0.017; // seconds of fall that one streak shows
    for (let i = 0; i < count; i++) {
      const o = i * 3;
      const vy = -this.fall[i];
      let x = P[o] + wx * dt, y = P[o + 1] + vy * dt, z = P[o + 2] + wz * dt;
      // Landed, on the ground or on the support?
      if (y < 0.02 || (sim && y < 30 && sim.distance(x, y, z) < 0.03)) {
        if (dt > 0) this.splash(x, Math.max(0.02, y), z);
        x = focus.x + (Math.random() * 2 - 1) * HALF;
        z = focus.z + (Math.random() * 2 - 1) * HALF;
        y = TOP * (0.75 + 0.25 * Math.random());
      }
      // Drops blown out of one side of the box come back in at the other.
      if (x - focus.x > HALF) x -= 2 * HALF;
      else if (x - focus.x < -HALF) x += 2 * HALF;
      if (z - focus.z > HALF) z -= 2 * HALF;
      else if (z - focus.z < -HALF) z += 2 * HALF;
      P[o] = x; P[o + 1] = y; P[o + 2] = z;
      const s = i * 6;
      S[s] = x; S[s + 1] = y; S[s + 2] = z;
      S[s + 3] = x - wx * STREAK; S[s + 4] = y - vy * STREAK; S[s + 5] = z - wz * STREAK;
    }
    this.rain.geometry.setDrawRange(0, count * 2);
    this.rain.visible = count > 0;
    if (count > 0) {
      this.streaks.addUpdateRange(0, count * 6);
      this.streaks.needsUpdate = true;
    }

    const A = this.splashAt, K = this.spokes.array;
    let live = false;
    for (let i = 0; i < SPLASHES; i++) {
      const age = (this.clock - A[i * 4 + 3]) / SPLASH_TIME;
      const o = i * 18;
      if (age >= 1 || age < 0) {
        if (K[o + 3] !== K[o]) for (let q = 0; q < 18; q++) K[o + q] = 0;
        continue;
      }
      live = true;
      const x = A[i * 4], y = A[i * 4 + 1], z = A[i * 4 + 2];
      const out = 0.16 * age, up = 0.22 * age * (1 - age) * 4 * 0.6;
      for (let q = 0; q < 3; q++) {
        const a = i * 2.4 + q * 2.094;
        const c = Math.cos(a), s = Math.sin(a);
        K[o + q * 6] = x + c * out * 0.55; K[o + q * 6 + 1] = y + up * 0.6; K[o + q * 6 + 2] = z + s * out * 0.55;
        K[o + q * 6 + 3] = x + c * out; K[o + q * 6 + 4] = y + up; K[o + q * 6 + 5] = z + s * out;
      }
    }
    this.splashes.visible = live || count > 0;
    this.spokes.needsUpdate = true;
  }

  splash(x, y, z) {
    // Only one drop in three makes a splash worth drawing.
    if (Math.random() > 0.34) return;
    const i = this.nextSplash;
    this.nextSplash = (i + 1) % SPLASHES;
    this.splashAt[i * 4] = x;
    this.splashAt[i * 4 + 1] = y;
    this.splashAt[i * 4 + 2] = z;
    this.splashAt[i * 4 + 3] = this.clock;
  }
}
