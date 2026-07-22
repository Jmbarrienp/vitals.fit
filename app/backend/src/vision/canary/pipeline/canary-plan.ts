import { PromotionExecutionPlan, RolloutStage } from '../../promotion/types/promotion-plan-contract';
import { RollbackExecutionPlan } from '../../rollback/types/rollback-contract';
import {
  CANARY_PLAN_VERSION,
  CanaryReadiness,
  CanaryRecommendation,
  CanaryRolloutPlan,
  CanarySignal,
  CanaryStage,
  ChecklistItem,
} from '../types/canary-contract';

/**
 * The Canary progression builder (V4.4) — PURE. Given where a rollout sits
 * (`atPercent`) and the two plans that already reasoned about it — the
 * Promotion Executor's ladder (V4.2) and the Rollback Engine's abort verdict
 * (V4.3) — recommend the next move. It recomputes nothing:
 *
 *   the LADDER (rungs, durations, conditions) is the Promotion plan's
 *     `rolloutStrategy`, consumed verbatim — never rebuilt here;
 *   whether a degradation has fired is the Rollback plan's readiness, consumed
 *     — this builder does NOT re-check health, re-read a gate, or re-assess
 *     risk. The Rollback Engine already did, and consuming its verdict is
 *     exactly what keeps two subsystems from disagreeing about whether things
 *     are degrading.
 *
 * The whole progression is one deterministic decision over those two consumed
 * verdicts plus the supplied position.
 */

/**
 * The single decision. Order encodes priority: an abort outranks everything, a
 * mild degradation outranks progress, an unviable promotion can't proceed at
 * all, and only a fully clear, low-risk state advances. STAY is the honest
 * "clear but keep observing" verdict for a green-but-cautious state.
 */
export function decideCanary(
  atPercent: number,
  promotion: PromotionExecutionPlan,
  rollback: RollbackExecutionPlan,
): { recommendation: CanaryRecommendation; reason: string; readiness: CanaryReadiness } {
  const triggerFired = rollback.readiness !== 'NOT_REQUIRED'; // the Rollback plan already decided this
  const abortNow = rollback.rollbackPriority === 'IMMEDIATE' || rollback.rollbackPriority === 'SCHEDULED';
  const promotable = promotion.readiness === 'READY';
  const riskMedium = promotion.estimatedRisk.overall === 'MEDIUM';

  if (abortNow) {
    return {
      recommendation: 'ROLLBACK',
      reason: `abortar el canario: el plan de rollback reporta prioridad ${rollback.rollbackPriority} (${rollback.rollbackReason})`,
      readiness: 'ABORTING',
    };
  }
  if (triggerFired) {
    // A degradation fired but only at MONITOR priority — contain, don't revert.
    return {
      recommendation: 'PAUSE',
      reason: `pausar: hay una degradación leve (rollback ${rollback.readiness}, prioridad ${rollback.rollbackPriority}) — contener y observar antes de avanzar`,
      readiness: 'HOLDING',
    };
  }
  if (!promotable) {
    return {
      recommendation: 'HOLD',
      reason: `mantener: no hay una promoción viable para canario (plan de promoción: ${promotion.readiness}${promotion.blockingReasons[0] ? ` — ${promotion.blockingReasons[0]}` : ''})`,
      readiness: 'HOLDING',
    };
  }
  if (atPercent >= 100) {
    return {
      recommendation: 'COMPLETE',
      reason: 'completar: el rollout está en 100% con la promoción viable y sin degradación — el canario terminó',
      readiness: 'COMPLETED',
    };
  }
  if (riskMedium) {
    return {
      recommendation: 'STAY',
      reason: 'permanecer: las señales permiten avanzar pero el riesgo global es MEDIO — mantener posición y seguir observando la ventana sugerida antes de subir',
      readiness: 'HOLDING',
    };
  }
  return {
    recommendation: 'ADVANCE',
    reason: `avanzar: salud en verde, promoción viable, sin señal de rollback y riesgo ${promotion.estimatedRisk.overall.toLowerCase()} — las señales apoyan subir al siguiente peldaño (el operador confirma la duración observada)`,
    readiness: 'READY_TO_ADVANCE',
  };
}

