import { Controller, Post, Get, Body, Param, UseGuards, Request } from '@nestjs/common';
import { RecommendationsService } from './recommendations.service';
import { RespondDto } from './dto/respond.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('recommendations')
export class RecommendationsController {
  constructor(private recommendationsService: RecommendationsService) {}

  @Post('generate')
  generate(@Request() req) {
    return this.recommendationsService.generate(req.user.id);
  }

  @Get()
  getActive(@Request() req) {
    return this.recommendationsService.getActive(req.user.id);
  }

  @Get('history')
  getHistory(@Request() req) {
    return this.recommendationsService.getHistory(req.user.id);
  }

  @Post(':id/respond')
  respond(@Request() req, @Param('id') id: string, @Body() dto: RespondDto) {
    return this.recommendationsService.respond(req.user.id, id, dto.action);
  }
}
