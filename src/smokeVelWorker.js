// Solveur de vitesse FFT (Stam) hors du fil principal. Le fil principal garde
// la densité sur GPU ; il envoie ici une densité grossière (une valeur par
// cellule de vitesse, relue du GPU) et reçoit le champ de vitesse, prêt à
// être téléversé en texture 3D demi-flottante. Les 5 à 15 ms du pas ne
// tombent donc plus jamais sur une image.
import { DataUtils } from 'three';

let n = 32, n3 = 0;
let h = [1, 1, 1], min = [0, 0, 0];
let sim = { visc: 0.08, weight: 5.5, swirl: 2.5 };
let U, V, W, Ur, Vr, Wr, Qa, Qb, Qc, Wi, Cx, Cy, Cz, Cm, Mu, Mv, Mw, Kx, Ky, Kz, wx, wy, wz;
let fft3 = null;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function makeFFT() {
  const bits = Math.round(Math.log2(n));
  const rev = new Uint16Array(n);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b); rev[i] = r; }
  const cosT = new Float64Array(n / 2), sinT = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cosT[i] = Math.cos(2 * Math.PI * i / n); sinT[i] = Math.sin(2 * Math.PI * i / n); }
  const lr = new Float64Array(n), li = new Float64Array(n);
  function axis(re, im, stepI, stepJ, stepK, dir) {
    for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) {
      const base = j * stepJ + k * stepK;
      for (let i = 0; i < n; i++) { const o = base + rev[i] * stepI; lr[i] = re[o]; li[i] = im[o]; }
      for (let len = 2; len <= n; len <<= 1) {
        const half = len >> 1, ts = n / len;
        for (let s = 0; s < n; s += len) for (let q = 0; q < half; q++) {
          const c = cosT[q * ts], sn = dir * sinT[q * ts];
          const a = s + q, b = a + half;
          const xr = lr[b] * c - li[b] * sn, xi = lr[b] * sn + li[b] * c;
          lr[b] = lr[a] - xr; li[b] = li[a] - xi;
          lr[a] += xr; li[a] += xi;
        }
      }
      for (let i = 0; i < n; i++) { const o = base + i * stepI; re[o] = lr[i]; im[o] = li[i]; }
    }
  }
  return (re, im, dir) => {
    axis(re, im, 1, n, n * n, dir);
    axis(re, im, n, 1, n * n, dir);
    axis(re, im, n * n, 1, n, dir);
    if (dir < 0) { const s = 1 / (n * n * n); for (let i = 0; i < re.length; i++) { re[i] *= s; im[i] *= s; } }
  };
}

