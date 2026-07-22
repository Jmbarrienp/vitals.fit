# Nutrition Platform V5.3 — Production Deployment Gate

**Fecha:** 2026-07-16 · **Rama:** `feature/nutrition-state-2a2` · **Estado:** implementado y verificado — **WAIT: sin commit, sin push, sin deploy, sin migraciones aplicadas**

Cierra los bloqueantes que V5.2 dejó explícitamente abiertos. Cero funcionalidades nuevas.

---

## 1. Auditoría — hallazgos

| Área | Estado encontrado |
|---|---|
| Rate limiting | **Inexistente.** Sin `@nestjs/throttler` ni nada equivalente. `/auth/login` aceptaba intentos ilimitados (fuerza bruta contra hashes) y los endpoints de Vision podían dispararse sin tope, **cada llamada costando dinero de vendor**. |
| CORS | `origin: '*'` **con `Authorization` permitido**, en todos los entornos. |
| Endpoints admin | **6 controllers** (learning, rollout, governance, promotion, rollback, canary) protegidos solo por el JWT **de usuario común**: cualquier usuario autenticado leía analíticas de plataforma, scorecards de proveedores y postura de rollout. |
| Modelo `User` | **Sin campo de rol.** No existía separación usuario/operador de ningún tipo. |
| Readiness | **No existía.** Solo `/health` (mejorado en V5.2) y `/health/live`. |
| Migraciones | 14 en repo, `migrate:deploy`/`migrate:status` ya existían, pero **sin ningún gate previo**: nada verificaba *a qué base* se iban a aplicar. |
| `DATABASE_URL` | **Sin validación de destino.** El riesgo registrado (producción apuntando a la Supabase local con datos de seed) no tenía forma de detectarse. |

---

## 2. Cambios realizados

### Rate limiting (`common/rate-limit/`, `common/guards/rate-limit.guard.ts`)
Limitador de ventana fija **en memoria y acotado**. Hecho a mano en vez de añadir `@nestjs/throttler`: el objetivo es una **instancia única** de Render, donde un contador en proceso es equivalente al store por defecto de cualquier librería — sin dependencia nueva, con reloj inyectado (determinista) y testeable sin arrancar Nest.

**Limitación declarada, no descubierta en producción:** los contadores son **por instancia**. En el momento en que la API corra más de una réplica, un cliente obtiene N× el límite y esto debe migrar a Redis. Está en el checklist.

Seguridad de memoria por diseño (era un tema explícito de la auditoría V5.2): barrido en cada escritura + tope duro de 10 000 claves con evicción — un `Map` sin límite indexado por IP es un vector trivial de agotamiento de memoria.

Buckets: `AUTH` 5/15min · `VISION` 20/h · `BARCODE` 60/h · `DEFAULT` 300/min. **Todos ajustables por variable de entorno** — poder apretar durante un incidente sin desplegar.

### CORS de producción (`config/production-config.ts`)
`resolveCors` puro. Desarrollo refleja cualquier origen; **producción nunca recibe wildcard** y `CORS_ORIGINS="*"` es un **error de arranque**. Sin allowlist en producción **falla cerrado** (ningún origen de navegador) — correcto para cliente móvil nativo, que no envía `Origin`.

### Separación usuario/operador (`common/guards/admin.guard.ts`)
Allowlist por `ADMIN_EMAILS` **en vez de una columna en la base**. Decisión deliberada: comprometer la base **no** otorga acceso de operador; cambiar la allowlist exige acceso al deploy. Y evita una migración en un slice de despliegue.

**Falla cerrado:** sin `ADMIN_EMAILS`, se le niega a *todos* (no se abre a todos).

**Matiz encontrado durante la implementación:** `learning.controller.ts` mezcla rutas del propio usuario (`trust`, `trust/scan/:id` devuelven datos del llamante) con analíticas de plataforma. Gatear la clase entera habría **eliminado silenciosamente una función de usuario**, así que ahí el guard se aplica **por ruta**.

### Readiness (`GET /ready`)
Deliberadamente **distinto** de `/health`. Liveness pregunta "¿el proceso vive?" (reiníciame si no); readiness pregunta "¿esta instancia debe recibir tráfico?" — más amplio: un proceso arrancado con base inalcanzable, configuración inválida o CORS wildcard en producción está **vivo pero no listo**. Confundirlos es cómo un deploy o bien flapea o bien sirve tráfico roto en silencio. Reporta **todos** los checks aunque uno falle (base, configuración, CORS, operadores, proveedores, rate limiting).

### Preflight (`npm run preflight`)
El gate reproducible **antes** de tocar una base real. Responde la pregunta abierta desde el inicio: *"¿voy a migrar la base que creo?"*
- Identifica el destino por **host + base + fingerprint**, **nunca imprime credenciales**.
- Verifica contra `EXPECTED_DB_FINGERPRINT` → **aborta** si no coincide.
- **Bloquea** `NODE_ENV=production` apuntando a localhost.
- Lee `_prisma_migrations` y lista las **pendientes**; bloquea si hay fallidas/revertidas.
- **Detecta datos de seed/prueba** (`@test.local`, `@example.com`) — en producción es **bloqueante**: exactamente el riesgo registrado.
- Avisa si el catálogo de alimentos está vacío o si una base de producción con usuarios va a migrarse sin backup confirmado.
- **Read-only por construcción**: no ejecuta DDL, seed ni migración. Sale distinto de cero ante bloqueantes.

---

## 3. Checklist de despliegue

