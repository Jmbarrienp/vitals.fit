import { Injectable } from '@nestjs/common';
import { LocalFoodAdapter } from './adapters/local.adapter';
import { CreateCustomFoodDto } from './dto/create-custom-food.dto';

@Injectable()
export class FoodService {
  constructor(private adapter: LocalFoodAdapter) {}

  search(query: string, limit = 15, userId?: string) {
    return this.adapter.search(query, limit, userId);
  }

  getCommon(limit = 20, userId?: string) {
    return this.adapter.getCommon(limit, userId);
  }

  findById(id: string) {
    return this.adapter.findById(id);
  }

  getRecent(userId: string) {
    return this.adapter.getRecent(userId);
  }

  getFrequent(userId: string) {
    return this.adapter.getFrequent(userId);
  }

  getFavorites(userId: string) {
    return this.adapter.getFavorites(userId);
  }

  /** Private custom foods the user created (for the meal planner's candidate pool). */
  getCustom(userId: string) {
    return this.adapter.getCustom(userId);
  }

  async addFavorite(userId: string, foodItemId: string) {
    await this.adapter.addFavorite(userId, foodItemId);
    return { ok: true };
  }

  async removeFavorite(userId: string, foodItemId: string) {
    await this.adapter.removeFavorite(userId, foodItemId);
    return { ok: true };
  }

  createCustom(userId: string, dto: CreateCustomFoodDto) {
    return this.adapter.createCustom(userId, dto);
  }
}
