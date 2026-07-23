import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WeeklyCoachService } from './weekly-coach.service';
import { ApiAuthErrors } from '../common/swagger/error-responses';

@ApiTags('coach')
@ApiBearerAuth()
@ApiAuthErrors()
@UseGuards(JwtAuthGuard)
@Controller('coach')
export class CoachController {
  constructor(private readonly coach: WeeklyCoachService) {}

  /**
   * The weekly AI coach (Phase 2C.1). Read-only, structured, compact. Returns the
   * deterministic coaching when no model is configured or a model call fails.
   */
  @Get('weekly')
  getWeekly(@Request() req: { user: { id: string } }) {
    return this.coach.getWeeklyCoaching(req.user.id);
  }
}
