import { PrismaService } from '../../prisma/prisma.service';
import { WeightUpdatedEvent } from '../events/progress.event';
export declare class ProgressHandler {
    private prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    handle(event: WeightUpdatedEvent): Promise<void>;
}
