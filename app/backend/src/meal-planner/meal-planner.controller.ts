import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MealPlannerService } from './meal-planner.service';

@UseGuards(JwtAuthGuard)
@Controller('meal-plan')
export class MealPlannerController {
  constructor(private readonly mealPlanner: MealPlannerService) {}

  /**
   * The adaptive daily meal plan (Phase 2D.1). Read-only, deterministic: executes
   * the planner's strategy into concrete meals from the user's own food repertoire.
   * No calculation in the controller.
   */
  @Get()
  getMealPlan(@Request() req: { user: { id: string } }) {
    return this.mealPlanner.getMealPlan(req.user.id);
  }
}
