import { Controller, Post, Get, Body, UseGuards, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GoalsService } from './goals.service';
import { CreateGoalDto } from './dto/create-goal.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiAuthErrors, ApiValidationError } from '../common/swagger/error-responses';

@ApiTags('goals')
@ApiBearerAuth()
@ApiAuthErrors()
@UseGuards(JwtAuthGuard)
@Controller('goals')
export class GoalsController {
  constructor(private goalsService: GoalsService) {}

  /** Creates a goal and deactivates the caller's previous active goal, if any. */
  @ApiOperation({ summary: 'Create a new goal for the authenticated caller.' })
  @ApiValidationError()
  @Post()
  create(@Request() req, @Body() dto: CreateGoalDto) {
    return this.goalsService.create(req.user.id, dto);
  }

  /** The single currently-active goal, or null. */
  @ApiOperation({ summary: "The caller's active goal." })
  @Get('active')
  getActive(@Request() req) {
    return this.goalsService.getActive(req.user.id);
  }

  /** Full goal history, active and inactive. */
  @ApiOperation({ summary: "All of the caller's goals, past and present." })
  @Get()
  getAll(@Request() req) {
    return this.goalsService.getAll(req.user.id);
  }
}
