import { AutoAcceptDecision, TrustDecision, TrustSignal, TRUST_POLICY_VERSION } from '../types/trust-contract';

/**
 * Subsystem 2 (V3.6) — the Auto Acceptance Policy. PURE: given a trust decision
 * and the scan's own shape, decide what the user experiences — manual review,
 * review required, or auto-accept with an undo window.
 *
 * Modalities graduate differently because their EPISTEMICS differ — the same
 * distinction that has governed every slice since V3.1:
 *
 *   BARCODE     a decoded barcode IS the product. Identity is exact, not
 *               inferred, so it graduates earliest.
 *   LABEL_OCR   the macros were printed by the manufacturer and transcribed;
 *               the user already reviewed them once. Graduates early.
 *   PHOTO       identity and portion are INFERRED from appearance. Every
 *               gram is a hypothesis. Graduates on evidence.
 *   RESTAURANT  someone else's kitchen, someone else's portions, and a plate
 *               this user does not control. Graduates last.
 *
 * The policy never sees a model. It sees earned evidence and a calibrated
 * number, both produced by the platform from the user's own history.
 */

/** Confirmations required (per user, per food) before a modality may auto-accept. */
export const GRADUATION_MINIMUMS: Record<string, number> = {
  BARCODE: 2, // exact identity
  LABEL_OCR: 3, // printed, transcribed, already reviewed once
  PHOTO: 5, // inferred — the goal narrative's "fifth time"
  RESTAURANT: 8, // unfamiliar kitchen, uncontrolled portions
};
export const DEFAULT_GRADUATION_MINIMUM = 5;

/** The undo affordance stays prominent this long. Manual deletion remains available forever. */
export const UNDO_WINDOW_SECONDS = 900;
/** A provider number that historically means less than this may never auto-accept. */
export const MIN_CALIBRATED_CONFIDENCE = 0.7;

export interface AutoAcceptInput {
  trust: TrustDecision;
  /** BARCODE | LABEL_OCR | PHOTO | RESTAURANT — restaurant photos are their own modality */
  modality: string;
  /** null when the provider's calibration curve has no evidence in this band yet */
  calibratedConfidence: number | null;
  /** a degraded scan (provider failure, no detections) can never auto-accept */
  fallbackReason: string | null;
  candidateCount: number;
  /** every candidate must be independently graduated — a plate is only as trusted as its least-known food */
  allCandidatesGraduated: boolean;
  /** the master switch: false -> shadow mode (decide, persist, report; never act) */
  enabled: boolean;
}

export function decideAutoAccept(input: AutoAcceptInput): AutoAcceptDecision {
  const signals: TrustSignal[] = [...input.trust.signals, modalitySignal(input.modality)];
  const minimum = GRADUATION_MINIMUMS[input.modality] ?? DEFAULT_GRADUATION_MINIMUM;

  const deny = (action: AutoAcceptDecision['action'], reason: string): AutoAcceptDecision => ({
    policyVersion: TRUST_POLICY_VERSION,
    action,
    undoWindowSeconds: 0,
    reason,
    signals,
    trust: input.trust,
    executed: false,
  });

  // A degraded scan is never a trust question — it is a fallback question (V1 rule, unchanged).
  if (input.fallbackReason !== null || input.candidateCount === 0) {
    return deny('MANUAL_REVIEW', 'el escaneo se degradó — registro manual, como siempre');
  }
  if (input.trust.level === 'NONE') {
    return deny('REVIEW_REQUIRED', input.trust.reasons[0] ?? 'sin confianza acumulada todavía');
  }
  if (!input.allCandidatesGraduated) {
    return deny(
      'REVIEW_REQUIRED',
      'algún alimento del plato aún no está graduado — un plato vale lo que su alimento menos conocido',
    );
  }
  if (input.trust.evidence.confirmations < minimum) {
    return deny(
      'REVIEW_REQUIRED',
      `${input.trust.evidence.confirmations}/${minimum} confirmaciones para graduar por ${input.modality.toLowerCase()}`,
    );
  }
  if (input.trust.level !== 'HIGH') {
    return deny(
      'REVIEW_REQUIRED',
      `confianza ${input.trust.level} (${pct(input.trust.score)}) — aún no alcanza para aceptar solo`,
    );
  }
  if (input.calibratedConfidence == null) {
    return deny('REVIEW_REQUIRED', 'el proveedor aún no tiene curva de calibración con evidencia en esta banda');
  }
  if (input.calibratedConfidence < MIN_CALIBRATED_CONFIDENCE) {
    return deny(
      'REVIEW_REQUIRED',
      `la confianza reportada históricamente significa ${pct(input.calibratedConfidence)} — por debajo del mínimo ${pct(MIN_CALIBRATED_CONFIDENCE)}`,
    );
  }

  signals.push('REPEATED_CONFIRMATIONS');
  const reason = `${input.trust.evidence.confirmations} confirmaciones tuyas de este alimento por ${input.modality.toLowerCase()}, sin correcciones recientes, y una confianza calibrada de ${pct(input.calibratedConfidence)}`;

  // Shadow mode: the decision is real, persisted and reported — it just doesn't act.
  if (!input.enabled) {
    return {
      policyVersion: TRUST_POLICY_VERSION,
      action: 'AUTO_ACCEPT',
      undoWindowSeconds: 0,
      reason: `${reason} (modo sombra: se habría aceptado automáticamente)`,
      signals,
      trust: input.trust,
      executed: false,
    };
  }

  return {
    policyVersion: TRUST_POLICY_VERSION,
    action: 'AUTO_ACCEPT',
    undoWindowSeconds: UNDO_WINDOW_SECONDS,
    reason,
    signals,
    trust: input.trust,
    executed: true,
  };
}

function modalitySignal(modality: string): TrustSignal {
  switch (modality) {
    case 'BARCODE':
      return 'MODALITY_BARCODE';
    case 'LABEL_OCR':
      return 'MODALITY_OCR';
    case 'RESTAURANT':
      return 'MODALITY_RESTAURANT';
    default:
      return 'MODALITY_VISION';
  }
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}
