import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdaptivePlannerService } from './adaptive-planner.service';

@UseGuards(JwtAuthGuard)
@Controller('planner')
export class PlannerController {
  constructor(private readonly planner: AdaptivePlannerService) {}

  /**
   * The adaptive nutrition plan (Phase 2C.2). Read-only, deterministic, structured:
   * whether calories/protein/intervention should stay stable or evolve, each with
   * confidence, evidence and a review window. No calculation in the controller.
   */
  @Get('plan')
  getPlan(@Request() req: { user: { id: string } }) {
    return this.planner.getPlan(req.user.id);
  }
}
