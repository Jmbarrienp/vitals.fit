import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DeviceTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(userId: string, token: string, platform: string): Promise<void> {
    await this.prisma.deviceToken.upsert({
      where: { token },
      update: { userId, platform, isActive: true },
      create: { userId, token, platform },
    });
  }

  async getActiveForUser(userId: string): Promise<string[]> {
    const rows = await this.prisma.deviceToken.findMany({
      where: { userId, isActive: true },
      select: { token: true },
    });
    return rows.map((r) => r.token);
  }

  async markInactive(token: string): Promise<void> {
    await this.prisma.deviceToken.updateMany({
      where: { token },
      data: { isActive: false },
    });
  }
}
