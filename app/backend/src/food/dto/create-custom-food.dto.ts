import { IsString, IsNumber, IsOptional, Min, Max, MinLength, MaxLength } from 'class-validator';

export class CreateCustomFoodDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @IsNumber()
  @Min(0)
  @Max(10000)
  caloriesPer100g: number;

  @IsNumber()
  @Min(0)
  @Max(1000)
  proteinPer100g: number;

  @IsNumber()
  @Min(0)
  @Max(1000)
  carbsPer100g: number;

  @IsNumber()
  @Min(0)
  @Max(1000)
  fatPer100g: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(200)
  fiberPer100g?: number;
}
