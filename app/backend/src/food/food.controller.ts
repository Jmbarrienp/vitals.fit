import { Controller, Get, Post, Delete, Query, Param, Body, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FoodService } from './food.service';
import { SearchFoodDto } from './dto/search-food.dto';
import { CreateCustomFoodDto } from './dto/create-custom-food.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiAuthErrors, ApiNotFoundError, ApiValidationError } from '../common/swagger/error-responses';

@ApiTags('food')
@ApiBearerAuth()
@ApiAuthErrors()
@UseGuards(JwtAuthGuard)
@Controller('food')
export class FoodController {
  constructor(private foodService: FoodService) {}

  /** Accent/typo-tolerant catalog search, scoped so the caller's own custom foods are included. */
  @ApiOperation({ summary: "Search the food catalog (+ the caller's custom foods)." })
  @ApiValidationError()
  @Get('search')
  search(@Request() req, @Query() dto: SearchFoodDto) {
    return this.foodService.search(dto.q, dto.limit, req.user.id);
  }

  @ApiOperation({ summary: 'The 20 most common catalog foods.' })
  @Get('common')
  getCommon(@Request() req) {
    return this.foodService.getCommon(20, req.user.id);
  }

  @ApiOperation({ summary: "The caller's most recently logged foods." })
  @Get('recent')
  getRecent(@Request() req) {
    return this.foodService.getRecent(req.user.id);
  }

  @ApiOperation({ summary: "The caller's most frequently logged foods." })
  @Get('frequent')
  getFrequent(@Request() req) {
    return this.foodService.getFrequent(req.user.id);
  }

  @ApiOperation({ summary: "The caller's favorited foods." })
  @Get('favorites')
  getFavorites(@Request() req) {
    return this.foodService.getFavorites(req.user.id);
  }

  /** A private, user-owned food (never visible to other users' searches). */
  @ApiOperation({ summary: 'Create a custom food owned by the authenticated caller.' })
  @ApiValidationError()
  @Post('custom')
  createCustom(@Request() req, @Body() dto: CreateCustomFoodDto) {
    return this.foodService.createCustom(req.user.id, dto);
  }

  @ApiOperation({ summary: 'Favorite a catalog or custom food.' })
  @ApiNotFoundError('Food')
  @Post(':id/favorite')
  addFavorite(@Request() req, @Param('id') id: string) {
    return this.foodService.addFavorite(req.user.id, id);
  }

  /** Idempotent: unfavoriting an id that was never favorited (or does not exist) still returns 200. */
  @ApiOperation({ summary: 'Remove a food from favorites.' })
  @Delete(':id/favorite')
  removeFavorite(@Request() req, @Param('id') id: string) {
    return this.foodService.removeFavorite(req.user.id, id);
  }

  // Keep the param route LAST so it doesn't shadow the static routes above.
  /** Returns `null` (with 200) rather than 404 for an id that does not exist. */
  @ApiOperation({ summary: 'A single food by id (catalog or custom).' })
  @Get(':id')
  findById(@Param('id') id: string) {
    return this.foodService.findById(id);
  }
}
