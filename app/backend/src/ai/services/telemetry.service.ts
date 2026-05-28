import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AiGenerationEntry {
  userId: string;
  trigger: string;
  model: string;
  latencyMs: number;
  success: boolean;
  fallbackUsed: boolean;
  inputTokenApprox?: number;
  outputTokens?: number;
  cacheHit?: boolean;
  compactSnapshot?: Record<string, unknown>;
  finalRecommendation?: string;
  errorType?: string;
}

@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Fire-and-forget: never throws, never blocks the caller.
  record(entry: AiGenerationEntry): void {
    this.prisma.aiGenerationLog
      .create({
        data: {
          ...entry,
          compactSnapshot: entry.compactSnapshot as Prisma.InputJsonValue | undefined,
        },
      })
      .catch((err: unknown) =>
        this.logger.error('Failed to write AI generation log', err),
      );
  }
}
