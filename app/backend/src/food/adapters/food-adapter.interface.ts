export interface NormalizedFood {
  id: string;
  name: string;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  fiberPer100g: number;
  source: string;
  isCommon: boolean;
  isFavorite?: boolean;
}

/** Product facts resolved from a barcode lookup — primitive shape, no cross-module type import (Food never depends on Vision). */
export interface BarcodeProductData {
  name: string;
  brand: string | null;
  servingGrams: number | null;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  fiberPer100g: number;
}

export interface FoodAdapter {
  search(query: string, limit: number, userId?: string): Promise<NormalizedFood[]>;
  getCommon(limit: number, userId?: string): Promise<NormalizedFood[]>;
  findById(id: string): Promise<NormalizedFood | null>;
  /** Exact identity lookup, scoped to the global catalog + this user's own custom foods. No fuzziness — a barcode either matches a product or it doesn't. */
  findByBarcode(barcode: string, userId?: string): Promise<NormalizedFood | null>;
  /** Idempotent: re-checks by barcode before inserting, so re-resolving an already-cached product returns the existing row instead of a duplicate. */
  upsertFromBarcode(barcode: string, product: BarcodeProductData): Promise<NormalizedFood>;
}
