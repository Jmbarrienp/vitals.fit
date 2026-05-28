import { Controller, Post, Get, Body, UseGuards, Request } from '@nestjs/common';
import { ProgressService } from './progress.service';
import { LogWeightDto } from './dto/log-weight.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('progress')
export class ProgressController {
  constructor(private progressService: ProgressService) {}

  @Post('weight')
  logWeight(@Request() req, @Body() dto: LogWeightDto) {
    return this.progressService.logWeight(req.user.id, dto);
  }

  @Get()
  getHistory(@Request() req) {
    return this.progressService.getHistory(req.user.id);
  }

  @Get('summary')
  getSummary(@Request() req) {
    return this.progressService.getSummary(req.user.id);
  }
}
