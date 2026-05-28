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
exports.DeviceTokenService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
let DeviceTokenService = class DeviceTokenService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async upsert(userId, token, platform) {
        await this.prisma.deviceToken.upsert({
            where: { token },
            update: { userId, platform, isActive: true },
            create: { userId, token, platform },
        });
    }
    async getActiveForUser(userId) {
        const rows = await this.prisma.deviceToken.findMany({
            where: { userId, isActive: true },
            select: { token: true },
        });
        return rows.map((r) => r.token);
    }
    async markInactive(token) {
        await this.prisma.deviceToken.updateMany({
            where: { token },
            data: { isActive: false },
        });
    }
};
exports.DeviceTokenService = DeviceTokenService;
exports.DeviceTokenService = DeviceTokenService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], DeviceTokenService);
//# sourceMappingURL=device-token.service.js.map