import { IsEnum, IsNumber, IsOptional, Min, Max } from 'class-validator';

export enum GoalType {
  LOSE_FAT = 'LOSE_FAT',
  GAIN_MUSCLE = 'GAIN_MUSCLE',
  MAINTAIN = 'MAINTAIN',
  RECOMPOSITION = 'RECOMPOSITION',
  HEALTH_WELLNESS = 'HEALTH_WELLNESS',
}

export class CreateGoalDto {
  @IsEnum(GoalType)
  type: GoalType;

  @IsOptional()
  @IsNumber()
  @Min(30)
  @Max(300)
  targetWeightKg?: number;
}
