import { Controller, Post, Get, Body, UseGuards, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProgressService } from './progress.service';
import { LogWeightDto } from './dto/log-weight.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiAuthErrors, ApiValidationError } from '../common/swagger/error-responses';

@ApiTags('progress')
@ApiBearerAuth()
@ApiAuthErrors()
@UseGuards(JwtAuthGuard)
@Controller('progress')
export class ProgressController {
  constructor(private progressService: ProgressService) {}

  @ApiOperation({ summary: 'Log a weight (+ optional body fat / waist) measurement.' })
  @ApiValidationError()
  @Post('weight')
  logWeight(@Request() req, @Body() dto: LogWeightDto) {
    return this.progressService.logWeight(req.user.id, dto);
  }

  @ApiOperation({ summary: "The caller's full weight history." })
  @Get()
  getHistory(@Request() req) {
    return this.progressService.getHistory(req.user.id);
  }

  @ApiOperation({ summary: 'Trend summary derived from the weight history.' })
  @Get('summary')
  getSummary(@Request() req) {
    return this.progressService.getSummary(req.user.id);
  }
}
