import { IsIn, IsString, MaxLength } from 'class-validator';
import { ScanSource } from '../types/vision-contract';

const SOURCES: ScanSource[] = ['PHOTO', 'BARCODE', 'MENU_OCR', 'RECEIPT_OCR', 'VIDEO_FRAME'];

export class CreateScanDto {
  @IsString()
  @MaxLength(500)
  imageRef: string;

  @IsIn(SOURCES)
  source: ScanSource;
}
