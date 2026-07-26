import { randomUnitVector } from './prng';

export type Vec3 = [number, number, number];

/** Pull each book a fraction of the way toward its top-level branch centroid,
 *  recomputing centroids every iteration.
 *
 *  Be careful with the parameters: the pull COMPOUNDS. After `iterations` passes
 *  a point retains `(1 - gamma)^iterations` of its original offset from the
 *  branch centroid, so the effective pull is `1 - (1 - gamma)^iterations`.
 *  Recomputing centroids does not save you — a branch's centroid barely moves
 *  while its members converge on it, so a large gamma is a hard snap that
 *  collapses each branch to a point, not a "soft consensus". See the measured
 *  table in `config.ts`; `attractionGamma` is small by design. */
export function taxonomyAttraction(
  points: Vec3[],
  branchOf: Array<string | null>,
  iterations: number,
  gamma: number,
): Vec3[] {
  if (iterations <= 0 || gamma <= 0) return points;
  const out = points.map((p) => [...p] as Vec3);

  for (let iter = 0; iter < iterations; iter++) {
    const sums = new Map<string, { x: number; y: number; z: number; n: number }>();
    for (let i = 0; i < out.length; i++) {
      const branch = branchOf[i];
      if (!branch) continue;
      const p = out[i] as Vec3;
      const acc = sums.get(branch) ?? { x: 0, y: 0, z: 0, n: 0 };
      acc.x += p[0];
      acc.y += p[1];
      acc.z += p[2];
      acc.n += 1;
      sums.set(branch, acc);
    }

    for (let i = 0; i < out.length; i++) {
      const branch = branchOf[i];
      if (!branch) continue;
      const acc = sums.get(branch);
      if (!acc || acc.n === 0) continue;
      const cx = acc.x / acc.n;
      const cy = acc.y / acc.n;
      const cz = acc.z / acc.n;
      const p = out[i] as Vec3;
      p[0] += (cx - p[0]) * gamma;
      p[1] += (cy - p[1]) * gamma;
      p[2] += (cz - p[2]) * gamma;
    }
  }

  return out;
}

/** Push apart points that are closer than `minDist`.
 *
 *  Books with identical tag sets AND the same author produce identical feature
 *  rows and therefore land on literally the same coordinates. That is a picking
 *  bug as much as a visual one — only one of them would ever be selectable.
 *  Deterministic because the jitter directions come from the shared seeded PRNG
 *  and are consumed in stable index order. */
export function separateCoincident(
  points: Vec3[],
  rng: () => number,
  minDist: number,
): Vec3[] {
  if (minDist <= 0) return points;
  const out = points.map((p) => [...p] as Vec3);
  const cell = minDist;
  const key = (p: Vec3): string =>
    `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)},${Math.floor(p[2] / cell)}`;

  // Two passes are enough in practice: the first separates exact duplicates,
  // the second resolves any pair the first pass pushed into a new collision.
  for (let pass = 0; pass < 2; pass++) {
    const buckets = new Map<string, number[]>();
    for (let i = 0; i < out.length; i++) {
      const k = key(out[i] as Vec3);
      const list = buckets.get(k) ?? [];
      list.push(i);
      buckets.set(k, list);
    }

    for (let i = 0; i < out.length; i++) {
      const p = out[i] as Vec3;
      const bx = Math.floor(p[0] / cell);
      const by = Math.floor(p[1] / cell);
      const bz = Math.floor(p[2] / cell);

      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            for (const j of buckets.get(`${bx + dx},${by + dy},${bz + dz}`) ?? []) {
              if (j <= i) continue;
              const q = out[j] as Vec3;
              const ddx = q[0] - p[0];
              const ddy = q[1] - p[1];
              const ddz = q[2] - p[2];
              const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
              if (d2 >= minDist * minDist) continue;

              const d = Math.sqrt(d2);
              let ux: number;
              let uy: number;
              let uz: number;
              if (d < 1e-9) {
                [ux, uy, uz] = randomUnitVector(rng);
              } else {
                ux = ddx / d;
                uy = ddy / d;
                uz = ddz / d;
              }
              const push = (minDist - d) / 2 + 1e-6;
              p[0] -= ux * push;
              p[1] -= uy * push;
              p[2] -= uz * push;
              q[0] += ux * push;
              q[1] += uy * push;
              q[2] += uz * push;
            }
          }
        }
      }
    }
  }

  return out;
}
