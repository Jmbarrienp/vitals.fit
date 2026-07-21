import { GroundTruthDataset } from '../../learning/types/eval-contract';
import { TrustDecisionRow } from '../rollout-data.reader';
import { ROLLOUT_CONTRACT_VERSION, TrustAnalytics, TrustSlice } from '../types/rollout-contract';

/**
 * Trust analytics (V4.0) — PURE aggregation over the append-only decision
 * audit. Nothing here recomputes trust: the runtime Trust Engine (V3.6)
 * already decided and persisted every score; this layer only aggregates what
 * was decided. A trust score in this report can therefore never disagree with
 * what the platform actually did — they are the same rows.
 *
 * The blend is pinned and versioned:
 *   score = 0.5·avgTrustScore + 0.3·autoAcceptShare + 0.2·(1 − undoShare)
 * (undoShare counts only against EXECUTED decisions; with nothing executed the
 * factor is neutral). Derived, never edited — there is no setter anywhere.
 */

const W_TRUST = 0.5;
const W_ACCEPT = 0.3;
const W_UNDO = 0.2;
/** Slices below this many decisions are noise, not analytics. */
export const MIN_SLICE_DECISIONS = 3;
const MAX_SLICES = 50;

export function buildTrustAnalytics(
  rows: TrustDecisionRow[],
  undoneScanIds: Set<string>,
  dataset: GroundTruthDataset,
  window: { from: Date; to: Date },
): TrustAnalytics {
  const examples = portionExamples(dataset);
  const edited = examples.filter((e) => e.action === 'EDITED_PORTION');
  const editedShare = examples.length === 0 ? null : round4(edited.length / examples.length);

  return {
    contractVersion: ROLLOUT_CONTRACT_VERSION,
    window,
    overall: slice('overall', rows, undoneScanIds),
    perUser: slices(rows, undoneScanIds, (r) => r.userId),
    perProvider: slices(rows, undoneScanIds, (r) => r.providerId),
    perModality: slices(rows, undoneScanIds, (r) => r.modality),
    perFood: slices(rows.filter((r) => r.foodItemId), undoneScanIds, (r) => r.foodItemId!),
    portionTrust: {
      examples: examples.length,
      editedShare,
      // Portion trust = how often the platform's grams survived the user unchanged.
      score: editedShare == null ? null : round4(1 - editedShare),
    },
  };
}

/**
 * The ONE definition of a portion example — the rollout engine's PORTION stage
 * and the portion-trust score both consume this, never their own filters.
 * UNDONE is excluded on principle: an undo rejects the MEAL, not the grams —
 * counting it here would let a recognition failure masquerade as portion noise.
 */
export function portionExamples(dataset: GroundTruthDataset) {
  return dataset.examples.filter(
    (e) => e.action !== 'ADDED_MANUAL' && e.action !== 'UNDONE' && e.proposedGrams != null,
  );
}

function slices(rows: TrustDecisionRow[], undone: Set<string>, keyOf: (r: TrustDecisionRow) => string): TrustSlice[] {
  const groups = new Map<string, TrustDecisionRow[]>();
  for (const r of rows) {
    const key = keyOf(r);
    const group = groups.get(key);
    if (group) group.push(r);
    else groups.set(key, [r]);
  }
  return [...groups.keys()]
    .sort()
    .map((key) => slice(key, groups.get(key)!, undone))
    .filter((s) => s.decisions >= MIN_SLICE_DECISIONS)
    .slice(0, MAX_SLICES);
}

export function slice(key: string, rows: TrustDecisionRow[], undone: Set<string>): TrustSlice {
  const n = rows.length;
  if (n === 0) {
    return { key, decisions: 0, autoAcceptShare: null, executedShare: null, undoShare: null, avgTrustScore: null, score: null };
  }
  const autoAccept = rows.filter((r) => r.action === 'AUTO_ACCEPT');
  const executed = rows.filter((r) => r.executed);
  const undoneExecuted = executed.filter((r) => undone.has(r.scanId));

  const autoAcceptShare = round4(autoAccept.length / n);
  const undoShare = executed.length === 0 ? null : round4(undoneExecuted.length / executed.length);
  const avgTrustScore = round4(rows.reduce((s, r) => s + r.trustScore, 0) / n);

  const score = round4(W_TRUST * avgTrustScore + W_ACCEPT * autoAcceptShare + W_UNDO * (1 - (undoShare ?? 0)));

  return {
    key,
    decisions: n,
    autoAcceptShare,
    executedShare: round4(executed.length / n),
    undoShare,
    avgTrustScore,
    score,
  };
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
