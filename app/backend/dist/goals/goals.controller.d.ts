import { GoalsService } from './goals.service';
import { CreateGoalDto } from './dto/create-goal.dto';
export declare class GoalsController {
    private goalsService;
    constructor(goalsService: GoalsService);
    create(req: any, dto: CreateGoalDto): Promise<{
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
    getActive(req: any): Promise<{
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
    getAll(req: any): Promise<{
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
