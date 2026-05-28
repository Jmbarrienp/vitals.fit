import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FoodAdapter, NormalizedFood } from './food-adapter.interface';

@Injectable()
export class LocalFoodAdapter implements FoodAdapter {
  constructor(private prisma: PrismaService) {}

  async search(query: string, limit: number): Promise<NormalizedFood[]> {
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

  async getCommon(limit: number): Promise<NormalizedFood[]> {
    const items = await this.prisma.foodItem.findMany({
      where: { isCommon: true },
      orderBy: { name: 'asc' },
      take: limit,
    });
    return items.map(this.normalize);
  }

  async findById(id: string): Promise<NormalizedFood | null> {
    const item = await this.prisma.foodItem.findUnique({ where: { id } });
    return item ? this.normalize(item) : null;
  }

  private normalize(item: any): NormalizedFood {
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
}
