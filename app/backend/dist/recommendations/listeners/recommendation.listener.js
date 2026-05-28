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
var RecommendationListener_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecommendationListener = void 0;
const common_1 = require("@nestjs/common");
const event_emitter_1 = require("@nestjs/event-emitter");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../../prisma/prisma.service");
const expo_push_service_1 = require("../../push/services/expo-push.service");
const recommendation_service_1 = require("../services/recommendation.service");
const meal_event_1 = require("../../orchestrator/events/meal.event");
let RecommendationListener = RecommendationListener_1 = class RecommendationListener {
    constructor(recommendation, prisma, expoPush) {
        this.recommendation = recommendation;
        this.prisma = prisma;
        this.expoPush = expoPush;
        this.logger = new common_1.Logger(RecommendationListener_1.name);
    }
    async handleMealLogged(event) {
        this.logger.log(`[meal.logged] userId=${event.userId} mealId=${event.mealId}`);
        const text = await this.recommendation.generateForUser(event.userId, 'meal.logged');
        await this.prisma.recommendation.create({
            data: {
                userId: event.userId,
                type: client_1.RecommendationType.BEHAVIOR_RECOMMENDATION,
                priority: client_1.Priority.MEDIUM,
                trigger: 'meal.logged',
                messageForUser: text,
            },
        });
        this.expoPush.sendToUser(event.userId, 'Vitals Fit', text, 'meal.logged');
        this.logger.log(`[meal.logged] recomendación generada: ${text.slice(0, 80)}`);
    }
};
exports.RecommendationListener = RecommendationListener;
__decorate([
    (0, event_emitter_1.OnEvent)('meal.logged', { async: true, promisify: true }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [meal_event_1.MealLoggedEvent]),
    __metadata("design:returntype", Promise)
], RecommendationListener.prototype, "handleMealLogged", null);
exports.RecommendationListener = RecommendationListener = RecommendationListener_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [recommendation_service_1.RecommendationService,
        prisma_service_1.PrismaService,
        expo_push_service_1.ExpoPushService])
], RecommendationListener);
//# sourceMappingURL=recommendation.listener.js.map