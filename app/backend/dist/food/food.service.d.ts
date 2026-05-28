import { LocalFoodAdapter } from './adapters/local.adapter';
export declare class FoodService {
    private adapter;
    constructor(adapter: LocalFoodAdapter);
    search(query: string, limit?: number): Promise<import("./adapters/food-adapter.interface").NormalizedFood[]>;
    getCommon(limit?: number): Promise<import("./adapters/food-adapter.interface").NormalizedFood[]>;
    findById(id: string): Promise<import("./adapters/food-adapter.interface").NormalizedFood>;
}
