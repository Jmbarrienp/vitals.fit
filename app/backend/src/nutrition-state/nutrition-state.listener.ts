import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NutritionStateService } from './nutrition-state.service';
import { MealLoggedEvent } from '../orchestrator/events/meal.event';
import { WeightUpdatedEvent } from '../orchestrator/events/progress.event';

/**
 * Marks the user's cached nutrition state stale on the events that change it.
 * Recompute is lazy (next read) — this stays a single cheap UPDATE, never blocks.
 */
@Injectable()
export class NutritionStateListener {
  constructor(private readonly state: NutritionStateService) {}

  @OnEvent('meal.logged', { async: true, promisify: true })
  async onMealLogged(event: MealLoggedEvent): Promise<void> {
    await this.state.markStale(event.userId);
  }

  @OnEvent('weight.updated', { async: true, promisify: true })
  async onWeightUpdated(event: WeightUpdatedEvent): Promise<void> {
    await this.state.markStale(event.userId);
  }
}
