import { FLAG_TO_REASON } from '../recommendations/recommendation-reason';
import { WeeklyLedgerEntry } from './types/weekly-ledger';
import {
  CommitmentOutcome,
  FollowUp,
  IssueFollowUp,
  MetricDelta,
  NextPriority,
  RetentionMetrics,
  ReviewMetric,
  WeeklyReview,
} from './types/weekly-review';

/**
 * The Weekly Review + Behavior Follow-Up engine. PURE and DETERMINISTIC: every
 * function is a projection over immutable ledger entries + the recommendation
 * lifecycle. It reads NO raw logs and computes NO scores (those already live in
 * the ledger). This is where longitudinal history becomes coaching.
 */

/** A recommendation row, normalized for correlation (subset of the lifecycle). */
export interface LedgerRec {
  reason: string | null;
  status: string;
  message: string;
  createdAt: Date;
  committedAt: Date | null;
  completedAt: Date | null;
  commitExpiresAt: Date | null;
  respondedAt: Date | null;
}

// Metrics compared week-over-week; all "higher is better". Thresholds mark a move
// as material rather than noise.
const REVIEW_METRICS: { key: ReviewMetric; threshold: number }[] = [
  { key: 'adherenceScore', threshold: 5 },
  { key: 'nutritionScore', threshold: 5 },
  { key: 'loggingStreak', threshold: 1 },
  { key: 'proteinStreakDays', threshold: 1 },
  { key: 'calorieStreakDays', threshold: 1 },
  { key: 'daysLogged', threshold: 1 },
];

// Impact order for choosing the single most important issue.
const ISSUE_PRIORITY: string[] = [
  'PLATEAU_SUSPECTED',
  'LOW_ADHERENCE_WEEK',
  'PROTEIN_CHRONIC_LOW',
  'WEEKEND_DRIFT',
  'LOW_LOGGING_CONSISTENCY',
  'BREAKFAST_SKIPPED',
];

/** The structured issue codes present in a ledger week (never from raw logs). */
export function deriveIssueSet(entry: WeeklyLedgerEntry): string[] {
  const issues: string[] = [];
  if (entry.plateauStatus === 'PLATEAU_SUSPECTED') issues.push('PLATEAU_SUSPECTED');
  for (const flag of entry.behaviorFlags) issues.push(FLAG_TO_REASON[flag]);
  if (entry.adherenceScore !== null && entry.adherenceScore < 40) issues.push('LOW_ADHERENCE_WEEK');
  return [...new Set(issues)];
}

/** Week-over-week movement across the review metrics. Empty when there's no prior week. */
export function compareWeeks(
  current: WeeklyLedgerEntry,
  prior: WeeklyLedgerEntry | null,
): { improved: MetricDelta[]; worsened: MetricDelta[]; stable: ReviewMetric[] } {
  if (!prior) return { improved: [], worsened: [], stable: [] };
  const improved: MetricDelta[] = [];
  const worsened: MetricDelta[] = [];
  const stable: ReviewMetric[] = [];
  for (const { key, threshold } of REVIEW_METRICS) {
    const to = current[key] as number | null;
    const from = prior[key] as number | null;
    const delta = (to ?? 0) - (from ?? 0);
    const d: MetricDelta = { metric: key, from, to, delta };
    if (delta >= threshold) improved.push(d);
    else if (delta <= -threshold) worsened.push(d);
    else stable.push(key);
  }
  return { improved, worsened, stable };
}

/** Commitments that reached a terminal state during a given ledger week. */
export function commitmentOutcomesForWeek(weekStart: string, recs: LedgerRec[]): CommitmentOutcome[] {
  const start = new Date(`${weekStart}T00:00:00.000Z`).getTime();
  const end = start + 7 * 86400000;
  const inWeek = (d: Date | null) => !!d && d.getTime() >= start && d.getTime() < end;
  const outcomes: CommitmentOutcome[] = [];
  for (const r of recs) {
    if (inWeek(r.completedAt)) {
      outcomes.push({ reason: r.reason, status: 'COMPLETED', message: r.message });
    } else if (
      inWeek(r.commitExpiresAt) &&
      (!r.completedAt || r.completedAt.getTime() > r.commitExpiresAt!.getTime())
    ) {
      outcomes.push({ reason: r.reason, status: 'EXPIRED', message: r.message });
    }
  }
  return outcomes;
}

/**
 * The follow-up analysis: how the current week's issues relate to the prior week,
 * and whether past interventions worked. `entries` are newest-first.
 */
