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
exports.ProgressService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const event_emitter_1 = require("@nestjs/event-emitter");
const progress_event_1 = require("../orchestrator/events/progress.event");
let ProgressService = class ProgressService {
    constructor(prisma, eventEmitter) {
        this.prisma = prisma;
        this.eventEmitter = eventEmitter;
    }
    async logWeight(userId, dto) {
        const now = new Date();
        const entry = await this.prisma.weightLog.create({
            data: { userId, date: now, weightKg: dto.weightKg, notes: dto.notes },
        });
        if (dto.bodyFatPct || dto.waistCm) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            await this.prisma.bodyMeasurement.upsert({
                where: { userId_date: { userId, date: today } },
                create: {
                    userId,
                    date: today,
                    bodyFatPct: dto.bodyFatPct ?? null,
                    waistCm: dto.waistCm ?? null,
                },
                update: {
                    bodyFatPct: dto.bodyFatPct ?? undefined,
                    waistCm: dto.waistCm ?? undefined,
                },
            });
        }
        await this.prisma.userProfile.update({
            where: { userId },
            data: { weightKg: dto.weightKg },
        });
        this.eventEmitter.emit('weight.updated', new progress_event_1.WeightUpdatedEvent(userId, dto.weightKg, now));
        return entry;
    }
    async getHistory(userId) {
        return this.prisma.weightLog.findMany({
            where: { userId },
            orderBy: { date: 'asc' },
            take: 30,
        });
    }
    async getSummary(userId) {
        const logs = await this.prisma.weightLog.findMany({
            where: { userId },
            orderBy: { date: 'asc' },
        });
        if (logs.length === 0) {
            return { message: 'Sin registros de peso todavía. Registra tu peso con POST /progress/weight' };
        }
        const goal = await this.prisma.goal.findFirst({ where: { userId, isActive: true } });
        const first = logs[0];
        const last = logs[logs.length - 1];
        const totalChange = Math.round((last.weightKg - first.weightKg) * 10) / 10;
        const days = Math.max(1, Math.round((last.date.getTime() - first.date.getTime()) / (1000 * 60 * 60 * 24)));
        const weeklyRate = Math.round((totalChange / days) * 7 * 100) / 100;
        let trend = 'insufficient_data';
        if (logs.length >= 3) {
            if (weeklyRate < -0.3)
                trend = 'losing';
            else if (weeklyRate > 0.2)
                trend = 'gaining';
            else
                trend = 'stable';
        }
        return {
            recordings: logs.length,
            startWeight: first.weightKg,
            currentWeight: last.weightKg,
            totalChange,
            weeklyRate,
            trend,
            daysTracked: days,
            goal: goal?.type ?? null,
            targetWeight: goal?.targetWeightKg ?? null,
            toGoal: goal?.targetWeightKg
                ? Math.round((goal.targetWeightKg - last.weightKg) * 10) / 10
                : null,
            history: logs,
        };
    }
};
exports.ProgressService = ProgressService;
exports.ProgressService = ProgressService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        event_emitter_1.EventEmitter2])
], ProgressService);
//# sourceMappingURL=progress.service.js.map