export function buildCanaryPlan(
  atPercent: number,
  promotion: PromotionExecutionPlan,
  rollback: RollbackExecutionPlan,
  generatedAt: string,
): CanaryRolloutPlan {
  const ladder = promotion.rolloutStrategy;
  const clampedPercent = Math.max(0, Math.min(100, atPercent));
  const { recommendation, reason, readiness } = decideCanary(clampedPercent, promotion, rollback);

  // The rung the rollout is "on" = the highest rung at or below the position.
  // -1 when pre-rollout (below the first rung), so every rung reads as FUTURE.
  const below = ladder.map((s) => s.percent).filter((p) => p <= clampedPercent);
  const currentRungPercent = below.length > 0 ? Math.max(...below) : -1;

  const timeline: CanaryStage[] = ladder.map((rung) => positioned(rung, currentRungPercent, recommendation, rollback));
  const currentStage = timeline.find((s) => s.position === 'CURRENT') ?? null;
  const nextStage = timeline.find((s) => s.percent > clampedPercent) ?? null;

  // requiredConditions: what must hold to advance FROM here. Pre-rollout uses
  // the first rung's; at a rung, that rung's. Consumed from the ladder.
  const gatingRung = currentStage ?? nextStage ?? null;
  const requiredConditions = gatingRung?.advanceConditions ?? [];
  const blockingConditions = collectBlockers(recommendation, currentStage, rollback, promotion);

  const advance = signal(recommendation === 'ADVANCE',
    recommendation === 'ADVANCE' ? 'las señales apoyan avanzar al siguiente peldaño' : `no se recomienda avanzar (${recommendation})`);
  const hold = signal(recommendation === 'HOLD' || recommendation === 'STAY' || recommendation === 'PAUSE',
    recommendation === 'STAY' ? 'mantener posición y seguir observando' : recommendation === 'PAUSE' ? 'pausar por degradación leve' : recommendation === 'HOLD' ? 'sin promoción viable para canario' : 'no se recomienda mantener');
  const rollbackSignal = signal(recommendation === 'ROLLBACK',
    recommendation === 'ROLLBACK' ? rollback.rollbackReason : 'no se recomienda rollback en este momento');

  return {
    version: CANARY_PLAN_VERSION,
    generatedAt,
    rolloutPercent: clampedPercent,
    currentStage,
    nextStage,
    recommendation,
    recommendationReason: reason,
    readiness,
    advanceRecommendation: advance,
    holdRecommendation: hold,
    rollbackRecommendation: rollbackSignal,
    requiredConditions,
    blockingConditions,
    monitoringChecklist: monitoringChecklist(currentStage, rollback),
    verificationChecklist: verificationChecklist(recommendation, promotion, rollback),
    promotionReference: { readiness: promotion.readiness, decision: promotion.decision, candidateProvider: promotion.candidateProvider },
    rollbackReference: { readiness: rollback.readiness, severity: rollback.rollbackSeverity, priority: rollback.rollbackPriority },
    estimatedExposure: {
      currentPercent: clampedPercent,
      nextPercent: nextStage?.percent ?? null,
      detail: nextStage
        ? `un avance expondría al ${nextStage.percent}% del tráfico de la modalidad (desde ${clampedPercent}%)`
        : `el rollout está en su etapa máxima (${clampedPercent}%)`,
    },
    estimatedRisk: promotion.estimatedRisk,
    timeline,
    window: promotion.window,
  };
}

function positioned(
  rung: RolloutStage,
  currentRungPercent: number,
  recommendation: CanaryRecommendation,
  rollback: RollbackExecutionPlan,
): CanaryStage {
  const position: CanaryStage['position'] =
    rung.percent < currentRungPercent ? 'PAST' : rung.percent === currentRungPercent ? 'CURRENT' : 'FUTURE';
  return {
    percent: rung.percent,
    suggestedDurationHours: rung.suggestedDurationHours,
    advanceConditions: rung.advanceConditions,
    stopConditions: rung.stopConditions,
    rollbackConditions: rung.rollbackConditions,
    position,
    // Live indicators only make sense for the rung the rollout is actually on.
    observedIndicators: position === 'CURRENT' ? observedIndicators(recommendation, rollback) : [],
  };
}

