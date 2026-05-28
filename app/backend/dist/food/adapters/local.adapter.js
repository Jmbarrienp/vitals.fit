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
exports.LocalFoodAdapter = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
let LocalFoodAdapter = class LocalFoodAdapter {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async search(query, limit) {
        const q = query.toLowerCase().trim();
        const items = await this.prisma.foodItem.findMany({
            where: {
                OR: [
                    { nameLower: { contains: q } },
                    { nameAliases: { has: q } },
                ],
            },
            orderBy: [{ isCommon: 'desc' }, { name: 'asc' }],
            take: limit,
        });
        return items.map(this.normalize);
    }
    async getCommon(limit) {
        const items = await this.prisma.foodItem.findMany({
            where: { isCommon: true },
            orderBy: { name: 'asc' },
            take: limit,
        });
        return items.map(this.normalize);
    }
    async findById(id) {
        const item = await this.prisma.foodItem.findUnique({ where: { id } });
        return item ? this.normalize(item) : null;
    }
    normalize(item) {
        return {
            id: item.id,
            name: item.name,
            caloriesPer100g: item.caloriesPer100g,
            proteinPer100g: item.proteinPer100g,
            carbsPer100g: item.carbsPer100g,
            fatPer100g: item.fatPer100g,
            fiberPer100g: item.fiberPer100g,
            source: item.source,
            isCommon: item.isCommon,
        };
    }
};
exports.LocalFoodAdapter = LocalFoodAdapter;
exports.LocalFoodAdapter = LocalFoodAdapter = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], LocalFoodAdapter);
//# sourceMappingURL=local.adapter.js.map