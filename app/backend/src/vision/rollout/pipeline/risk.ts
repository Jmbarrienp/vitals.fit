import { ProviderScorecard } from '../../learning/types/eval-contract';
import { HEALTH_MAX_ECE } from './health';
import {
  GatesReport,
  HealthReport,
  RiskAssessment,
  RiskDimension,
  RiskLevel,
  ROLLOUT_CONTRACT_VERSION,
} from '../types/rollout-contract';

/**
 * Deployment risk (V4.0) — PURE, five dimensions, every claim with its number.
 * No heuristic hides in a controller: the thresholds are named constants here,
 * the inputs are the reports the metric owners already produced, and the same
 * inputs always yield the same assessment. Overall risk is the MAX of the
 * dimensions — pessimistic by design, because averaging risks is how surprises
 * happen.
 */

export const RISK_HIGH_FAILURE_RATE = 0.15;
export const RISK_MED_FAILURE_RATE = 0.05;
export const RISK_HIGH_LATENCY_MS = 20_000;
export const RISK_MED_LATENCY_MS = 8_000;
export const RISK_HIGH_UNDO_RATE = 0.2;
export const RISK_MED_UNDO_RATE = 0.1;
export const RISK_MED_FALLBACK_RATE = 0.4;
export const RISK_MED_DRIFT = 0.1;
export const RISK_LOW_TOP1 = 0.6;
export const RISK_MIN_SCANS = 50;

export function assessRisk(
  health: HealthReport,
  gates: GatesReport,
  scorecard: ProviderScorecard,
  posture: { autoAcceptEnabled: boolean; activeProviderId: string },
  window: { from: Date; to: Date },
): RiskAssessment {
  const dimensions: RiskDimension[] = [
    technical(health),
    user(health),
    business(health, scorecard),
    model(health, scorecard),
    operational(health, gates, scorecard, posture),
  ];
  return {
    contractVersion: ROLLOUT_CONTRACT_VERSION,
    window,
    overall: dimensions.reduce<RiskLevel>((acc, d) => worst(acc, d.level), 'LOW'),
    dimensions,
  };
}

function technical(h: HealthReport): RiskDimension {
  const e: string[] = [];
  let level: RiskLevel = 'LOW';
  if (h.providerFailureRate != null && h.providerFailureRate > RISK_HIGH_FAILURE_RATE) {
    level = 'HIGH';
    e.push(`fallos de proveedor ${pct(h.providerFailureRate)} > ${pct(RISK_HIGH_FAILURE_RATE)}`);
  } else if (h.providerFailureRate != null && h.providerFailureRate > RISK_MED_FAILURE_RATE) {
    level = 'MEDIUM';
    e.push(`fallos de proveedor ${pct(h.providerFailureRate)} > ${pct(RISK_MED_FAILURE_RATE)}`);
  }
  if (h.meanLatencyMs != null && h.meanLatencyMs > RISK_HIGH_LATENCY_MS) {
    level = 'HIGH';
    e.push(`latencia media ${Math.round(h.meanLatencyMs)}ms > ${RISK_HIGH_LATENCY_MS}ms`);
  } else if (h.meanLatencyMs != null && h.meanLatencyMs > RISK_MED_LATENCY_MS) {
    level = worst(level, 'MEDIUM');
    e.push(`latencia media ${Math.round(h.meanLatencyMs)}ms > ${RISK_MED_LATENCY_MS}ms`);
  }
  if (e.length === 0)
    e.push(
      `fallos ${pct(h.providerFailureRate)} y latencia ${h.meanLatencyMs == null ? 'n/d' : Math.round(h.meanLatencyMs) + 'ms'} dentro de umbrales`,
    );
  return { dimension: 'TECHNICAL', level, evidence: e };
}

function user(h: HealthReport): RiskDimension {
  const e: string[] = [];
  let level: RiskLevel = 'LOW';
  if (h.undoRate != null && h.undoRate > RISK_HIGH_UNDO_RATE) {
    level = 'HIGH';
    e.push(
      `tasa de undo ${pct(h.undoRate)} > ${pct(RISK_HIGH_UNDO_RATE)} — los usuarios están revirtiendo a la plataforma`,
    );
  } else if (h.undoRate != null && h.undoRate > RISK_MED_UNDO_RATE) {
    level = 'MEDIUM';
    e.push(`tasa de undo ${pct(h.undoRate)} > ${pct(RISK_MED_UNDO_RATE)}`);
  }
  if (h.falsePositives > 0) {
    level = worst(level, h.falsePositives > 5 ? 'HIGH' : 'MEDIUM');
    e.push(`${h.falsePositives} auto-aceptaciones deshechas (falsos positivos)`);
  }
  if (e.length === 0)
    e.push(`undo ${pct(h.undoRate)} y ${h.falsePositives} falsos positivos — sin señales de desconfianza`);
  return { dimension: 'USER', level, evidence: e };
}

