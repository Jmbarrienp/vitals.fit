import { Controller, Get, Put, Body, UseGuards, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiAuthErrors, ApiValidationError } from '../common/swagger/error-responses';

@ApiTags('users')
@ApiBearerAuth()
@ApiAuthErrors()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  /** The caller's account + profile (onboarding fields, dietary flags, training availability). */
  @ApiOperation({ summary: "The authenticated caller's own profile." })
  @Get('me')
  getMe(@Request() req) {
    return this.usersService.getMe(req.user.id);
  }

  /** Full replace of the profile (onboarding + subsequent edits use the same endpoint). */
  @ApiOperation({ summary: "Replace the authenticated caller's profile." })
  @ApiValidationError()
  @Put('profile')
  updateProfile(@Request() req, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(req.user.id, dto);
  }
}