function advect(sU, sV, sW, cU, cV, cW, dt, dU, dV, dW) {
  const n2 = n * n, nc = n - 1.001;
  const sx = dt / h[0], sy = dt / h[1], sz = dt / h[2];
  let i = 0;
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++, i++) {
    const gx = clamp(x - cU[i] * sx, 0, nc), gy = clamp(y - cV[i] * sy, 0, nc), gz = clamp(z - cW[i] * sz, 0, nc);
    const x0 = gx | 0, fx = gx - x0, y0 = gy | 0, fy = gy - y0, z0 = gz | 0, fz = gz - z0;
    const a0 = x0 + n * y0 + n2 * z0, a1 = a0 + n, a2 = a0 + n2, a3 = a1 + n2;
    const q000 = (1 - fx) * (1 - fy) * (1 - fz), q100 = fx * (1 - fy) * (1 - fz);
    const q010 = (1 - fx) * fy * (1 - fz), q110 = fx * fy * (1 - fz);
    const q001 = (1 - fx) * (1 - fy) * fz, q101 = fx * (1 - fy) * fz;
    const q011 = (1 - fx) * fy * fz, q111 = fx * fy * fz;
    dU[i] = sU[a0] * q000 + sU[a0 + 1] * q100 + sU[a1] * q010 + sU[a1 + 1] * q110 + sU[a2] * q001 + sU[a2 + 1] * q101 + sU[a3] * q011 + sU[a3 + 1] * q111;
    dV[i] = sV[a0] * q000 + sV[a0 + 1] * q100 + sV[a1] * q010 + sV[a1 + 1] * q110 + sV[a2] * q001 + sV[a2 + 1] * q101 + sV[a3] * q011 + sV[a3 + 1] * q111;
    dW[i] = sW[a0] * q000 + sW[a0 + 1] * q100 + sW[a1] * q010 + sW[a1 + 1] * q110 + sW[a2] * q001 + sW[a2 + 1] * q101 + sW[a3] * q011 + sW[a3 + 1] * q111;
  }
}
// Correction MacCormack bornée aux 8 voisins d'origine.
function macCorrect(S, C, dt, D, Q) {
  const n2 = n * n, nc = n - 1.001;
  const sx = dt / h[0], sy = dt / h[1], sz = dt / h[2];
  const [cU, cV, cW] = C;
  let i = 0;
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++, i++) {
    const a0 = (clamp(x - cU[i] * sx, 0, nc) | 0) + n * (clamp(y - cV[i] * sy, 0, nc) | 0) + n2 * (clamp(z - cW[i] * sz, 0, nc) | 0);
    const a1 = a0 + n, a2 = a0 + n2, a3 = a1 + n2;
    for (let k = 0; k < 3; k++) {
      const s = S[k];
      const mn = Math.min(Math.min(Math.min(s[a0], s[a0 + 1]), Math.min(s[a1], s[a1 + 1])), Math.min(Math.min(s[a2], s[a2 + 1]), Math.min(s[a3], s[a3 + 1])));
      const mx = Math.max(Math.max(Math.max(s[a0], s[a0 + 1]), Math.max(s[a1], s[a1 + 1])), Math.max(Math.max(s[a2], s[a2 + 1]), Math.max(s[a3], s[a3 + 1])));
      D[k][i] = Math.min(mx, Math.max(mn, D[k][i] + 0.5 * (s[i] - Q[k][i])));
    }
  }
}
function project(a, b, c, vdt) {
  // u + i·v dans une seule FFT complexe : 2 transformées par sens au lieu de 3.
  Wi.fill(0);
  fft3(a, b, 1); fft3(c, Wi, 1);
  for (let z = 0; z < n; z++) { const kz = Kz[z], zj = ((n - z) % n) * n * n; for (let y = 0; y < n; y++) { const ky = Ky[y], kyz = ky * ky + kz * kz, yj = ((n - y) % n) * n + zj; const row = n * (y + n * z); for (let x = 0; x < n; x++) {
    const i = x + row, j = ((n - x) % n) + yj;
    if (j < i) continue;
    const kx = Kx[x], k2 = kx * kx + kyz;
    const f = 1 / (1 + vdt * k2);
    let ur = 0.5 * (a[i] + a[j]) * f, ui = 0.5 * (b[i] - b[j]) * f;
    let vr = 0.5 * (b[i] + b[j]) * f, vi = -0.5 * (a[i] - a[j]) * f;
    let wr = c[i] * f, wi = Wi[i] * f;
    if (k2 > 0) {
      const dr = (kx * ur + ky * vr + kz * wr) / k2, di = (kx * ui + ky * vi + kz * wi) / k2;
      ur -= kx * dr; ui -= kx * di; vr -= ky * dr; vi -= ky * di; wr -= kz * dr; wi -= kz * di;
    }
    a[i] = ur - vi; b[i] = ui + vr; c[i] = wr; Wi[i] = wi;
    if (j !== i) { a[j] = ur + vi; b[j] = vr - ui; c[j] = wr; Wi[j] = -wi; }
  } } }
  fft3(a, b, -1); fft3(c, Wi, -1);
  for (let i = 0; i < n3; i++) { a[i] *= Mu[i]; b[i] *= Mv[i]; c[i] *= Mw[i]; }
}
function forces(dt, rho) {
  const g = sim.weight * dt / 255;
  for (let i = 0; i < n3; i++) { const d = rho[i]; if (d > 1) V[i] -= d * g; }
  const n2 = n * n, ix2 = 0.5 / h[0], iy2 = 0.5 / h[1], iz2 = 0.5 / h[2];
  for (let z = 1; z < n - 1; z++) for (let y = 1; y < n - 1; y++) {
    let j = 1 + n * y + n2 * z;
    for (let x = 1; x < n - 1; x++, j++) {
      const cx = (W[j + n] - W[j - n]) * iy2 - (V[j + n2] - V[j - n2]) * iz2;
      const cy = (U[j + n2] - U[j - n2]) * iz2 - (W[j + 1] - W[j - 1]) * ix2;
      const cz = (V[j + 1] - V[j - 1]) * ix2 - (U[j + n] - U[j - n]) * iy2;
      Cx[j] = cx; Cy[j] = cy; Cz[j] = cz;
      Cm[j] = Math.sqrt(cx * cx + cy * cy + cz * cz);
    }
  }
  const s = sim.swirl * dt;
  for (let z = 1; z < n - 1; z++) for (let y = 1; y < n - 1; y++) {
    let j = 1 + n * y + n2 * z;
    for (let x = 1; x < n - 1; x++, j++) {
      let gx = (Cm[j + 1] - Cm[j - 1]) * ix2, gy = (Cm[j + n] - Cm[j - n]) * iy2, gz = (Cm[j + n2] - Cm[j - n2]) * iz2;
      const m = Math.sqrt(gx * gx + gy * gy + gz * gz) + 1e-6;
      gx /= m; gy /= m; gz /= m;
      U[j] += s * (gy * Cz[j] - gz * Cy[j]);
      V[j] += s * (gz * Cx[j] - gx * Cz[j]);
      W[j] += s * (gx * Cy[j] - gy * Cx[j]);
    }
  }
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'config') {
    n = m.n; n3 = n * n * n; min = m.min;
    h = [m.size[0] / n, m.size[1] / n, m.size[2] / n];
    sim = { ...sim, ...m.sim };
    const F = () => new Float32Array(n3);
    U = F(); V = F(); W = F(); Ur = F(); Vr = F(); Wr = F(); Qa = F(); Qb = F(); Qc = F(); Wi = F(); Cx = F(); Cy = F(); Cz = F(); Cm = F();
    wx = new Float32Array(n); wy = new Float32Array(n); wz = new Float32Array(n);
    Kx = new Float32Array(n); Ky = new Float32Array(n); Kz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      wx[i] = min[0] + (i + 0.5) * h[0]; wy[i] = min[1] + (i + 0.5) * h[1]; wz[i] = min[2] + (i + 0.5) * h[2];
      const q = i === n / 2 ? 0 : i < n / 2 ? i : i - n; // nombres d'onde signés (Nyquist à 0 : garde le champ réel)
      Kx[i] = 2 * Math.PI * q / m.size[0]; Ky[i] = 2 * Math.PI * q / m.size[1]; Kz[i] = 2 * Math.PI * q / m.size[2];
    }
    // Masques de parois calculés ici, à la résolution du solveur : amorti aux
    // bords du domaine (la FFT est périodique), vitesse nulle dans les
    // solides, composante normale annulée à l'approche d'une paroi.
    Mu = F(); Mv = F(); Mw = F();
    const g = m.geom, mx = [min[0] + m.size[0], min[1] + m.size[1], min[2] + m.size[2]];
    let i = 0;
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++, i++) {
      const X = wx[x], Y = wy[y], Z = wz[z];
      const a = Math.min(1, Math.min(X - min[0], mx[0] - X) / 2, (mx[1] - Y) / 2, Math.min(Z - min[2], mx[2] - Z) / 2);
      let mu = a, mv = a, mw = a;
      if (g.kind === 'voxels') {
        // Architecture quelconque, donnée en voxels. Dans chaque cellule de
        // vitesse on cherche des « tranches » pleines : une tranche pleine
        // perpendiculaire à x est un mur qui arrête u (mais laisse glisser v
        // et w), une tranche horizontale pleine est un sol ou un plafond…
        if (Y < 0) mu = mv = mw = 0;
        else {
          const V = g.vox;
          const x0 = Math.max(0, Math.floor((X - h[0] / 2 - min[0]) / V)), x1 = Math.min(g.nx, Math.ceil((X + h[0] / 2 - min[0]) / V));
          const y0 = Math.max(0, Math.floor((Y - h[1] / 2 - min[1]) / V)), y1 = Math.min(g.ny, Math.ceil((Y + h[1] / 2 - min[1]) / V));
          const z0 = Math.max(0, Math.floor((Z - h[2] / 2 - min[2]) / V)), z1 = Math.min(g.nz, Math.ceil((Z + h[2] / 2 - min[2]) / V));
          const sx = new Uint16Array(x1 - x0), sy = new Uint16Array(y1 - y0), sz = new Uint16Array(z1 - z0);
          for (let c = z0; c < z1; c++) for (let b = y0; b < y1; b++) { const row = g.nx * (b + g.ny * c); for (let aa = x0; aa < x1; aa++) if (g.occ[row + aa]) { sx[aa - x0]++; sy[b - y0]++; sz[c - z0]++; } }
          const full = (arr, per) => { let m = 0; for (let q = 0; q < arr.length; q++) if (arr[q] > m) m = arr[q]; return per > 0 && m / per > 0.55; };
          if (full(sx, (y1 - y0) * (z1 - z0))) mu = 0;
          if (full(sy, (x1 - x0) * (z1 - z0))) mv = 0;
          if (full(sz, (x1 - x0) * (y1 - y0))) mw = 0;
        }
      } else if (g.kind === 'hall') {
        if (Y < 0 || Y > g.top || Math.abs(X) > g.X || Z < g.doorZ || Z > g.north) mu = mv = mw = 0;
        else {
          mv *= clamp(Y / 0.5, 0, 1) * clamp((g.top - Y) / 0.5, 0, 1);
          mu *= clamp((g.X - Math.abs(X)) / 1.0, 0, 1);
          mw *= clamp(Math.min(Z - g.doorZ, g.north - Z) / 1.0, 0, 1);
          for (const b of g.boxes) if (Math.abs(X - b.x) < b.sx / 2 + h[0] * 0.5 && Math.abs(Y - b.y) < b.sy / 2 + h[1] * 0.5 && Math.abs(Z - b.z) < b.sz / 2 + h[2] * 0.5) { mu = mv = mw = 0; break; }
        }
      } else if (Y < 0) mu = mv = mw = 0;
      else {
        mv *= clamp(Y / 0.9, 0, 1);
        if (Y < g.wallH) {
          const dx = X - g.cx, dz = Z - g.cz, H = g.half, T = g.wallT;
          const wall = dx < -H || dz < -H || (!g.open && ((dx > H && dx < H + T && dz < H + T) || (dz > H && dz < H + T && dx < H + T)));
          if (wall) mu = mv = mw = 0;
          else {
            mu *= clamp((dx + H) / 1.2, 0, 1); mw *= clamp((dz + H) / 1.2, 0, 1);
            if (!g.open && dx < H && dz < H) { mu *= clamp((H - dx) / 1.2, 0, 1); mw *= clamp((H - dz) / 1.2, 0, 1); }
          }
        }
      }
      Mu[i] = Math.max(0, mu); Mv[i] = Math.max(0, mv); Mw[i] = Math.max(0, mw);
    }
    fft3 = makeFFT();
  } else if (m.type === 'sim') {
    Object.assign(sim, m.sim);
  } else if (m.type === 'clear') {
    if (U) { U.fill(0); V.fill(0); W.fill(0); }
  } else if (m.type === 'impulse') {
    // Bouffée : poussée vers le bas vrillée d'une rotation autour de la verticale.
    let i = 0;
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++, i++) {
      const dx = wx[x] - m.px, dy = wy[y] - m.py, dz = wz[z] - m.pz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) / m.rv;
      if (d >= 1) continue;
      const f = (1 - d * d) * (1 - d * d);
      V[i] -= m.push * f;
      U[i] -= dz / m.rv * m.spin * f;
      W[i] += dx / m.rv * m.spin * f;
    }
  } else if (m.type === 'step') {
    const t0 = performance.now();
    const dt = m.dt;
    // Jets des sources : la vitesse locale est ramenée vers celle de sortie.
    for (const j of m.jets || []) {
      const k = Math.min(1, 9 * dt);
      let i = 0;
      for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++, i++) {
        const dx = wx[x] - j.x, dy = wy[y] - j.y, dz = wz[z] - j.z;
        const d2 = (dx * dx + dy * dy + dz * dz) / (j.rv * j.rv);
        if (d2 >= 1) continue;
        const f = k * (1 - d2) * (1 - d2);
        U[i] += (j.jx - U[i]) * f; V[i] += (j.jy - V[i]) * f; W[i] += (j.jz - W[i]) * f;
      }
    }
    // Le joueur dans la grille de vitesse : à son emplacement le fluide est
    // entraîné à sa vitesse (paroi mobile). La projection qui suit répartit
    // la pression — l'air est poussé devant, aspiré derrière, et le sillage
    // garde des tourbillons après son passage.
    for (const B of m.bodies || []) {
      if (B.h > 0) {
        // Cylindre vertical (le joueur).
        const R = 1.15, k = Math.min(1, 14 * dt * B.k);
        let i = 0;
        for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) {
          const hy = clamp((wy[y] - B.y + 0.3) / 0.3, 0, 1) * clamp((B.y + B.h + 0.3 - wy[y]) / 0.3, 0, 1);
          for (let x = 0; x < n; x++, i++) {
            if (hy <= 0) continue;
            const dx = wx[x] - B.x, dz = wz[z] - B.z, d2 = (dx * dx + dz * dz) / (R * R);
            if (d2 >= 1) continue;
            const f = k * hy * (1 - d2) * (1 - d2);
            U[i] += (B.vx - U[i]) * f; V[i] += (B.vy - V[i]) * f; W[i] += (B.vz - W[i]) * f;
          }
        }
      } else {
        // Sphère (balle, boule d'air, projectile) : balayée le long du chemin
        // parcouru pendant le pas — autant de positions qu'il faut pour ne
        // pas laisser de trous derrière un projectile rapide.
        const R = Math.max(1.0, B.r * 1.5);
        const sx = B.sx ?? B.vx * dt, sy = B.sy ?? B.vy * dt, sz = B.sz ?? B.vz * dt;
        const len = Math.hypot(sx, sy, sz), N = Math.max(3, Math.min(16, Math.ceil(len / 0.7)));
        const k = Math.min(1, 10 * dt * B.k) * Math.min(1, Math.max(1 / 3, len / N / R));
        for (let q = 0; q < N; q++) {
          const bx = B.x - sx * q / N, by = B.y - sy * q / N, bz = B.z - sz * q / N;
          // Seules les cellules proches sont visitées.
          const x0 = Math.max(0, Math.floor((bx - R - min[0]) / h[0])), x1 = Math.min(n - 1, Math.ceil((bx + R - min[0]) / h[0]));
          const y0 = Math.max(0, Math.floor((by - R - min[1]) / h[1])), y1 = Math.min(n - 1, Math.ceil((by + R - min[1]) / h[1]));
          const z0 = Math.max(0, Math.floor((bz - R - min[2]) / h[2])), z1 = Math.min(n - 1, Math.ceil((bz + R - min[2]) / h[2]));
          for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
            const dx = wx[x] - bx, dy = wy[y] - by, dz = wz[z] - bz, d2 = (dx * dx + dy * dy + dz * dz) / (R * R);
            if (d2 >= 1) continue;
            const f = k * (1 - d2) * (1 - d2), i = x + n * (y + n * z);
            U[i] += (B.vx - U[i]) * f; V[i] += (B.vy - V[i]) * f; W[i] += (B.vz - W[i]) * f;
          }
        }
      }
    }
    forces(dt, m.rho);
    advect(U, V, W, U, V, W, dt, Ur, Vr, Wr);
    advect(Ur, Vr, Wr, U, V, W, -dt, Qa, Qb, Qc);
    macCorrect([U, V, W], [U, V, W], dt, [Ur, Vr, Wr], [Qa, Qb, Qc]);
    project(Ur, Vr, Wr, sim.visc * dt);
    U.set(Ur); V.set(Vr); W.set(Wr);
    const out = new Uint16Array(n3 * 4);
    for (let i = 0, o = 0; i < n3; i++, o += 4) {
      out[o] = DataUtils.toHalfFloat(U[i]); out[o + 1] = DataUtils.toHalfFloat(V[i]); out[o + 2] = DataUtils.toHalfFloat(W[i]);
    }
    self.postMessage({ type: 'vel', buf: out, ms: performance.now() - t0, rho: m.rho }, [out.buffer, m.rho.buffer]);
  }
};
