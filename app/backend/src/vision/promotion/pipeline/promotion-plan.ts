import { GovernanceRecommendation } from '../../governance/types/governance-contract';
import {
  MAX_LATENCY_MULTIPLE,
  MAX_TOKEN_MULTIPLE,
  MIN_CHALLENGER_AVAILABILITY,
  MIN_PAIRED_SCANS,
} from '../../governance/pipeline/governance-decision';
import { GatesReport, HealthReport, RiskAssessment, RolloutStatus } from '../../rollout/types/rollout-contract';
import { HEALTH_MAX_ECE, HEALTH_MAX_PROVIDER_FAILURE_RATE, HEALTH_MAX_UNDO_RATE } from '../../rollout/pipeline/health';
import {
  ChecklistItem,
  ExecutionStep,
  PROMOTION_PLAN_VERSION,
  PromotionExecutionPlan,
  PromotionReadiness,
  RolloutStage,
  StatisticalEvidence,
} from '../types/promotion-plan-contract';

/**
 * The Promotion Execution Plan builder (V4.2) — PURE. Given the verdicts the
 * owners already reached (Governance's recommendation, the Rollout Risk/Gates/
 * Health/Status reports), assemble the operational plan. It recomputes NOTHING:
 * every statistic is quoted, every threshold is imported from the module that
 * owns it, and the rollout ladder is a fixed template whose CONDITIONS cite
 * those imported thresholds rather than restating them.
 *
 * `generatedAt` is an INPUT, not a clock read — so the same evidence always
 * yields the byte-identical plan, which is what makes it auditable.
 */

/** The rollout ladder is a fixed, conservative template. Durations are suggestions. */
const LADDER: { percent: number; hours: number }[] = [
  { percent: 5, hours: 24 },
  { percent: 10, hours: 24 },
  { percent: 25, hours: 48 },
  { percent: 50, hours: 48 },
  { percent: 100, hours: 72 },
];

/** Gates whose FAIL blocks a promotion outright. */
const BLOCKING_GATES = ['PROVIDER_READY', 'ROLLBACK_REQUIRED'];

export function buildPromotionPlan(
  recommendation: GovernanceRecommendation,
  risk: RiskAssessment,
  gates: GatesReport,
  health: HealthReport,
  rollout: RolloutStatus,
  generatedAt: string,
): PromotionExecutionPlan {
  const currentProvider = recommendation.incumbentId;
  const candidateProvider = recommendation.challengerId;
  const decision = recommendation.action;

  const { readiness, blockingReasons } = deriveReadiness(recommendation, risk, gates);
  const evidence = statisticalEvidence(recommendation);
  const advance = advanceConditions(recommendation);
  const stop = stopConditions();
  const rollback = rollbackConditions();

  const rolloutStrategy: RolloutStage[] = LADDER.map((rung, i) => ({
    percent: rung.percent,
    suggestedDurationHours: rung.hours,
    advanceConditions:
      i === LADDER.length - 1 ? ['última etapa: monitorear en 100% antes de retirar la bandera de reversión'] : advance,
    stopConditions: stop,
    rollbackConditions: rollback,
  }));

  return {
    version: PROMOTION_PLAN_VERSION,
    generatedAt,
    currentProvider,
    candidateProvider,
    decision,
    confidence: confidenceLabel(recommendation),
    readiness,
    blockingReasons,
    statisticalEvidence: evidence,
    estimatedRisk: {
      overall: risk.overall,
      dimensions: risk.dimensions.map((d) => ({
        dimension: d.dimension,
        level: d.level,
        topEvidence: d.evidence[0] ?? '',
      })),
    },
    rolloutStrategy,
    // A blocked plan starts nowhere: the ladder is documented, but the entry rung is 0.
    rolloutPercent: readiness === 'READY' ? LADDER[0].percent : 0,
    estimatedDurationHours: LADDER.reduce((sum, r) => sum + r.hours, 0),
    rollbackCriteria: dedupe(rolloutStrategy.flatMap((s) => s.rollbackConditions)),
    rollbackSteps: rollbackSteps(currentProvider, candidateProvider),
    executionSteps: executionSteps(currentProvider, candidateProvider),
    monitoringChecklist: monitoringChecklist(health, gates),
    validationChecklist: validationChecklist(recommendation, gates),
    approvalChecklist: approvalChecklist(readiness, risk),
    window: recommendation.window,
  };
}

