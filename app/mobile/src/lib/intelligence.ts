/**
 * Centralized, deterministic mapping from backend intelligence enums to UI copy.
 * This is the ONLY place the client assigns meaning to a flag / status / reason.
 * It contains NO recomputation — it only labels and themes values the backend
 * already decided. Keep copy short and specific (no wellness fluff).
 */
import type { BehaviorFlag, FollowUpBasis, PlateauStatus, ReviewMetric } from '../types';

export interface Copy {
  label: string;
  detail: string;
  icon: string;
  color: string;
}

// ── Detected habits (behaviorFlags) ──
export const BEHAVIOR_FLAG_COPY: Record<BehaviorFlag, Copy> = {
  PROTEIN_CHRONIC_LOW: {
    label: 'Proteína baja',
    detail: 'Vienes varios días por debajo de tu meta de proteína.',
    icon: '🥩',
    color: '#f59e0b',
  },
  LOW_LOGGING_CONSISTENCY: {
    label: 'Registro irregular',
    detail: 'Registraste pocos días esta semana.',
    icon: '📋',
    color: '#64748b',
  },
  WEEKEND_OVEREATING: {
    label: 'Descontrol de finde',
    detail: 'Tus fines de semana suman bastante más que entre semana.',
    icon: '📅',
    color: '#f59e0b',
  },
  BREAKFAST_SKIPPED: {
    label: 'Saltas el desayuno',
    detail: 'Casi nunca registras desayuno.',
    icon: '🌅',
    color: '#6366f1',
  },
};

// ── Plateau status ──
export const PLATEAU_COPY: Record<PlateauStatus, Copy | null> = {
  PLATEAU_SUSPECTED: {
    label: 'Posible plateau',
    detail: 'Tu peso lleva días plano pese a buena adherencia.',
    icon: '⛰️',
    color: '#f59e0b',
  },
  // No chip when there's nothing to flag.
  NONE: null,
  INSUFFICIENT_DATA: null,
};

// ── Goal-aware trend status (from the rollup, not the raw weight trend) ──
export const TREND_COPY: Record<string, Copy> = {
  on_track: { label: 'En camino', detail: 'Vas en la dirección de tu objetivo.', icon: '🟢', color: '#22c55e' },
  stalled: { label: 'Estancado', detail: 'Tu peso no se está moviendo hacia tu meta.', icon: '🟡', color: '#f59e0b' },
  regressing: { label: 'Retrocediendo', detail: 'Vas en dirección contraria a tu meta.', icon: '🔴', color: '#ef4444' },
  insufficient_data: { label: 'Pocos datos', detail: 'Registra más peso para ver tu tendencia.', icon: '⏳', color: '#64748b' },
};

export function trendCopy(status: string | null): Copy {
  return (status && TREND_COPY[status]) || TREND_COPY.insufficient_data;
}

// ── Recommendation reason → short "why" copy ──
const REASON_COPY: Record<string, string> = {
  PLATEAU_SUSPECTED: 'Peso estancado con buena adherencia',
  LOSING_TOO_FAST: 'Estás bajando muy rápido',
  GAIN_STALLED: 'Tu ganancia se detuvo',
  PROTEIN_CHRONIC_LOW: 'Proteína bajo tu meta varios días',
  WEEKEND_DRIFT: 'Tus fines de semana se descontrolan',
  BREAKFAST_SKIPPED: 'Vienes saltando el desayuno',
  LOW_LOGGING_CONSISTENCY: 'Registraste pocos días',
  LOW_ADHERENCE_WEEK: 'Semana de baja adherencia',
  NO_MEALS_LOGGED: 'Aún no registras comidas hoy',
  OVER_TARGET: 'Te pasaste de tu meta calórica',
  TARGET_REACHED: 'Llegaste a tu meta de hoy',
  PROTEIN_GAP_TODAY: 'Te falta proteína para hoy',
  CALORIES_REMAINING: 'Te quedan calorías por completar',
  STREAK_MILESTONE: 'Racha de constancia',
  TREND_ON_TRACK: 'Vas en la dirección correcta',
  STEADY: 'Vas bien',
};

export function reasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return REASON_COPY[reason] ?? null;
}

// ── Score → band (theming only; the score itself is computed on the backend) ──
export function scoreBand(score: number | null): { label: string; color: string } {
  if (score === null) return { label: 'Sin datos', color: '#64748b' };
  if (score >= 80) return { label: 'Excelente', color: '#22c55e' };
  if (score >= 60) return { label: 'Bien', color: '#6366f1' };
  if (score >= 40) return { label: 'Mejorable', color: '#f59e0b' };
  return { label: 'Bajo', color: '#ef4444' };
}

// ── Weekly Review (2B.3) copy. Codes decided by the backend engine; text lives here. ──
const METRIC_COPY: Record<ReviewMetric, string> = {
  adherenceScore: 'Adherencia',
  nutritionScore: 'Nutrición',
  loggingStreak: 'Racha de registro',
  proteinStreakDays: 'Racha de proteína',
  calorieStreakDays: 'Racha de calorías',
  daysLogged: 'Días registrados',
};

export function metricLabel(metric: ReviewMetric): string {
  return METRIC_COPY[metric] ?? metric;
}

// primaryImprovement (WeeklyImprovement) → short "what got better" copy.
const IMPROVEMENT_COPY: Record<string, string> = {
  ADHERENCE_IMPROVED: 'Mejoró tu adherencia',
  NUTRITION_IMPROVED: 'Mejoró tu nutrición',
  LOGGING_STREAK_IMPROVED: 'Creció tu racha de registro',
  PROTEIN_STREAK_IMPROVED: 'Creció tu racha de proteína',
  WEIGHT_TREND_IMPROVED: 'Mejoró tu tendencia de peso',
};

export function improvementLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return IMPROVEMENT_COPY[code] ?? null;
}

// How the follow-up engine framed the next priority — sets the tone of the callout.
const BASIS_COPY: Record<FollowUpBasis, { label: string; color: string }> = {
  PERSISTENT_INTERVENED: { label: 'Sigue pendiente pese a tu esfuerzo — probemos otro enfoque', color: '#ef4444' },
  PERSISTENT_IGNORED: { label: 'Esto sigue sin resolverse', color: '#f59e0b' },
  NEW_ISSUE: { label: 'Algo nuevo apareció esta semana', color: '#f59e0b' },
  RESOLVED_NEXT: { label: 'Lo resolviste — mantén el rumbo', color: '#22c55e' },
  MAINTAIN: { label: 'Vas bien — mantén el hábito', color: '#22c55e' },
};

export function basisCopy(basis: FollowUpBasis): { label: string; color: string } {
  return BASIS_COPY[basis] ?? { label: 'Enfócate en tu siguiente meta', color: '#6366f1' };
}
