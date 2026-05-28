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
exports.LogsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const event_emitter_1 = require("@nestjs/event-emitter");
const meal_event_1 = require("../orchestrator/events/meal.event");
let LogsService = class LogsService {
    constructor(prisma, eventEmitter) {
        this.prisma = prisma;
        this.eventEmitter = eventEmitter;
    }
    async logMeal(userId, dto) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let dailyLog = await this.prisma.dailyLog.findUnique({
            where: { userId_date: { userId, date: today } },
        });
        if (!dailyLog) {
            dailyLog = await this.prisma.dailyLog.create({
                data: { userId, date: today },
            });
        }
        const meal = await this.prisma.loggedMeal.create({
            data: {
                dailyLogId: dailyLog.id,
                mealType: dto.mealType,
                name: dto.name ?? dto.mealType,
                totalCalories: dto.totalCalories,
                totalProteinG: dto.totalProteinG,
                totalCarbsG: dto.totalCarbsG,
                totalFatG: dto.totalFatG,
            },
        });
        const meals = await this.prisma.loggedMeal.findMany({
            where: { dailyLogId: dailyLog.id },
        });
        const totals = meals.reduce((acc, m) => ({
            calories: acc.calories + m.totalCalories,
            protein: acc.protein + Number(m.totalProteinG),
            carbs: acc.carbs + Number(m.totalCarbsG),
            fat: acc.fat + Number(m.totalFatG),
        }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
        const updated = await this.prisma.dailyLog.update({
            where: { id: dailyLog.id },
            data: {
                caloriesLogged: totals.calories,
                proteinG: totals.protein,
                carbsG: totals.carbs,
                fatG: totals.fat,
            },
            include: { loggedMeals: true },
        });
        this.eventEmitter.emit('meal.logged', new meal_event_1.MealLoggedEvent(userId, meal.id, new Date(), totals.calories));
        return updated;
    }
    async getToday(userId) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dailyLog = await this.prisma.dailyLog.findUnique({
            where: { userId_date: { userId, date: today } },
            include: { loggedMeals: true },
        });
        if (!dailyLog) {
            return { message: 'No hay registros para hoy', date: today, meals: [], totals: { calories: 0, protein: 0, carbs: 0, fat: 0 } };
        }
        const goal = await this.prisma.goal.findFirst({
            where: { userId, isActive: true },
        });
        const remaining = goal ? {
            calories: goal.targetCalories - dailyLog.caloriesLogged,
            proteinG: goal.proteinG - Number(dailyLog.proteinG),
            carbsG: goal.carbsG - Number(dailyLog.carbsG),
            fatG: goal.fatG - Number(dailyLog.fatG),
        } : null;
        return {
            date: today,
            totals: {
                calories: dailyLog.caloriesLogged,
                proteinG: dailyLog.proteinG,
                carbsG: dailyLog.carbsG,
                fatG: dailyLog.fatG,
            },
            target: goal ? {
                calories: goal.targetCalories,
                proteinG: goal.proteinG,
                carbsG: goal.carbsG,
                fatG: goal.fatG,
            } : null,
            remaining,
            meals: dailyLog.loggedMeals,
        };
    }
    async getRecent(userId) {
        const logs = await this.prisma.dailyLog.findMany({
            where: { userId },
            orderBy: { date: 'desc' },
            take: 7,
            include: { loggedMeals: true },
        });
        return logs;
    }
};
exports.LogsService = LogsService;
exports.LogsService = LogsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        event_emitter_1.EventEmitter2])
], LogsService);
//# sourceMappingURL=logs.service.js.map