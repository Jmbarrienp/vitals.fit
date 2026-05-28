import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
export declare class AuthService {
    private prisma;
    private jwt;
    constructor(prisma: PrismaService, jwt: JwtService);
    register(dto: RegisterDto): Promise<{
        access_token: string;
        user: {
            id: string;
            email: string;
        };
    }>;
    login(dto: LoginDto): Promise<{
        access_token: string;
        user: {
            id: string;
            email: string;
        };
    }>;
    me(userId: string): Promise<{
        id: string;
        createdAt: Date;
        isActive: boolean;
        email: string;
        provider: import("@prisma/client").$Enums.AuthProvider;
        profile: {
            id: string;
            userId: string;
            createdAt: Date;
            name: string;
            updatedAt: Date;
            age: number;
            weightKg: number;
            heightCm: number;
            sex: import("@prisma/client").$Enums.Sex;
            activityLevel: import("@prisma/client").$Enums.ActivityLevel;
            fitnessLevel: import("@prisma/client").$Enums.FitnessLevel;
            equipment: import("@prisma/client").$Enums.Equipment;
            dietaryRestrictions: string[];
            allergies: string[];
            medicalConditions: string[];
            daysAvailablePerWeek: number;
            sessionDurationMin: number;
            timezone: string;
            country: string | null;
            persona: import("@prisma/client").$Enums.PersonaType;
            onboardingCompleted: boolean;
        };
    }>;
    private signToken;
}
