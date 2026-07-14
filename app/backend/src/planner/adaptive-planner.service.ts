import { Injectable } from '@nestjs/common';
import { CoachingContextService } from '../nutrition-state/coaching-context.service';
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

  async getPlan(userId: string): Promise<NutritionPlan> {
    const ctx = await this.coachingContext.build(userId, 'full');
    return decidePlan(ctx);
  }
}
