import { Module } from '@nestjs/common';
import { PushController } from './controllers/push.controller';
import { DeviceTokenService } from './services/device-token.service';
import { ExpoPushService } from './services/expo-push.service';

@Module({
  controllers: [PushController],
  providers: [DeviceTokenService, ExpoPushService],
  exports: [ExpoPushService],
})
export class PushModule {}
