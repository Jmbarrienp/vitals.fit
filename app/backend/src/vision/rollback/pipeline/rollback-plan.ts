import { GovernanceRecommendation } from '../../governance/types/governance-contract';
import { GatesReport, HealthReport, RiskAssessment, RolloutStatus } from '../../rollout/types/rollout-contract';
import { HEALTH_MAX_ECE, HEALTH_MAX_PROVIDER_FAILURE_RATE, HEALTH_MAX_UNDO_RATE, isHealthGreen } from '../../rollout/pipeline/health';
import { GATE_MAX_FALSE_POSITIVES } from '../../rollout/pipeline/gates';
import { PromotionExecutionPlan } from '../../promotion/types/promotion-plan-contract';
import {
  ChecklistItem,
  ROLLBACK_PLAN_VERSION,
  RollbackExecutionPlan,
  RollbackPriority,
  RollbackReadiness,
  RollbackSeverity,
  RollbackStep,
  RollbackTarget,
  TriggeringMetric,
} from '../types/rollback-contract';

/**
 * The Safe Rollback plan builder (V4.3) — PURE. Given the verdicts the owners
 * already reached, decide whether a rollback is indicated, which safe lever to
 * pull, and how — recomputing nothing.
 *
 * The trigger is CONSUMED, never re-derived. "Is health degrading?" is the
 * `ROLLBACK_REQUIRED` gate's job (V4.0), and it already reuses the single
 * `isHealthGreen` definition and the false-positive ceiling. "Is the provider
 * drifting?" is Governance's job (V4.1). This builder reads those verdicts and
 * assembles the plan; every threshold it names in the plan is imported from the
 * module that owns it, never restated.
 *
 * The safe-lever rule is deterministic: while auto-accept is ENABLED, the
 * fastest known-safe containment for ANY degradation is to stop the autonomous
 * behavior — disable it (AUTO_ACCEPT_ENABLED=false, the shipped default). That
 * target needs no history and is always available. Only when auto-accept is
 * already off and the provider itself is degrading does rollback require
 * restoring a prior provider — which the platform does not persist, so that
 * path is BLOCKED on operator confirmation rather than guessing.
 */

/** The gate whose FAIL is the canonical "roll back now" signal. */
const ROLLBACK_GATE = 'ROLLBACK_REQUIRED';

