import { PrismaService } from '../prisma/prisma.service';
export declare class RecommendationsService {
    private prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    generate(userId: string): Promise<{
        message: string;
        recommendations: any[];
        generated?: undefined;
    } | {
        generated: number;
        recommendations: {
            summary: any;
            id: string;
            type: import("@prisma/client").$Enums.RecommendationType;
            userId: string;
            trigger: string;
            createdAt: Date;
            status: import("@prisma/client").$Enums.RecommendationStatus;
            priority: import("@prisma/client").$Enums.Priority;
            progressStatus: string | null;
            planChange: boolean;
            calorieAdjustment: number | null;
            macroAdjustments: import("@prisma/client/runtime/client").JsonValue | null;
            messageForUser: string;
            requiresConfirmation: boolean;
            userResponse: string | null;
            expiresAt: Date | null;
            respondedAt: Date | null;
        }[];
        message?: undefined;
    }>;
    getActive(userId: string): Promise<{
        id: string;
        type: import("@prisma/client").$Enums.RecommendationType;
        userId: string;
        trigger: string;
        createdAt: Date;
        status: import("@prisma/client").$Enums.RecommendationStatus;
        priority: import("@prisma/client").$Enums.Priority;
        progressStatus: string | null;
        planChange: boolean;
        calorieAdjustment: number | null;
        macroAdjustments: import("@prisma/client/runtime/client").JsonValue | null;
        messageForUser: string;
        requiresConfirmation: boolean;
        userResponse: string | null;
        expiresAt: Date | null;
        respondedAt: Date | null;
    }[]>;
    getHistory(userId: string): Promise<{
        id: string;
        type: import("@prisma/client").$Enums.RecommendationType;
        trigger: string;
        createdAt: Date;
        status: import("@prisma/client").$Enums.RecommendationStatus;
        priority: import("@prisma/client").$Enums.Priority;
        planChange: boolean;
        calorieAdjustment: number;
        messageForUser: string;
    }[]>;
    respond(userId: string, id: string, action: string): Promise<{
        id: string;
        type: import("@prisma/client").$Enums.RecommendationType;
        userId: string;
        trigger: string;
        createdAt: Date;
        status: import("@prisma/client").$Enums.RecommendationStatus;
        priority: import("@prisma/client").$Enums.Priority;
        progressStatus: string | null;
        planChange: boolean;
        calorieAdjustment: number | null;
        macroAdjustments: import("@prisma/client/runtime/client").JsonValue | null;
        messageForUser: string;
        requiresConfirmation: boolean;
        userResponse: string | null;
        expiresAt: Date | null;
        respondedAt: Date | null;
    } | {
        message: string;
    }>;
}
