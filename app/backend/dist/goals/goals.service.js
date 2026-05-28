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
exports.GoalsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let GoalsService = class GoalsService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(userId, dto) {
        const profile = await this.prisma.userProfile.findUnique({ where: { userId } });
        if (!profile)
            throw new common_1.BadRequestException('Completa tu perfil antes de crear un objetivo');
        await this.prisma.goal.updateMany({
            where: { userId, isActive: true },
            data: { isActive: false },
        });
        const goal = await this.prisma.goal.create({
            data: {
                userId,
                type: dto.type,
                targetWeightKg: dto.targetWeightKg ?? null,
                targetCalories: 0,
                proteinG: 0,
                carbsG: 0,
                fatG: 0,
                fiberTargetG: 0,
                waterMl: 0,
                bmr: 0,
                tdee: 0,
                formulaUsed: 'pending',
                goalAdjustment: 0,
                isActive: true,
            },
        });
        return goal;
    }
    async getActive(userId) {
        const goal = await this.prisma.goal.findFirst({
            where: { userId, isActive: true },
            orderBy: { createdAt: 'desc' },
        });
        if (!goal)
            return { message: 'No tienes un objetivo activo. Crea uno con POST /goals' };
        return goal;
    }
    async getAll(userId) {
        return this.prisma.goal.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
        });
    }
};
exports.GoalsService = GoalsService;
exports.GoalsService = GoalsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], GoalsService);
//# sourceMappingURL=goals.service.js.map