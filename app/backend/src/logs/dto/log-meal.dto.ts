import { IsString, IsEnum, IsNumber, IsOptional, Min, Max, MaxLength } from 'class-validator';

export enum MealType {
  BREAKFAST = 'BREAKFAST',
  LUNCH = 'LUNCH',
  DINNER = 'DINNER',
  SNACK = 'SNACK',
}

export class LogMealDto {
  @IsEnum(MealType)
  mealType: MealType;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsNumber()
  @Min(0)
  @Max(10000)
  totalCalories: number;

  @IsNumber()
  @Min(0)
  @Max(1000)
  totalProteinG: number;

  @IsNumber()
  @Min(0)
  @Max(2000)
  totalCarbsG: number;

  @IsNumber()
  @Min(0)
  @Max(500)
  totalFatG: number;
}
