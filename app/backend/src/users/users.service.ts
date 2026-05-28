import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async getMe(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        provider: true,
        createdAt: true,
        profile: true,
        goals: {
          where: { isActive: true },
          take: 1,
        },
      },
    });
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    return this.prisma.userProfile.upsert({
      where: { userId },
      create: {
        userId,
        ...dto,
        dietaryRestrictions: dto.dietaryRestrictions ?? [],
        allergies: dto.allergies ?? [],
        medicalConditions: dto.medicalConditions ?? [],
        onboardingCompleted: true,
      },
      update: {
        ...dto,
        dietaryRestrictions: dto.dietaryRestrictions ?? [],
        allergies: dto.allergies ?? [],
        medicalConditions: dto.medicalConditions ?? [],
        onboardingCompleted: true,
      },
    });
  }
}
