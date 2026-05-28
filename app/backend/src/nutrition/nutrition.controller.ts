import { Controller, Post, UseGuards, Request } from '@nestjs/common';
import { NutritionService } from './nutrition.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('nutrition')
export class NutritionController {
  constructor(private nutritionService: NutritionService) {}

  @Post('calculate')
  calculate(@Request() req) {
    return this.nutritionService.calculate(req.user.id);
  }
}
