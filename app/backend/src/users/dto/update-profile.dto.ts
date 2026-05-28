import { IsString, IsInt, IsNumber, IsEnum, IsOptional, IsArray, Min, Max } from 'class-validator';

export enum Sex { MALE = 'MALE', FEMALE = 'FEMALE', OTHER = 'OTHER' }
export enum ActivityLevel { SEDENTARY = 'SEDENTARY', LIGHT = 'LIGHT', MODERATE = 'MODERATE', ACTIVE = 'ACTIVE', EXTRA = 'EXTRA' }
export enum FitnessLevel { BEGINNER = 'BEGINNER', INTERMEDIATE = 'INTERMEDIATE', ADVANCED = 'ADVANCED' }
export enum Equipment { GYM = 'GYM', HOME = 'HOME', NONE = 'NONE' }

export class UpdateProfileDto {
  @IsString()
  name: string;

  @IsInt()
  @Min(13)
  @Max(100)
  age: number;

  @IsNumber()
  @Min(30)
  @Max(300)
  weightKg: number;

  @IsNumber()
  @Min(100)
  @Max(250)
  heightCm: number;

  @IsEnum(Sex)
  sex: Sex;

  @IsEnum(ActivityLevel)
  activityLevel: ActivityLevel;

  @IsEnum(FitnessLevel)
  fitnessLevel: FitnessLevel;

  @IsOptional()
  @IsEnum(Equipment)
  equipment?: Equipment;

  @IsOptional()
  @IsArray()
  dietaryRestrictions?: string[];

  @IsOptional()
  @IsArray()
  allergies?: string[];

  @IsOptional()
  @IsArray()
  medicalConditions?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  daysAvailablePerWeek?: number;

  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(180)
  sessionDurationMin?: number;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  country?: string;
}
