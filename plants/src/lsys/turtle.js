// Walks a generation of L-system modules with a 3D turtle and builds two
// meshes: tapered tubes for stems, and blades for leaves and petals.
//
// Turtle commands:
//   F(len)        move forward, drawing a stem segment     f(len)  move without drawing
//   +(a) -(a)     turn left / right                        &(a) ^(a)  pitch down / up
//   \(a) /(a)     roll left / right                        |  turn around
//   $             roll so the turtle's left is level       [ ]  start / end a branch
//   !(w)          set stem width
//   L(len, wid)   leaf                                     K(size)  flower
// Any other symbol is ignored: it only matters to the rules.

const RAD = Math.PI / 180;

class Buffer {
  constructor(Type, size = 8192) {
    this.Type = Type;
    this.data = new Type(size);
    this.n = 0;
  }
  room(k) {
    if (this.n + k <= this.data.length) return;
    const bigger = new this.Type(Math.max(this.data.length * 2, this.n + k));
    bigger.set(this.data);
    this.data = bigger;
  }
  push3(x, y, z) {
    this.room(3);
    const d = this.data;
    d[this.n++] = x;
    d[this.n++] = y;
    d[this.n++] = z;
  }
  done() {
    return this.data.slice(0, this.n);
  }
}

export class MeshBuilder {
  constructor() {
    this.position = new Buffer(Float32Array);
    this.normal = new Buffer(Float32Array);
    this.color = new Buffer(Float32Array);
    this.index = new Buffer(Uint32Array);
    this.count = 0;
  }
  vertex(x, y, z, nx, ny, nz, r, g, b) {
    this.position.push3(x, y, z);
    this.normal.push3(nx, ny, nz);
    this.color.push3(r, g, b);
    return this.count++;
  }
  triangle(a, b, c) {
    this.index.push3(a, b, c);
  }
  done() {
    return { position: this.position.done(), normal: this.normal.done(), color: this.color.done(), index: this.index.done() };
  }
}

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const mix = (a, b, t) => a + (b - a) * t;

