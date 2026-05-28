import { FoodService } from './food.service';
import { SearchFoodDto } from './dto/search-food.dto';
export declare class FoodController {
    private foodService;
    constructor(foodService: FoodService);
    search(dto: SearchFoodDto): Promise<import("./adapters/food-adapter.interface").NormalizedFood[]>;
    getCommon(): Promise<import("./adapters/food-adapter.interface").NormalizedFood[]>;
    findById(id: string): Promise<import("./adapters/food-adapter.interface").NormalizedFood>;
}
