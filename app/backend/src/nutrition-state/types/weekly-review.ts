/**
 * Weekly Review + Behavior Follow-Up DTOs (Phase 2B.3). These are PURE PROJECTIONS
 * over the immutable Weekly Behavioral Ledger + the recommendation lifecycle. The
 * review is never persisted (the ledger is the single history) and never reads a
 * raw meal row. All narrative is structured codes, not free-form strings — the
 * mobile copy map turns codes into text.
 */

/** Ledger metrics the review compares week-over-week (all "higher is better"). */
export type ReviewMetric =
  | 'adherenceScore'
  | 'nutritionScore'
  | 'loggingStreak'
  | 'proteinStreakDays'
  | 'calorieStreakDays'
  | 'daysLogged';

export interface MetricDelta {
  metric: ReviewMetric;
  from: number | null;
  to: number | null;
  delta: number; // to - from (nulls treated as 0)
}

/** Why the follow-up engine chose a given next priority. */
export type FollowUpBasis =
  | 'PERSISTENT_INTERVENED' // issue remains despite a committed intervention -> try something different
  | 'PERSISTENT_IGNORED' // issue remains and the past recommendation was never acted on
  | 'NEW_ISSUE' // emerged this week
  | 'RESOLVED_NEXT' // last week's issue is gone -> acknowledge + next optimization
  | 'MAINTAIN'; // nothing pressing -> keep the habit

export interface NextPriority {
  reason: string; // RecommendationReason code
  basis: FollowUpBasis;
}

export interface CommitmentOutcome {
  reason: string | null; // RecommendationReason code of the committed recommendation
  status: 'COMPLETED' | 'EXPIRED';
  message: string; // the recommendation's stored text (not new copy)
}

export interface WeeklyReview {
  weekStart: string; // YYYY-MM-DD (Monday, UTC)
  isoYear: number;
  isoWeek: number;

  // Headline (straight from the ledger week).
  adherenceScore: number | null;
  nutritionScore: number | null;
  daysLogged: number;
  loggingStreak: number;

  // Week-over-week comparison (empty when there is no prior week).
  improved: MetricDelta[];
  worsened: MetricDelta[];
  stable: ReviewMetric[];

  // Structured narrative (ledger-sourced).
  biggestOpportunity: string | null; // primaryIssue (RecommendationReason code)
  biggestImprovement: string | null; // primaryImprovement (WeeklyImprovement code)

  commitments: {
    completed: number;
    expired: number;
    completionRate: number | null;
    outcomes: CommitmentOutcome[]; // which commitments succeeded / failed
  };

  nextPriority: NextPriority | null;
}

/** One issue tracked across the ledger timeline. */
export interface IssueFollowUp {
  issue: string; // RecommendationReason code
  weeksActive: number; // consecutive weeks the issue has been present
  status: 'RESOLVED' | 'PERSISTING' | 'NEW';
  intervention: 'INTERVENED' | 'IGNORED' | 'NONE'; // did a matching recommendation get committed?
}

export interface FollowUp {
  resolved: IssueFollowUp[]; // present last week, gone now
  persisting: IssueFollowUp[]; // present both weeks
  emerged: IssueFollowUp[]; // new this week
  successfulInterventions: number; // resolved AND intervened
  repeatedFailures: number; // persisting AND intervened (tried, still failing)
}

/** Product-intelligence instrumentation. NOT used to drive recommendations (yet). */
export interface RetentionMetrics {
  weeksTracked: number;
  recommendationCompletionRate: number | null; // completed commitments / generated recommendations
  commitmentAcceptanceRate: number | null; // committed / generated
  commitmentCompletionRate: number | null; // completed / committed
  weeklyConsistency: number | null; // avg (daysLogged / 7) across weeks, 0..1
  improvementVelocity: number | null; // avg week-over-week adherenceScore delta
  interventionSuccessRate: number | null; // successfulInterventions / total interventions
}

/** The full read-only payload behind GET /nutrition-state/weekly-review. */
export interface ReviewSnapshot {
  hasReview: boolean;
  current: WeeklyReview | null;
  previous: WeeklyReview | null;
  followUp: FollowUp;
  retention: RetentionMetrics;
  nextPriorities: NextPriority[];
}
