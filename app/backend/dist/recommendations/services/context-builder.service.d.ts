import { PrismaService } from '../../prisma/prisma.service';
import { UserSnapshot } from '../types/user-snapshot';
export declare class ContextBuilderService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    buildSnapshot(userId: string): Promise<UserSnapshot>;
}
