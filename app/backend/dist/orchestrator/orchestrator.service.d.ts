import { EventEmitter2 } from '@nestjs/event-emitter';
export declare class OrchestratorService {
    private eventEmitter;
    constructor(eventEmitter: EventEmitter2);
    emitWeightUpdated(userId: string, weightKg: number, date: Date): void;
    emitMealLogged(userId: string, mealId: string, loggedAt: Date, totalCalories: number): void;
    emitOnboardingCompleted(userId: string, goalType: string): void;
    getStatus(): {
        status: string;
        events: string[];
        handlers: string[];
    };
}
