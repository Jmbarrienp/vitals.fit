import { Injectable } from '@nestjs/common';
import { GovernanceEngine } from '../governance/governance.engine';
import { RolloutEngine } from '../rollout/rollout.engine';
import { buildPromotionPlan } from './pipeline/promotion-plan';
import { PromotionExecutionPlan } from './types/promotion-plan-contract';

/**
 * The Promotion Executor engine (V4.2). It orchestrates the READ-ONLY owners —
 * GovernanceEngine (the recommendation and its statistical evidence) and
 * RolloutEngine (risk, gates, health, status) — and hands their verdicts to a
 * pure builder. It contains no statistics, no thresholds, and no write call.
 *
 * "Executor" is aspirational: it executes NOTHING. It produces a plan. The
 * plan describes what a human would do; the platform performs none of it, and
 * this engine has no path to a provider, a flag, or any configuration.
 *
 * Determinism: the only non-deterministic input is the wall clock, and that is
 * pushed to the very edge (`generatedAt`) so the plan-building itself is a pure
 * function of the owners' verdicts. Same verdicts + same timestamp -> the same
 * plan, forever.
 */
@Injectable()
export class PromotionExecutorEngine {
  constructor(
    private readonly governance: GovernanceEngine,
    private readonly rollout: RolloutEngine,
  ) {}

  async plan(days?: number, generatedAt: string = new Date().toISOString()): Promise<PromotionExecutionPlan> {
    // Every input is a verdict an owner already reached. Nothing is recomputed.
    const [recommendation, risk, gates, health, status] = await Promise.all([
      this.governance.recommend(days),
      this.rollout.risk(days),
      this.rollout.gatesReport(days),
      this.rollout.health(days),
      this.rollout.status(days),
    ]);
    return buildPromotionPlan(recommendation, risk, gates, health, status, generatedAt);
  }

  /** Convenience projections over the same plan — each is a read-only slice, never a recompute. */
  async readiness(days?: number, generatedAt?: string) {
    const plan = await this.plan(days, generatedAt);
    return {
      version: plan.version,
      currentProvider: plan.currentProvider,
      candidateProvider: plan.candidateProvider,
      decision: plan.decision,
      confidence: plan.confidence,
      readiness: plan.readiness,
      blockingReasons: plan.blockingReasons,
      estimatedRisk: plan.estimatedRisk,
    };
  }

  async checklist(days?: number, generatedAt?: string) {
    const plan = await this.plan(days, generatedAt);
    return {
      version: plan.version,
      validation: plan.validationChecklist,
      monitoring: plan.monitoringChecklist,
      approval: plan.approvalChecklist,
    };
  }

  async execution(days?: number, generatedAt?: string) {
    const plan = await this.plan(days, generatedAt);
    return {
      version: plan.version,
      readiness: plan.readiness,
      rolloutStrategy: plan.rolloutStrategy,
      rolloutPercent: plan.rolloutPercent,
      estimatedDurationHours: plan.estimatedDurationHours,
      executionSteps: plan.executionSteps,
    };
  }

  async rollback(days?: number, generatedAt?: string) {
    const plan = await this.plan(days, generatedAt);
    return { version: plan.version, rollbackCriteria: plan.rollbackCriteria, rollbackSteps: plan.rollbackSteps };
  }
}
