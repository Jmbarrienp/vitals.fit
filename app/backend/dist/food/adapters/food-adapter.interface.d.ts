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
}
export interface FoodAdapter {
    search(query: string, limit: number): Promise<NormalizedFood[]>;
    getCommon(limit: number): Promise<NormalizedFood[]>;
    findById(id: string): Promise<NormalizedFood | null>;
}
