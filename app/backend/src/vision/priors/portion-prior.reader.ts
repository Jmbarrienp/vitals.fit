import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { median } from '../pipeline/portion-priors';

/**
 * The ONLY I/O of the Portion Estimation Engine (V3.3). Reads three corpora the
 * platform already owns — it creates none of them and writes to none of them:
 *
 *   LoggedMealItem.amountG   validated portions (manual + vision + barcode +
 *                            label), the user-food prior corpus
 *   VisionFeedback           proposed vs confirmed grams — the correction corpus
 *                            captured (write-only until now) since V0
 *   PlannedMealItem.amountG  the active plan's expectation — READ-ONLY; planner
 *                            decisions are never modified here
 *
 * Every method fails soft: a prior is an enhancement, and no prior fetch may
 * ever fail a scan. All statistics are computed in the pure pipeline modules —
 * this class only fetches observations.
 */

/** Recent-window size: enough to be stable, small enough to track a user whose portions change. */
const OBSERVATION_LIMIT = 20;
/** Correction-ratio window — same recency logic as observations. */
const BIAS_RATIO_LIMIT = 20;

export interface PortionObservation {
  amountG: number;
  mealType: string;
}

@Injectable()
export class PortionPriorReader {
  constructor(private readonly prisma: PrismaService) {}

  /** The user's most recent validated portions of this food, newest first. */
  async userFoodObservations(userId: string, foodItemId: string): Promise<PortionObservation[]> {
    try {
      const rows = await this.prisma.loggedMealItem.findMany({
        where: { foodItemId, loggedMeal: { dailyLog: { userId } } },
        orderBy: { loggedMeal: { loggedAt: 'desc' } },
        take: OBSERVATION_LIMIT,
        select: { amountG: true, loggedMeal: { select: { mealType: true } } },
      });
      return rows
        .filter((r) => r.amountG > 0)
        .map((r) => ({ amountG: r.amountG, mealType: r.loggedMeal.mealType as string }));
    } catch {
      return [];
    }
  }

  /**
   * confirmedGrams/proposedGrams ratios from past confirmations of
   * PROVIDER_ESTIMATE portions — the correction engine's supervision. Filtered
   * by proposedMethod so an edit to a catalog default is never misattributed as
   * a model error (pre-V3.3 rows have proposedMethod null and are excluded,
   * keeping the corpus clean by construction).
   */
  async visionBiasRatios(userId: string): Promise<number[]> {
    try {
      const rows = await this.prisma.visionFeedback.findMany({
        where: {
          userId,
          proposedMethod: 'PROVIDER_ESTIMATE',
          action: { in: ['ACCEPTED', 'EDITED_PORTION'] },
          proposedGrams: { gt: 0 },
          confirmedGrams: { gt: 0 },
        },
        orderBy: { createdAt: 'desc' },
        take: BIAS_RATIO_LIMIT,
        select: { proposedGrams: true, confirmedGrams: true },
      });
      return rows.map((r) => r.confirmedGrams! / r.proposedGrams!);
    } catch {
      return [];
    }
  }

  /**
   * What the ACTIVE meal plan typically serves of this food at this meal type
   * (median across plan days — deliberately day-agnostic, so vision never has
   * to replicate the planner's day-mapping logic to consume its output).
   */
  async plannerExpectedGrams(userId: string, foodItemId: string, mealType: string): Promise<number | null> {
    try {
      const items = await this.prisma.plannedMealItem.findMany({
        where: {
          foodItemId,
          plannedMeal: { mealType: mealType as any, mealPlanDay: { mealPlan: { userId, isActive: true } } },
        },
        select: { amountG: true },
      });
      const grams = items.map((i) => i.amountG).filter((g) => g > 0);
      return grams.length > 0 ? median(grams) : null;
    } catch {
      return null;
    }
  }
}