export function buildRollbackPlan(
  governance: GovernanceRecommendation,
  risk: RiskAssessment,
  gates: GatesReport,
  health: HealthReport,
  rollout: RolloutStatus,
  promotion: PromotionExecutionPlan,
  generatedAt: string,
): RollbackExecutionPlan {
  const currentProvider = rollout.generatedFor.activeProviderId;
  const autoAcceptEnabled = rollout.generatedFor.autoAcceptEnabled;

  // ── Consume the triggers (never re-derive) ────────────────────────────────
  const rollbackGate = gates.gates.find((g) => g.id === ROLLBACK_GATE);
  const gateFired = rollbackGate?.status === 'FAIL';
  const drifting = governance.evidence.incumbentDrift === 'DRIFTING' || governance.action === 'DEMOTE';
  const riskHigh = risk.overall === 'HIGH';
  const healthGreen = isHealthGreen(health);
  const anyTrigger = gateFired || drifting || riskHigh;

  const degradedHealth = healthGreen.green ? [] : healthGreen.reasons;
  const failedGates = gates.gates.filter((g) => g.status === 'FAIL').map((g) => ({ id: g.id, reasons: g.reasons }));
  const triggeringMetrics = collectMetrics(health);
  const triggeringEvidence = collectEvidence(rollbackGate, governance, riskHigh, risk);

  const { target, readiness, blockingReasons } = decideTarget(anyTrigger, autoAcceptEnabled, drifting, currentProvider);
  const severity = deriveSeverity(anyTrigger, riskHigh, gateFired, health, drifting);
  const priority = derivePriority(severity);
  // Confidence counts INDEPENDENT axes of evidence. The gate and degraded
  // health are NOT independent — the ROLLBACK_REQUIRED gate fires precisely
  // BECAUSE health left green — so they are one axis, not two, or the same
  // undo spike would be double-counted into false certainty.
  const healthAxis = gateFired || !healthGreen.green;
  const confidence = confidenceLabel([healthAxis, drifting, riskHigh].filter(Boolean).length);

  return {
    version: ROLLBACK_PLAN_VERSION,
    generatedAt,
    currentProvider,
    rollbackTarget: target,
    readiness,
    rollbackReason: headline(anyTrigger, target, gateFired, drifting, riskHigh),
    rollbackSeverity: severity,
    rollbackPriority: priority,
    rollbackConfidence: anyTrigger ? confidence : 'SIN_DISPARADOR',
    blockingReasons,
    triggeringEvidence,
    triggeringMetrics,
    failedGates,
    degradedHealth,
    riskSummary: {
      overall: risk.overall,
      dimensions: risk.dimensions.map((d) => ({ dimension: d.dimension, level: d.level, topEvidence: d.evidence[0] ?? '' })),
    },
    rollbackSteps: rollbackSteps(target, currentProvider),
    verificationChecklist: verificationChecklist(target, health),
    postRollbackChecklist: postRollbackChecklist(target),
    monitoringPlan: monitoringPlan(),
    communicationPlan: communicationPlan(severity),
    retryConditions: retryConditions(promotion),
    estimatedImpact: estimatedImpact(target, health),
    rollbackWindow: risk.window,
  };
}

/**
 * The safe target. While auto-accept is on, disabling it contains ANY
 * degradation deterministically. Otherwise a degrading provider needs a
 * restore, whose prior target the platform does not persist — BLOCKED on the
 * operator rather than a fabricated guess.
 */
function decideTarget(
  anyTrigger: boolean,
  autoAcceptEnabled: boolean,
  drifting: boolean,
  currentProvider: string,
): { target: RollbackTarget; readiness: RollbackReadiness; blockingReasons: string[] } {
  if (!anyTrigger) {
    return {
      target: { kind: 'NONE', provider: null, detail: 'nada está degradándose — no se requiere rollback' },
      readiness: 'NOT_REQUIRED',
      blockingReasons: [],
    };
  }
  if (autoAcceptEnabled) {
    return {
      target: {
        kind: 'DISABLE_AUTO_ACCEPT',
        provider: null,
        detail: 'contención inmediata y determinista: apagar AUTO_ACCEPT_ENABLED (el default de fábrica). No requiere historial y siempre está disponible.',
      },
      readiness: 'REQUIRED',
      blockingReasons: [],
    };
  }
  // Auto-accept already off; the lever is the provider, whose prior the platform
  // does not record. Name the safe floor, but require operator confirmation.
  return {
    target: {
      kind: 'RESTORE_PROVIDER',
      provider: 'fixture',
      detail: `el proveedor '${currentProvider}' se está degradando y auto-accept ya está apagado. 'fixture' es el piso seguro garantizado, pero la plataforma no persiste historial de promociones — el operador confirma el último proveedor bueno conocido.`,
    },
    readiness: 'BLOCKED',
    blockingReasons: [
      'el objetivo del rollback de proveedor no es derivable del estado vivo: no existe historial de promociones persistido. El operador debe confirmar el último proveedor bueno conocido (o aceptar el piso seguro fixture).',
    ],
  };
}

function deriveSeverity(anyTrigger: boolean, riskHigh: boolean, gateFired: boolean, health: HealthReport, drifting: boolean): RollbackSeverity {
  if (!anyTrigger) return 'NONE';
  if (riskHigh || (gateFired && health.falsePositives > 0)) return 'CRITICAL';
  if (gateFired) return 'HIGH';
  if (drifting) return 'MEDIUM';
  return 'LOW';
}

