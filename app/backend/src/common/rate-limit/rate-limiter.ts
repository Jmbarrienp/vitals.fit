/**
 * In-memory fixed-window rate limiter (V5.3) — PURE and bounded.
 *
 * Why hand-rolled instead of @nestjs/throttler: the deployment target is a
 * SINGLE Render instance, where an in-process counter is exactly equivalent to
 * a library's default memory store — and this version adds no dependency, is
 * deterministic (the clock is injected), and is testable without booting Nest.
 *
 * THE LIMITATION, stated plainly because it decides when this must be
 * replaced: counters are per-INSTANCE. The moment the API runs more than one
 * replica, a client gets N× the limit and this must move to Redis. Documented
 * in the deployment checklist rather than discovered in production.
 *
 * Memory safety was an explicit V5.2 audit finding, so it is designed in here:
 * entries are swept on write and the map is hard-capped with oldest-first
 * eviction. An unbounded Map keyed by client IP is a trivial memory-exhaustion
 * vector, and this one cannot grow past MAX_KEYS.
 */

export interface RateLimitRule {
  /** requests allowed per window */
  limit: number;
  windowMs: number;
}

export interface RateLimitVerdict {
  allowed: boolean;
  remaining: number;
  /** seconds until the window resets — surfaced as Retry-After */
  retryAfterSeconds: number;
}

/** Hard ceiling on tracked clients; beyond it the oldest window is evicted. */
export const MAX_KEYS = 10_000;

interface Window {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  /**
   * Records a hit and returns the verdict. `now` is injected so behavior is
   * deterministic under test and never depends on a hidden clock.
   */
  hit(key: string, rule: RateLimitRule, now: number): RateLimitVerdict {
    this.sweep(now);

    const existing = this.windows.get(key);
    if (!existing || existing.resetAt <= now) {
      // Re-insert (rather than mutate) so Map iteration order tracks recency,
      // which is what makes oldest-first eviction meaningful.
      this.windows.delete(key);
      this.windows.set(key, { count: 1, resetAt: now + rule.windowMs });
      this.evictIfNeeded();
      return { allowed: true, remaining: Math.max(0, rule.limit - 1), retryAfterSeconds: 0 };
    }

    existing.count += 1;
    const allowed = existing.count <= rule.limit;
    return {
      allowed,
      remaining: Math.max(0, rule.limit - existing.count),
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  /** Diagnostic only — the readiness endpoint reports it so leaks are visible. */
  size(): number {
    return this.windows.size;
  }

  reset(): void {
    this.windows.clear();
  }

  private sweep(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }

  private evictIfNeeded(): void {
    while (this.windows.size > MAX_KEYS) {
      const oldest = this.windows.keys().next();
      if (oldest.done) break;
      this.windows.delete(oldest.value);
    }
  }
}

/**
 * The shipped policy. Every rule is overridable by environment variable so an
 * operator can tighten or loosen without a code deploy — a requirement when
 * the alternative is shipping to fix an abuse incident.
 */
export function resolveRules(env: Record<string, unknown>): Record<string, RateLimitRule> {
  const num = (key: string, fallback: number): number => {
    const raw = env[key];
    const parsed = Number(raw);
    return raw !== undefined && raw !== '' && Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  return {
    // Brute force is the threat: 5 attempts/15min per IP is standard.
    AUTH: { limit: num('RATE_LIMIT_AUTH', 5), windowMs: num('RATE_LIMIT_AUTH_WINDOW_MS', 15 * 60_000) },
    // Vision/OCR cost real vendor money per call — the tightest non-auth limit.
    VISION: { limit: num('RATE_LIMIT_VISION', 20), windowMs: num('RATE_LIMIT_VISION_WINDOW_MS', 60 * 60_000) },
    // Barcode lookups are free (OpenFoodFacts) but still abusable.
    BARCODE: { limit: num('RATE_LIMIT_BARCODE', 60), windowMs: num('RATE_LIMIT_BARCODE_WINDOW_MS', 60 * 60_000) },
    // Everything else: a generous ceiling that only stops runaway clients.
    DEFAULT: { limit: num('RATE_LIMIT_DEFAULT', 300), windowMs: num('RATE_LIMIT_DEFAULT_WINDOW_MS', 60_000) },
  };
}
