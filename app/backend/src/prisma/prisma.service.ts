import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

/**
 * V5.2 hardening — this service used to implement `OnModuleInit` only. It
 * opened a pg Pool in the constructor and NEVER closed it: on SIGTERM (every
 * Render redeploy) the process died with its connections still checked out,
 * so the database reclaimed them only on its own timeout. Against a pooled
 * Postgres with a hard connection ceiling, a few rapid redeploys could exhaust
 * the pool and take the API down for reasons invisible in the app logs.
 *
 * Now the pool is held explicitly and drained on shutdown. Paired with
 * `app.enableShutdownHooks()` in main.ts — without that call Nest never runs
 * this hook, so the fix only works because both halves landed together.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;

  constructor() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const adapter = new PrismaPg(pool);
    super({ adapter } as any);
    this.pool = pool;
  }

  async onModuleInit() {
    await this.$connect();
  }

  /**
   * Drain on shutdown. Both steps are best-effort and independently guarded:
   * a failure to disconnect must not prevent the pool from closing, and
   * neither must turn a graceful shutdown into a crash.
   */
  async onModuleDestroy() {
    try {
      await this.$disconnect();
    } catch (err) {
      this.logger.warn(`prisma disconnect failed during shutdown: ${err instanceof Error ? err.message : err}`);
    }
    try {
      await this.pool.end();
    } catch (err) {
      this.logger.warn(`pg pool close failed during shutdown: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * A cheap liveness probe for the health endpoint. Deliberately the simplest
   * query that proves the connection is usable end to end.
   */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
