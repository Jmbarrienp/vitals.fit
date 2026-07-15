import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ScanSource } from '../types/vision-contract';
import { MAX_IMAGE_BASE64_CHARS, SupportedImageMime } from '../images/image-store.port';

const SOURCES: ScanSource[] = ['PHOTO', 'BARCODE', 'MENU_OCR', 'RECEIPT_OCR', 'VIDEO_FRAME'];
const MIME_TYPES: SupportedImageMime[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export class CreateScanDto {
  @IsIn(SOURCES)
  source: ScanSource;

  /**
   * The captured photo (V2). Optional so the V0/V1 reference-only path still
   * works: the fixture provider is keyed on `imageRef` and needs no pixels, which
   * is what keeps dev/CI/smoke running without a vendor key.
   *
   * Bounded here so an oversized body is rejected by validation before the
   * service allocates anything to decode it.
   */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_IMAGE_BASE64_CHARS)
  imageBase64?: string;

  @IsOptional()
  @IsIn(MIME_TYPES)
  imageMimeType?: SupportedImageMime;

  /** A stable identifier for the capture. Ignored when `imageBase64` is sent — the image store issues the ref then. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageRef?: string;
}
