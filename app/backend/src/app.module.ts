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
import { NutritionStateModule } from './nutrition-state/nutrition-state.module';
import { CoachModule } from './coach/coach.module';
import { PlannerModule } from './planner/planner.module';
import { MealPlannerModule } from './meal-planner/meal-planner.module';
import { VisionModule } from './vision/vision.module';
import { CopilotModule } from './copilot/copilot.module';
import { validateEnv } from './config/env.validation';

@Module({
  controllers: [AppController],
  imports: [
    // V5.2 — fail fast on a misconfigured deploy. A missing or placeholder
    // JWT_SECRET used to boot "fine" and either fail at the first login or,
    // worse, sign every token with the value published in .env.example.
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
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
    NutritionStateModule,
    CoachModule,
    PlannerModule,
    MealPlannerModule,
    VisionModule,
    CopilotModule,
  ],
})
export class AppModule {}
