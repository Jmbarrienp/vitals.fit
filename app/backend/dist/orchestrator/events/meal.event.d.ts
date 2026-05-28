export declare class MealLoggedEvent {
    readonly userId: string;
    readonly mealId: string;
    readonly loggedAt: Date;
    readonly totalCalories: number;
    constructor(userId: string, mealId: string, loggedAt: Date, totalCalories: number);
}
