import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { WeightUpdatedEvent } from '../events/progress.event';

@Injectable()
export class ProgressHandler {
  private readonly logger = new Logger(ProgressHandler.name);

  constructor(private prisma: PrismaService) {}

  @OnEvent('weight.updated')
  async handle(event: WeightUpdatedEvent) {
    this.logger.log(`[progress-analyst] weight.updated for user ${event.userId}`);

    const logs = await this.prisma.weightLog.findMany({
      where: { userId: event.userId },
      orderBy: { date: 'asc' },
      take: 14,
    });

    if (logs.length < 3) {
      this.logger.log(`[progress-analyst] insufficient_data — ${logs.length} recordings`);
      return;
    }

    const first = logs[0].weightKg;
    const last = logs[logs.length - 1].weightKg;
    const days = Math.max(1, logs.length - 1);
    const weeklyRate = Math.round(((last - first) / days) * 7 * 100) / 100;

    let status = 'on_track';
    const goal = await this.prisma.goal.findFirst({
      where: { userId: event.userId, isActive: true },
    });

    if (goal?.type === 'LOSE_FAT') {
      if (weeklyRate > -0.1) status = 'stalled';
      else if (weeklyRate < -0.9) status = 'too_fast';
      else status = 'on_track';
    } else if (goal?.type === 'GAIN_MUSCLE') {
      status = weeklyRate < 0.1 ? 'stalled' : 'on_track';
    }

    this.logger.log(`[progress-analyst] status=${status} weekly_rate=${weeklyRate} kg/week`);

    // Emit result to memory — store as a log note for now
    await this.prisma.dailyLog.upsert({
      where: { userId_date: { userId: event.userId, date: event.date } },
      create: { userId: event.userId, date: event.date, notes: `progress_status:${status}` },
      update: { notes: `progress_status:${status}` },
    });
  }
}
