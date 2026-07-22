# Nutrition Platform V5.2 — Production Readiness Audit & Hardening

**Fecha:** 2026-07-16 · **Rama:** `feature/nutrition-state-2a2` · **Estado:** implementado y verificado — **WAIT: sin commit, sin push, sin migraciones**

Cero funcionalidades nuevas. Cuatro problemas reales encontrados, demostrados y corregidos.

---

## 1. Problemas encontrados

### 🔴 P1 — CRÍTICO · Seguridad: `JWT_SECRET` sin validación

`auth.module.ts` y `jwt.strategy.ts` leían `process.env.JWT_SECRET` **directamente, sin validar**. Y `.env.example` enviaba `JWT_SECRET=changeme`.

Dos escenarios, ambos silenciosos:
- **Ausente** → la app arrancaba "bien" y fallaba en el **primer login**, lejísimos del deploy que lo causó.
- **`changeme`** → la app arrancaba bien y **todos los tokens de producción eran forjables por cualquiera que hubiera leído el repo**. Bypass total de autenticación, sin un solo error en los logs.

### 🔴 P2 — ALTO · Fuga de conexiones en cada redeploy

`PrismaService` implementaba `OnModuleInit` pero **no** `OnModuleDestroy`, y `main.ts` **nunca llamaba** `enableShutdownHooks()`. Abría un `Pool` de pg en el constructor y no lo cerraba jamás: en cada SIGTERM (cada redeploy de Render) el proceso moría con sus conexiones tomadas, y la base solo las reclamaba por timeout propio. Contra un Postgres con tope de conexiones, unos pocos redeploys seguidos pueden agotar el pool y tumbar la API por una causa **invisible en los logs de la aplicación**.

### 🔴 P3 — ALTO · El health endpoint no podía reportar enfermedad

`/health` devolvía un objeto **estático** `{ status: 'ok' }`. Era literalmente incapaz de fallar: con Postgres caído seguía respondiendo 200, así que un orquestador o monitor seguiría enrutando tráfico a una instancia que no podía servir una sola petición real. Un health check que no puede reportar mala salud es decoración, no observabilidad.

### 🟠 P4 — ALTO · Triple recomputación en el endpoint más caliente

`GET /copilot/daily` → `runtime.daily()` → `runtime.session()` construía el `CoachingContext` **tres veces**: una el runtime, otra `planner.getPlan()` internamente, otra `mealPlanner.getMealPlan()` internamente. Es la lectura más cara de la plataforma (rollup + historial del ledger + review + comidas de hoy + compromisos) **triplicada en el endpoint que la app abre**.

### 🟡 P5 — MEDIO · Sin filtro de excepciones

Cero `ExceptionFilter` en todo el backend. Un error de Prisma no manejado llegaba al cliente como 500 con detalle interno (nombres de tablas, columnas, constraints), y nada lo registraba con la ruta que lo causó: fugas y no atribuible.

### Auditado y **sin** problema (se documenta para cerrar la pregunta)

| Área | Veredicto |
|---|---|
| Código muerto | **Ninguno.** `RecommendationService` (singular) parece duplicar a `RecommendationsService` pero lo usa `recommendation.listener.ts` — nombres confusos, no código muerto. **No renombrado**: churn con riesgo de regresión en un slice de hardening. |
| Dependencias circulares | Ninguna — `tsc` y el arranque de Nest lo confirman. |
| Memory leaks | `EphemeralImageStore` acotado por TTL + tope de 32 entradas con evicción; el caché de curvas de `TrustEngine` está acotado por número de proveedores. Ambos correctos. |
| N+1 | El único bucle con `await` dentro está en `ReplayEngine` (ruta de evaluación **offline**, documentada). Los caminos calientes usan `Promise.all`. |
| Payloads | `8mb` justificado para fotos base64; el resto de endpoints envía órdenes de magnitud menos. |
| Validación | `ValidationPipe` global con `whitelist: true` — DTOs correctos. |
| Timeouts | Vision/OCR/barcode/shadow todos con timeout externo más laxo que el interno del adapter (disciplina consistente). |
| Flags obsoletos | Ninguno: los 6 flags están documentados en `.env.example` y todos se leen. |
| Endpoints redundantes | Ninguno: `/copilot/session` (coordinación) y `/copilot/daily` (usuario) tienen audiencias distintas y documentadas. |

---

## 2. Cambios realizados

