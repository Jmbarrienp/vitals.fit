import { Injectable } from '@nestjs/common';
import { CoachingContextService } from '../nutrition-state/coaching-context.service';
import { AdaptivePlannerService } from '../planner/adaptive-planner.service';
import { MealPlannerService } from '../meal-planner/meal-planner.service';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { buildDeterministicCoach } from '../coach/weekly-coach.builder';
import { ActiveRecommendation, composeSession } from './pipeline/session-composer';
import { projectDailySession } from './pipeline/daily-projection';
import { CopilotSession } from './types/copilot-contract';
import { DailyCopilotSession } from './types/daily-copilot-contract';

/**
 * The Nutrition Copilot Runtime (V5.0) — the coordination layer over every
 * intelligent engine the platform has built. It is a CONSUMER OF CONTRACTS
 * only:
 *
 *   - It injects SERVICES, never PrismaService. It touches no table, reads no
 *     log, recomputes no metric. (The one Prisma-shaped thing it sees —
 *     recommendation rows from RecommendationsService — is projected into
 *     contract vocabulary at this boundary and never leaks through.)
 *   - CoachingContext is fetched ONCE and shared: it is already the
 *     model-agnostic aggregation of state/today/history/review/commitments
 *     (2C.0), and the deterministic Weekly Coach is a PURE builder over that
 *     same context — so the coach costs zero extra queries here.
 *   - The LLM-rephrased coach is deliberately NOT consumed: a session must be
 *     deterministic and cheap. The rephrased version stays available at the
 *     coach's own endpoint; the session carries the deterministic structure
 *     both versions share. That is a coordination decision, recorded in the
 *     contract's design rather than hidden.
 *
 * The runtime decides ORDER, PRIORITY, SILENCE and REDUNDANCY — never a
 * business decision. All of that lives in the pure composer.
 */
@Injectable()
export class NutritionCopilotRuntime {
  constructor(
    private readonly coachingContext: CoachingContextService,
    private readonly planner: AdaptivePlannerService,
    private readonly mealPlanner: MealPlannerService,
    private readonly recommendations: RecommendationsService,
  ) {}

  async session(userId: string, generatedAt: string = new Date().toISOString()): Promise<CopilotSession> {
    // V5.2 — ONE context build, genuinely shared. Until this slice the planner
    // and meal planner each built their own copy internally, so a single
    // Copilot session triggered THREE identical builds of the platform's most
    // expensive read (rollup + ledger history + review + today's meals +
    // commitments) on the endpoint the app opens to. They now accept an
    // already-built context; the result is byte-identical because the context
    // is the same deterministic snapshot either way.
    const ctx = await this.coachingContext.build(userId, 'full');
    const [plan, mealPlan, activeRows] = await Promise.all([
      this.planner.getPlan(userId, ctx),
      this.mealPlanner.getMealPlan(userId, ctx),
      this.recommendations.getActive(userId),
    ]);

    // Anti-corruption projection: rows -> contract vocabulary. Nothing
    // Prisma-shaped survives past this line.
    const recommendations: ActiveRecommendation[] = activeRows.map((r: any) => ({
      message: String(r.message ?? ''),
      reason: r.reason ?? null,
      status: String(r.status ?? 'PENDING'),
      priority: Number(r.priority ?? 99),
    }));

    const coach = buildDeterministicCoach(ctx);
    return composeSession({ ctx, plan, mealPlan, coach, recommendations }, generatedAt);
  }

  /**
   * V5.1 — the user-facing DAILY projection of the same coordinated session.
   * A pure reshape: it adds no engine call, no query, and no decision. The
   * coordination artifact stays available at `session()` for operators and
   * future consumers; this is what a person opening the app sees.
   */
  async daily(userId: string, generatedAt: string = new Date().toISOString()): Promise<DailyCopilotSession> {
    const session = await this.session(userId, generatedAt);
    return projectDailySession(session, generatedAt);
  }
}
