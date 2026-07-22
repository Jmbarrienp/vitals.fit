/**
 * Production posture resolution (V5.3) — PURE, so every rule below is
 * testable without booting Nest, and so the deployment smoke can assert the
 * exact behavior a production environment will get.
 *
 * Two things this file decides, both of which were production blockers:
 *
 *   CORS  — V5.2 shipped `origin: '*'` with `Authorization` allowed. Harmless
 *           for a pure mobile client (native HTTP ignores CORS), but the day a
 *           web client exists it is an open door. Production now REQUIRES an
 *           explicit allowlist and refuses the wildcard.
 *
 *   ADMIN — the platform has ~20 governance/rollout/promotion/rollback/canary
 *           endpoints that were protected by the ordinary user JWT, so ANY
 *           authenticated user could read platform-wide analytics. Operator
 *           identity is an env allowlist rather than a database column on
 *           purpose: compromising the database must not grant operator access,
 *           and changing the allowlist requires deploy access.
 */

export interface CorsPosture {
  /** `true` = reflect any origin (dev only). Otherwise an explicit allowlist. */
  origin: true | string[];
  isWildcard: boolean;
  reason: string;
}

/**
 * Resolve the CORS posture. Production never gets a wildcard; the caller
 * (env validation) refuses to boot if production has no allowlist configured.
 */
export function resolveCors(env: Record<string, unknown>): CorsPosture {
  const isProduction = String(env.NODE_ENV ?? '').toLowerCase() === 'production';
  const configured = parseList(env.CORS_ORIGINS);

  if (configured.length > 0) {
    return {
      origin: configured,
      isWildcard: false,
      reason: `allowlist explícita de CORS_ORIGINS (${configured.length} origen(es))`,
    };
  }
  if (isProduction) {
    // Fail CLOSED: no allowlist in production means no browser origin is
    // trusted. Native mobile clients are unaffected (they do not send Origin).
    return {
      origin: [],
      isWildcard: false,
      reason: 'producción sin CORS_ORIGINS — ningún origen de navegador permitido (los clientes móviles nativos no se ven afectados)',
    };
  }
  return { origin: true, isWildcard: true, reason: 'desarrollo — se refleja cualquier origen' };
}

/** Operators, by email, from the deploy environment. Empty = nobody. */
export function resolveAdminEmails(env: Record<string, unknown>): string[] {
  return parseList(env.ADMIN_EMAILS).map((e) => e.toLowerCase());
}

/**
 * FAIL CLOSED. An unset ADMIN_EMAILS denies everyone rather than allowing
 * everyone — the difference between "no operators configured yet" and "every
 * user is an operator" is the whole point of this gate.
 */
export function isAdmin(email: string | null | undefined, adminEmails: string[]): boolean {
  if (!email || adminEmails.length === 0) return false;
  return adminEmails.includes(email.trim().toLowerCase());
}

function parseList(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
