import { ProgressService } from './progress.service';
import { LogWeightDto } from './dto/log-weight.dto';
export declare class ProgressController {
    private progressService;
    constructor(progressService: ProgressService);
    logWeight(req: any, dto: LogWeightDto): Promise<{
        id: string;
        userId: string;
        createdAt: Date;
        weightKg: number;
        date: Date;
        notes: string | null;
    }>;
    getHistory(req: any): Promise<{
        id: string;
        userId: string;
        createdAt: Date;
        weightKg: number;
        date: Date;
        notes: string | null;
    }[]>;
    getSummary(req: any): Promise<{
        message: string;
        recordings?: undefined;
        startWeight?: undefined;
        currentWeight?: undefined;
        totalChange?: undefined;
        weeklyRate?: undefined;
        trend?: undefined;
        daysTracked?: undefined;
        goal?: undefined;
        targetWeight?: undefined;
        toGoal?: undefined;
        history?: undefined;
    } | {
        recordings: number;
        startWeight: number;
        currentWeight: number;
        totalChange: number;
        weeklyRate: number;
        trend: string;
        daysTracked: number;
        goal: import("@prisma/client").$Enums.GoalType;
        targetWeight: number;
        toGoal: number;
        history: {
            id: string;
            userId: string;
            createdAt: Date;
            weightKg: number;
            date: Date;
            notes: string | null;
        }[];
        message?: undefined;
    }>;
}
