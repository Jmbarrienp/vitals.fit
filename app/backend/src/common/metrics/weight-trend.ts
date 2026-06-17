export interface WeightPoint {
  date: Date;
  weightKg: number;
}

export interface WeightTrend {
  /** Least-squares slope expressed as kg per week. null if < 2 usable points. */
  weeklyRateKg: number | null;
  /** Number of points used in the fit. */
  points: number;
  /** Most recent weight (by date). null if no points. */
  currentKg: number | null;
}

/**
 * Single source of truth for weight trend across the codebase (rules, rollups,
 * progress summary, future Claude context). Least-squares linear regression of
 * weight (kg) over time (days), returned as a kg/week rate.
 *
 * Replaces the older approximations that had diverged:
 *  - progress.service: (last - first) / days  (comment claimed "regression")
 *  - context-builder:  2-point diff of the last two weigh-ins
 */
export function computeWeightTrend(points: WeightPoint[]): WeightTrend {
  if (points.length === 0) return { weeklyRateKg: null, points: 0, currentKg: null };

  const sorted = [...points].sort((a, b) => a.date.getTime() - b.date.getTime());
  const currentKg = sorted[sorted.length - 1].weightKg;
  if (sorted.length < 2) return { weeklyRateKg: null, points: sorted.length, currentKg };

  const DAY_MS = 1000 * 60 * 60 * 24;
  const t0 = sorted[0].date.getTime();
  const xs = sorted.map((p) => (p.date.getTime() - t0) / DAY_MS); // days since first point
  const ys = sorted.map((p) => p.weightKg);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return { weeklyRateKg: null, points: n, currentKg }; // all on the same day

  const slopePerDay = num / den;
  const weeklyRateKg = Math.round(slopePerDay * 7 * 100) / 100;
  return { weeklyRateKg, points: n, currentKg };
}
