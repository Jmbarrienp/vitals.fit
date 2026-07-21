import { CalibrationReport, ProviderComparison, ProviderScorecard } from '../../learning/types/eval-contract';
import { MIN_BIN_SAMPLES } from '../../learning/pipeline/calibration';
import { MIN_EXAMPLES_PER_PROVIDER, MIN_SCANS_PER_PROVIDER } from '../../learning/pipeline/promotion';
import { isHealthGreen } from './health';
import { GatesReport, HealthReport, ROLLOUT_CONTRACT_VERSION, RolloutGate } from '../types/rollout-contract';

/**
 * Formal deployment gates (V4.0) — PURE, and never a bare boolean: a verdict
 * that cannot explain itself is not a verdict. Every threshold is either an
 * exported constant here or REUSED from the module that owns it (promotion
 * minimums, calibration bin evidence, the single health-green definition) —
 * no heuristic hides in a controller, and no owner's number is duplicated.
 */

export const GATE_MIN_SHADOW_DECISIONS = 25;
export const GATE_MIN_SHADOW_WOULD_ACCEPT = 5;
export const GATE_MAX_FALSE_POSITIVES = 10;
export const GATE_MIN_PROVIDER_TOP1 = 0.6;
export const GATE_MIN_PROVIDER_AVAILABILITY = 0.95;

export interface GateInputs {
  health: HealthReport;
  shadowDecisions: number;
  shadowWouldAccept: number;
  autoAcceptEnabled: boolean;
  scorecard: ProviderScorecard; // the ACTIVE provider's
  calibration: CalibrationReport; // the ACTIVE provider's
  comparison: ProviderComparison | null; // null when no challenger has data
}

export function buildGates(inputs: GateInputs, window: { from: Date; to: Date }): GatesReport {
  return {
    contractVersion: ROLLOUT_CONTRACT_VERSION,
    window,
    gates: [
      autoAcceptReady(inputs),
      providerReady(inputs.scorecard, inputs.calibration),
      rollbackRequired(inputs),
      ...promotionGates(inputs.comparison),
    ],
  };
}

function autoAcceptReady(i: GateInputs): RolloutGate {
  const reasons: string[] = [];
  const health = isHealthGreen(i.health);
  const usableBins = i.calibration.curve.bins.filter((b) => b.n >= MIN_BIN_SAMPLES).length;

  if (i.shadowDecisions < GATE_MIN_SHADOW_DECISIONS) {
    reasons.push(`decisiones en sombra insuficientes: ${i.shadowDecisions}/${GATE_MIN_SHADOW_DECISIONS}`);
  }
  if (i.shadowWouldAccept < GATE_MIN_SHADOW_WOULD_ACCEPT) {
    reasons.push(`auto-aceptaciones potenciales insuficientes: ${i.shadowWouldAccept}/${GATE_MIN_SHADOW_WOULD_ACCEPT}`);
  }
  if (usableBins === 0) {
    reasons.push('el proveedor activo no tiene NINGÚN bin de calibración con evidencia — auto-accept no puede graduar a nadie');
  }
  if (!health.green) reasons.push(...health.reasons.map((r) => `salud: ${r}`));

  return gate('AUTO_ACCEPT_READY', reasons.length === 0 ? 'PASS' : 'FAIL',
    reasons.length === 0
      ? [`${i.shadowDecisions} decisiones en sombra, ${i.shadowWouldAccept} habrían aceptado, ${usableBins} bins calibrados, salud en verde`]
      : reasons,
    {
      shadowDecisions: i.shadowDecisions,
      shadowWouldAccept: i.shadowWouldAccept,
      usableCalibrationBins: usableBins,
      healthGreen: health.green,
      alreadyEnabled: i.autoAcceptEnabled,
    });
}

