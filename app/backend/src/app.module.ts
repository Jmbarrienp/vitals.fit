import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AiModule } from './ai/ai.module';
import { PushModule } from './push/push.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { GoalsModule } from './goals/goals.module';
import { NutritionModule } from './nutrition/nutrition.module';
import { LogsModule } from './logs/logs.module';
import { ProgressModule } from './progress/progress.module';
import { RecommendationsModule } from './recommendations/recommendations.module';
import { OrchestratorModule } from './orchestrator/orchestrator.module';
import { FoodModule } from './food/food.module';

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    AiModule,
    PushModule,
    PrismaModule,
    AuthModule,
    UsersModule,
    GoalsModule,
    NutritionModule,
    LogsModule,
    ProgressModule,
    RecommendationsModule,
    OrchestratorModule,
    FoodModule,
  ],
})
export class AppModule {}
