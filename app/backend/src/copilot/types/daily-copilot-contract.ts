/**
 * Daily Copilot session contract (V5.1) — the USER-FACING projection of the
 * V5.0 coordination artifact.
 *
 * Two contracts, two audiences, one truth. `CopilotSession` (V5.0) is the
 * COORDINATION artifact: rich, auditable, carrying provenance and the
 * `silenced[]` record of which module was told to stay quiet. This contract is
 * the DAILY artifact: exactly what one user needs today, in the order they
 * need it, with the copy already written. It is a pure projection of the
 * former — it recomputes no score, no adherence, no plan, no streak. Every
 * number here was produced by the engine that owns it; every priority decision
 * was made by the V5.0 runtime.
 *
 * The copy lives HERE, on the backend, on purpose: the screen must be pure
 * rendering with zero logic, so it cannot be the place that decides what a
 * trend "means" in Spanish. One projection, one vocabulary, every client.
 *
 * Model-agnostic like everything above it: this contract knows CoachingContext
 * (transitively) and nothing about any vendor.
 */

export const DAILY_COPILOT_CONTRACT_NAME = 'vitals-fit.daily-copilot';
export const DAILY_COPILOT_CONTRACT_VERSION = 1;

/** Where a concrete action came from, so the UI can route the tap correctly. */
export type DailyActionKind = 'PRIORITY' | 'COMMITMENT' | 'LOG';

export interface DailyAction {
  text: string; // the owning engine's own words — never rephrased here
  kind: DailyActionKind;
  source: string; // CopilotModuleId, verbatim
}

export interface DailyMetric {
  label: string;
  value: string; // pre-formatted — the screen prints it, it does not compute it
}

/**
 * Everything the user needs today. Seven sections, no more: a single focus,
 * why it is the focus, what to do, what to eat, what they pledged, how the
 * week is going, and — only when it lowers friction — a way to log faster.
 */
export interface DailyCopilotSession {
  meta: {
    contract: typeof DAILY_COPILOT_CONTRACT_NAME;
    version: number;
    generatedAt: string; // ISO — an INPUT, so the projection is reproducible
    /** the coordination contract this projects, pinned */
    source: { copilotSessionVersion: number };
  };

  /** 1 + 2 — EXACTLY ONE priority, and the evidence behind it. Never two. */
  focus: {
    area: string; // CopilotFocusArea, verbatim
    title: string; // the headline the user reads
    why: string; // the runtime's own evidence-based reason, verbatim
  };

  /** 3 — concrete actions, priority first, deduplicated. */
  todaysPlan: { actions: DailyAction[] };

  /** 4 — from the Meal Planner. `note` explains an empty list (quoted from the coordination audit). */
  meals: { items: { name: string }[]; note: string | null };

  /** 5 — live pledges and their status. */
  commitments: { active: { message: string; expiresAt: string }[]; note: string | null };

  /** 6 — progress against the week. Pre-formatted; nothing recomputed. */
  progress: { headline: string; metrics: DailyMetric[] };

  /** 7 — shown ONLY when it reduces friction; null otherwise. */
  visionCta: { text: string; target: string } | null;

  /** Evidence label inherited from the coordination session. */
  confidence: string;
}
