import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WeightUpdatedEvent } from './events/progress.event';
import { MealLoggedEvent } from './events/meal.event';
import { OnboardingCompletedEvent } from './events/onboarding.event';

@Injectable()
export class OrchestratorService {
  constructor(private eventEmitter: EventEmitter2) {}

  emitWeightUpdated(userId: string, weightKg: number, date: Date) {
    this.eventEmitter.emit('weight.updated', new WeightUpdatedEvent(userId, weightKg, date));
  }

  emitMealLogged(userId: string, mealId: string, loggedAt: Date, totalCalories: number) {
    this.eventEmitter.emit('meal.logged', new MealLoggedEvent(userId, mealId, loggedAt, totalCalories));
  }

  emitOnboardingCompleted(userId: string, goalType: string) {
    this.eventEmitter.emit('onboarding.completed', new OnboardingCompletedEvent(userId, goalType));
  }

  getStatus() {
    return {
      status: 'active',
      events: ['weight.updated', 'meal.logged', 'onboarding.completed', 'user.inactive'],
      handlers: ['progress-analyst', 'recommendation-engine', 'retention-agent'],
    };
  }
}
