import type { Vec3 } from './relax';

/** Centre on the centroid and scale so the 98th-percentile radius equals
 *  `radius`.
 *
 *  Percentile rather than max: a single outlier would otherwise shrink the whole
 *  cloud to fit it, so the default camera framing would drift as the corpus
 *  grows. With a percentile, a handful of points are allowed to sit outside the
 *  nominal radius and the bulk of the cloud keeps a stable apparent size. */
export function fitToRadius(points: Vec3[], radius: number, percentile = 0.98): Vec3[] {
  if (points.length === 0) return points;

  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const p of points) {
    cx += p[0];
    cy += p[1];
    cz += p[2];
  }
  cx /= points.length;
  cy /= points.length;
  cz /= points.length;

  const centred = points.map((p) => [p[0] - cx, p[1] - cy, p[2] - cz] as Vec3);
  const radii = centred.map((p) => Math.hypot(p[0], p[1], p[2])).sort((a, b) => a - b);
  const idx = Math.min(radii.length - 1, Math.floor(percentile * (radii.length - 1)));
  const reference = radii[idx] as number;

  const scale = reference > 1e-9 ? radius / reference : 1;
  return centred.map((p) => [p[0] * scale, p[1] * scale, p[2] * scale] as Vec3);
}

/** Largest absolute coordinate extent, for deriving picking thresholds and
 *  camera limits. */
export function extentOf(points: Vec3[]): number {
  let max = 0;
  for (const p of points) {
    max = Math.max(max, Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2]));
  }
  return max;
}
