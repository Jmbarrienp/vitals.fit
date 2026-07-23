import { Controller, Post, Get, Patch, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LogsService } from './logs.service';
import { LogMealDto } from './dto/log-meal.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiAuthErrors, ApiNotFoundError, ApiValidationError } from '../common/swagger/error-responses';

@ApiTags('logs')
@ApiBearerAuth()
@ApiAuthErrors()
@UseGuards(JwtAuthGuard)
@Controller('logs')
export class LogsController {
  constructor(private logsService: LogsService) {}

  /** Server-calculated: resolves catalog items to grams/macros, or accepts pre-totaled manual entries. */
  @ApiOperation({ summary: "Log a meal to the caller's daily log." })
  @ApiValidationError()
  @Post('meal')
  logMeal(@Request() req, @Body() dto: LogMealDto) {
    return this.logsService.logMeal(req.user.id, dto);
  }

  @ApiOperation({ summary: 'Replace a logged meal (items and/or totals).' })
  @ApiValidationError()
  @ApiNotFoundError('Meal')
  @Patch('meal/:id')
  updateMeal(@Request() req, @Param('id') id: string, @Body() dto: LogMealDto) {
    return this.logsService.updateMeal(req.user.id, id, dto);
  }

  @ApiOperation({ summary: 'Delete a logged meal and recalculate the daily total.' })
  @ApiNotFoundError('Meal')
  @Delete('meal/:id')
  deleteMeal(@Request() req, @Param('id') id: string) {
    return this.logsService.deleteMeal(req.user.id, id);
  }

  /** Deletes the meal itself if this was its last item. */
  @ApiOperation({ summary: 'Delete a single item from a logged meal.' })
  @ApiNotFoundError('Meal or item')
  @Delete('meal/:id/item/:itemId')
  deleteMealItem(@Request() req, @Param('id') id: string, @Param('itemId') itemId: string) {
    return this.logsService.deleteMealItem(req.user.id, id, itemId);
  }

  @ApiOperation({ summary: "Today's logged meals and running totals." })
  @Get('today')
  getToday(@Request() req) {
    return this.logsService.getToday(req.user.id);
  }

  @ApiOperation({ summary: 'Recent logged meals.' })
  @Get()
  getRecent(@Request() req) {
    return this.logsService.getRecent(req.user.id);
  }
}
