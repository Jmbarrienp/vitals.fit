import { IsString, IsOptional, IsInt, Min, Max, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class SearchFoodDto {
  @IsString()
  @MinLength(1)
  q: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  limit?: number = 15;
}
