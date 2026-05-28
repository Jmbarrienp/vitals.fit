import { PrismaService } from '../prisma/prisma.service';
import { LogMealDto } from './dto/log-meal.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
export declare class LogsService {
    private prisma;
    private eventEmitter;
    constructor(prisma: PrismaService, eventEmitter: EventEmitter2);
    logMeal(userId: string, dto: LogMealDto): Promise<{
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
    getToday(userId: string): Promise<{
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
    getRecent(userId: string): Promise<({
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
