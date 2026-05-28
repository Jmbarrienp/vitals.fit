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
var RecommendationHandler_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecommendationHandler = void 0;
const common_1 = require("@nestjs/common");
const event_emitter_1 = require("@nestjs/event-emitter");
const prisma_service_1 = require("../../prisma/prisma.service");
const progress_event_1 = require("../events/progress.event");
let RecommendationHandler = RecommendationHandler_1 = class RecommendationHandler {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(RecommendationHandler_1.name);
    }
    async handle(event) {
        this.logger.log(`[recommendation-engine] evaluating after weight update for ${event.userId}`);
        const logs = await this.prisma.weightLog.findMany({
            where: { userId: event.userId },
            orderBy: { date: 'asc' },
            take: 14,
        });
        if (logs.length < 7) {
            this.logger.log(`[recommendation-engine] needs 7+ logs, has ${logs.length} — skipping`);
            return;
        }
        const goal = await this.prisma.goal.findFirst({
            where: { userId: event.userId, isActive: true },
        });
        if (!goal)
            return;
        const lastHistory = await this.prisma.planHistory.findFirst({
            where: { userId: event.userId },
            orderBy: { activeFrom: 'desc' },
        });
        if (lastHistory) {
            const daysSince = Math.floor((Date.now() - lastHistory.activeFrom.getTime()) / (1000 * 60 * 60 * 24));
            if (daysSince < 14) {
                this.logger.log(`[recommendation-engine] cooldown active — ${daysSince}/14 days`);
                return;
            }
        }
        const first = logs[0].weightKg;
        const last = logs[logs.length - 1].weightKg;
        const days = Math.max(1, logs.length - 1);
        const weeklyRate = ((last - first) / days) * 7;
        let message = null;
        let adjustment = 0;
        if (goal.type === 'LOSE_FAT' && weeklyRate > -0.1) {
            adjustment = -200;
            message = `Tu peso lleva estable ${logs.length} días. El recommendation-engine sugiere reducir ${Math.abs(adjustment)} kcal para retomar el progreso.`;
        }
        else if (goal.type === 'LOSE_FAT' && weeklyRate < -0.9) {
            adjustment = 100;
            message = `Estás perdiendo peso más rápido de lo recomendado. El recommendation-engine sugiere aumentar ${adjustment} kcal para proteger músculo.`;
        }
        else if (goal.type === 'GAIN_MUSCLE' && weeklyRate < 0.1) {
            adjustment = 100;
            message = `Sin progreso de ganancia en ${logs.length} días. El recommendation-engine sugiere aumentar ${adjustment} kcal.`;
        }
        if (message) {
            await this.prisma.recommendation.create({
                data: {
                    userId: event.userId,
                    type: 'PLAN_ADJUSTMENT',
                    priority: 'HIGH',
                    trigger: 'weight.updated → recommendation-engine',
                    messageForUser: message,
                    planChange: true,
                    calorieAdjustment: adjustment,
                    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                },
            });
            this.logger.log(`[recommendation-engine] created recommendation: ${adjustment} kcal`);
        }
        else {
            this.logger.log(`[recommendation-engine] on_track — no adjustment needed`);
        }
    }
};
exports.RecommendationHandler = RecommendationHandler;
__decorate([
    (0, event_emitter_1.OnEvent)('weight.updated'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [progress_event_1.WeightUpdatedEvent]),
    __metadata("design:returntype", Promise)
], RecommendationHandler.prototype, "handle", null);
exports.RecommendationHandler = RecommendationHandler = RecommendationHandler_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], RecommendationHandler);
//# sourceMappingURL=recommendation.handler.js.map