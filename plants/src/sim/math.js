export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);

// Seeded PRNG (mulberry32) so a given seed always grows the same plant.
export function createRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Rate multiplier for temperature: 0 at tMin and tMax, 1 at tOpt.
export function tempResponse(t, tMin = 4, tOpt = 26, tMax = 38) {
  if (t <= tMin || t >= tMax) return 0;
  const a = (t - tMin) / (tOpt - tMin);
  const b = (tMax - t) / (tMax - tOpt);
  return a * Math.pow(b, (tMax - tOpt) / (tOpt - tMin));
}
