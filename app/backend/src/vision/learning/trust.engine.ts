import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FoodCandidate, VisionScanProposal } from '../types/vision-contract';
import { TrustEvidenceReader } from './trust-evidence.reader';
import { EvaluationEngine } from './evaluation.engine';
import { computeTrust } from './pipeline/trust';
import { decideAutoAccept, DEFAULT_GRADUATION_MINIMUM, GRADUATION_MINIMUMS } from './pipeline/auto-accept';
import { calibrate, MIN_BIN_SAMPLES } from './pipeline/calibration';
import { AutoAcceptDecision, TrustEvidence } from './types/trust-contract';
import { CalibrationCurve } from './types/eval-contract';

/**
 * Subsystem 1 (V3.6) — the Runtime Trust Engine, the ONE seam that owns runtime
 * trust. It orchestrates; it decides nothing itself. Every judgment comes from
 * pure functions (`computeTrust`, `decideAutoAccept`, V3.5's `calibrate`), and
 * every input comes from a platform contract:
 *
 *   TrustEvidence      the user's own confirmations (TrustEvidenceReader)
 *   CalibrationCurve   what this provider's confidence has MEANT (V3.5)
 *   FoodCandidate      the proposal the pipeline already built
 *
 * No adapter computes confidence. No model contributes to the decision. The
 * provider produced a hypothesis; the user produced the ground truth; the
 * platform decides whether the hypothesis has earned the right to skip a
 * question.
 *
 * `AUTO_ACCEPT_ENABLED` (default FALSE) is the master switch, following the
 * discipline every Vision slice has used — production ships INERT. With it off
 * the engine still computes, persists and reports every decision (shadow mode),
 * so the policy is validated against real traffic before it is ever allowed to
 * act.
 */

/** How long a calibration curve is reused before rebuilding. Trust is per-scan; the curve is not. */
const CURVE_TTL_MS = 10 * 60 * 1000;
/** The curve is built from a provider's recent production traffic. */
const CURVE_WINDOW_DAYS = 90;

@Injectable()
export class TrustEngine {
  private readonly enabled: boolean;
  private curveCache = new Map<string, { curve: CalibrationCurve; at: number }>();

  constructor(
    private readonly evidence: TrustEvidenceReader,
    private readonly evaluation: EvaluationEngine,
    config: ConfigService,
  ) {
    this.enabled = config.get<string>('AUTO_ACCEPT_ENABLED', 'false') === 'true';
  }

  /**
   * The runtime decision for one proposal. Fails SOFT everywhere: any problem
   * computing trust yields "ask the user", which is exactly the pre-V3.6
   * behavior — trust can only ever REMOVE friction, never add or break.
   */
  async decide(userId: string, proposal: VisionScanProposal, providerId: string): Promise<AutoAcceptDecision> {
    const modality = modalityOf(proposal);
    const primary: FoodCandidate | undefined = proposal.candidates[0];
    const foodItemId = primary?.foodItemId ?? null;

    let evidence: TrustEvidence;
    let calibrated: number | null = null;
    try {
      evidence = await this.evidence.evidenceFor(userId, foodItemId, modality);
      const reported = primary?.confidence.overall ?? null;
      if (reported != null) calibrated = await this.calibrateFor(providerId, reported);
    } catch {
      evidence = emptyEvidence(userId, foodItemId, modality);
    }

    const trust = computeTrust(evidence, primary?.confidence.overall ?? null, calibrated, new Date());

    // A plate is only as trusted as its least-known food: every candidate must
    // independently clear the same bar before the platform acts on any of them.
    const allCandidatesGraduated = await this.allGraduated(userId, proposal, modality);

    return decideAutoAccept({
      trust,
      modality,
      calibratedConfidence: calibrated,
      fallbackReason: proposal.fallback.reason,
      candidateCount: proposal.candidates.length,
      allCandidatesGraduated,
      enabled: this.enabled,
    });
  }

  private async allGraduated(userId: string, proposal: VisionScanProposal, modality: string): Promise<boolean> {
    if (proposal.candidates.length === 0) return false;
    // An unmatched candidate has no stable trust key — it can never graduate.
    if (proposal.candidates.some((c) => !c.foodItemId)) return false;
    if (proposal.candidates.length === 1) return true;

    const minimum = graduationMinimum(modality);
    const others = proposal.candidates.slice(1);
    const evidences = await Promise.all(others.map((c) => this.evidence.evidenceFor(userId, c.foodItemId, modality)));
    return evidences.every((e) => e.confirmations >= minimum && e.undos === 0);
  }

  /** V3.5's calibration, reused verbatim — the curve interface every provider plugs into. */
  private async calibrateFor(providerId: string, reported: number): Promise<number | null> {
    const cached = this.curveCache.get(providerId);
    const fresh = cached && Date.now() - cached.at < CURVE_TTL_MS;
    let curve: CalibrationCurve;
    if (fresh) {
      curve = cached!.curve;
    } else {
      const report = await this.evaluation.calibration(providerId, { days: CURVE_WINDOW_DAYS });
      curve = report.curve;
      this.curveCache.set(providerId, { curve, at: Date.now() });
    }
    const calibrated = calibrate(reported, curve);
    // calibrate() falls through to the raw value when a bin lacks evidence; that
    // is NOT a calibrated number, and the policy must not treat it as one.
    return isCalibratedBy(curve, reported) ? calibrated : null;
  }
}

/**
 * A restaurant photo is its own modality: someone else's kitchen, someone
 * else's portions. Trust earned at home must not silently transfer to it.
 */
export function modalityOf(proposal: VisionScanProposal): string {
  if (proposal.source === 'PHOTO' && proposal.restaurant) return 'RESTAURANT';
  return proposal.source;
}

/** The thresholds live in the pure policy module; this is a readability alias. */
export function graduationMinimum(modality: string): number {
  return GRADUATION_MINIMUMS[modality] ?? DEFAULT_GRADUATION_MINIMUM;
}

/**
 * True only when the bin backing this confidence actually had evidence.
 * `calibrate()` deliberately falls through to the raw value on a sparse bin —
 * that pass-through is NOT a calibrated number, and letting the policy read it
 * as one would let an uncalibrated provider auto-accept.
 */
function isCalibratedBy(curve: CalibrationCurve, reported: number): boolean {
  const clamped = Math.max(0, Math.min(1, reported));
  const index = Math.min(curve.bins.length - 1, Math.floor(clamped * curve.bins.length));
  const bin = curve.bins[index];
  return !!bin && bin.empiricalAccuracy !== null && bin.n >= MIN_BIN_SAMPLES;
}

function emptyEvidence(userId: string, foodItemId: string | null, modality: string): TrustEvidence {
  return {
    userId,
    foodItemId,
    modality,
    confirmations: 0,
    corrections: 0,
    undos: 0,
    lastConfirmedAt: null,
    lastUndoAt: null,
    userTotalConfirmations: 0,
  };
}
