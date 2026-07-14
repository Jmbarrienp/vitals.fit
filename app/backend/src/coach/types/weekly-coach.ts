/**
 * Weekly Coach output contract (Phase 2C.1). The STRUCTURE is deterministic and
 * platform-owned: every coaching response has the same four sections, decided by
 * the backend from the CoachingContext. A model (Claude today, GPT/Gemini/local
 * tomorrow) only rephrases the prose — it never decides the structure, the
 * diagnosis, or the action. `meta.grounding` records the structured codes the
 * prose must stay true to, so any output is auditable against backend truth.
 */

export const COACH_OUTPUT_VERSION = 1;

export interface CoachGrounding {
  weekStart: string | null;
  primaryReason: string | null; // RecommendationReason code the coaching addresses
  nextPriorityBasis: string | null; // FollowUpBasis code
  biggestImprovement: string | null; // WeeklyImprovement code, if any
  contractVersion: number; // CoachingContext version the coaching was built from
}

export interface WeeklyCoachOutput {
  summary: string; // 1 sentence: what happened this week
  diagnosis: string; // 1-2 sentences: the main issue and why it matters
  nextAction: string; // 1 concrete, specific action
  optionalFollowUp: string | null; // acknowledgement of an improvement, or null

  meta: {
    source: 'deterministic' | 'claude'; // who phrased it (structure is always platform)
    outputVersion: number;
    promptVersion: number | null; // set only when a model produced the prose
    grounding: CoachGrounding;
  };
}

export interface WeeklyCoachResult {
  hasCoaching: boolean; // false until the user has a completed week to analyze
  output: WeeklyCoachOutput | null;
}
