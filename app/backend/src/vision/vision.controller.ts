import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { VisionScanService } from './vision-scan.service';
import { CreateScanDto } from './dto/create-scan.dto';
import { ConfirmScanDto } from './dto/confirm-scan.dto';

/**
 * Nutrition Vision (Phase 2D.2 V0). Vision never writes LoggedMeal directly —
 * confirm() hands off to the existing LogsService.logMeal path, so every
 * downstream consumer (rollup, ledger, review, planner, coach, meal planner)
 * keeps working unchanged.
 */
@UseGuards(JwtAuthGuard)
@Controller('vision/scans')
export class VisionController {
  constructor(private readonly scans: VisionScanService) {}

  @Post()
  create(@Request() req: { user: { id: string } }, @Body() dto: CreateScanDto) {
    return this.scans.createScan(req.user.id, dto.imageRef, dto.source);
  }

  @Get(':id')
  get(@Request() req: { user: { id: string } }, @Param('id') id: string) {
    return this.scans.getScan(req.user.id, id);
  }

  @Post(':id/confirm')
  confirm(@Request() req: { user: { id: string } }, @Param('id') id: string, @Body() dto: ConfirmScanDto) {
    return this.scans.confirmScan(req.user.id, { scanId: id, mealType: dto.mealType, items: dto.items as any });
  }

  @Post(':id/reject')
  reject(@Request() req: { user: { id: string } }, @Param('id') id: string) {
    return this.scans.rejectScan(req.user.id, id);
  }

  /** The user chose to log manually instead (V1). Records the fallback; creates no meal. */
  @Post(':id/fallback')
  fallback(@Request() req: { user: { id: string } }, @Param('id') id: string) {
    return this.scans.markFallbackManual(req.user.id, id);
  }
}