```bash
# 1. PREFLIGHT — nunca lo saltes. Read-only; aborta si la base es la equivocada.
cd app/backend
export DATABASE_URL="<url de producción>"
export NODE_ENV=production
npm run preflight
#    → confirma host/base/fingerprint, migraciones pendientes, ausencia de seeds

# 2. Fija el fingerprint en el entorno de Render (blinda despliegues futuros)
#    EXPECTED_DB_FINGERPRINT=<el que imprimió el paso 1>

# 3. Variables OBLIGATORIAS en Render (el arranque falla si faltan)
#    DATABASE_URL, DIRECT_URL
#    JWT_SECRET          ← openssl rand -base64 48   (nunca 'changeme')
#    NODE_ENV=production
#    ADMIN_EMAILS=<tu email>        ← si no, gobernanza cerrada a todos
#    CORS_ORIGINS=<orígenes web>    ← omitir si solo hay móvil nativo

# 4. Postura de proveedores (todo inerte por defecto — no cambiar en el primer deploy)
#    VISION_PROVIDER=fixture  OCR_PROVIDER=fixture
#    RESTAURANT_MENU_PROVIDER=none  AUTO_ACCEPT_ENABLED=false
#    SHADOW_SAMPLE_RATE=0

# 5. Verificación local completa antes de desplegar
npm run deploy:check     # preflight + smoke:deploy
npm run build            # debe terminar limpio

# 6. BACKUP de la base de producción (Supabase → snapshot manual)

# 7. Migraciones
npm run migrate:status   # confirma qué se va a aplicar
npm run migrate:deploy   # aplica las 5 pendientes de Vision

# 8. Deploy del código en Render

# 9. Verificación post-deploy
curl https://<host>/api/health        # 200 + database.ok:true
curl https://<host>/api/ready         # 200 "ready" + todos los checks ok
curl https://<host>/api/health/live   # 200

# 10. Verificación de seguridad (con un JWT de usuario NO operador)
curl -H "Authorization: Bearer <token-usuario>" https://<host>/api/vision/rollout
#    → debe responder 403, NO 200
```

## 4. Procedimiento de rollback

```bash
# A. El código es el problema (API 5xx, comportamiento roto)
#    Render → Rollback al deploy anterior. Sin pasos de base: las migraciones
#    de este ciclo son ADITIVAS (columnas nullable + tablas nuevas), así que
#    el código anterior funciona contra el esquema nuevo.

# B. Una función se comporta mal (sin desplegar)
#    AUTO_ACCEPT_ENABLED=false     → detiene el registro autónomo (V3.6)
#    SHADOW_SAMPLE_RATE=0          → detiene el gasto de vendor en sombra
#    VISION_PROVIDER=fixture       → Vision determinista, coste cero
#    RATE_LIMIT_* más estrictos    → contiene abuso
#    Todos son cambios de variable + reinicio. Sin deploy, sin migración.

# C. La base es el problema
#    Restaurar el snapshot del paso 6. Las migraciones aditivas no destruyen
#    datos previos, así que restaurar es el último recurso, no el primero.

# D. Compromiso de seguridad
#    Rotar JWT_SECRET (invalida TODAS las sesiones) + vaciar ADMIN_EMAILS.
```

## 5. Verificación

| Check | Resultado |
|---|---|
| `smoke:deploy` (nuevo) | ✅ **54/54** |
| Rate limiting | ✅ límite exacto, 429 + Retry-After, cuota por cliente, reset de ventana, **tope de memoria probado** (10 500 claves → ≤10 000), overrides y fallback ante override inválido |
| CORS | ✅ wildcard imposible en producción; `"*"` es error de arranque; falla cerrado sin allowlist |
| Operadores | ✅ falla cerrado sin configurar; 403 a usuario común; admite operador; case-insensitive |
| Readiness | ✅ **instancia mal configurada → 503** (probado con `JWT_SECRET` ausente), configurada → 200; liveness sigue OK ante caída de base |
| Preflight | ✅ nunca imprime credenciales, detecta seeds, verifica fingerprint, bloquea prod→localhost, read-only, sale ≠0 |
| **20/20 suites** | ✅ todas verdes |
| Builds | ✅ backend build, backend tsc, mobile tsc — limpios |

## 6. Riesgos restantes

| Riesgo | Severidad |
|---|---|
| **Rate limiting por instancia** — con >1 réplica el límite se multiplica. Requiere Redis. | 🟠 (irrelevante hoy: instancia única) |
| **Sin observabilidad externa** (Sentry/APM). Un 500 solo existe en logs de Render. | 🟠 |
| **Sin CI** — nada corre los 20 smokes antes de un merge. | 🟠 |
| **Sin tests HTTP reales** (supertest) — los smokes prueban servicios, no la capa HTTP. | 🟡 |
| **Sin graceful drain** de peticiones en vuelo al apagar. | 🟡 |
| **`EXPECTED_DB_FINGERPRINT` sin fijar** hasta el primer preflight real. | 🟡 |
| Mobile sin error boundary global. | 🟡 |

## 7. Estado de Production Readiness

**Los cuatro bloqueantes de V5.2 están cerrados**: rate limiting existe y es configurable; CORS no puede ser wildcard en producción; los endpoints de operador exigen allowlist explícita y fallan cerrado; y existe un procedimiento **reproducible, seguro, auditable y reversible** para verificar la base y aplicar migraciones.

**Sigue pendiente por acción humana** (no por código): correr `npm run preflight` contra la base real de Render para **resolver definitivamente** la duda registrada de si producción comparte base con los datos de seed locales. Ese comando existe ahora precisamente para responderla, y **debe correrse antes del primer deploy**.

**WAIT** — sin commit, sin push, sin merge, sin deploy, sin migraciones aplicadas.
