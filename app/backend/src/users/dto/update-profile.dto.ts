import {
  IsString,
  IsInt,
  IsNumber,
  IsEnum,
  IsOptional,
  IsArray,
  Min,
  Max,
  MaxLength,
  ArrayMaxSize,
} from 'class-validator';

export enum Sex {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  OTHER = 'OTHER',
}
export enum ActivityLevel {
  SEDENTARY = 'SEDENTARY',
  LIGHT = 'LIGHT',
  MODERATE = 'MODERATE',
  ACTIVE = 'ACTIVE',
  EXTRA = 'EXTRA',
}
export enum FitnessLevel {
  BEGINNER = 'BEGINNER',
  INTERMEDIATE = 'INTERMEDIATE',
  ADVANCED = 'ADVANCED',
}
export enum Equipment {
  GYM = 'GYM',
  HOME = 'HOME',
  NONE = 'NONE',
}

export class UpdateProfileDto {
  @IsString()
  @MaxLength(120)
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

  // V5.5 — @IsArray() alone checks the container, not its contents: a payload
  // like [123, {}] previously passed validation and reached Prisma's String[]
  // column. These three are the only DTO array fields in the API without an
  // element-type check; every other array field (LogMealDto.items,
  // ConfirmScanDto.items) already validates its elements.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  dietaryRestrictions?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  allergies?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
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
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  country?: string;
}