function observedIndicators(recommendation: CanaryRecommendation, rollback: RollbackExecutionPlan): string[] {
  const out = [`recomendación actual: ${recommendation}`];
  if (rollback.degradedHealth.length > 0) out.push(...rollback.degradedHealth.map((d) => `salud: ${d}`));
  else out.push('salud en verde');
  if (rollback.readiness !== 'NOT_REQUIRED') out.push(`rollback ${rollback.readiness} (severidad ${rollback.rollbackSeverity})`);
  return out;
}

function collectBlockers(
  recommendation: CanaryRecommendation,
  currentStage: CanaryStage | null,
  rollback: RollbackExecutionPlan,
  promotion: PromotionExecutionPlan,
): string[] {
  const out: string[] = [];
  if (recommendation === 'ROLLBACK' || recommendation === 'PAUSE') out.push(...rollback.triggeringEvidence);
  if (recommendation === 'HOLD') out.push(...promotion.blockingReasons);
  if (recommendation === 'STAY') out.push('riesgo global MEDIO — observar la ventana sugerida antes de avanzar');
  // The current rung's own stop conditions are always worth surfacing as what to watch.
  if (currentStage) out.push(...currentStage.stopConditions.map((c) => `condición de parada del peldaño: ${c}`));
  return out.length > 0 ? out : ['ninguna — las señales apoyan avanzar'];
}

function monitoringChecklist(currentStage: CanaryStage | null, rollback: RollbackExecutionPlan): ChecklistItem[] {
  const healthy = rollback.degradedHealth.length === 0;
  return [
    item('SAFETY', 'Sin señal de rollback activa', rollback.readiness === 'NOT_REQUIRED' ? 'PASS' : 'FAIL',
      rollback.readiness === 'NOT_REQUIRED' ? 'el plan de rollback no reporta degradación' : `rollback ${rollback.readiness}: ${rollback.rollbackReason}`, 'CRITICAL', 'ON_CALL'),
    item('MONITORING', 'Salud en verde en el peldaño actual', healthy ? 'PASS' : 'FAIL',
      healthy ? 'sin métricas de salud degradadas' : rollback.degradedHealth.join('; '), 'HIGH', 'ON_CALL'),
    item('MONITORING', 'Ventana de observación del peldaño', currentStage ? 'PENDING' : 'NOT_APPLICABLE',
      currentStage ? `observar al menos ${currentStage.suggestedDurationHours}h en ${currentStage.percent}% antes de avanzar (el motor no rastrea el tiempo en etapa)` : 'aún no hay rollout activo', 'MEDIUM', 'OPERATIONS'),
    item('STATISTICAL', 'Evidencia de riesgo estable', 'PENDING',
      'confirmar que el riesgo global no ha subido desde el último peldaño', 'MEDIUM', 'ML'),
  ];
}

function verificationChecklist(
  recommendation: CanaryRecommendation,
  promotion: PromotionExecutionPlan,
  rollback: RollbackExecutionPlan,
): ChecklistItem[] {
  return [
    item('OPERATIONAL', 'Mecanismo de enrutamiento por porcentaje disponible', 'PENDING',
      'confirmar que el sistema de rollout gradual puede fijar el nuevo porcentaje (fuera de este slice)', 'HIGH', 'OPERATIONS'),
    item('TECHNICAL', 'Referencia de promoción vigente', promotion.readiness === 'READY' ? 'PASS' : promotion.readiness === 'NOT_APPLICABLE' ? 'NOT_APPLICABLE' : 'FAIL',
      `plan de promoción: ${promotion.readiness} (decisión ${promotion.decision})`, 'HIGH', 'ENGINEERING'),
    item('SAFETY', 'Plan de rollback listo si se necesita', 'PASS',
      `el plan de rollback está siempre disponible (estado actual: ${rollback.readiness})`, 'CRITICAL', 'ON_CALL'),
    item('OPERATIONAL', 'Recomendación entendida por el operador', 'PENDING',
      `la recomendación es ${recommendation} — confirmar que el operador la ejecuta manualmente (el motor no actúa)`, 'MEDIUM', 'OPERATIONS'),
  ];
}

function signal(value: boolean, explanation: string): CanarySignal {
  return { value, explanation };
}

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