function business(h: HealthReport, card: ProviderScorecard): RiskDimension {
  const e: string[] = [];
  let level: RiskLevel = 'LOW';
  if (h.manualFallbackRate != null && h.manualFallbackRate > RISK_MED_FALLBACK_RATE) {
    level = 'MEDIUM';
    e.push(
      `fallback manual ${pct(h.manualFallbackRate)} > ${pct(RISK_MED_FALLBACK_RATE)} — el valor de Vision no está llegando`,
    );
  }
  if (h.acceptanceRate != null && h.acceptanceRate < 0.5) {
    level = worst(level, 'MEDIUM');
    e.push(`aceptación ${pct(h.acceptanceRate)} < 50% — la mitad de las propuestas no termina en registro`);
  }
  if (card.meanTokensPerScan != null && h.falseNegatives > 10) {
    level = worst(level, 'MEDIUM');
    e.push(
      `${h.falseNegatives} falsos negativos — fricción pagada (${Math.round(card.meanTokensPerScan)} tokens/scan) sin necesidad`,
    );
  }
  if (e.length === 0)
    e.push(`aceptación ${pct(h.acceptanceRate)}, fallback ${pct(h.manualFallbackRate)} — el flujo aporta valor`);
  return { dimension: 'BUSINESS', level, evidence: e };
}

function model(h: HealthReport, card: ProviderScorecard): RiskDimension {
  const e: string[] = [];
  let level: RiskLevel = 'LOW';
  if (h.calibration.currentEce != null && h.calibration.currentEce > HEALTH_MAX_ECE) {
    level = 'HIGH';
    e.push(`ECE ${h.calibration.currentEce} > ${HEALTH_MAX_ECE} — la confianza del modelo no es honesta`);
  }
  if (h.calibration.drift != null && h.calibration.drift > RISK_MED_DRIFT) {
    level = worst(level, 'MEDIUM');
    e.push(`deriva de calibración ${h.calibration.drift} > ${RISK_MED_DRIFT} entre ventanas`);
  }
  if (card.top1Accuracy != null && card.top1Accuracy < RISK_LOW_TOP1) {
    level = worst(level, 'MEDIUM');
    e.push(`top-1 ${pct(card.top1Accuracy)} < ${pct(RISK_LOW_TOP1)}`);
  }
  if (e.length === 0)
    e.push(
      `ECE ${h.calibration.currentEce ?? 'n/d'}, deriva ${h.calibration.drift ?? 'n/d'}, top-1 ${pct(card.top1Accuracy)} — modelo estable`,
    );
  return { dimension: 'MODEL', level, evidence: e };
}

function operational(
  h: HealthReport,
  gates: GatesReport,
  card: ProviderScorecard,
  posture: { autoAcceptEnabled: boolean; activeProviderId: string },
): RiskDimension {
  const e: string[] = [];
  let level: RiskLevel = 'LOW';
  if (card.sampleSizes.scans < RISK_MIN_SCANS) {
    level = 'MEDIUM';
    e.push(`solo ${card.sampleSizes.scans}/${RISK_MIN_SCANS} scans en la ventana — cualquier señal es tentativa`);
  }
  const rollback = gates.gates.find((g) => g.id === 'ROLLBACK_REQUIRED');
  if (rollback?.status === 'FAIL') {
    level = 'HIGH';
    e.push('la puerta ROLLBACK_REQUIRED está disparada');
  }
  if (posture.autoAcceptEnabled && card.providerId !== posture.activeProviderId) {
    level = 'HIGH';
    e.push(`el scorecard evaluado ('${card.providerId}') no es el proveedor activo ('${posture.activeProviderId}')`);
  }
  if (e.length === 0)
    e.push(
      `${card.sampleSizes.scans} scans, puertas sin rollback, postura consistente ('${posture.activeProviderId}')`,
    );
  return { dimension: 'OPERATIONAL', level, evidence: e };
}

const ORDER: RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH'];
function worst(a: RiskLevel, b: RiskLevel): RiskLevel {
  return ORDER.indexOf(b) > ORDER.indexOf(a) ? b : a;
}

function pct(x: number | null): string {
  return x == null ? 'n/d' : `${(x * 100).toFixed(1)}%`;
}
