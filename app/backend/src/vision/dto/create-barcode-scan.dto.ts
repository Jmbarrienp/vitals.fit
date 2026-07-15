import { IsNumberString, Length } from 'class-validator';

export class CreateBarcodeScanDto {
  /** EAN-8 through GTIN-14 — the range every common on-device barcode decoder emits for retail products. */
  @IsNumberString()
  @Length(8, 14)
  barcode: string;
}
