import { PrismaService } from '../../prisma/prisma.service';
import { WeightUpdatedEvent } from '../events/progress.event';
export declare class RecommendationHandler {
    private prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    handle(event: WeightUpdatedEvent): Promise<void>;
}