function providerReady(card: ProviderScorecard, calibration: CalibrationReport): RolloutGate {
  const reasons: string[] = [];
  if (card.sampleSizes.scans < MIN_SCANS_PER_PROVIDER || card.sampleSizes.examples < MIN_EXAMPLES_PER_PROVIDER) {
    reasons.push(
      `muestra insuficiente: ${card.sampleSizes.scans}/${MIN_SCANS_PER_PROVIDER} scans, ${card.sampleSizes.examples}/${MIN_EXAMPLES_PER_PROVIDER} ejemplos (mínimos de la política de promoción, reutilizados)`,
    );
  }
  if (card.top1Accuracy != null && card.top1Accuracy < GATE_MIN_PROVIDER_TOP1) {
    reasons.push(`top-1 ${pct(card.top1Accuracy)} < ${pct(GATE_MIN_PROVIDER_TOP1)}`);
  }
  if (card.providerAvailability != null && card.providerAvailability < GATE_MIN_PROVIDER_AVAILABILITY) {
    reasons.push(`disponibilidad ${pct(card.providerAvailability)} < ${pct(GATE_MIN_PROVIDER_AVAILABILITY)}`);
  }
  return gate('PROVIDER_READY', reasons.length === 0 ? 'PASS' : 'FAIL',
    reasons.length === 0
      ? [`'${card.providerId}': muestra suficiente, top-1 ${pct(card.top1Accuracy)}, disponibilidad ${pct(card.providerAvailability)}`]
      : reasons,
    {
      providerId: card.providerId,
      scans: card.sampleSizes.scans,
      examples: card.sampleSizes.examples,
      top1Accuracy: card.top1Accuracy,
      availability: card.providerAvailability,
      ece: calibration.expectedCalibrationError,
    });
}

function rollbackRequired(i: GateInputs): RolloutGate {
  if (!i.autoAcceptEnabled) {
    return gate('ROLLBACK_REQUIRED', 'NOT_APPLICABLE', ['auto-accept no está habilitado — no hay nada que revertir'], {
      autoAcceptEnabled: false,
    });
  }
  const reasons: string[] = [];
  const health = isHealthGreen(i.health);
  if (!health.green) reasons.push(...health.reasons);
  if (i.health.falsePositives > GATE_MAX_FALSE_POSITIVES) {
    reasons.push(`${i.health.falsePositives} falsos positivos > ${GATE_MAX_FALSE_POSITIVES} — la plataforma está actuando mal demasiadas veces`);
  }
  return gate('ROLLBACK_REQUIRED', reasons.length > 0 ? 'FAIL' : 'PASS',
    reasons.length > 0
      ? reasons.map((r) => `REVERTIR: ${r}`)
      : ['salud en verde y falsos positivos bajo control — no se requiere rollback'],
    { falsePositives: i.health.falsePositives, undoRate: i.health.undoRate, healthGreen: health.green });
}

/**
 * PROMOTION_ALLOWED / PROMOTION_BLOCKED quote the Promotion owner's verdict
 * VERBATIM. This gate adds zero statistics of its own — two subsystems must
 * never disagree about who should be promoted.
 */
function promotionGates(comparison: ProviderComparison | null): RolloutGate[] {
  if (!comparison) {
    return [
      gate('PROMOTION_ALLOWED', 'NOT_APPLICABLE', ['no hay challenger con datos en esta ventana'], {}),
      gate('PROMOTION_BLOCKED', 'NOT_APPLICABLE', ['no hay challenger con datos en esta ventana'], {}),
    ];
  }
  const allowed = comparison.decision.verdict === 'PROMOTE_CHALLENGER';
  const evidence = {
    incumbent: comparison.incumbent.providerId,
    challenger: comparison.challenger.providerId,
    verdict: comparison.decision.verdict,
    zScoreTop1: comparison.decision.zScoreTop1,
  };
  return [
    gate('PROMOTION_ALLOWED', allowed ? 'PASS' : 'FAIL', comparison.decision.reasons, evidence),
    gate('PROMOTION_BLOCKED', allowed ? 'FAIL' : 'PASS', comparison.decision.reasons, evidence),
  ];
}

function gate(id: string, status: RolloutGate['status'], reasons: string[], evidence: RolloutGate['evidence']): RolloutGate {
  return { id, status, reasons, evidence };
}

function pct(x: number | null): string {
  return x == null ? 'n/d' : `${(x * 100).toFixed(1)}%`;
}
