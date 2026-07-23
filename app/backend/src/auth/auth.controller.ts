import { Controller, Post, Get, Body, UseGuards, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RateLimit } from '../common/guards/rate-limit.guard';
import {
  ApiAuthErrors,
  ApiConflictError,
  ApiPublicErrors,
  ApiRateLimited,
  ApiValidationError,
} from '../common/swagger/error-responses';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  /** Creates the account and returns a bearer token — no separate login call needed. */
  @ApiOperation({ summary: 'Register a new account (email + password).' })
  @ApiPublicErrors()
  @ApiValidationError()
  @ApiConflictError('The email is already registered.')
  @ApiRateLimited()
  @RateLimit('AUTH')
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @ApiOperation({ summary: 'Exchange email + password for a bearer token.' })
  @ApiPublicErrors()
  @ApiValidationError()
  @ApiAuthErrors()
  @ApiRateLimited()
  @RateLimit('AUTH')
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /** The caller's own account row (profile relation included, password hash never selected). */
  @ApiOperation({ summary: "The authenticated caller's own account." })
  @ApiBearerAuth()
  @ApiAuthErrors()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Request() req) {
    return this.authService.me(req.user.id);
  }
}
