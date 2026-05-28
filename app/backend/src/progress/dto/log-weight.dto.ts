import { IsNumber, IsOptional, IsString, Min, Max } from 'class-validator';

export class LogWeightDto {
  @IsNumber()
  @Min(20)
  @Max(400)
  weightKg: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(70)
  bodyFatPct?: number;

  @IsOptional()
  @IsNumber()
  @Min(40)
  @Max(200)
  waistCm?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
