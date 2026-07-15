import { BadRequestException, Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { VisionScanService } from './vision-scan.service';
import { CreateScanDto } from './dto/create-scan.dto';
import { CreateBarcodeScanDto } from './dto/create-barcode-scan.dto';
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

  /**
   * The image is uploaded HERE and recognized server-side (V2). The vendor key
   * never leaves the backend and mobile never talks to a provider — it posts a
   * photo to this endpoint and receives a platform-shaped proposal.
   */
  @Post()
  create(@Request() req: { user: { id: string } }, @Body() dto: CreateScanDto) {
    if (!dto.imageBase64 && !dto.imageRef) {
      throw new BadRequestException('Provide either imageBase64 (a captured photo) or imageRef (a stable reference).');
    }
    if (dto.imageBase64 && !dto.imageMimeType) {
      throw new BadRequestException('imageMimeType is required when sending imageBase64.');
    }
    const image = dto.imageBase64 ? { base64: dto.imageBase64, mimeType: dto.imageMimeType! } : undefined;
    return this.scans.createScan(req.user.id, dto.imageRef ?? '', dto.source, image);
  }

  /**
   * Barcode is decoded ON-DEVICE (V3.1) — this endpoint receives the digits,
   * never an image. A separate route from POST / because the input shape is
   * genuinely different (a string, not a photo), not a variant of it; confirm/
   * reject/fallback/get below are shared unchanged since the VisionScan
   * lifecycle they operate on is source-agnostic.
   */
  @Post('barcode')
  createBarcode(@Request() req: { user: { id: string } }, @Body() dto: CreateBarcodeScanDto) {
    return this.scans.createBarcodeScan(req.user.id, dto.barcode);
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
