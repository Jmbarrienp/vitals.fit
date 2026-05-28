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
exports.ContextBuilderService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../../prisma/prisma.service");
const PERSONA_MAP = {
    PRINCIPIANTE_MOTIVADO: 'beginner',
    ATLETA_AMATEUR: 'athlete',
    OCUPADO_CONSISTENTE: 'busy',
    REINCIDENTE: 'returning',
    EXPERTO_AUTODIRIGIDO: 'expert',
};
const GOAL_MAP = {
    LOSE_FAT: 'lose',
    GAIN_MUSCLE: 'gain',
    MAINTAIN: 'maintain',
    RECOMPOSITION: 'maintain',
    HEALTH_WELLNESS: 'maintain',
};
const SEX_MAP = {
    MALE: 'male',
    FEMALE: 'female',
    OTHER: 'other',
};
let ContextBuilderService = class ContextBuilderService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async buildSnapshot(userId) {
        const today = startOfDay(new Date());
        const sevenDaysAgo = startOfDay(new Date());
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const [profileData, goalData, todayLog, habitsData, last7Logs, recentWeights] = await Promise.all([
            this.prisma.userProfile.findUnique({
                where: { userId },
                select: { persona: true, sex: true },
            }),
            this.prisma.goal.findFirst({
                where: { userId, isActive: true },
                orderBy: { createdAt: 'desc' },
                select: {
                    type: true,
                    targetCalories: true,
                    proteinG: true,
                    carbsG: true,
                    fatG: true,
                    tdee: true,
                },
            }),
            this.prisma.dailyLog.findUnique({
                where: { userId_date: { userId, date: today } },
                select: {
                    caloriesLogged: true,
                    proteinG: true,
                    carbsG: true,
                    fatG: true,
                    loggedMeals: {
                        select: { name: true, totalCalories: true, mealType: true },
                        orderBy: { loggedAt: 'desc' },
                        take: 3,
                    },
                },
            }),
            this.prisma.userHabits.findUnique({
                where: { userId },
                select: { currentStreak: true },
            }),
            this.prisma.dailyLog.findMany({
                where: { userId, date: { gte: sevenDaysAgo } },
                select: { adherencePct: true, planFollowed: true },
                orderBy: { date: 'desc' },
            }),
            this.prisma.weightLog.findMany({
                where: { userId },
                orderBy: { date: 'desc' },
                take: 2,
                select: { weightKg: true },
            }),
        ]);
        const personaKey = profileData?.persona ?? client_1.PersonaType.PRINCIPIANTE_MOTIVADO;
        const goalKey = goalData?.type ?? client_1.GoalType.MAINTAIN;
        const sexKey = profileData?.sex ?? client_1.Sex.OTHER;
        const recentMeals = (todayLog?.loggedMeals ?? []).map((m) => ({
            name: m.name ?? 'Comida',
            calories: m.totalCalories,
            mealType: m.mealType.toLowerCase(),
        }));
        return {
            userId,
            goal: GOAL_MAP[goalKey],
            persona: PERSONA_MAP[personaKey],
            sex: SEX_MAP[sexKey],
            targets: {
                tdee: Math.round(goalData?.tdee ?? 2000),
                calories: goalData?.targetCalories ?? 2000,
                proteinG: goalData?.proteinG ?? 150,
                carbsG: goalData?.carbsG ?? 200,
                fatG: goalData?.fatG ?? 65,
            },
            today: {
                caloriesLogged: todayLog?.caloriesLogged ?? 0,
                proteinG: todayLog?.proteinG ?? 0,
                carbsG: todayLog?.carbsG ?? 0,
                fatG: todayLog?.fatG ?? 0,
                mealsLogged: todayLog?.loggedMeals.length ?? 0,
                recentMeals,
            },
            progress: {
                weightTrendKg: computeWeightTrend(recentWeights),
                adherencePct7d: computeAdherence(last7Logs),
            },
            streak: {
                currentDays: habitsData?.currentStreak ?? 0,
            },
        };
    }
};
exports.ContextBuilderService = ContextBuilderService;
exports.ContextBuilderService = ContextBuilderService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ContextBuilderService);
function startOfDay(date) {
    date.setHours(0, 0, 0, 0);
    return date;
}
function computeAdherence(logs) {
    const evaluated = logs.filter((l) => l.planFollowed !== null);
    if (evaluated.length === 0)
        return 0;
    const sum = evaluated.reduce((acc, l) => {
        if (l.adherencePct !== null)
            return acc + l.adherencePct * 100;
        return acc + (l.planFollowed ? 100 : 0);
    }, 0);
    return Math.round(sum / evaluated.length);
}
function computeWeightTrend(weights) {
    if (weights.length < 2)
        return null;
    return Math.round((weights[0].weightKg - weights[1].weightKg) * 10) / 10;
}
//# sourceMappingURL=context-builder.service.js.map