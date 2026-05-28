import { RecommendationsService } from './recommendations.service';
import { RespondDto } from './dto/respond.dto';
export declare class RecommendationsController {
    private recommendationsService;
    constructor(recommendationsService: RecommendationsService);
    generate(req: any): Promise<{
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
    getActive(req: any): Promise<{
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
    respond(req: any, id: string, dto: RespondDto): Promise<{
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
