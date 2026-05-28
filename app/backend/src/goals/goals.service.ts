import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGoalDto } from './dto/create-goal.dto';

@Injectable()
export class GoalsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateGoalDto) {
    const profile = await this.prisma.userProfile.findUnique({ where: { userId } });
    if (!profile) throw new BadRequestException('Completa tu perfil antes de crear un objetivo');

    // Desactivar goal anterior si existe
    await this.prisma.goal.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false },
    });

    // Crear nuevo goal activo con placeholders — nutrition/calculate los llenará
    const goal = await this.prisma.goal.create({
      data: {
        userId,
        type: dto.type,
        targetWeightKg: dto.targetWeightKg ?? null,
        targetCalories: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        fiberTargetG: 0,
        waterMl: 0,
        bmr: 0,
        tdee: 0,
        formulaUsed: 'pending',
        goalAdjustment: 0,
        isActive: true,
      },
    });

    return goal;
  }

  async getActive(userId: string) {
    const goal = await this.prisma.goal.findFirst({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!goal) return { message: 'No tienes un objetivo activo. Crea uno con POST /goals' };
    return goal;
  }

  async getAll(userId: string) {
    return this.prisma.goal.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
