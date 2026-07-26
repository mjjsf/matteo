import { describe, expect, it } from 'vitest';
import { mulberry32 } from './prng';
import { separateCoincident, taxonomyAttraction, type Vec3 } from './relax';
import { extentOf, fitToRadius } from './normalize';

describe('taxonomyAttraction', () => {
  const points: Vec3[] = [
    [10, 0, 0],
    [-10, 0, 0],
    [0, 10, 0],
    [0, -10, 0],
  ];
  const branches = ['a', 'a', 'b', 'b'];

  it('is a no-op at gamma 0 or zero iterations', () => {
    expect(taxonomyAttraction(points, branches, 0, 0.5)).toEqual(points);
    expect(taxonomyAttraction(points, branches, 10, 0)).toEqual(points);
  });

  it('moves members toward their branch centroid', () => {
    const out = taxonomyAttraction(points, branches, 1, 0.5);
    // Branch a centroid is the origin, so both members halve their offset.
    expect(out[0]?.[0]).toBeCloseTo(5, 6);
    expect(out[1]?.[0]).toBeCloseTo(-5, 6);
  });

  it('compounds geometrically across iterations', () => {
    // The retained offset is (1 - gamma)^iterations. This is the relationship
    // that makes a seemingly small gamma a hard snap over many iterations.
    const gamma = 0.1;
    const iterations = 20;
    const out = taxonomyAttraction(points, branches, iterations, gamma);
    expect(out[0]?.[0]).toBeCloseTo(10 * (1 - gamma) ** iterations, 6);
  });

  it('does not collapse a branch entirely at the configured strength', () => {
    const out = taxonomyAttraction(points, branches, 40, 0.015);
    const retained = Math.abs(out[0]?.[0] ?? 0) / 10;
    expect(retained).toBeGreaterThan(0.4);
    expect(retained).toBeLessThan(0.7);
  });

  it('ignores points with no branch', () => {
    const out = taxonomyAttraction(points, ['a', 'a', null, null], 5, 0.5);
    expect(out[2]).toEqual([0, 10, 0]);
    expect(out[3]).toEqual([0, -10, 0]);
  });

  it('does not mutate its input', () => {
    const original: Vec3[] = [[1, 2, 3]];
    taxonomyAttraction(original, ['a'], 5, 0.5);
    expect(original[0]).toEqual([1, 2, 3]);
  });
});

describe('separateCoincident', () => {
  it('pushes exactly coincident points apart', () => {
    const points: Vec3[] = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const out = separateCoincident(points, mulberry32(3), 1);
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const p = out[i] as Vec3;
        const q = out[j] as Vec3;
        expect(Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])).toBeGreaterThan(0);
      }
    }
  });

  it('is deterministic for a fixed seed', () => {
    const points: Vec3[] = [
      [0, 0, 0],
      [0, 0, 0],
    ];
    const a = separateCoincident(points, mulberry32(3), 1);
    const b = separateCoincident(points, mulberry32(3), 1);
    expect(a).toEqual(b);
  });

  it('leaves already-separated points alone', () => {
    const points: Vec3[] = [
      [0, 0, 0],
      [100, 0, 0],
    ];
    expect(separateCoincident(points, mulberry32(3), 1)).toEqual(points);
  });

  it('is a no-op for a non-positive minimum distance', () => {
    const points: Vec3[] = [
      [0, 0, 0],
      [0, 0, 0],
    ];
    expect(separateCoincident(points, mulberry32(3), 0)).toEqual(points);
  });
});

describe('fitToRadius', () => {
  it('centres and scales to the target 98th-percentile radius', () => {
    const points: Vec3[] = Array.from({ length: 100 }, (_, i) => [i, 0, 0]);
    const out = fitToRadius(points, 50);
    const radii = out.map((p) => Math.hypot(p[0], p[1], p[2])).sort((a, b) => a - b);
    expect(radii[Math.floor(0.98 * (radii.length - 1))]).toBeCloseTo(50, 6);
  });

  it('is not dominated by a single outlier', () => {
    // A max-based fit would shrink the whole cloud to accommodate the outlier,
    // making default camera framing drift as the corpus grows.
    const base: Vec3[] = Array.from({ length: 100 }, (_, i) => [(i % 10) - 5, 0, 0]);
    const withOutlier: Vec3[] = [...base, [10_000, 0, 0]];
    const a = fitToRadius(base, 50);
    const b = fitToRadius(withOutlier, 50);
    const spread = (pts: Vec3[]): number => extentOf(pts.slice(0, 100));
    expect(Math.abs(spread(a) - spread(b)) / spread(a)).toBeLessThan(0.5);
  });

  it('handles an empty input', () => {
    expect(fitToRadius([], 50)).toEqual([]);
  });

  it('does not divide by zero when all points coincide', () => {
    const out = fitToRadius(
      [
        [1, 1, 1],
        [1, 1, 1],
      ],
      50,
    );
    for (const p of out) for (const v of p) expect(Number.isFinite(v)).toBe(true);
  });
});
