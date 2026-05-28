import { PrismaService } from '../prisma/prisma.service';
import { LogWeightDto } from './dto/log-weight.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
export declare class ProgressService {
    private prisma;
    private eventEmitter;
    constructor(prisma: PrismaService, eventEmitter: EventEmitter2);
    logWeight(userId: string, dto: LogWeightDto): Promise<{
        id: string;
        userId: string;
        createdAt: Date;
        weightKg: number;
        date: Date;
        notes: string | null;
    }>;
    getHistory(userId: string): Promise<{
        id: string;
        userId: string;
        createdAt: Date;
        weightKg: number;
        date: Date;
        notes: string | null;
    }[]>;
    getSummary(userId: string): Promise<{
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
