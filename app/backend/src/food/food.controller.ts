import { Controller, Get, Query, Param, UseGuards } from '@nestjs/common';
import { FoodService } from './food.service';
import { SearchFoodDto } from './dto/search-food.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('food')
export class FoodController {
  constructor(private foodService: FoodService) {}

  @Get('search')
  search(@Query() dto: SearchFoodDto) {
    return this.foodService.search(dto.q, dto.limit);
  }

  @Get('common')
  getCommon() {
    return this.foodService.getCommon(20);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.foodService.findById(id);
  }
}
