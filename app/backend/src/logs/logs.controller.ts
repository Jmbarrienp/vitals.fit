import { Controller, Post, Get, Patch, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
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

  @Patch('meal/:id')
  updateMeal(@Request() req, @Param('id') id: string, @Body() dto: LogMealDto) {
    return this.logsService.updateMeal(req.user.id, id, dto);
  }

  @Delete('meal/:id')
  deleteMeal(@Request() req, @Param('id') id: string) {
    return this.logsService.deleteMeal(req.user.id, id);
  }

  @Delete('meal/:id/item/:itemId')
  deleteMealItem(@Request() req, @Param('id') id: string, @Param('itemId') itemId: string) {
    return this.logsService.deleteMealItem(req.user.id, id, itemId);
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
