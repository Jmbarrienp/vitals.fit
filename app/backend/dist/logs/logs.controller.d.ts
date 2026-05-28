import { LogsService } from './logs.service';
import { LogMealDto } from './dto/log-meal.dto';
export declare class LogsController {
    private logsService;
    constructor(logsService: LogsService);
    logMeal(req: any, dto: LogMealDto): Promise<{
        loggedMeals: {
            id: string;
            name: string | null;
            mealType: import("@prisma/client").$Enums.MealType;
            totalCalories: number;
            totalProteinG: number;
            totalCarbsG: number;
            totalFatG: number;
            loggedAt: Date;
            dailyLogId: string;
        }[];
    } & {
        id: string;
        userId: string;
        createdAt: Date;
        updatedAt: Date;
        proteinG: number;
        carbsG: number;
        fatG: number;
        date: Date;
        caloriesLogged: number;
        planFollowed: boolean | null;
        adherencePct: number | null;
        notes: string | null;
    }>;
    getToday(req: any): Promise<{
        message: string;
        date: Date;
        meals: any[];
        totals: {
            calories: number;
            protein: number;
            carbs: number;
            fat: number;
            proteinG?: undefined;
            carbsG?: undefined;
            fatG?: undefined;
        };
        target?: undefined;
        remaining?: undefined;
    } | {
        date: Date;
        totals: {
            calories: number;
            proteinG: number;
            carbsG: number;
            fatG: number;
            protein?: undefined;
            carbs?: undefined;
            fat?: undefined;
        };
        target: {
            calories: number;
            proteinG: number;
            carbsG: number;
            fatG: number;
        };
        remaining: {
            calories: number;
            proteinG: number;
            carbsG: number;
            fatG: number;
        };
        meals: {
            id: string;
            name: string | null;
            mealType: import("@prisma/client").$Enums.MealType;
            totalCalories: number;
            totalProteinG: number;
            totalCarbsG: number;
            totalFatG: number;
            loggedAt: Date;
            dailyLogId: string;
        }[];
        message?: undefined;
    }>;
    getRecent(req: any): Promise<({
        loggedMeals: {
            id: string;
            name: string | null;
            mealType: import("@prisma/client").$Enums.MealType;
            totalCalories: number;
            totalProteinG: number;
            totalCarbsG: number;
            totalFatG: number;
            loggedAt: Date;
            dailyLogId: string;
        }[];
    } & {
        id: string;
        userId: string;
        createdAt: Date;
        updatedAt: Date;
        proteinG: number;
        carbsG: number;
        fatG: number;
        date: Date;
        caloriesLogged: number;
        planFollowed: boolean | null;
        adherencePct: number | null;
        notes: string | null;
    })[]>;
}