export function buildFollowUp(entries: WeeklyLedgerEntry[], recs: LedgerRec[]): FollowUp {
  const empty: FollowUp = { resolved: [], persisting: [], emerged: [], successfulInterventions: 0, repeatedFailures: 0 };
  if (entries.length === 0) return empty;

  const issueSets = entries.map(deriveIssueSet);
  const current = issueSets[0];
  const prior = issueSets[1] ?? [];

  const intervention = (issue: string): IssueFollowUp['intervention'] => {
    const matching = recs.filter((r) => r.reason === issue);
    if (matching.length === 0) return 'NONE';
    return matching.some((r) => r.completedAt !== null || r.committedAt !== null) ? 'INTERVENED' : 'IGNORED';
  };
  // Consecutive weeks an issue was present, starting at `fromIndex` and walking older.
  const weeksActive = (issue: string, fromIndex: number): number => {
    let n = 0;
    for (let i = fromIndex; i < issueSets.length; i++) {
      if (issueSets[i].includes(issue)) n++;
      else break;
    }
    return n;
  };

  const persisting: IssueFollowUp[] = current
    .filter((i) => prior.includes(i))
    .map((issue) => ({ issue, weeksActive: weeksActive(issue, 0), status: 'PERSISTING', intervention: intervention(issue) }));
  const emerged: IssueFollowUp[] = current
    .filter((i) => !prior.includes(i))
    .map((issue) => ({ issue, weeksActive: 1, status: 'NEW', intervention: intervention(issue) }));
  const resolved: IssueFollowUp[] = prior
    .filter((i) => !current.includes(i))
    .map((issue) => ({ issue, weeksActive: weeksActive(issue, 1), status: 'RESOLVED', intervention: intervention(issue) }));

  const successfulInterventions = resolved.filter((i) => i.intervention === 'INTERVENED').length;
  const repeatedFailures = persisting.filter((i) => i.intervention === 'INTERVENED').length;

  return { resolved, persisting, emerged, successfulInterventions, repeatedFailures };
}

/** The single most important focus for next week (structured). */
export function pickNextPriority(followUp: FollowUp): NextPriority {
  const pool = [...followUp.persisting, ...followUp.emerged].sort(
    (a, b) => priorityIndex(a.issue) - priorityIndex(b.issue),
  );
  if (pool.length > 0) {
    const top = pool[0];
    const basis =
      top.status === 'NEW'
        ? 'NEW_ISSUE'
        : top.intervention === 'INTERVENED'
          ? 'PERSISTENT_INTERVENED'
          : 'PERSISTENT_IGNORED';
    return { reason: top.issue, basis };
  }
  if (followUp.resolved.length > 0) return { reason: 'STEADY', basis: 'RESOLVED_NEXT' };
  return { reason: 'STEADY', basis: 'MAINTAIN' };
}

export function buildReview(
  entry: WeeklyLedgerEntry,
  prior: WeeklyLedgerEntry | null,
  outcomes: CommitmentOutcome[],
  nextPriority: NextPriority | null,
): WeeklyReview {
  const cmp = compareWeeks(entry, prior);
  return {
    weekStart: entry.weekStart,
    isoYear: entry.isoYear,
    isoWeek: entry.isoWeek,
    adherenceScore: entry.adherenceScore,
    nutritionScore: entry.nutritionScore,
    daysLogged: entry.daysLogged,
    loggingStreak: entry.loggingStreak,
    improved: cmp.improved,
    worsened: cmp.worsened,
    stable: cmp.stable,
    biggestOpportunity: entry.primaryIssue,
    biggestImprovement: entry.primaryImprovement,
    commitments: {
      completed: entry.completedCommitments,
      expired: entry.expiredCommitments,
      completionRate: entry.completionRate,
      outcomes,
    },
    nextPriority,
  };
}

/** Product-intelligence metrics. Read-only; does NOT feed recommendation generation. */
export function computeRetention(entries: WeeklyLedgerEntry[], recs: LedgerRec[], followUp: FollowUp): RetentionMetrics {
  const generated = recs.length;
  const committed = recs.filter((r) => r.committedAt !== null).length;
  const completed = recs.filter((r) => r.completedAt !== null).length;
  const totalInterventions = followUp.successfulInterventions + followUp.repeatedFailures;

  const consistency = entries.length
    ? avg(entries.map((e) => Math.min(1, e.daysLogged / 7)))
    : null;

  // adherenceScore deltas across consecutive weeks (entries are newest-first).
  const deltas: number[] = [];
  for (let i = 0; i < entries.length - 1; i++) {
    const newer = entries[i].adherenceScore;
    const older = entries[i + 1].adherenceScore;
    if (newer !== null && older !== null) deltas.push(newer - older);
  }

  return {
    weeksTracked: entries.length,
    recommendationCompletionRate: rate(completed, generated),
    commitmentAcceptanceRate: rate(committed, generated),
    commitmentCompletionRate: rate(completed, committed),
    weeklyConsistency: consistency === null ? null : round2(consistency),
    improvementVelocity: deltas.length ? round2(avg(deltas)!) : null,
    interventionSuccessRate: rate(followUp.successfulInterventions, totalInterventions),
  };
}

// ── small utils ──

function priorityIndex(issue: string): number {
  const i = ISSUE_PRIORITY.indexOf(issue);
  return i === -1 ? ISSUE_PRIORITY.length : i;
}

function avg(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function rate(num: number, den: number): number | null {
  return den > 0 ? round2(num / den) : null;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
