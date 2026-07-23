import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RegisterTokenDto } from '../dto/register-token.dto';
import { DeviceTokenService } from '../services/device-token.service';
import { ApiAuthErrors, ApiValidationError } from '../../common/swagger/error-responses';

// V5.5 — moved from a method-level guard to class-level for consistency with
// every other controller in the API (the previous placement was equivalent —
// this is the only route in the class — but a class-level guard is what a
// reviewer expects to see and is what stays correct if a second route is
// added here without remembering to guard it too).
@ApiTags('push')
@ApiBearerAuth()
@ApiAuthErrors()
@UseGuards(JwtAuthGuard)
@Controller('push')
export class PushController {
  constructor(private readonly deviceToken: DeviceTokenService) {}

  /** Upserts the caller's Expo push token for this platform (idempotent — one row per user+platform). */
  @ApiOperation({ summary: 'Register or refresh the device push token for the authenticated user.' })
  @ApiValidationError()
  @Post('token')
  async registerToken(
    @Request() req: { user: { id: string } },
    @Body() dto: RegisterTokenDto,
  ): Promise<{ ok: boolean }> {
    await this.deviceToken.upsert(req.user.id, dto.token, dto.platform);
    return { ok: true };
  }
}
