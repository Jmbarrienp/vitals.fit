import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { MAX_IMAGE_BASE64_CHARS, SupportedImageMime } from '../images/image-store.port';

const MIME_TYPES: SupportedImageMime[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/**
 * A nutrition-label scan (V3.2). Same image transport as a photo scan — the
 * source is implied by the endpoint (`LABEL_OCR`), so unlike CreateScanDto there
 * is no `source` field to get wrong.
 */
export class CreateLabelScanDto {
  /** The captured label photo. Optional so the fixture (reference-only) path keeps working with no vendor key. */
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