function derivePriority(severity: RollbackSeverity): RollbackPriority {
  switch (severity) {
    case 'CRITICAL':
      return 'IMMEDIATE';
    case 'HIGH':
      return 'SCHEDULED';
    case 'MEDIUM':
    case 'LOW':
      return 'MONITOR';
    default:
      return 'NONE';
  }
}

/** A LABEL over how many INDEPENDENT signals agree — a count, not a recomputation. */
function confidenceLabel(agreeingSignals: number): string {
  if (agreeingSignals >= 3) return 'ALTA';
  if (agreeingSignals === 2) return 'MEDIA';
  return 'BAJA';
}

function headline(anyTrigger: boolean, target: RollbackTarget, gateFired: boolean, drifting: boolean, riskHigh: boolean): string {
  if (!anyTrigger) return 'no se requiere rollback: la salud está en verde, sin deriva ni riesgo elevado';
  const causes: string[] = [];
  if (gateFired) causes.push('la puerta ROLLBACK_REQUIRED está disparada (salud degradada o falsos positivos)');
  if (drifting) causes.push('el incumbente está a la deriva (Governance recomienda DEMOTE)');
  if (riskHigh) causes.push('el riesgo global es HIGH');
  const action = target.kind === 'DISABLE_AUTO_ACCEPT' ? 'apagar auto-accept' : target.kind === 'RESTORE_PROVIDER' ? 'restaurar un proveedor seguro' : 'ninguna acción';
  return `Rollback indicado (${action}): ${causes.join('; ')}`;
}

function collectMetrics(health: HealthReport): TriggeringMetric[] {
  return [
    { metric: 'undoRate', observed: health.undoRate, threshold: HEALTH_MAX_UNDO_RATE, source: 'Health Engine (V4.0)' },
    { metric: 'providerFailureRate', observed: health.providerFailureRate, threshold: HEALTH_MAX_PROVIDER_FAILURE_RATE, source: 'Health Engine (V4.0)' },
    { metric: 'calibrationEce', observed: health.calibration.currentEce, threshold: HEALTH_MAX_ECE, source: 'Calibration via Health (V4.0)' },
    { metric: 'falsePositives', observed: health.falsePositives, threshold: GATE_MAX_FALSE_POSITIVES, source: 'Gates Engine (V4.0)' },
    { metric: 'falseNegatives', observed: health.falseNegatives, threshold: null, source: 'Health Engine (V4.0)' },
  ];
}

function collectEvidence(
  rollbackGate: { reasons: string[] } | undefined,
  governance: GovernanceRecommendation,
  riskHigh: boolean,
  risk: RiskAssessment,
): string[] {
  const out: string[] = [];
  if (rollbackGate?.reasons) out.push(...rollbackGate.reasons);
  if (governance.evidence.incumbentDrift === 'DRIFTING' || governance.action === 'DEMOTE') {
    out.push(`Governance: acción ${governance.action}, deriva del incumbente ${governance.evidence.incumbentDrift} — ${governance.reasons[0] ?? ''}`);
  }
  if (riskHigh) {
    const worst = risk.dimensions.find((d) => d.level === 'HIGH');
    out.push(`Riesgo HIGH (${worst?.dimension ?? '—'}): ${worst?.evidence[0] ?? ''}`);
  }
  return out.length > 0 ? out : ['sin evidencia de disparo — la salud está en verde'];
}

