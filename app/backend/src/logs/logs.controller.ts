import { Controller, Post, Get, Body, UseGuards, Request } from '@nestjs/common';
import { LogsService } from './logs.service';
import { LogMealDto } from './dto/log-meal.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('logs')
export class LogsController {
  constructor(private logsService: LogsService) {}

  @Post('meal')
  logMeal(@Request() req, @Body() dto: LogMealDto) {
    return this.logsService.logMeal(req.user.id, dto);
  }

  @Get('today')
  getToday(@Request() req) {
    return this.logsService.getToday(req.user.id);
  }

  @Get()
  getRecent(@Request() req) {
    return this.logsService.getRecent(req.user.id);
  }
}
