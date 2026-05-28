import { Controller, Post, Get, Body, UseGuards, Request } from '@nestjs/common';
import { GoalsService } from './goals.service';
import { CreateGoalDto } from './dto/create-goal.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('goals')
export class GoalsController {
  constructor(private goalsService: GoalsService) {}

  @Post()
  create(@Request() req, @Body() dto: CreateGoalDto) {
    return this.goalsService.create(req.user.id, dto);
  }

  @Get('active')
  getActive(@Request() req) {
    return this.goalsService.getActive(req.user.id);
  }

  @Get()
  getAll(@Request() req) {
    return this.goalsService.getAll(req.user.id);
  }
}
