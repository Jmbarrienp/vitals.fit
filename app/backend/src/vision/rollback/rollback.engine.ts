import { Injectable } from '@nestjs/common';
import { GovernanceEngine } from '../governance/governance.engine';
import { RolloutEngine } from '../rollout/rollout.engine';
import { PromotionExecutorEngine } from '../promotion/promotion-executor.engine';
import { buildRollbackPlan } from './pipeline/rollback-plan';
import { RollbackExecutionPlan } from './types/rollback-contract';

/**
 * The Safe Rollback engine (V4.3). It orchestrates the READ-ONLY owners —
 * Governance (drift + DEMOTE), Rollout (risk, gates, health, status) and the
 * Promotion Executor (its readiness feeds the retry conditions) — and hands
 * their verdicts to a pure builder. It contains no statistics, no thresholds,
 * and no write call.
 *
 * "Rollback" is aspirational, exactly like "Executor" was in V4.2: it rolls
 * back NOTHING. It produces a plan. The plan describes the safe lever a human
 * would pull; the platform performs none of it, and this engine has no path to
 * a flag, a provider, or any configuration.
 *
 * Determinism: the only non-deterministic input is the wall clock, pushed to
 * the edge (`generatedAt`), so plan-building is a pure function of the owners'
 * live verdicts.
 */
@Injectable()
export class RollbackEngine {
  constructor(
    private readonly governance: GovernanceEngine,
    private readonly rollout: RolloutEngine,
    private readonly promotion: PromotionExecutorEngine,
  ) {}

  async plan(days?: number, generatedAt: string = new Date().toISOString()): Promise<RollbackExecutionPlan> {
    // Every input is a verdict an owner already reached. Nothing is recomputed.
    const [governance, risk, gates, health, status, promotionPlan] = await Promise.all([
      this.governance.recommend(days),
      this.rollout.risk(days),
      this.rollout.gatesReport(days),
      this.rollout.health(days),
      this.rollout.status(days),
      this.promotion.plan(days, generatedAt),
    ]);
    return buildRollbackPlan(governance, risk, gates, health, status, promotionPlan, generatedAt);
  }

  async readiness(days?: number, generatedAt?: string) {
    const plan = await this.plan(days, generatedAt);
    return {
      version: plan.version,
      currentProvider: plan.currentProvider,
      rollbackTarget: plan.rollbackTarget,
      readiness: plan.readiness,
      rollbackReason: plan.rollbackReason,
      rollbackSeverity: plan.rollbackSeverity,
      rollbackPriority: plan.rollbackPriority,
      rollbackConfidence: plan.rollbackConfidence,
      blockingReasons: plan.blockingReasons,
    };
  }

  async checklist(days?: number, generatedAt?: string) {
    const plan = await this.plan(days, generatedAt);
    return { version: plan.version, verification: plan.verificationChecklist, postRollback: plan.postRollbackChecklist };
  }

  async monitoring(days?: number, generatedAt?: string) {
    const plan = await this.plan(days, generatedAt);
    return { version: plan.version, monitoringPlan: plan.monitoringPlan, retryConditions: plan.retryConditions, communicationPlan: plan.communicationPlan };
  }

  async summary(days?: number, generatedAt?: string) {
    const plan = await this.plan(days, generatedAt);
    return {
      version: plan.version,
      currentProvider: plan.currentProvider,
      rollbackTarget: plan.rollbackTarget,
      readiness: plan.readiness,
      rollbackReason: plan.rollbackReason,
      rollbackSeverity: plan.rollbackSeverity,
      rollbackPriority: plan.rollbackPriority,
      triggeringEvidence: plan.triggeringEvidence,
      degradedHealth: plan.degradedHealth,
      failedGates: plan.failedGates,
      riskSummary: plan.riskSummary,
      estimatedImpact: plan.estimatedImpact,
    };
  }
}
