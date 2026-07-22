import { Injectable } from '@nestjs/common';
import { PromotionExecutorEngine } from '../promotion/promotion-executor.engine';
import { RollbackEngine } from '../rollback/rollback.engine';
import { buildCanaryPlan } from './pipeline/canary-plan';
import { CanaryRolloutPlan } from './types/canary-contract';

/**
 * The Progressive Canary engine (V4.4). It orchestrates the two READ-ONLY plan
 * builders it sits on top of — the Promotion Executor (V4.2, which owns the
 * rollout ladder and promotion viability) and the Rollback Engine (V4.3, which
 * owns the abort verdict) — and hands both to a pure builder that recommends
 * the next canary move. It contains no statistics, no thresholds, no ladder of
 * its own, and no write call.
 *
 * "Automation" here is the progression LOGIC being deterministic and
 * machine-checkable — not the machine acting. It advances no traffic, writes no
 * flag, promotes nothing. A human reads the recommendation and moves the
 * rollout.
 *
 * `atPercent` is an input (the operator's stated current position) because the
 * platform persists no live canary state — the same knowability boundary V4.3
 * documented for provider history. `generatedAt` is pushed to the edge so the
 * plan is a pure function of the two consumed plans plus the position.
 */
@Injectable()
export class CanaryEngine {
  constructor(
    private readonly promotion: PromotionExecutorEngine,
    private readonly rollback: RollbackEngine,
  ) {}

  async plan(atPercent = 0, days?: number, generatedAt: string = new Date().toISOString()): Promise<CanaryRolloutPlan> {
    // Both inputs are plans an owner already produced. Nothing is recomputed.
    const [promotionPlan, rollbackPlan] = await Promise.all([
      this.promotion.plan(days, generatedAt),
      this.rollback.plan(days, generatedAt),
    ]);
    return buildCanaryPlan(atPercent, promotionPlan, rollbackPlan, generatedAt);
  }

  async readiness(atPercent = 0, days?: number, generatedAt?: string) {
    const plan = await this.plan(atPercent, days, generatedAt);
    return {
      version: plan.version,
      rolloutPercent: plan.rolloutPercent,
      recommendation: plan.recommendation,
      recommendationReason: plan.recommendationReason,
      readiness: plan.readiness,
      advanceRecommendation: plan.advanceRecommendation,
      holdRecommendation: plan.holdRecommendation,
      rollbackRecommendation: plan.rollbackRecommendation,
      blockingConditions: plan.blockingConditions,
    };
  }

  async stages(atPercent = 0, days?: number, generatedAt?: string) {
    const plan = await this.plan(atPercent, days, generatedAt);
    return {
      version: plan.version,
      currentStage: plan.currentStage,
      nextStage: plan.nextStage,
      estimatedExposure: plan.estimatedExposure,
      requiredConditions: plan.requiredConditions,
    };
  }

  async checklist(atPercent = 0, days?: number, generatedAt?: string) {
    const plan = await this.plan(atPercent, days, generatedAt);
    return { version: plan.version, monitoring: plan.monitoringChecklist, verification: plan.verificationChecklist };
  }

  async timeline(atPercent = 0, days?: number, generatedAt?: string) {
    const plan = await this.plan(atPercent, days, generatedAt);
    return { version: plan.version, timeline: plan.timeline, estimatedRisk: plan.estimatedRisk };
  }
}
