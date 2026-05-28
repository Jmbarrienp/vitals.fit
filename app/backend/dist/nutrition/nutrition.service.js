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
exports.NutritionService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const ACTIVITY_FACTORS = {
    SEDENTARY: 1.2,
    LIGHT: 1.375,
    MODERATE: 1.55,
    ACTIVE: 1.725,
    EXTRA: 1.9,
};
const GOAL_ADJUSTMENTS = {
    LOSE_FAT: -350,
    GAIN_MUSCLE: 250,
    MAINTAIN: 0,
    RECOMPOSITION: -150,
    HEALTH_WELLNESS: 0,
};
const PROTEIN_RATIOS = {
    LOSE_FAT: 2.2,
    GAIN_MUSCLE: 2.0,
    MAINTAIN: 1.8,
    RECOMPOSITION: 2.4,
    HEALTH_WELLNESS: 1.6,
};
const MINIMUMS = { MALE: 1500, FEMALE: 1200, OTHER: 1200 };
let NutritionService = class NutritionService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async calculate(userId) {
        const profile = await this.prisma.userProfile.findUnique({ where: { userId } });
        if (!profile)
            throw new common_1.BadRequestException('Completa tu perfil primero');
        const goal = await this.prisma.goal.findFirst({
            where: { userId, isActive: true },
        });
        if (!goal)
            throw new common_1.BadRequestException('Crea un objetivo primero con POST /goals');
        const { weightKg, heightCm, age, sex, activityLevel } = profile;
        const bmr = sex === 'MALE'
            ? (10 * weightKg) + (6.25 * heightCm) - (5 * age) + 5
            : (10 * weightKg) + (6.25 * heightCm) - (5 * age) - 161;
        const activityFactor = ACTIVITY_FACTORS[activityLevel] ?? 1.2;
        const tdee = Math.round(bmr * activityFactor);
        const adjustment = GOAL_ADJUSTMENTS[goal.type] ?? 0;
        let targetCalories = tdee + adjustment;
        const minimum = MINIMUMS[sex] ?? 1200;
        const minimumApplied = targetCalories < minimum;
        if (minimumApplied)
            targetCalories = minimum;
        const heightM = heightCm / 100;
        const bmi = Math.round((weightKg / (heightM * heightM)) * 10) / 10;
        const proteinRatio = PROTEIN_RATIOS[goal.type] ?? 1.8;
        const proteinG = Math.round(proteinRatio * weightKg);
        const proteinKcal = proteinG * 4;
        const fatKcal = Math.round(targetCalories * 0.27);
        const fatG = Math.round(fatKcal / 9);
        const carbKcal = targetCalories - proteinKcal - fatKcal;
        const carbsG = Math.round(carbKcal / 4);
        const fiberTargetG = sex === 'MALE' ? 38 : 25;
        const waterMl = Math.round(weightKg * 35);
        const updatedGoal = await this.prisma.goal.update({
            where: { id: goal.id },
            data: {
                targetCalories,
                proteinG,
                carbsG,
                fatG,
                fiberTargetG,
                waterMl,
                bmr: Math.round(bmr),
                tdee,
                formulaUsed: 'mifflin_st_jeor',
                goalAdjustment: adjustment,
            },
        });
        await this.prisma.planHistory.create({
            data: {
                userId,
                goalId: goal.id,
                version: 1,
                caloriesTarget: targetCalories,
                proteinG,
                carbsG,
                fatG,
                activeFrom: new Date(),
                reasonForChange: 'Initial calculation',
                agentResponsible: 'nutrition-core',
            },
        });
        return {
            formula: 'mifflin_st_jeor',
            inputs: { weightKg, heightCm, age, sex, activityLevel, goal: goal.type },
            calculations: {
                bmr: Math.round(bmr),
                activityFactor,
                tdee,
                goalAdjustment: adjustment,
                targetCalories,
                minimumApplied,
                bmi,
                bmiCategory: this.getBmiCategory(bmi),
            },
            macros: {
                protein: { g: proteinG, kcal: proteinG * 4, pct: Math.round((proteinG * 4 / targetCalories) * 100) },
                fat: { g: fatG, kcal: fatKcal, pct: Math.round((fatKcal / targetCalories) * 100) },
                carbs: { g: carbsG, kcal: carbKcal, pct: Math.round((carbKcal / targetCalories) * 100) },
                fiber: { g: fiberTargetG },
                water: { ml: waterMl },
            },
            goal: updatedGoal,
        };
    }
    getBmiCategory(bmi) {
        if (bmi < 18.5)
            return 'underweight';
        if (bmi < 25)
            return 'normal';
        if (bmi < 30)
            return 'overweight';
        if (bmi < 35)
            return 'obesity_grade_1';
        return 'obesity_grade_2';
    }
};
exports.NutritionService = NutritionService;
exports.NutritionService = NutritionService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], NutritionService);
//# sourceMappingURL=nutrition.service.js.map