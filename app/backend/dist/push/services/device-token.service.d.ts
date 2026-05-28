import { PrismaService } from '../../prisma/prisma.service';
export declare class DeviceTokenService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    upsert(userId: string, token: string, platform: string): Promise<void>;
    getActiveForUser(userId: string): Promise<string[]>;
    markInactive(token: string): Promise<void>;
}
