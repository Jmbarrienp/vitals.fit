import { Injectable, NotFoundException } from '@nestjs/common';
import { LocalFoodAdapter } from './adapters/local.adapter';
import { BarcodeProductData } from './adapters/food-adapter.interface';
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

  findByBarcode(barcode: string, userId?: string) {
    return this.adapter.findByBarcode(barcode, userId);
  }

  upsertFromBarcode(barcode: string, product: BarcodeProductData) {
    return this.adapter.upsertFromBarcode(barcode, product);
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

  // V5.5 — FoodFavorite.foodItemId carries a real FK to FoodItem. Without this
  // check, a bogus id reached the upsert directly and Prisma's FK-violation
  // error (not a Nest HttpException) fell through AllExceptionsFilter's
  // catch-all into an opaque 500 — the client's own mistake reported as a
  // server failure. Same existence-check shape as LogsService.getOwnedMeal /
  // VisionScanService.getOwnedScan, applied to the one write path that lacked it.
  async addFavorite(userId: string, foodItemId: string) {
    const food = await this.adapter.findById(foodItemId);
    if (!food) throw new NotFoundException('Food not found.');
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
