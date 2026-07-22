import { Controller, Get, Post, Delete, Query, Param, Body, Request, UseGuards } from '@nestjs/common';
import { FoodService } from './food.service';
import { SearchFoodDto } from './dto/search-food.dto';
import { CreateCustomFoodDto } from './dto/create-custom-food.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('food')
export class FoodController {
  constructor(private foodService: FoodService) {}

  @Get('search')
  search(@Request() req, @Query() dto: SearchFoodDto) {
    return this.foodService.search(dto.q, dto.limit, req.user.id);
  }

  @Get('common')
  getCommon(@Request() req) {
    return this.foodService.getCommon(20, req.user.id);
  }

  @Get('recent')
  getRecent(@Request() req) {
    return this.foodService.getRecent(req.user.id);
  }

  @Get('frequent')
  getFrequent(@Request() req) {
    return this.foodService.getFrequent(req.user.id);
  }

  @Get('favorites')
  getFavorites(@Request() req) {
    return this.foodService.getFavorites(req.user.id);
  }

  @Post('custom')
  createCustom(@Request() req, @Body() dto: CreateCustomFoodDto) {
    return this.foodService.createCustom(req.user.id, dto);
  }

  @Post(':id/favorite')
  addFavorite(@Request() req, @Param('id') id: string) {
    return this.foodService.addFavorite(req.user.id, id);
  }

  @Delete(':id/favorite')
  removeFavorite(@Request() req, @Param('id') id: string) {
    return this.foodService.removeFavorite(req.user.id, id);
  }

  // Keep the param route LAST so it doesn't shadow the static routes above.
  @Get(':id')
  findById(@Param('id') id: string) {
    return this.foodService.findById(id);
  }
}
