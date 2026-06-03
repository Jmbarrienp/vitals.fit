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
var RecommendationsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecommendationsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let RecommendationsService = RecommendationsService_1 = class RecommendationsService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(RecommendationsService_1.name);
    }
    async generate(userId) {
        const goal = await this.prisma.goal.findFirst({ where: { userId, isActive: true } });
        if (!goal)
            return { message: 'Crea un objetivo primero', recommendations: [] };
        const weightLogs = await this.prisma.weightLog.findMany({
            where: { userId },
            orderBy: { date: 'asc' },
            take: 14,
        });
        const recentLogs = await this.prisma.dailyLog.findMany({
            where: { userId },
            orderBy: { date: 'desc' },
            take: 7,
        });
        const recommendations = [];
        if (weightLogs.length < 3) {
            recommendations.push({
                type: 'DATA_COLLECTION',
                priority: 'MEDIUM',
                message: `Registra tu peso diariamente. Con ${weightLogs.length} registro(s) todavía no podemos analizar tu tendencia — necesitamos al menos 3.`,
                action: null,
            });
        }
        if (weightLogs.length >= 3) {
            const first = weightLogs[0].weightKg;
            const last = weightLogs[weightLogs.length - 1].weightKg;
            const change = last - first;
            const days = Math.max(1, weightLogs.length);
            const weeklyRate = (change / days) * 7;
            if (goal.type === 'LOSE_FAT' && weeklyRate > -0.1) {
                recommendations.push({
                    type: 'PLAN_ADJUSTMENT',
                    priority: 'HIGH',
                    message: `Tu peso lleva ${days} días casi sin cambio. Sugerimos reducir 200 kcal (de ${goal.targetCalories} a ${goal.targetCalories - 200} kcal) para retomar el progreso.`,
                    action: { calorieAdjustment: -200 },
                });
            }
            if (goal.type === 'LOSE_FAT' && weeklyRate < -0.9) {
                recommendations.push({
                    type: 'SAFETY',
                    priority: 'HIGH',
                    message: `Estás perdiendo peso muy rápido (${Math.abs(weeklyRate).toFixed(1)} kg/semana). Aumentamos 100 kcal para proteger tu masa muscular.`,
                    action: { calorieAdjustment: 100 },
                });
            }
            if (goal.type === 'GAIN_MUSCLE' && weeklyRate < 0.1) {
                recommendations.push({
                    type: 'PLAN_ADJUSTMENT',
                    priority: 'MEDIUM',
                    message: `El progreso de ganancia es más lento de lo esperado. Sugerimos aumentar 100 kcal (de ${goal.targetCalories} a ${goal.targetCalories + 100} kcal).`,
                    action: { calorieAdjustment: 100 },
                });
            }
            if (goal.type === 'LOSE_FAT' && weeklyRate <= -0.3 && weeklyRate >= -0.8) {
                recommendations.push({
                    type: 'REINFORCEMENT',
                    priority: 'LOW',
                    message: `Vas muy bien. Tu ritmo de pérdida es ${Math.abs(weeklyRate).toFixed(2)} kg/semana — exactamente dentro del rango óptimo. Mantén el plan.`,
                    action: null,
                });
            }
        }
        if (recentLogs.length >= 3) {
            const daysWithData = recentLogs.filter(l => l.caloriesLogged > 0).length;
            const adherencePct = Math.round((daysWithData / recentLogs.length) * 100);
            if (adherencePct < 50) {
                recommendations.push({
                    type: 'BEHAVIOR',
                    priority: 'HIGH',
                    message: `Registraste comidas solo ${adherencePct}% de los días recientes. El primer paso no es ajustar calorías — es registrar. Prueba registrar solo el desayuno esta semana.`,
                    action: null,
                });
            }
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayLog = await this.prisma.dailyLog.findUnique({
            where: { userId_date: { userId, date: today } },
        });
        if (!todayLog || todayLog.caloriesLogged === 0) {
            recommendations.push({
                type: 'REMINDER',
                priority: 'LOW',
                message: `Aún no registraste comidas hoy. Tu meta es ${goal.targetCalories} kcal — empieza por el desayuno.`,
                action: null,
            });
        }
        const saved = await Promise.all(recommendations.map(r => this.prisma.recommendation.create({
            data: {
                userId,
                type: r.type,
                priority: r.priority,
                trigger: 'simple_rules_engine',
                messageForUser: r.message,
                planChange: r.action?.calorieAdjustment !== undefined,
                calorieAdjustment: r.action?.calorieAdjustment ?? null,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
        })));
        return {
            generated: saved.length,
            recommendations: saved.map((r, i) => ({
                ...r,
                summary: recommendations[i].message,
            })),
        };
    }
    async getActive(userId) {
        return this.prisma.recommendation.findMany({
            where: { userId, status: 'PENDING' },
            orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
        });
    }
    async getHistory(userId) {
        try {
            return await this.prisma.recommendation.findMany({
                where: { userId },
                orderBy: { createdAt: 'desc' },
                take: 30,
                select: {
                    id: true,
                    type: true,
                    priority: true,
                    trigger: true,
                    messageForUser: true,
                    status: true,
                    planChange: true,
                    calorieAdjustment: true,
                    createdAt: true,
                },
            });
        }
        catch (err) {
            this.logger.error('getHistory failed', err);
            throw err;
        }
    }
    async respond(userId, id, action) {
        const rec = await this.prisma.recommendation.findFirst({
            where: { id, userId },
        });
        if (!rec)
            return { message: 'Recomendación no encontrada' };
        if (action === 'ACCEPTED' && rec.calorieAdjustment) {
            const goal = await this.prisma.goal.findFirst({ where: { userId, isActive: true } });
            if (goal) {
                const newCalories = goal.targetCalories + rec.calorieAdjustment;
                await this.prisma.goal.update({
                    where: { id: goal.id },
                    data: { targetCalories: Math.max(1200, newCalories) },
                });
            }
        }
        return this.prisma.recommendation.update({
            where: { id },
            data: {
                status: action === 'ACCEPTED' ? 'ACCEPTED' : 'REJECTED',
                respondedAt: new Date(),
                userResponse: action,
            },
        });
    }
};
exports.RecommendationsService = RecommendationsService;
exports.RecommendationsService = RecommendationsService = RecommendationsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], RecommendationsService);
//# sourceMappingURL=recommendations.service.js.map