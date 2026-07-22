import { Controller, Post, Get, Body, UseGuards, Request } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RateLimit } from '../common/guards/rate-limit.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @RateLimit('AUTH')
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @RateLimit('AUTH')
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Request() req) {
    return this.authService.me(req.user.id);
  }
}
