import { Injectable } from '@nestjs/common';
import { CoachingContextService } from '../nutrition-state/coaching-context.service';
import { CoachingContext } from '../nutrition-state/types/coaching-context';
import { decidePlan } from './adaptive-planner.engine';
import { NutritionPlan } from './types/nutrition-plan';

/**
 * The Adaptive Nutrition Planner (Phase 2C.2) — the platform's strategic brain for
 * nutrition. A pure CONSUMER: it reads the deterministic CoachingContext (which
 * already composes the rollup, ledger history, review/follow-up and commitments)
 * and delegates ALL reasoning to the deterministic engine. It never reads raw
 * logs, never recomputes a score, and never mutates the plan — it decides what the
 * plan SHOULD be; applying decisions stays with the existing confirmation flow.
 *
 * Deterministic by construction: identical context -> identical plan. AI is
 * optional and only communicates these decisions; it never makes them.
 */
@Injectable()
export class AdaptivePlannerService {
  constructor(private readonly coachingContext: CoachingContextService) {}

  /**
   * `ctx` (V5.2) lets a caller that ALREADY built the context pass it in
   * instead of paying for a second identical build. Optional and fully
   * backward compatible: every existing caller keeps its exact behavior, and
   * the context is the same deterministic snapshot either way.
   */
  async getPlan(userId: string, ctx?: CoachingContext): Promise<NutritionPlan> {
    const context = ctx ?? (await this.coachingContext.build(userId, 'full'));
    return decidePlan(context);
  }
}
