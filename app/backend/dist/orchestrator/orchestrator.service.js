"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrchestratorService = void 0;
const common_1 = require("@nestjs/common");
const event_emitter_1 = require("@nestjs/event-emitter");
const progress_event_1 = require("./events/progress.event");
const meal_event_1 = require("./events/meal.event");
const onboarding_event_1 = require("./events/onboarding.event");
let OrchestratorService = class OrchestratorService {
    constructor(eventEmitter) {
        this.eventEmitter = eventEmitter;
    }
    emitWeightUpdated(userId, weightKg, date) {
        this.eventEmitter.emit('weight.updated', new progress_event_1.WeightUpdatedEvent(userId, weightKg, date));
    }
    emitMealLogged(userId, mealId, loggedAt, totalCalories) {
        this.eventEmitter.emit('meal.logged', new meal_event_1.MealLoggedEvent(userId, mealId, loggedAt, totalCalories));
    }
    emitOnboardingCompleted(userId, goalType) {
        this.eventEmitter.emit('onboarding.completed', new onboarding_event_1.OnboardingCompletedEvent(userId, goalType));
    }
    getStatus() {
        return {
            status: 'active',
            events: ['weight.updated', 'meal.logged', 'onboarding.completed', 'user.inactive'],
            handlers: ['progress-analyst', 'recommendation-engine', 'retention-agent'],
        };
    }
};
exports.OrchestratorService = OrchestratorService;
exports.OrchestratorService = OrchestratorService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [event_emitter_1.EventEmitter2])
], OrchestratorService);
//# sourceMappingURL=orchestrator.service.js.map