| Fix | Archivo | Compatibilidad |
|---|---|---|
| Validación fail-fast de entorno | `config/env.validation.ts` (nuevo), `app.module.ts` | Rechaza solo configuraciones que **ya estaban rotas** |
| Drenaje del pool + shutdown hooks | `prisma/prisma.service.ts`, `main.ts` | Aditivo |
| Health con sonda real de BD + `/health/live` | `app.controller.ts` | **Campos originales intactos**; `status: 'ok'` sigue igual en el camino feliz |
| Contexto compartido (3 builds → 1) | `planner`, `meal-planner` (param opcional), `copilot.runtime.ts` | Parámetro **opcional**: todo caller existente sin cambios |
| Filtro de excepciones | `common/filters/all-exceptions.filter.ts` (nuevo), `main.ts` | **Toda `HttpException` intencional pasa con su status y body EXACTOS** |
| `.env.example` ya no invita al deploy roto | `.env.example` | Documentación |

**Decisión de diseño clave:** el filtro es deliberadamente conservador. Cambiar respuestas de error *sería* un cambio funcional, así que cada `BadRequest`/`NotFound`/`Unauthorized`/respuesta de `ValidationPipe` se reemite **idéntica**. Solo los errores **no manejados** (que ya eran 500) se normalizan.

---

## 3. Verificación

`smoke:production` **35/35 verde**. Cada aserción corresponde a un problema demostrablemente presente antes:

- El placeholder `changeme` **es rechazado**; los errores se reportan **todos a la vez** (no uno por reinicio); secreto corto = error en producción, warning en dev.
- Base inalcanzable → `degraded` + **HTTP 503**; base colgada → timeout, no cuelga la sonda; campos originales intactos.
- Filtro: `BadRequest` conserva 400 y su mensaje; cuerpo de `ValidationPipe` byte-idéntico; error de Prisma → 500 opaco **sin filtrar internals**.
- **Performance medida, no asumida:** instrumenté el método real y conté. `1 build(s)`, antes 3.
- Compatibilidad: plan y meal plan **byte-idénticos** con contexto compartido vs propio.
- Shutdown idempotente: un segundo `onModuleDestroy` no rompe el proceso.

**19/19 suites verdes** · backend build limpio · backend tsc limpio · mobile tsc limpio.

---

## 4. Lo que TODAVÍA impediría un deploy serio

Honestamente, y por severidad:

### 🔴 Bloqueantes
1. **Sin migraciones aplicadas en prod.** Hay **5 migraciones pendientes** (V3.1, V3.3, V3.5, V3.6, V4.1). Render Free = `npx prisma migrate deploy` manual.
2. **Sin verificación de qué apunta `DATABASE_URL` en Render.** Sigue sin confirmarse si producción apunta a la misma Supabase del `.env` local, donde hubo datos de seed. **Riesgo de datos falsos en cuentas reales.**
3. **Sin rate limiting.** Ningún throttler: `/auth/login` acepta intentos ilimitados (fuerza bruta) y los endpoints de Vision pueden dispararse sin tope (coste de vendor).
4. **CORS `origin: '*'` con `Authorization` permitido.** Aceptable para cliente móvil puro; **inaceptable** si algún día hay cliente web.

### 🟠 Serios
5. **Sin rol admin.** Los ~20 endpoints de gobernanza/rollout/promotion/rollback/canary están tras JWT **de usuario común**: cualquier usuario autenticado puede leer analíticas de plataforma.
6. **Sin observabilidad externa.** No hay Sentry ni APM: un 500 en producción solo existe en los logs de Render.
7. **Sin tests unitarios/e2e formales.** Los smokes son excelentes pero corren contra Postgres embebido, no contra la API HTTP real (sin supertest).
8. **Sin CI.** Nada corre los 19 smokes automáticamente antes de un merge.
9. **Sin backups verificados** de la base de producción.
10. **Sin índice en `LoggedMealItem.foodItemId`** confirmado para el volumen esperado de los priors de porción (V3.3).

### 🟡 Menores
11. `RecommendationsService` / `RecommendationService`: nombres confusos.
12. Mobile: sin error boundary global.
13. Sin graceful drain de peticiones en vuelo (shutdown cierra el pool, pero no espera a que terminen las requests activas).

---

## 5. Estado de producción

**Objetivamente más robusta**, sin una sola funcionalidad nueva: un deploy mal configurado ahora **no arranca** en vez de fallar en el primer login o firmar tokens forjables; los redeploys ya no fugan conexiones; el health check puede reportar enfermedad; el endpoint más caliente hace **un tercio** del trabajo de base de datos; y ningún error no manejado filtra internals.

**No está lista para un deploy serio** hasta cerrar al menos los cuatro bloqueantes de arriba.

**WAIT** — sin commit, sin push, sin merge, sin deploy.