/**
 * Readiness is DERIVED from the owners, never re-judged. READY requires all of:
 * Governance said PROMOTE, no blocking gate failed, and overall risk is not
 * HIGH. Anything else is BLOCKED, and every blocking reason is quoted from the
 * owner that produced it — the plan explains itself in the owners' own words.
 */
function deriveReadiness(
  rec: GovernanceRecommendation,
  risk: RiskAssessment,
  gates: GatesReport,
): { readiness: PromotionReadiness; blockingReasons: string[] } {
  if (!rec.challengerId) {
    return {
      readiness: 'NOT_APPLICABLE',
      blockingReasons: ['no hay proveedor candidato con evidencia en esta ventana'],
    };
  }
  const blocking: string[] = [];
  if (rec.action !== 'PROMOTE') {
    blocking.push(`Governance recomienda ${rec.action}, no PROMOTE: ${rec.reasons[0] ?? 'sin razón'}`);
  }
  for (const id of BLOCKING_GATES) {
    const gate = gates.gates.find((g) => g.id === id);
    if (gate?.status === 'FAIL') blocking.push(`la puerta ${id} está en FAIL: ${gate.reasons[0] ?? ''}`);
  }
  if (risk.overall === 'HIGH') {
    const worst = risk.dimensions.find((d) => d.level === 'HIGH');
    blocking.push(`riesgo global HIGH (${worst?.dimension ?? '—'}): ${worst?.evidence[0] ?? ''}`);
  }
  return blocking.length === 0
    ? { readiness: 'READY', blockingReasons: [] }
    : { readiness: 'BLOCKED', blockingReasons: blocking };
}

function statisticalEvidence(rec: GovernanceRecommendation): StatisticalEvidence {
  return {
    pairedScans: rec.evidence.pairedScans,
    top1Delta: rec.evidence.top1Delta,
    top1DeltaCi: rec.evidence.top1DeltaCi,
    mcNemarZ: rec.evidence.mcNemarZ,
    generalizesAcrossModalities: rec.evidence.generalizesAcrossModalities,
    generalizesAcrossUsers: rec.evidence.generalizesAcrossUsers,
    incumbentDrift: rec.evidence.incumbentDrift,
    governanceAction: rec.action,
  };
}

/**
 * A confidence LABEL, not a recomputation. The confidence interval itself came
 * from Governance; this only names how tight it is, for a human skimming the
 * plan. Width, not position — position is what `significant`/`action` already
 * encoded.
 */
function confidenceLabel(rec: GovernanceRecommendation): string {
  const ci = rec.evidence.top1DeltaCi;
  if (!ci) return 'SIN_EVIDENCIA';
  const width = ci.high - ci.low;
  if (width <= 0.05) return 'ALTA';
  if (width <= 0.12) return 'MEDIA';
  return 'BAJA';
}

function advanceConditions(rec: GovernanceRecommendation): string[] {
  return [
    `la ventaja de top-1 se mantiene (Governance la midió en ${pctDelta(rec.evidence.top1Delta)}, IC ${ci(rec.evidence.top1DeltaCi)})`,
    `la tasa de undo se mantiene ≤ ${pct(HEALTH_MAX_UNDO_RATE)} en el segmento promovido`,
    `los fallos de proveedor se mantienen ≤ ${pct(HEALTH_MAX_PROVIDER_FAILURE_RATE)}`,
    `sin regresión de calibración (ECE ≤ ${HEALTH_MAX_ECE}) en la nueva curva del candidato`,
  ];
}

