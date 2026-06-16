import {
  IsString, IsEnum, IsNumber, IsOptional, Min, Max, MaxLength,
  IsArray, ValidateNested, IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum MealType {
  BREAKFAST = 'BREAKFAST',
  LUNCH = 'LUNCH',
  DINNER = 'DINNER',
  SNACK = 'SNACK',
}

/**
 * Un ítem de una comida. Dos formas válidas:
 *  - catálogo:  { foodItemId, quantity, unit }  o  { foodItemId, servingSizeId, quantity }
 *  - manual:    { customName, quantity?, calories, proteinG, carbsG, fatG }
 * El backend resuelve gramos y calcula macros; nunca confía en macros para ítems de catálogo.
 */
export class LogMealItemDto {
  @IsOptional()
  @IsUUID()
  foodItemId?: string;

  @IsOptional()
  @IsUUID()
  servingSizeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  customName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string; // "g" | "ml" | "serving"

  @IsNumber()
  @Min(0)
  @Max(10000)
  quantity: number;

  // Solo para ítems manuales (customName). Ignorados para ítems de catálogo.
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
}

export class LogMealDto {
  @IsOptional()
  @IsEnum(MealType)
  mealType?: MealType; // si falta, se infiere por la hora

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  // ── Nuevo flujo: server-calculated ──
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LogMealItemDto)
  items?: LogMealItemDto[];

  // ── Compat temporal: payload viejo (totales precalculados por el cliente) ──
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000)
  totalCalories?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  totalProteinG?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2000)
  totalCarbsG?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500)
  totalFatG?: number;
}
