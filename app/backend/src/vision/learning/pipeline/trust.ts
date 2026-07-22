import { TrustDecision, TrustEvidence, TrustLevel, TrustSignal, TRUST_POLICY_VERSION } from '../types/trust-contract';

/**
 * Subsystem 1 (V3.6) — the Runtime Trust Engine's PURE core. Given what the
 * USER has historically done with this (food, modality) and what the provider's
 * confidence has historically MEANT (V3.5 calibration), decide how much the
 * platform trusts itself here. Same evidence in -> same decision out; no I/O,
 * no clock of its own (`now` is injected), no randomness, no model.
 *
 * Trust policy, in one place:
 *   · CUMULATIVE — every clean confirmation adds evidence.
 *   · EARNED, NEVER GRANTED — a new user and an unknown food start at zero.
 *   · DECAYING — evidence has a half-life; trust earned last spring is not
 *     trust today, because portions and habits drift.
 *   · ASYMMETRIC — a correction costs more than a confirmation earns, and an
 *     UNDO is catastrophic: the platform acted, and the user said no.
 *   · IMMEDIATE — a recent undo drops trust to NONE at once, regardless of how
 *     much history preceded it. No amount of past success buys the right to
 *     repeat a mistake the user just rejected.
 */

/**
 * Two gates, two distinct questions — deliberately NOT redundant:
 *   · the trust SCORE (here) answers "is this record CLEAN and CURRENT?"
 *   · GRADUATION_MINIMUMS (auto-accept.ts) answers "is there ENOUGH of it?",
 *     and only that gate knows about modalities.
 * Collapsing both into one evidence count would make barcode (2 confirmations)
 * unable to reach HIGH while demanding the same count as vision — the modality
 * differentiation the policy exists to express would silently die.
 */
export const TRUST_EVIDENCE_K = 1;
/** Evidence half-life. Trust is a claim about the present, not a trophy. */
export const TRUST_HALF_LIFE_DAYS = 45;
/** A correction costs two confirmations: being close but wrong is still wrong. */
export const CORRECTION_PENALTY = 2;
/** An undo costs five: the platform acted without asking and was rejected. */
export const UNDO_PENALTY = 5;
/** After an undo, this (user, food) cannot auto-accept for this long. Trust must be re-earned. */
export const UNDO_COOLDOWN_DAYS = 14;
/** Below this many total confirmations anywhere, the user is new to the platform. */
export const NEW_USER_CONFIRMATIONS = 3;

/** 0.65 lets a clean 2-confirmation barcode record reach HIGH while a single sighting (0.5) cannot. */
const HIGH_THRESHOLD = 0.65;
const MEDIUM_THRESHOLD = 0.4;
const LOW_THRESHOLD = 0.15;
/** Reported-confidence bands, aligned with the V0 confidence policy. */
const REPORTED_HIGH = 0.75;
/** A calibrated confidence below this means the provider's number over-promises here. */
const CALIBRATED_HIGH = 0.7;