function stopConditions(): string[] {
  return [
    `la ventaja de top-1 deja de ser significativa en el segmento promovido (pausar, no revertir)`,
    `la disponibilidad del candidato cae por debajo de ${pct(MIN_CHALLENGER_AVAILABILITY)}`,
    `la latencia o el coste superan ${MAX_LATENCY_MULTIPLE}× / ${MAX_TOKEN_MULTIPLE}× del incumbente`,
  ];
}

function rollbackConditions(): string[] {
  return [
    `la tasa de undo supera ${pct(HEALTH_MAX_UNDO_RATE)} (los usuarios están revirtiendo al candidato)`,
    `los fallos de proveedor superan ${pct(HEALTH_MAX_PROVIDER_FAILURE_RATE)}`,
    `el ECE del candidato supera ${HEALTH_MAX_ECE} (confianza deshonesta → auto-accept en riesgo)`,
    `cualquier incidente de seguridad o corrección catastrófica atribuible al candidato`,
  ];
}

function executionSteps(current: string, candidate: string | null): ExecutionStep[] {
  const c = candidate ?? 'CANDIDATO';
  return [
    {
      order: 1,
      action: 'Verificar registro',
      detail: `confirmar que '${c}' está registrado en el VisionProviderRegistry y con credencial en producción`,
      owner: 'ENGINEERING',
    },
    {
      order: 2,
      action: 'Verificación previa',
      detail: 'correr smoke:vision y smoke:governance; confirmar builds y tsc limpios',
      owner: 'ENGINEERING',
    },
    {
      order: 3,
      action: 'Aprobaciones',
      detail: 'recoger las firmas del approvalChecklist antes de tocar nada',
      owner: 'PRODUCT',
    },
    {
      order: 4,
      action: 'Iniciar en 5%',
      detail: `enrutar el 5% del tráfico de la modalidad a '${c}' mediante el mecanismo de rollout gradual (fuera de este slice)`,
      owner: 'OPERATIONS',
    },
    {
      order: 5,
      action: 'Observar',
      detail: 'vigilar el monitoringChecklist durante la duración sugerida de cada etapa antes de avanzar',
      owner: 'ON_CALL',
    },
    {
      order: 6,
      action: 'Escalar por la escalera',
      detail: '5% → 10% → 25% → 50% → 100%, avanzando solo cuando se cumplan las advanceConditions',
      owner: 'OPERATIONS',
    },
    {
      order: 7,
      action: 'Promover como default',
      detail: `una vez estable en 100%, fijar VISION_PROVIDER=${c} y retirar la bandera de reversión`,
      owner: 'ENGINEERING',
    },
    {
      order: 8,
      action: 'Recordatorio de calibración',
      detail: `la curva de calibración de '${c}' arranca vacía: auto-accept deja de graduar hasta que acumule evidencia propia (V3.6)`,
      owner: 'ML',
    },
  ];
}

function rollbackSteps(current: string, candidate: string | null): ExecutionStep[] {
  const c = candidate ?? 'CANDIDATO';
  return [
    { order: 1, action: 'Detener el avance', detail: 'congelar el rollout en el porcentaje actual', owner: 'ON_CALL' },
    {
      order: 2,
      action: 'Revertir enrutamiento',
      detail: `devolver el 100% del tráfico a '${current}'`,
      owner: 'OPERATIONS',
    },
    { order: 3, action: 'Restaurar default', detail: `confirmar VISION_PROVIDER=${current}`, owner: 'ENGINEERING' },
    {
      order: 4,
      action: 'Preservar evidencia',
      detail: `conservar las corridas en sombra de '${c}' — son evidencia append-only para el diagnóstico`,
      owner: 'ML',
    },
    {
      order: 5,
      action: 'Post-mortem',
      detail: 'documentar el criterio de rollback que disparó y por qué la evidencia previa no lo anticipó',
      owner: 'PRODUCT',
    },
  ];
}

