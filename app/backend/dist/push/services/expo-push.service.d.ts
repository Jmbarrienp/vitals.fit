import { PrismaService } from '../../prisma/prisma.service';
import { DeviceTokenService } from './device-token.service';
export declare class ExpoPushService {
    private readonly deviceToken;
    private readonly prisma;
    private readonly logger;
    constructor(deviceToken: DeviceTokenService, prisma: PrismaService);
    sendToUser(userId: string, title: string, body: string, trigger: string): void;
    private doSend;
}
