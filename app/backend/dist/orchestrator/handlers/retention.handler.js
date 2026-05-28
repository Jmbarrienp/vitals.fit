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
var RetentionHandler_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RetentionHandler = void 0;
const common_1 = require("@nestjs/common");
const event_emitter_1 = require("@nestjs/event-emitter");
const prisma_service_1 = require("../../prisma/prisma.service");
const meal_event_1 = require("../events/meal.event");
const onboarding_event_1 = require("../events/onboarding.event");
let RetentionHandler = RetentionHandler_1 = class RetentionHandler {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(RetentionHandler_1.name);
    }
    async handleMealLogged(event) {
        this.logger.log(`[retention-agent] meal.logged for ${event.userId} — ${event.totalCalories} kcal`);
        const habits = await this.prisma.userHabits.findUnique({
            where: { userId: event.userId },
        });
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        let newStreak = 1;
        if (habits?.lastActiveAt) {
            const lastDate = new Date(habits.lastActiveAt);
            lastDate.setHours(0, 0, 0, 0);
            if (lastDate.getTime() === yesterday.getTime()) {
                newStreak = (habits.currentStreak ?? 0) + 1;
            }
        }
        await this.prisma.userHabits.upsert({
            where: { userId: event.userId },
            create: {
                userId: event.userId,
                lastActiveAt: new Date(),
                currentStreak: newStreak,
                longestStreak: newStreak,
                daysInactive: 0,
                typicalMealTimes: [],
                preferredFoods: [],
                dislikedFoods: [],
            },
            update: {
                lastActiveAt: new Date(),
                currentStreak: newStreak,
                longestStreak: Math.max(newStreak, habits?.longestStreak ?? 0),
                daysInactive: 0,
            },
        });
        await this.checkMilestones(event.userId, newStreak);
        this.logger.log(`[retention-agent] streak updated to ${newStreak}`);
    }
    async handleOnboarding(event) {
        this.logger.log(`[retention-agent] onboarding.completed for ${event.userId} — goal: ${event.goalType}`);
        await this.prisma.userHabits.upsert({
            where: { userId: event.userId },
            create: {
                userId: event.userId,
                lastActiveAt: new Date(),
                currentStreak: 1,
                longestStreak: 1,
                daysInactive: 0,
                typicalMealTimes: [],
                preferredFoods: [],
                dislikedFoods: [],
            },
            update: { lastActiveAt: new Date() },
        });
        this.logger.log(`[retention-agent] habits initialized`);
    }
    async checkMilestones(userId, streak) {
        const milestoneMap = {
            7: 'STREAK_7_DAYS',
            30: 'STREAK_30_DAYS',
        };
        const milestoneType = milestoneMap[streak];
        if (!milestoneType)
            return;
        const existing = await this.prisma.userMilestone.findFirst({
            where: { userId, type: milestoneType },
        });
        if (!existing) {
            await this.prisma.userMilestone.create({
                data: { userId, type: milestoneType },
            });
            this.logger.log(`[retention-agent] 🎯 milestone unlocked: ${milestoneType}`);
        }
    }
};
exports.RetentionHandler = RetentionHandler;
__decorate([
    (0, event_emitter_1.OnEvent)('meal.logged'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [meal_event_1.MealLoggedEvent]),
    __metadata("design:returntype", Promise)
], RetentionHandler.prototype, "handleMealLogged", null);
__decorate([
    (0, event_emitter_1.OnEvent)('onboarding.completed'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [onboarding_event_1.OnboardingCompletedEvent]),
    __metadata("design:returntype", Promise)
], RetentionHandler.prototype, "handleOnboarding", null);
exports.RetentionHandler = RetentionHandler = RetentionHandler_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], RetentionHandler);
//# sourceMappingURL=retention.handler.js.map