function monitoringChecklist(health: HealthReport, gates: GatesReport): ChecklistItem[] {
  const rollback = gates.gates.find((g) => g.id === 'ROLLBACK_REQUIRED');
  return [
    item(
      'OBSERVABILITY',
      'Tasa de undo bajo umbral',
      metricStatus(health.undoRate, HEALTH_MAX_UNDO_RATE),
      `undo actual ${pct(health.undoRate)} vs umbral ${pct(HEALTH_MAX_UNDO_RATE)}`,
      'CRITICAL',
      'ON_CALL',
    ),
    item(
      'OBSERVABILITY',
      'Fallos de proveedor bajo umbral',
      metricStatus(health.providerFailureRate, HEALTH_MAX_PROVIDER_FAILURE_RATE),
      `fallos ${pct(health.providerFailureRate)} vs umbral ${pct(HEALTH_MAX_PROVIDER_FAILURE_RATE)}`,
      'CRITICAL',
      'ON_CALL',
    ),
    item(
      'OBSERVABILITY',
      'Calibración honesta',
      metricStatus(health.calibration.currentEce, HEALTH_MAX_ECE),
      `ECE ${health.calibration.currentEce ?? 'n/d'} vs umbral ${HEALTH_MAX_ECE}`,
      'HIGH',
      'ML',
    ),
    item(
      'OBSERVABILITY',
      'Latencia observada',
      health.meanLatencyMs == null ? 'PENDING' : 'PASS',
      `latencia media ${health.meanLatencyMs == null ? 'n/d' : Math.round(health.meanLatencyMs) + 'ms'}`,
      'MEDIUM',
      'ON_CALL',
    ),
    item(
      'SAFETY',
      'Sin señal de rollback',
      rollback?.status === 'FAIL' ? 'FAIL' : 'PASS',
      rollback?.reasons[0] ?? 'la puerta ROLLBACK_REQUIRED no está disparada',
      'CRITICAL',
      'ON_CALL',
    ),
    item(
      'SAFETY',
      'Falsos positivos bajo control',
      health.falsePositives > 0 ? 'FAIL' : 'PASS',
      `${health.falsePositives} auto-aceptaciones deshechas en la ventana`,
      'HIGH',
      'ML',
    ),
  ];
}

function validationChecklist(rec: GovernanceRecommendation, gates: GatesReport): ChecklistItem[] {
  const provider = gates.gates.find((g) => g.id === 'PROVIDER_READY');
  return [
    item(
      'STATISTICAL',
      'Evidencia pareada suficiente',
      rec.evidence.pairedScans >= MIN_PAIRED_SCANS ? 'PASS' : 'FAIL',
      `${rec.evidence.pairedScans}/${MIN_PAIRED_SCANS} scans pareados`,
      'CRITICAL',
      'ML',
    ),
    item(
      'STATISTICAL',
      'Ventaja estadísticamente significativa',
      rec.action === 'PROMOTE' || rec.action === 'DEMOTE' ? 'PASS' : significantEnough(rec) ? 'PASS' : 'FAIL',
      `McNemar z=${rec.evidence.mcNemarZ ?? 'n/d'}, IC top-1 ${ci(rec.evidence.top1DeltaCi)}`,
      'CRITICAL',
      'ML',
    ),
    item(
      'STATISTICAL',
      'La ventaja generaliza entre modalidades',
      boolStatus(rec.evidence.generalizesAcrossModalities),
      generalizeText(rec.evidence.generalizesAcrossModalities),
      'HIGH',
      'ML',
    ),
    item(
      'STATISTICAL',
      'La ventaja generaliza entre usuarios',
      boolStatus(rec.evidence.generalizesAcrossUsers),
      generalizeText(rec.evidence.generalizesAcrossUsers),
      'HIGH',
      'ML',
    ),
    item(
      'TECHNICAL',
      'Proveedor candidato listo',
      provider?.status === 'PASS' ? 'PASS' : provider?.status === 'FAIL' ? 'FAIL' : 'PENDING',
      provider?.reasons[0] ?? 'sin veredicto de la puerta PROVIDER_READY',
      'CRITICAL',
      'ENGINEERING',
    ),
    item(
      'OPERATIONAL',
      'Coste y latencia dentro de límites',
      rec.evidence.latencyDeltaMs != null && rec.evidence.latencyDeltaMs <= 0 ? 'PASS' : 'PENDING',
      `Δlatencia ${rec.evidence.latencyDeltaMs ?? 'n/d'}ms, Δtokens ${rec.evidence.tokenDeltaPerScan ?? 'n/d'}/scan`,
      'MEDIUM',
      'OPERATIONS',
    ),
    item(
      'PRODUCT',
      'Impacto en el usuario entendido',
      'PENDING',
      'confirmar que la promoción no cambia la experiencia visible más allá de la calidad de reconocimiento',
      'MEDIUM',
      'PRODUCT',
    ),
  ];
}

