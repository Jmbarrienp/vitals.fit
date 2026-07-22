/**
 * Environment validation (V5.2 hardening) — FAIL FAST AT BOOT.
 *
 * The problem this solves is not hypothetical. Before this, `JWT_SECRET` was
 * read directly from `process.env` in two places (`auth.module.ts`,
 * `jwt.strategy.ts`) with no validation whatsoever:
 *
 *   - missing  -> the app booted "fine" and failed at the FIRST LOGIN, far from
 *                 the deploy that caused it;
 *   - `changeme` (the literal value shipped in .env.example) -> the app booted
 *                 fine and every token in production was forgeable by anyone
 *                 who had read the repo. Silent, total auth bypass.
 *
 * A misconfigured deploy must fail LOUDLY and IMMEDIATELY, before it can serve
 * a single request. This module is a pure function so it is testable without
 * booting Nest, and it is wired into `ConfigModule.forRoot({ validate })`.
 *
 * Philosophy: validate what would be CATASTROPHIC or SILENT if wrong. Optional
 * feature switches keep their documented defaults — this is a safety gate, not
 * a straitjacket.
 */

/** Values that must never reach production as a signing secret. */
const FORBIDDEN_SECRETS = ['changeme', 'secret', 'password', 'jwt_secret', 'test'];
/** Below this, a secret is brute-forceable. 32 chars ≈ 128+ bits of entropy in practice. */
export const MIN_JWT_SECRET_LENGTH = 32;

export interface EnvValidationResult {
  errors: string[];
  warnings: string[];
}

/**
 * PURE. Returns every problem at once (not just the first) so a broken deploy
 * is fixed in one pass rather than one restart per mistake.
 */
export function collectEnvProblems(env: Record<string, unknown>): EnvValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const isProduction = String(env.NODE_ENV ?? '').toLowerCase() === 'production';

  // ── Required everywhere ──
  const databaseUrl = str(env.DATABASE_URL);
  if (!databaseUrl) {
    errors.push('DATABASE_URL is required (the app cannot serve a single request without it).');
  } else if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) {
    errors.push('DATABASE_URL must be a postgres:// or postgresql:// connection string.');
  }

  const jwtSecret = str(env.JWT_SECRET);
  if (!jwtSecret) {
    errors.push('JWT_SECRET is required — without it every login fails at runtime, long after the deploy that broke it.');
  } else {
    if (FORBIDDEN_SECRETS.includes(jwtSecret.toLowerCase())) {
      errors.push(
        `JWT_SECRET is set to the placeholder "${jwtSecret}" — this value is public in .env.example, so every token would be forgeable. Generate a real secret.`,
      );
    } else if (jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
      const message = `JWT_SECRET is only ${jwtSecret.length} characters; ${MIN_JWT_SECRET_LENGTH}+ is required to resist brute force.`;
      // Short secrets are a hard failure in production, a warning in local dev.
      if (isProduction) errors.push(message);
      else warnings.push(`${message} (allowed outside production)`);
    }
  }

  // ── Optional switches: validate SHAPE only, never presence (defaults are documented). ──
  const sampleRate = env.SHADOW_SAMPLE_RATE;
  if (sampleRate !== undefined && sampleRate !== '') {
    const rate = Number(sampleRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
      errors.push(`SHADOW_SAMPLE_RATE must be a number between 0 and 1 (got "${String(sampleRate)}").`);
    }
  }

  for (const flag of ['AUTO_ACCEPT_ENABLED']) {
    const value = env[flag];
    if (value !== undefined && value !== '' && !['true', 'false'].includes(String(value).toLowerCase())) {
      errors.push(`${flag} must be exactly "true" or "false" (got "${String(value)}"). Anything else silently reads as false.`);
    }
  }

  const port = env.PORT;
  if (port !== undefined && port !== '' && !Number.isInteger(Number(port))) {
    errors.push(`PORT must be an integer (got "${String(port)}").`);
  }

  // ── Production-only posture warnings (never block a deploy) ──
  if (isProduction) {
    if (!str(env.ANTHROPIC_API_KEY)) {
      warnings.push('ANTHROPIC_API_KEY is not set — AI features degrade to their deterministic fallbacks (by design, but confirm this is intended).');
    }
    if (String(env.AUTO_ACCEPT_ENABLED ?? '').toLowerCase() === 'true') {
      warnings.push('AUTO_ACCEPT_ENABLED=true — the platform will log meals without asking. Confirm the shadow-mode evidence supported enabling it.');
    }
  }

  return { errors, warnings };
}

/**
 * The ConfigModule hook. Throws on any error so Nest aborts the boot; prints
 * warnings once and continues.
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const { errors, warnings } = collectEnvProblems(config);

  for (const warning of warnings) {
    // eslint-disable-next-line no-console
    console.warn(`[config] WARNING: ${warning}`);
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration — the application refuses to start:\n` +
        errors.map((e) => `  • ${e}`).join('\n') +
        `\nFix these variables and redeploy.`,
    );
  }

  return config;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
