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

  // ── Phase 2B.1: commitment lifecycle (recommendation -> pledge -> done) ──
  @Post(':id/commit')
  commit(@Request() req, @Param('id') id: string) {
    return this.recommendationsService.commit(req.user.id, id);
  }

  @Post(':id/complete')
  complete(@Request() req, @Param('id') id: string) {
    return this.recommendationsService.complete(req.user.id, id);
  }
}
