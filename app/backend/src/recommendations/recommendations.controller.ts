import { Controller, Post, Get, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RecommendationsService } from './recommendations.service';
import { RespondDto } from './dto/respond.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiAuthErrors, ApiValidationError } from '../common/swagger/error-responses';

// V5.5 note (see ADR-0004): unlike Logs/Vision/Food, an id that does not exist
// or is not owned by the caller returns 200 with `{ message: '...' }`, not a
// 404 — a pre-existing inconsistency this slice documents and pins with a
// contract test rather than silently changing (the Recommendation Engine's
// response shape is a public contract mobile already consumes).
@ApiTags('recommendations')
@ApiBearerAuth()
@ApiAuthErrors()
@UseGuards(JwtAuthGuard)
@Controller('recommendations')
export class RecommendationsController {
  constructor(private recommendationsService: RecommendationsService) {}

  @ApiOperation({ summary: 'Generate a fresh recommendation from the current diagnosis.' })
  @Post('generate')
  generate(@Request() req) {
    return this.recommendationsService.generate(req.user.id);
  }

  @ApiOperation({ summary: "The caller's active (pending/committed) recommendations." })
  @Get()
  getActive(@Request() req) {
    return this.recommendationsService.getActive(req.user.id);
  }

  @ApiOperation({ summary: "The caller's recommendation history." })
  @Get('history')
  getHistory(@Request() req) {
    return this.recommendationsService.getHistory(req.user.id);
  }

  @ApiOperation({ summary: 'Accept or reject a pending recommendation.' })
  @ApiValidationError()
  @Post(':id/respond')
  respond(@Request() req, @Param('id') id: string, @Body() dto: RespondDto) {
    return this.recommendationsService.respond(req.user.id, id, dto.action);
  }

  // ── Phase 2B.1: commitment lifecycle (recommendation -> pledge -> done) ──
  @ApiOperation({ summary: 'Turn a pending recommendation into a time-boxed commitment.' })
  @Post(':id/commit')
  commit(@Request() req, @Param('id') id: string) {
    return this.recommendationsService.commit(req.user.id, id);
  }

  @ApiOperation({ summary: 'Mark a live commitment as completed.' })
  @Post(':id/complete')
  complete(@Request() req, @Param('id') id: string) {
    return this.recommendationsService.complete(req.user.id, id);
  }
}