function approvalChecklist(readiness: PromotionReadiness, risk: RiskAssessment): ChecklistItem[] {
  const highRisk = risk.overall === 'HIGH';
  return [
    item(
      'PRODUCT',
      'Aprobación de producto',
      'PENDING',
      'firma requerida antes de cualquier cambio de tráfico',
      'CRITICAL',
      'PRODUCT',
    ),
    item(
      'TECHNICAL',
      'Aprobación de ingeniería',
      'PENDING',
      'plan de reversión revisado y probado',
      'CRITICAL',
      'ENGINEERING',
    ),
    item(
      'STATISTICAL',
      'Aprobación de ML',
      'PENDING',
      'evidencia estadística y de calibración revisada',
      'CRITICAL',
      'ML',
    ),
    item(
      'SAFETY',
      'Guardia de seguridad',
      readiness === 'READY' ? 'PENDING' : 'FAIL',
      readiness === 'READY'
        ? 'el plan está listo; confirmar cobertura de on-call durante el rollout'
        : 'el plan está BLOQUEADO — no puede aprobarse',
      highRisk ? 'CRITICAL' : 'HIGH',
      'ON_CALL',
    ),
  ];
}

// ── helpers ──────────────────────────────────────────────────────────────────

function item(
  category: ChecklistItem['category'],
  label: string,
  status: ChecklistItem['status'],
  explanation: string,
  severity: ChecklistItem['severity'],
  owner: ChecklistItem['owner'],
): ChecklistItem {
  return { category, label, status, explanation, severity, owner };
}

function significantEnough(rec: GovernanceRecommendation): boolean {
  const civ = rec.evidence.top1DeltaCi;
  return civ != null && civ.low > 0;
}

function metricStatus(value: number | null, max: number): ChecklistItem['status'] {
  if (value == null) return 'PENDING';
  return value <= max ? 'PASS' : 'FAIL';
}

function boolStatus(x: boolean | null): ChecklistItem['status'] {
  if (x == null) return 'PENDING';
  return x ? 'PASS' : 'FAIL';
}

function generalizeText(x: boolean | null): string {
  if (x == null) return 'evidencia insuficiente para juzgar generalización (se necesitan ≥2 buckets)';
  return x
    ? 'la ventaja se sostiene en la mayoría de los buckets'
    : 'la ventaja NO generaliza — concentrada en un subconjunto';
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}

function ci(x: { low: number; high: number } | null | undefined): string {
  return x == null ? 'n/d' : `[${pctDelta(x.low)}, ${pctDelta(x.high)}]`;
}
function pctDelta(x: number | null | undefined): string {
  return x == null ? 'n/d' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}pp`;
}
function pct(x: number | null | undefined): string {
  return x == null ? 'n/d' : `${(x * 100).toFixed(1)}%`;
}
