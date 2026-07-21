import { GroundTruthDataset } from '../../learning/types/eval-contract';
import { TrustDecisionRow } from '../rollout-data.reader';
import { ROLLOUT_CONTRACT_VERSION, TimelinePoint, TrustTimeline } from '../types/rollout-contract';

/**
 * Trust timeline (V4.0) — PURE weekly aggregation of append-only history.
 * Because every input row is immutable (decisions are append-only, feedback is
 * append-only), any historical bucket can be recomputed from scratch forever
 * and will always come out identical — the timeline IS the data, not a cached
 * copy of it. Weeks are UTC Mondays; ordering is chronological and total.
 */

export function buildTimeline(
  decisions: TrustDecisionRow[],
  undoneScanIds: Set<string>,
  dataset: GroundTruthDataset,
  window: { from: Date; to: Date },
): TrustTimeline {
  return {
    contractVersion: ROLLOUT_CONTRACT_VERSION,
    window,
    global: buckets(decisions, undoneScanIds, dataset, () => true),
    perProvider: grouped(decisions, undoneScanIds, dataset, (d) => d.providerId),
    perModality: grouped(decisions, undoneScanIds, dataset, (d) => d.modality),
  };
}

function grouped(
  decisions: TrustDecisionRow[],
  undone: Set<string>,
  dataset: GroundTruthDataset,
  keyOf: (d: TrustDecisionRow) => string,
): Record<string, TimelinePoint[]> {
  const out: Record<string, TimelinePoint[]> = {};
  for (const key of [...new Set(decisions.map(keyOf))].sort()) {
    out[key] = buckets(decisions, undone, dataset, (d) => keyOf(d) === key);
  }
  return out;
}

function buckets(
  decisions: TrustDecisionRow[],
  undone: Set<string>,
  dataset: GroundTruthDataset,
  include: (d: TrustDecisionRow) => boolean,
): TimelinePoint[] {
  const included = decisions.filter(include);
  const scanIds = new Set(included.map((d) => d.scanId));

  const byWeek = new Map<string, { decisions: TrustDecisionRow[]; confirmations: number; corrections: number }>();
  const bucketOf = (week: string) => {
    let bucket = byWeek.get(week);
    if (!bucket) {
      bucket = { decisions: [], confirmations: 0, corrections: 0 };
      byWeek.set(week, bucket);
    }
    return bucket;
  };

  for (const d of included) bucketOf(weekStartUtc(d.createdAt)).decisions.push(d);
  // Ground-truth examples ride the same weeks, scoped to the same scans.
  for (const e of dataset.examples) {
    if (!scanIds.has(e.scanId) || !e.confirmedAt) continue;
    const bucket = bucketOf(weekStartUtc(e.confirmedAt));
    if (e.action === 'ACCEPTED') bucket.confirmations++;
    if (e.action === 'EDITED_PORTION' || e.action === 'SWAPPED') bucket.corrections++;
  }

  return [...byWeek.keys()].sort().map((week) => {
    const bucket = byWeek.get(week)!;
    const n = bucket.decisions.length;
    const autoAccept = bucket.decisions.filter((d) => d.action === 'AUTO_ACCEPT').length;
    const executed = bucket.decisions.filter((d) => d.executed);
    return {
      weekStart: week,
      decisions: n,
      autoAcceptShare: n === 0 ? null : round4(autoAccept / n),
      executed: executed.length,
      undone: executed.filter((d) => undone.has(d.scanId)).length,
      avgTrustScore: n === 0 ? null : round4(bucket.decisions.reduce((s, d) => s + d.trustScore, 0) / n),
      confirmations: bucket.confirmations,
      corrections: bucket.corrections,
    };
  });
}

/** UTC Monday of the row's week, as YYYY-MM-DD — timezone-proof and total. */
export function weekStartUtc(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sunday
  d.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
