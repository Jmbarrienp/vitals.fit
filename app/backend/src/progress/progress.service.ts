import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LogWeightDto } from './dto/log-weight.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WeightUpdatedEvent } from '../orchestrator/events/progress.event';

@Injectable()
export class ProgressService {
  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
  ) {}

  async logWeight(userId: string, dto: LogWeightDto) {
    const now = new Date();

    // Always insert a new entry — no per-day deduplication
    const entry = await this.prisma.weightLog.create({
      data: { userId, date: now, weightKg: dto.weightKg, notes: dto.notes },
    });

    // Save body measurements if provided (still keyed by date — one per day)
    if (dto.bodyFatPct || dto.waistCm) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      await this.prisma.bodyMeasurement.upsert({
        where: { userId_date: { userId, date: today } } as any,
        create: {
          userId,
          date: today,
          bodyFatPct: dto.bodyFatPct ?? null,
          waistCm: dto.waistCm ?? null,
        },
        update: {
          bodyFatPct: dto.bodyFatPct ?? undefined,
          waistCm: dto.waistCm ?? undefined,
        },
      });
    }

    // Update profile weight
    await this.prisma.userProfile.update({
      where: { userId },
      data: { weightKg: dto.weightKg },
    });

    // Emit event → triggers progress-analyst + recommendation-engine
    this.eventEmitter.emit('weight.updated', new WeightUpdatedEvent(userId, dto.weightKg, now));

    return entry;
  }

  async getHistory(userId: string) {
    return this.prisma.weightLog.findMany({
      where: { userId },
      orderBy: { date: 'asc' },
      take: 30,
    });
  }

  async getSummary(userId: string) {
    const logs = await this.prisma.weightLog.findMany({
      where: { userId },
      orderBy: { date: 'asc' },
    });

    if (logs.length === 0) {
      return { message: 'Sin registros de peso todavía. Registra tu peso con POST /progress/weight' };
    }

    const goal = await this.prisma.goal.findFirst({ where: { userId, isActive: true } });
    const first = logs[0];
    const last = logs[logs.length - 1];
    const totalChange = Math.round((last.weightKg - first.weightKg) * 10) / 10;
    const days = Math.max(1, Math.round((last.date.getTime() - first.date.getTime()) / (1000 * 60 * 60 * 24)));
    const weeklyRate = Math.round((totalChange / days) * 7 * 100) / 100;

    // Simple trend: linear regression slope
    let trend = 'insufficient_data';
    if (logs.length >= 3) {
      if (weeklyRate < -0.3) trend = 'losing';
      else if (weeklyRate > 0.2) trend = 'gaining';
      else trend = 'stable';
    }

    return {
      recordings: logs.length,
      startWeight: first.weightKg,
      currentWeight: last.weightKg,
      totalChange,
      weeklyRate,
      trend,
      daysTracked: days,
      goal: goal?.type ?? null,
      targetWeight: goal?.targetWeightKg ?? null,
      toGoal: goal?.targetWeightKg
        ? Math.round((goal.targetWeightKg - last.weightKg) * 10) / 10
        : null,
      history: logs,
    };
  }
}
