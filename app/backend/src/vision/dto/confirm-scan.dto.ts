import { Type } from 'class-transformer';
import { IsArray, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class ConfirmScanItemDto {
  @IsOptional()
  @IsUUID()
  foodItemId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  customName?: string;

  @IsNumber()
  @Min(0)
  @Max(10000)
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5000)
  grams?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000)
  calories?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  proteinG?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2000)
  carbsG?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500)
  fatG?: number;

  @IsOptional()
  @IsNumber()
  acceptedFromCandidate?: number | null;
}

export class ConfirmScanDto {
  @IsOptional()
  @IsString()
  mealType?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfirmScanItemDto)
  items: ConfirmScanItemDto[];
}
