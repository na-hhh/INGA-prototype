// Vérification jetable de la FFT 3D du bac (réplique de src/main.js) :
// aller-retour, divergence spectrale après projection, champ réel. À lancer
// avec `node fftcheck.mjs`, puis supprimer.
const n = 32, bits = Math.round(Math.log2(n));
const rev = new Uint16Array(n);
for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b); rev[i] = r; }
const cosT = new Float32Array(n / 2), sinT = new Float32Array(n / 2);
for (let i = 0; i < n / 2; i++) { cosT[i] = Math.cos(2 * Math.PI * i / n); sinT[i] = Math.sin(2 * Math.PI * i / n); }
const lr = new Float32Array(n), li = new Float32Array(n);
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
const fft3 = (re, im, dir) => {
  axis(re, im, 1, n, n * n, dir);
  axis(re, im, n, 1, n * n, dir);
  axis(re, im, n * n, 1, n, dir);
  if (dir < 0) { const s = 1 / (n * n * n); for (let i = 0; i < re.length; i++) { re[i] *= s; im[i] *= s; } }
};
const N3 = n * n * n;
const re = new Float32Array(N3), im = new Float32Array(N3), orig = new Float32Array(N3);
for (let i = 0; i < N3; i++) orig[i] = re[i] = Math.sin(i * 0.37) + Math.cos(i * 0.11);
const t0 = performance.now();
fft3(re, im, 1); fft3(re, im, -1);
const t1 = performance.now();
let err = 0, imax = 0;
for (let i = 0; i < N3; i++) { err = Math.max(err, Math.abs(re[i] - orig[i])); imax = Math.max(imax, Math.abs(im[i])); }
console.log('aller-retour: err max', err.toExponential(2), '| imag residuel', imax.toExponential(2), '| 2 fft3:', (t1 - t0).toFixed(1), 'ms');
const Lx = 32, Ly = 22, Lz = 32;
const K = (i, L) => 2 * Math.PI * (i <= n / 2 ? i : i - n) / L;
const ur = new Float32Array(N3), ui = new Float32Array(N3);
const vr = new Float32Array(N3), vi = new Float32Array(N3);
const wr = new Float32Array(N3), wi = new Float32Array(N3);
for (let i = 0; i < N3; i++) { ur[i] = Math.sin(i * 0.713); vr[i] = Math.cos(i * 0.291); wr[i] = Math.sin(i * 1.03); }
fft3(ur, ui, 1); fft3(vr, vi, 1); fft3(wr, wi, 1);
let i2 = 0;
for (let z = 0; z < n; z++) { const kz = K(z, Lz); for (let y = 0; y < n; y++) { const ky = K(y, Ly); for (let x = 0; x < n; x++, i2++) {
  const kx = K(x, Lx), k2 = kx * kx + ky * ky + kz * kz;
  if (k2 > 0) {
    const dr = (kx * ur[i2] + ky * vr[i2] + kz * wr[i2]) / k2;
    const di = (kx * ui[i2] + ky * vi[i2] + kz * wi[i2]) / k2;
    ur[i2] -= kx * dr; ui[i2] -= kx * di;
    vr[i2] -= ky * dr; vi[i2] -= ky * di;
    wr[i2] -= kz * dr; wi[i2] -= kz * di;
  }
} } }
let div = 0; i2 = 0;
for (let z = 0; z < n; z++) { const kz = K(z, Lz); for (let y = 0; y < n; y++) { const ky = K(y, Ly); for (let x = 0; x < n; x++, i2++) {
  const kx = K(x, Lx);
  div = Math.max(div, Math.abs(kx * ur[i2] + ky * vr[i2] + kz * wr[i2]), Math.abs(kx * ui[i2] + ky * vi[i2] + kz * wi[i2]));
} } }
fft3(ur, ui, -1);
let imag = 0; for (let i = 0; i < N3; i++) imag = Math.max(imag, Math.abs(ui[i]));
console.log('divergence spectrale apres projection', div.toExponential(2), '| imag apres inverse', imag.toExponential(2));
