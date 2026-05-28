import { PrismaService } from '../../prisma/prisma.service';
export interface AiGenerationEntry {
    userId: string;
    trigger: string;
    model: string;
    latencyMs: number;
    success: boolean;
    fallbackUsed: boolean;
    inputTokenApprox?: number;
    outputTokens?: number;
    cacheHit?: boolean;
    compactSnapshot?: Record<string, unknown>;
    finalRecommendation?: string;
    errorType?: string;
}
export declare class TelemetryService {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    record(entry: AiGenerationEntry): void;
}
