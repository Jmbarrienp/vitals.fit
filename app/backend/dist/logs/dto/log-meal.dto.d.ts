export declare enum MealType {
    BREAKFAST = "BREAKFAST",
    LUNCH = "LUNCH",
    DINNER = "DINNER",
    SNACK = "SNACK"
}
export declare class LogMealDto {
    mealType: MealType;
    name?: string;
    totalCalories: number;
    totalProteinG: number;
    totalCarbsG: number;
    totalFatG: number;
}
