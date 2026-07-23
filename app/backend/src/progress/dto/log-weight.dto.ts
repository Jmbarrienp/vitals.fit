import { IsNumber, IsOptional, IsString, Min, Max, MaxLength } from 'class-validator';

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

  // V5.5 — every other free-text field in the API is bounded; this one was not
  // (nothing else limits it, since the global 8mb JSON body cap exists for
  // Vision's photo uploads, not as a per-field guard).
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
