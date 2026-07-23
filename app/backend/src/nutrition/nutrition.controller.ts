import { Controller, Post, UseGuards, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { NutritionService } from './nutrition.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiAuthErrors } from '../common/swagger/error-responses';

@ApiTags('nutrition')
@ApiBearerAuth()
@ApiAuthErrors()
@UseGuards(JwtAuthGuard)
@Controller('nutrition')
export class NutritionController {
  constructor(private nutritionService: NutritionService) {}

  /** Recomputes BMR/TDEE and macro targets from the caller's current profile + active goal. No request body. */
  @ApiOperation({ summary: "Recalculate the caller's caloric and macro targets." })
  @Post('calculate')
  calculate(@Request() req) {
    return this.nutritionService.calculate(req.user.id);
  }
}