export function computeTrust(
  evidence: TrustEvidence,
  reportedConfidence: number | null,
  calibratedConfidence: number | null,
  now: Date,
): TrustDecision {
  const signals: TrustSignal[] = [];
  const reasons: string[] = [];

  const daysSinceLastConfirmation = daysBetween(evidence.lastConfirmedAt, now);
  const daysSinceUndo = daysBetween(evidence.lastUndoAt, now);

  // ── Evidence classification ────────────────────────────────────────────────
  if (evidence.userTotalConfirmations < NEW_USER_CONFIRMATIONS) {
    signals.push('NEW_USER');
    reasons.push(
      `usuario nuevo: ${evidence.userTotalConfirmations} confirmaciones en total (mínimo ${NEW_USER_CONFIRMATIONS})`,
    );
  } else {
    signals.push('KNOWN_USER');
  }

  if (evidence.confirmations === 0) {
    signals.push('UNKNOWN_FOOD');
    reasons.push('nunca has confirmado este alimento por esta vía');
  } else {
    signals.push('KNOWN_FOOD');
    reasons.push(`${evidence.confirmations} confirmación(es) previa(s) de este alimento`);
  }

  if (evidence.corrections > 0) {
    signals.push('RECENT_CORRECTIONS');
    reasons.push(`${evidence.corrections} corrección(es) previa(s) — la plataforma acertó a medias`);
  }

  // ── Confidence, reported vs what it has historically MEANT ─────────────────
  if (reportedConfidence != null) {
    if (reportedConfidence >= REPORTED_HIGH) signals.push('HIGH_CONFIDENCE');
    else signals.push('LOW_CONFIDENCE');
  }
  if (calibratedConfidence != null) {
    if (calibratedConfidence >= CALIBRATED_HIGH) {
      signals.push('CALIBRATED_HIGH');
    } else {
      signals.push('CALIBRATED_LOW');
      reasons.push(
        `la confianza reportada (${fmt(reportedConfidence)}) históricamente significa ${fmt(calibratedConfidence)}`,
      );
    }
  }

  // ── Catastrophic override: a recent undo zeroes trust immediately ──────────
  if (daysSinceUndo != null && daysSinceUndo < UNDO_COOLDOWN_DAYS) {
    signals.push('RECENT_UNDO');
    // FIRST, not appended: reasons[0] is what the user is shown, and the
    // decisive reason must be the one they read. Telling someone "you have 5
    // previous confirmations" when the real answer is "you undid this two days
    // ago" would be technically true and actively misleading.
    reasons.unshift(
      `deshiciste un registro automático hace ${daysSinceUndo} día(s) — la confianza se reconstruye desde cero (${UNDO_COOLDOWN_DAYS} días)`,
    );
    return decision('NONE', 0, signals, reasons, evidence, daysSinceLastConfirmation, calibratedConfidence);
  }

  // ── Score = evidence × cleanliness × recency ───────────────────────────────
  // Each factor answers one question and can independently veto:
  //   evidence    have we seen this at all? (one sighting is not a pattern)
  //   cleanliness when we acted before, were we right? (a correction costs 2
  //               confirmations, an undo costs 5 — asymmetric on purpose)
  //   recency     is that still true today? (45-day half-life)
  if (evidence.confirmations === 0) {
    return decision('NONE', 0, signals, reasons, evidence, daysSinceLastConfirmation, calibratedConfidence);
  }

  const penalty = CORRECTION_PENALTY * evidence.corrections + UNDO_PENALTY * evidence.undos;
  const cleanliness = evidence.confirmations / (evidence.confirmations + penalty);
  const evidenceFactor = evidence.confirmations / (evidence.confirmations + TRUST_EVIDENCE_K);
  const decay = decayFactor(daysSinceLastConfirmation);
  if (penalty > 0) {
    reasons.push(
      `historial no impecable: ${pct(cleanliness)} de tus registros de este alimento quedaron como los propusimos`,
    );
  }
  const base = evidenceFactor * cleanliness;
  if (decay < 0.75) {
    signals.push('TRUST_DECAYED');
    reasons.push(
      `última confirmación hace ${daysSinceLastConfirmation} día(s) — la evidencia perdió peso (vida media ${TRUST_HALF_LIFE_DAYS}d)`,
    );
  }
  const score = round4(base * decay);

  return decision(levelFor(score), score, signals, reasons, evidence, daysSinceLastConfirmation, calibratedConfidence);
}

/** Exponential decay with a half-life — no history at all means no decay to apply (score is already 0). */
export function decayFactor(daysSinceLastConfirmation: number | null): number {
  if (daysSinceLastConfirmation == null) return 1;
  return Math.pow(0.5, daysSinceLastConfirmation / TRUST_HALF_LIFE_DAYS);
}

export function levelFor(score: number): TrustLevel {
  if (score >= HIGH_THRESHOLD) return 'HIGH';
  if (score >= MEDIUM_THRESHOLD) return 'MEDIUM';
  if (score >= LOW_THRESHOLD) return 'LOW';
  return 'NONE';
}

function decision(
  level: TrustLevel,
  score: number,
  signals: TrustSignal[],
  reasons: string[],
  evidence: TrustEvidence,
  daysSinceLastConfirmation: number | null,
  calibratedConfidence: number | null,
): TrustDecision {
  return {
    policyVersion: TRUST_POLICY_VERSION,
    level,
    score,
    signals,
    reasons,
    evidence: {
      confirmations: evidence.confirmations,
      corrections: evidence.corrections,
      undos: evidence.undos,
      daysSinceLastConfirmation,
      userTotalConfirmations: evidence.userTotalConfirmations,
    },
    calibratedConfidence,
  };
}

/** Whole days, floored, never negative — a clock skew must not manufacture trust. */
export function daysBetween(from: Date | null, now: Date): number | null {
  if (!from) return null;
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / 86_400_000));
}

function fmt(x: number | null): string {
  return x == null ? 'n/d' : `${Math.round(x * 100)}%`;
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
