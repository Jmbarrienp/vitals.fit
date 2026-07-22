import { CopilotSession } from '../types/copilot-contract';
import {
  DAILY_COPILOT_CONTRACT_NAME,
  DAILY_COPILOT_CONTRACT_VERSION,
  DailyAction,
  DailyCopilotSession,
  DailyMetric,
} from '../types/daily-copilot-contract';

/**
 * The Daily projection (V5.1) — PURE. Reshapes the V5.0 coordination session
 * into the seven sections a user needs today. It computes NOTHING: no score,
 * no adherence, no plan, no streak, no priority. The single focus was already
 * chosen by the runtime; the actions are already-owned strings; the metrics are
 * values other engines produced. This layer only SELECTS, ORDERS, DEDUPLICATES
 * and LABELS.
 *
 * Why the copy lives here and not on the screen: the screen must be pure
 * rendering, so it cannot be the place that decides what a trend "means". One
 * projection, one vocabulary, every client.
 */

/** The headline per focus area. Presentation copy — never a decision. */
const FOCUS_TITLE: Record<string, string> = {
  LOGGING: 'Retoma tu registro',
  COMMITMENT: 'Cumple tu compromiso',
  ISSUE: 'Resolvamos lo que se repite',
  ADJUSTMENT: 'Tu plan cambia hoy',
  MAINTAIN: 'Vas bien — mantén el ritmo',
};

/** Progress headline per trend. Presentation copy over an already-computed trend. */
const TREND_HEADLINE: Record<string, string> = {
  on_track: 'Vas en camino',
  stalled: 'El progreso se estancó',
  regressing: 'El progreso retrocedió',
  insufficient_data: 'Aún no hay datos suficientes para una tendencia',
};

export function projectDailySession(session: CopilotSession, generatedAt: string): DailyCopilotSession {
  return {
    meta: {
      contract: DAILY_COPILOT_CONTRACT_NAME,
      version: DAILY_COPILOT_CONTRACT_VERSION,
      generatedAt,
      source: { copilotSessionVersion: session.meta.version },
    },
    // 1 + 2 — the runtime already chose exactly one focus; this only titles it.
    focus: {
      area: session.currentFocus.area,
      title: FOCUS_TITLE[session.currentFocus.area] ?? 'Tu día',
      why: session.currentFocus.reason,
    },
    todaysPlan: { actions: buildActions(session) },
    meals: buildMeals(session),
    commitments: buildCommitments(session),
    progress: buildProgress(session),
    visionCta: buildVisionCta(session),
    confidence: session.confidence,
  };
}

/**
 * Concrete actions, priority first, deduplicated by normalized text. The
 * priority action is ALWAYS position 1 — the single focus never becomes two.
 * Supporting steps are added only when they are already-decided actions the
 * priority does not already cover.
 */
function buildActions(session: CopilotSession): DailyAction[] {
  const actions: DailyAction[] = [
    { text: session.nextAction.action, kind: 'PRIORITY', source: session.nextAction.source },
  ];
  const seen = new Set([normalize(session.nextAction.action)]);

  // A live pledge the priority didn't already voice.
  const commitment = session.activeCommitments[0];
  if (commitment && !seen.has(normalize(commitment.message))) {
    actions.push({ text: commitment.message, kind: 'COMMITMENT', source: 'COMMITMENTS' });
    seen.add(normalize(commitment.message));
  }

  // The logging affordance, when the runtime decided Vision should speak.
  const vision = session.visionSuggestions[0];
  if (vision && !seen.has(normalize(vision.text))) {
    actions.push({ text: vision.text, kind: 'LOG', source: vision.source });
    seen.add(normalize(vision.text));
  }

  return actions;
}

/**
 * Meals as the Meal Planner produced them. When the list is empty, the note
 * QUOTES the coordination audit — the reason the runtime already recorded for
 * silencing that module, rather than inventing an explanation here.
 */
function buildMeals(session: CopilotSession): DailyCopilotSession['meals'] {
  const items = session.mealSuggestions.map((m) => ({ name: m.text }));
  if (items.length > 0) return { items, note: null };
  const silencedReason = session.silenced.find((s) => s.module === 'MEAL_PLANNER')?.reason ?? null;
  return { items: [], note: silencedReason };
}

function buildCommitments(session: CopilotSession): DailyCopilotSession['commitments'] {
  const active = session.activeCommitments.map((c) => ({ message: c.message, expiresAt: c.expiresAt }));
  return {
    active,
    note: active.length === 0 ? 'No tienes compromisos activos ahora mismo.' : null,
  };
}

/**
 * Progress against the week. Every value was computed by the engine that owns
 * it (state rollup, ledger, review); this only formats and labels.
 */
function buildProgress(session: CopilotSession): DailyCopilotSession['progress'] {
  const p = session.recentProgress;
  const metrics: DailyMetric[] = [
    { label: 'Hoy', value: `${session.currentGoals.todayCalories} / ${session.currentGoals.calories} kcal` },
    { label: 'Proteína hoy', value: `${session.currentGoals.todayProteinG} / ${session.currentGoals.proteinG} g` },
    { label: 'Racha de registro', value: `${p.loggingStreakDays} día(s)` },
    { label: 'Adherencia 7d', value: p.adherence7d == null ? 'sin datos' : `${Math.round(p.adherence7d)}%` },
  ];
  if (p.lastWeek?.adherenceScore != null) {
    metrics.push({ label: 'Semana pasada', value: `${Math.round(p.lastWeek.adherenceScore)}/100` });
  }
  return { headline: TREND_HEADLINE[p.trend ?? 'insufficient_data'] ?? 'Tu progreso', metrics };
}

/** Only when the runtime decided Vision reduces friction right now. */
function buildVisionCta(session: CopilotSession): DailyCopilotSession['visionCta'] {
  const vision = session.visionSuggestions[0];
  return vision ? { text: vision.text, target: 'LOG' } : null;
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}