function rollbackSteps(target: RollbackTarget, currentProvider: string): RollbackStep[] {
  if (target.kind === 'DISABLE_AUTO_ACCEPT') {
    return [
      { order: 1, action: 'Contener', detail: 'fijar AUTO_ACCEPT_ENABLED=false para detener el registro autónomo de inmediato', owner: 'ON_CALL' },
      { order: 2, action: 'Verificar', detail: 'confirmar que no se generan nuevas auto-aceptaciones (los scans vuelven a pedir confirmación)', owner: 'ON_CALL' },
      { order: 3, action: 'Preservar evidencia', detail: 'conservar VisionTrustDecision y VisionFeedback — son append-only y son el corpus del diagnóstico', owner: 'ML' },
      { order: 4, action: 'Diagnosticar', detail: 'identificar la causa raíz de la degradación (¿undo spike? ¿falsos positivos? ¿deriva de calibración?)', owner: 'ML' },
      { order: 5, action: 'Post-mortem', detail: 'documentar qué criterio de salud disparó y por qué la graduación no lo anticipó', owner: 'PRODUCT' },
    ];
  }
  if (target.kind === 'RESTORE_PROVIDER') {
    return [
      { order: 1, action: 'Confirmar objetivo', detail: `el operador confirma el último proveedor bueno conocido (piso seguro: '${target.provider}')`, owner: 'ENGINEERING' },
      { order: 2, action: 'Congelar rollout', detail: 'detener cualquier avance de tráfico en curso', owner: 'ON_CALL' },
      { order: 3, action: 'Restaurar', detail: `fijar VISION_PROVIDER al objetivo confirmado y redesplegar`, owner: 'ENGINEERING' },
      { order: 4, action: 'Verificar recuperación', detail: 'confirmar que la tasa de fallos y la calibración vuelven a rangos verdes', owner: 'ON_CALL' },
      { order: 5, action: 'Preservar evidencia', detail: `conservar las corridas en sombra de '${currentProvider}' — evidencia append-only para el diagnóstico`, owner: 'ML' },
      { order: 6, action: 'Post-mortem', detail: 'documentar la deriva y por qué la evidencia previa a la promoción no la anticipó', owner: 'PRODUCT' },
    ];
  }
  return [];
}

function verificationChecklist(target: RollbackTarget, health: HealthReport): ChecklistItem[] {
  const items: ChecklistItem[] = [
    item('SAFETY', 'Contención aplicada', 'PENDING',
      target.kind === 'DISABLE_AUTO_ACCEPT' ? 'AUTO_ACCEPT_ENABLED=false confirmado' : target.kind === 'RESTORE_PROVIDER' ? 'VISION_PROVIDER restaurado al objetivo confirmado' : 'sin acción requerida', 'CRITICAL', 'ON_CALL'),
    item('MONITORING', 'Tasa de undo recuperándose', metricStatus(health.undoRate, HEALTH_MAX_UNDO_RATE),
      `undo actual ${pct(health.undoRate)} vs umbral ${pct(HEALTH_MAX_UNDO_RATE)}`, 'HIGH', 'ON_CALL'),
    item('MONITORING', 'Fallos de proveedor bajo umbral', metricStatus(health.providerFailureRate, HEALTH_MAX_PROVIDER_FAILURE_RATE),
      `fallos ${pct(health.providerFailureRate)} vs umbral ${pct(HEALTH_MAX_PROVIDER_FAILURE_RATE)}`, 'HIGH', 'ON_CALL'),
    item('MONITORING', 'Sin nuevos falsos positivos', health.falsePositives > 0 ? 'FAIL' : 'PASS',
      `${health.falsePositives} falsos positivos en la ventana`, 'CRITICAL', 'ML'),
    item('TECHNICAL', 'Evidencia preservada', 'PENDING', 'VisionTrustDecision / VisionFeedback / VisionShadowRun intactas (append-only)', 'MEDIUM', 'ML'),
  ];
  return items;
}

