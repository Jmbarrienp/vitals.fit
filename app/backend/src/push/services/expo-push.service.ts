import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DeviceTokenService } from './device-token.service';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound: 'default';
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

@Injectable()
export class ExpoPushService {
  private readonly logger = new Logger(ExpoPushService.name);

  constructor(
    private readonly deviceToken: DeviceTokenService,
    private readonly prisma: PrismaService,
  ) {}

  // Fire-and-forget — never throws, never blocks caller.
  sendToUser(userId: string, title: string, body: string, trigger: string): void {
    this.doSend(userId, title, body, trigger).catch((err: unknown) =>
      this.logger.error(`Unhandled push error userId=${userId}`, err),
    );
  }

  private async doSend(
    userId: string,
    title: string,
    body: string,
    trigger: string,
  ): Promise<void> {
    const tokens = await this.deviceToken.getActiveForUser(userId);

    if (tokens.length === 0) {
      this.logger.debug(`No active push tokens for userId=${userId}`);
      return;
    }

    const messages: ExpoMessage[] = tokens.map((to) => ({
      to,
      title,
      body,
      data: { trigger },
      sound: 'default',
    }));

    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(messages),
    });

    const json = (await res.json()) as { data: ExpoTicket[] };

    await Promise.all(
      json.data.map(async (ticket, i) => {
        const token = tokens[i];
        const isDeviceGone = ticket.details?.error === 'DeviceNotRegistered';
        const status = ticket.status === 'ok' ? 'sent' : (ticket.details?.error ?? 'failed');

        if (isDeviceGone) {
          await this.deviceToken.markInactive(token);
        }

        await this.prisma.pushLog.create({
          data: {
            userId,
            token,
            title,
            body: body.slice(0, 200),
            trigger,
            status,
            receiptId: ticket.id,
            errorCode: ticket.message,
          },
        });

        if (ticket.status === 'ok') {
          this.logger.log(
            `Push sent userId=${userId} trigger=${trigger} receipt=${ticket.id}`,
          );
        } else {
          this.logger.warn(
            `Push failed userId=${userId} error=${ticket.details?.error} token=${token.slice(-6)}`,
          );
        }
      }),
    );
  }
}
