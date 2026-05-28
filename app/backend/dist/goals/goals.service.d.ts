import { PrismaService } from '../prisma/prisma.service';
import { CreateGoalDto } from './dto/create-goal.dto';
export declare class GoalsService {
    private prisma;
    constructor(prisma: PrismaService);
    create(userId: string, dto: CreateGoalDto): Promise<{
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
    }>;
    getActive(userId: string): Promise<{
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
    } | {
        message: string;
    }>;
    getAll(userId: string): Promise<{
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
    }[]>;
}
