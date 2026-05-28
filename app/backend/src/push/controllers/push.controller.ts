import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RegisterTokenDto } from '../dto/register-token.dto';
import { DeviceTokenService } from '../services/device-token.service';

@Controller('push')
export class PushController {
  constructor(private readonly deviceToken: DeviceTokenService) {}

  @UseGuards(JwtAuthGuard)
  @Post('token')
  async registerToken(
    @Request() req: { user: { id: string } },
    @Body() dto: RegisterTokenDto,
  ): Promise<{ ok: boolean }> {
    await this.deviceToken.upsert(req.user.id, dto.token, dto.platform);
    return { ok: true };
  }
}
