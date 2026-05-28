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
var ProgressHandler_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProgressHandler = void 0;
const common_1 = require("@nestjs/common");
const event_emitter_1 = require("@nestjs/event-emitter");
const prisma_service_1 = require("../../prisma/prisma.service");
const progress_event_1 = require("../events/progress.event");
let ProgressHandler = ProgressHandler_1 = class ProgressHandler {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(ProgressHandler_1.name);
    }
    async handle(event) {
        this.logger.log(`[progress-analyst] weight.updated for user ${event.userId}`);
        const logs = await this.prisma.weightLog.findMany({
            where: { userId: event.userId },
            orderBy: { date: 'asc' },
            take: 14,
        });
        if (logs.length < 3) {
            this.logger.log(`[progress-analyst] insufficient_data — ${logs.length} recordings`);
            return;
        }
        const first = logs[0].weightKg;
        const last = logs[logs.length - 1].weightKg;
        const days = Math.max(1, logs.length - 1);
        const weeklyRate = Math.round(((last - first) / days) * 7 * 100) / 100;
        let status = 'on_track';
        const goal = await this.prisma.goal.findFirst({
            where: { userId: event.userId, isActive: true },
        });
        if (goal?.type === 'LOSE_FAT') {
            if (weeklyRate > -0.1)
                status = 'stalled';
            else if (weeklyRate < -0.9)
                status = 'too_fast';
            else
                status = 'on_track';
        }
        else if (goal?.type === 'GAIN_MUSCLE') {
            status = weeklyRate < 0.1 ? 'stalled' : 'on_track';
        }
        this.logger.log(`[progress-analyst] status=${status} weekly_rate=${weeklyRate} kg/week`);
        await this.prisma.dailyLog.upsert({
            where: { userId_date: { userId: event.userId, date: event.date } },
            create: { userId: event.userId, date: event.date, notes: `progress_status:${status}` },
            update: { notes: `progress_status:${status}` },
        });
    }
};
exports.ProgressHandler = ProgressHandler;
__decorate([
    (0, event_emitter_1.OnEvent)('weight.updated'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [progress_event_1.WeightUpdatedEvent]),
    __metadata("design:returntype", Promise)
], ProgressHandler.prototype, "handle", null);
exports.ProgressHandler = ProgressHandler = ProgressHandler_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ProgressHandler);
//# sourceMappingURL=progress.handler.js.map