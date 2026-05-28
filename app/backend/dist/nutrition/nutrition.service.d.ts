import { PrismaService } from '../prisma/prisma.service';
export declare class NutritionService {
    private prisma;
    constructor(prisma: PrismaService);
    calculate(userId: string): Promise<{
        formula: string;
        inputs: {
            weightKg: number;
            heightCm: number;
            age: number;
            sex: import("@prisma/client").$Enums.Sex;
            activityLevel: import("@prisma/client").$Enums.ActivityLevel;
            goal: import("@prisma/client").$Enums.GoalType;
        };
        calculations: {
            bmr: number;
            activityFactor: number;
            tdee: number;
            goalAdjustment: number;
            targetCalories: number;
            minimumApplied: boolean;
            bmi: number;
            bmiCategory: string;
        };
        macros: {
            protein: {
                g: number;
                kcal: number;
                pct: number;
            };
            fat: {
                g: number;
                kcal: number;
                pct: number;
            };
            carbs: {
                g: number;
                kcal: number;
                pct: number;
            };
            fiber: {
                g: number;
            };
            water: {
                ml: number;
            };
        };
        goal: {
            id: string;
            type: import("@prisma/client").$Enums.GoalType;
            userId: string;
            createdAt: Date;
            isActive: boolean;
            updatedAt: Date;
            targetWeightKg: number | null;
            targetCalories: number;
            proteinG: number;
            carbsG: number;
            fatG: number;
            fiberTargetG: number;
            waterMl: number;
            bmr: number;
            tdee: number;
            formulaUsed: string;
            goalAdjustment: number;
        };
    }>;
    private getBmiCategory;
}
