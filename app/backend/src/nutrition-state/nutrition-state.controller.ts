import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NutritionStateService } from './nutrition-state.service';

@UseGuards(JwtAuthGuard)
@Controller('nutrition-state')
export class NutritionStateController {
  constructor(private readonly state: NutritionStateService) {}

  /** Read-only compact intelligence snapshot for the mobile UI. */
  @Get('intelligence')
  getIntelligence(@Request() req: { user: { id: string } }) {
    return this.state.getIntelligenceSnapshot(req.user.id);
  }
}