function postRollbackChecklist(target: RollbackTarget): ChecklistItem[] {
  return [
    item('OPERATIONAL', 'Estado estable declarado', 'PENDING', 'salud en verde sostenida durante al menos una ventana completa tras el rollback', 'HIGH', 'ON_CALL'),
    item('STATISTICAL', 'Causa raíz identificada', 'PENDING', 'el diagnóstico explica qué señal disparó y por qué la evidencia previa no la anticipó', 'HIGH', 'ML'),
    item('PRODUCT', 'Impacto en usuario evaluado', 'PENDING', 'cuantificar cuántos usuarios/comidas se vieron afectados durante la degradación', 'MEDIUM', 'PRODUCT'),
    item('TECHNICAL', 'Guardas reforzadas', 'PENDING',
      target.kind === 'DISABLE_AUTO_ACCEPT' ? 'revisar si los umbrales de graduación de auto-accept necesitan endurecerse' : 'revisar si la barra de promoción necesita endurecerse', 'MEDIUM', 'ENGINEERING'),
    item('SAFETY', 'Post-mortem sin culpa completado', 'PENDING', 'documento compartido con el criterio de retry acordado', 'HIGH', 'PRODUCT'),
  ];
}

function monitoringPlan(): string[] {
  return [
    `vigilar la tasa de undo hasta que se sostenga ≤ ${pct(HEALTH_MAX_UNDO_RATE)} durante una ventana completa`,
    `vigilar los fallos de proveedor ≤ ${pct(HEALTH_MAX_PROVIDER_FAILURE_RATE)}`,
    `vigilar el ECE ≤ ${HEALTH_MAX_ECE} (calibración honesta restaurada)`,
    'vigilar que los falsos positivos vuelvan a cero',
    'revisar el reporte de salud (GET /vision/health) al inicio de cada ventana',
  ];
}

function communicationPlan(severity: RollbackSeverity): string[] {
  const base = ['registrar el rollback y su causa en el canal de operaciones'];
  if (severity === 'CRITICAL') {
    return [
      'notificar a on-call y a ingeniería INMEDIATAMENTE',
      'escalar a producto: la plataforma actuó mal sobre usuarios reales',
      ...base,
      'preparar comunicación al usuario solo si hubo impacto visible (comidas mal registradas)',
    ];
  }
  if (severity === 'HIGH') {
    return ['notificar a on-call e ingeniería', ...base];
  }
  return [...base, 'no se requiere escalamiento — degradación contenida antes de impacto visible'];
}

/**
 * When may a future promotion be attempted again? Reuses the Promotion
 * Executor's own readiness contract rather than inventing new criteria.
 */
function retryConditions(promotion: PromotionExecutionPlan): string[] {
  return [
    'la causa raíz del rollback está identificada y mitigada',
    'la salud se sostiene en verde durante al menos dos ventanas completas',
    `un nuevo plan de promoción (V4.2) alcanza readiness READY (el actual reporta '${promotion.readiness}')`,
    'la evidencia pareada de sombra se ha reconstruido para el candidato tras cualquier cambio',
  ];
}

function estimatedImpact(target: RollbackTarget, health: HealthReport): string[] {
  const out: string[] = [];
  if (target.kind === 'DISABLE_AUTO_ACCEPT') {
    out.push('los usuarios vuelven a confirmar cada scan manualmente (la experiencia pre-V3.6, nunca peor que el registro manual)');
    out.push('la graduación de auto-accept se pausa; la confianza acumulada por usuario se conserva (vive en VisionFeedback)');
  } else if (target.kind === 'RESTORE_PROVIDER') {
    out.push('cada scan futuro pasa por el proveedor restaurado; la curva de calibración del proveedor degradado se descarta');
    out.push('la confianza ganada por usuario sobre cada alimento se conserva (es provider-independiente)');
  } else {
    out.push('sin impacto — no se requiere rollback');
  }
  if (health.falsePositives > 0) out.push(`${health.falsePositives} auto-aceptaciones ya deshechas por usuarios durante la degradación`);
  return out;
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

function metricStatus(value: number | null, max: number): ChecklistItem['status'] {
  if (value == null) return 'PENDING';
  return value <= max ? 'PASS' : 'FAIL';
}

function pct(x: number | null | undefined): string {
  return x == null ? 'n/d' : `${(x * 100).toFixed(1)}%`;
}
