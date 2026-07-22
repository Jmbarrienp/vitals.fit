/**
 * Nutrition Copilot session contract (V5.0) — the versioned, model-agnostic
 * artifact the Copilot Runtime produces.
 *
 * What the Copilot is, and is not. It is NOT a chatbot and NOT a new brain: it
 * makes no nutrition decision, recalculates no metric, and reinterprets no
 * data. Every intelligent statement in a session was produced by the engine
 * that owns it — CoachingContext (state), the Adaptive Planner (strategy), the
 * Meal Planner (meals), the Recommendation Engine (nudges), the deterministic
 * Weekly Coach (narrative). The Copilot decides only COORDINATION: which
 * module speaks first, which has priority, which stays silent, and which
 * message would be redundant. Coordination decisions are recorded in
 * `silenced[]` so even the act of quieting a module is auditable.
 *
 * A session is a CONTRACT, not text. Mobile renders it; an LLM may narrate it
 * later; neither may contradict it.
 */

export const COPILOT_CONTRACT_NAME = 'vitals-fit.copilot-session';
export const COPILOT_CONTRACT_VERSION = 1;

/** The single thing the session leads with. Growable String vocabulary. */
export type CopilotFocusArea =
  | 'LOGGING' // the loop is broken: nothing to coordinate until data flows
  | 'COMMITMENT' // the user made a pledge that is live/expiring — honor it first
  | 'ISSUE' // the review/follow-up surfaced a persisting problem
  | 'ADJUSTMENT' // the planner decided a change this cycle
  | 'MAINTAIN'; // everything green — protect the streak

export type CopilotModuleId =
  | 'COACHING_CONTEXT'
  | 'WEEKLY_COACH'
  | 'PLANNER'
  | 'MEAL_PLANNER'
  | 'RECOMMENDATIONS'
  | 'COMMITMENTS'
  | 'REVIEW'
  | 'VISION';

/** A coordination decision to quiet a module — always with its reason. */
export interface SilencedModule {
  module: CopilotModuleId;
  reason: string;
}

export interface CopilotNextAction {
  source: CopilotModuleId; // which engine owns this action
  action: string; // the owning engine's own words, never rephrased here
  reason: string; // why the COORDINATOR picked this one (priority explanation)
}

export interface CopilotSuggestion {
  source: CopilotModuleId;
  text: string;
  code: string | null; // the owning engine's structured code, when it has one
}

export interface CopilotSession {
  meta: {
    contract: typeof COPILOT_CONTRACT_NAME;
    version: number;
    generatedAt: string; // ISO — an INPUT to the builder, so sessions are reproducible
    /** contract versions of every consumed engine — provenance, pinned */
    consumes: { coachingContext: number; planner: number; mealPlanner: number };
  };

  currentFocus: { area: CopilotFocusArea; reason: string };

  currentGoals: {
    goal: string; // CtxGoal, verbatim
    calories: number;
    proteinG: number;
    todayCalories: number;
    todayProteinG: number;
    mealsLoggedToday: number;
  };

  /** The Adaptive Planner's cycle decision, summarized by POINTING, not recomputing. */
  currentPlan: {
    posture: string;
    headlineCode: string;
    headlineExplanation: string; // planner's own words
    decisions: number;
    reviewWindowDays: number;
  };

  activeCommitments: { message: string; reason: string | null; expiresAt: string }[];

  /** Persisting issues from the follow-up engine, verbatim codes. */
  unresolvedIssues: { issue: string; weeksActive: number; intervention: string }[];

  recentProgress: {
    trend: string | null;
    adherence7d: number | null;
    loggingStreakDays: number;
    lastWeek: { adherenceScore: number | null; biggestImprovement: string | null } | null;
  };

  mealSuggestions: CopilotSuggestion[]; // from the Meal Planner's plan, verbatim
  visionSuggestions: CopilotSuggestion[]; // affordance pointers to Vision — never nutrition
  plannerRecommendations: CopilotSuggestion[]; // planner decision explanations, verbatim

  /** The deterministic Weekly Coach narrative (LLM rephrasing deliberately not consumed here). */
  coachSummary: { summary: string; diagnosis: string; source: string } | null;

  nextAction: CopilotNextAction;

  /** Questions the platform genuinely cannot answer from data — asked, not guessed. */
  pendingQuestions: string[];

  /** Label over how much evidence backs this session (weeks + days logged) — a count, not a probability. */
  confidence: 'ALTA' | 'MEDIA' | 'BAJA';

  /** Coordination audit: every module told to stay quiet, and why. */
  silenced: SilencedModule[];
}