export function buildPlant(gen, time, opts, out) {
  const stems = out?.stems ?? new MeshBuilder();
  const leaves = out?.leaves ?? new MeshBuilder();
  const { colors, constants, rng } = opts;
  const origin = opts.origin ?? [0, 0, 0];
  const sides = opts.sides ?? 7;
  const defaultAngle = constants.angle ?? 25;
  const mature = Math.max(0.01, constants.mature ?? 1);
  // Environment: these bend what the rules describe.
  const env = opts.env ?? { gravity: 1, water: 1, nutrients: 1, wind: 0, windX: 1, windZ: 0, sun: [0, 1, 0] };
  const wilt = Math.max(0, 1 - env.water) * 3; // a thirsty plant cannot hold itself up
  const droop = (constants.droop ?? 0) * env.gravity * (1 + wilt);
  const phototropism = constants.phototropism ?? 0;
  const [sunX, sunY, sunZ] = env.sun;
  const unfurl = (constants.unfurl ?? 0) * RAD;
  const woodWidth = constants.woodWidth ?? 0.6;
  const leafFold = (constants.leafFold ?? 18) * RAD;
  const leafCurl = (constants.leafCurl ?? 0.25) * (1 + wilt);

  // Turtle state: position, heading H, left L, up U, width, and the last
  // ring of stem vertices so consecutive segments join into one tube.
  let px = origin[0], py = origin[1], pz = origin[2];
  let hx = 0, hy = 1, hz = 0;
  let lx = 1, ly = 0, lz = 0;
  let ux = 0, uy = 0, uz = 1;
  let width = constants.width ?? 0.2;
  let ring = -1;
  let ringWidth = width;
  // The ring's own "side" direction, carried along without twisting.
  let ax = 1, ay = 0, az = 0;
  const stack = [];
  let segments = 0, leafCount = 0, flowers = 0;

  const rotate = (angle, kx, ky, kz) => {
    // Rodrigues rotation of the whole frame about a unit axis.
    const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
    const rot = (x, y, z) => {
      const d = kx * x + ky * y + kz * z;
      return [x * c + (ky * z - kz * y) * s + kx * d * t, y * c + (kz * x - kx * z) * s + ky * d * t, z * c + (kx * y - ky * x) * s + kz * d * t];
    };
    [hx, hy, hz] = rot(hx, hy, hz);
    [lx, ly, lz] = rot(lx, ly, lz);
    [ux, uy, uz] = rot(ux, uy, uz);
  };

  const addRing = (radius, shade) => {
    // Keep the ring's side vector perpendicular to the heading.
    const d = ax * hx + ay * hy + az * hz;
    ax -= hx * d;
    ay -= hy * d;
    az -= hz * d;
    let l = Math.hypot(ax, ay, az);
    if (l < 1e-5) {
      ax = lx;
      ay = ly;
      az = lz;
      l = 1;
    }
    ax /= l;
    ay /= l;
    az /= l;
    const bx = hy * az - hz * ay, by = hz * ax - hx * az, bz = hx * ay - hy * ax;
    const first = stems.count;
    const r = mix(colors.stem[0], colors.wood[0], shade);
    const g = mix(colors.stem[1], colors.wood[1], shade);
    const b = mix(colors.stem[2], colors.wood[2], shade);
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const nx = ax * Math.cos(a) + bx * Math.sin(a);
      const ny = ay * Math.cos(a) + by * Math.sin(a);
      const nz = az * Math.cos(a) + bz * Math.sin(a);
      stems.vertex(px + nx * radius, py + ny * radius, pz + nz * radius, nx, ny, nz, r, g, b);
    }
    return first;
  };

  const blade = (length, bladeWidth, base, tip, vein) => {
    const stations = 5;
    const jitter = 0.88 + rng() * 0.24;
    const cf = Math.cos(leafFold), sf = Math.sin(leafFold);
    let prev = -1;
    for (let i = 0; i <= stations; i++) {
      const t = i / stations;
      const half = (bladeWidth / 2) * Math.pow(Math.sin(Math.PI * Math.pow(t * 0.96 + 0.02, 0.75)), 0.8);
      const sag = -leafCurl * t * t * length;
      const cx = px + hx * length * t + ux * sag;
      const cy = py + hy * length * t + uy * sag;
      const cz = pz + hz * length * t + uz * sag;
      const r = mix(base[0], tip[0], t) * jitter, g = mix(base[1], tip[1], t) * jitter, b = mix(base[2], tip[2], t) * jitter;
      // Left edge, midrib, right edge; the two halves fold up into a shallow V.
      const ex = lx * cf, ey = ly * cf, ez = lz * cf;
      const fx = ux * sf, fy = uy * sf, fz = uz * sf;
      const left = leaves.vertex(cx + (ex + fx) * half, cy + (ey + fy) * half, cz + (ez + fz) * half, ux * cf - lx * sf, uy * cf - ly * sf, uz * cf - lz * sf, r, g, b);
      leaves.vertex(cx, cy, cz, ux, uy, uz, mix(r, vein[0], 0.5), mix(g, vein[1], 0.5), mix(b, vein[2], 0.5));
      leaves.vertex(cx - (ex - fx) * half, cy - (ey - fy) * half, cz - (ez - fz) * half, ux * cf + lx * sf, uy * cf + ly * sf, uz * cf + lz * sf, r, g, b);
      if (prev >= 0) {
        leaves.triangle(prev, left, prev + 1);
        leaves.triangle(prev + 1, left, left + 1);
        leaves.triangle(prev + 1, left + 1, prev + 2);
        leaves.triangle(prev + 2, left + 1, left + 2);
      }
      prev = left;
    }
  };

  const n = gen.s.length;
  for (let i = 0; i < n; i++) {
    const sym = gen.s[i];
    const args = gen.a[i];
    const p0 = args ? args[0] : undefined;
    switch (sym) {
      case 'F':
      case 'f': {
        const m = smooth((time - (gen.b[i] - 1)) / mature);
        if (m <= 0) break;
        const length = (p0 ?? 1) * m;
        // A young shoot is still coiled up: it straightens as it matures.
        if (unfurl && m < 1) rotate(-unfurl * (1 - m), lx, ly, lz);
        if (sym === 'F') {
          if (ring < 0) ring = addRing((ringWidth / 2) * m, Math.min(1, ringWidth / woodWidth));
          px += hx * length;
          py += hy * length;
          pz += hz * length;
          // Thin stems give more than thick ones.
          const flex = Math.min(4, woodWidth / Math.max(width, 0.02)) * length;
          if (droop) {
            // Gravity: bend towards the ground (axis = H x down).
            const kx = hz, kz = -hx;
            const k = Math.hypot(kx, kz);
            if (k > 1e-4) rotate(droop * flex * k, kx / k, 0, kz / k);
          }
          if (phototropism) {
            // Light: bend towards the sun (axis = H x sun).
            const kx = hy * sunZ - hz * sunY, ky = hz * sunX - hx * sunZ, kz = hx * sunY - hy * sunX;
            const k = Math.hypot(kx, ky, kz);
            if (k > 1e-4) rotate(phototropism * length * k, kx / k, ky / k, kz / k);
          }
          if (env.wind) {
            // Wind: lean downwind (axis = H x wind).
            const kx = -hy * env.windZ, ky = hz * env.windX - hx * env.windZ, kz = hy * env.windX;
            const k = Math.hypot(kx, ky, kz);
            if (k > 1e-4) rotate(env.wind * 0.006 * flex * k, kx / k, ky / k, kz / k);
          }
          // The ground: a stem that reaches it runs along it instead.
          if (py < 0.03 && origin[1] === 0) {
            py = 0.03;
            if (hy < 0) {
              const k = Math.hypot(hx, hz);
              if (k > 1e-4) rotate(Math.asin(Math.max(-1, hy)), -hz / k, 0, hx / k);
            }
          }
          const end = addRing((width / 2) * m, Math.min(1, width / woodWidth));
          for (let q = 0; q < sides; q++) {
            const q1 = (q + 1) % sides;
            stems.triangle(ring + q, ring + q1, end + q);
            stems.triangle(ring + q1, end + q1, end + q);
          }
          ring = end;
          ringWidth = width;
          segments++;
        } else {
          px += hx * length;
          py += hy * length;
          pz += hz * length;
          ring = -1;
        }
        break;
      }
      case '+':
        rotate((p0 ?? defaultAngle) * RAD, ux, uy, uz);
        break;
      case '-':
        rotate(-(p0 ?? defaultAngle) * RAD, ux, uy, uz);
        break;
      case '&':
        rotate((p0 ?? defaultAngle) * RAD, lx, ly, lz);
        break;
      case '^':
        rotate(-(p0 ?? defaultAngle) * RAD, lx, ly, lz);
        break;
      case '\\':
        rotate((p0 ?? defaultAngle) * RAD, hx, hy, hz);
        break;
      case '/':
        rotate(-(p0 ?? defaultAngle) * RAD, hx, hy, hz);
        break;
      case '|':
        rotate(Math.PI, ux, uy, uz);
        break;
      case '$': {
        // Level the turtle: left becomes horizontal, up as upright as it can be.
        const kx = -hz, kz = hx; // up(0,1,0) x H
        const k = Math.hypot(kx, kz);
        if (k > 1e-4) {
          lx = kx / k;
          ly = 0;
          lz = kz / k;
          ux = hy * lz - hz * ly;
          uy = hz * lx - hx * lz;
          uz = hx * ly - hy * lx;
        }
        break;
      }
      case '!':
        width = p0 ?? width;
        break;
      case '[':
        stack.push([px, py, pz, hx, hy, hz, lx, ly, lz, ux, uy, uz, width, ring, ringWidth, ax, ay, az]);
        ring = -1;
        ringWidth = width;
        break;
      case ']':
        if (stack.length) [px, py, pz, hx, hy, hz, lx, ly, lz, ux, uy, uz, width, ring, ringWidth, ax, ay, az] = stack.pop();
        break;
      case 'L': {
        const m = smooth((time - (gen.b[i] - 1)) / mature);
        if (m <= 0) break;
        blade((p0 ?? 1) * m, (args?.[1] ?? 0.4) * m, colors.leaf, colors.leafTip, colors.stem);
        leafCount++;
        break;
      }
      case 'K': {
        const m = smooth((time - (gen.b[i] - 1)) / mature);
        if (m <= 0) break;
        const size = (p0 ?? 1) * m;
        const petals = Math.round(args?.[1] ?? 5);
        const saved = [hx, hy, hz, lx, ly, lz, ux, uy, uz];
        for (let k = 0; k < petals; k++) {
          [hx, hy, hz, lx, ly, lz, ux, uy, uz] = saved;
          rotate((k / petals) * Math.PI * 2, hx, hy, hz);
          rotate(62 * RAD, lx, ly, lz);
          blade(size, size * 0.62, colors.flowerCenter, colors.flower, colors.flower);
        }
        [hx, hy, hz, lx, ly, lz, ux, uy, uz] = saved;
        flowers++;
        break;
      }
      default:
    }
  }
  return { stems, leaves, stats: { segments, leaves: leafCount, flowers } };
}
