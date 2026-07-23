# ADR-0003: Contract testing boots the built app via Supertest-in-ts-node, not Jest e2e

- **Estado:** Accepted
- **Fecha:** 2026-07-22
- **Decide:** Principal Software Architect

## Contexto

Hasta V5.5 las 21 suites de smoke prueban **servicios**, nunca la API HTTP:
cada una hace `new PrismaService()` / `new FoodService(...)` a mano y llama
métodos directamente — ninguna arranca el servidor Nest real, así que ninguna
ejercita `ValidationPipe`, `AllExceptionsFilter`, `JwtAuthGuard`, `AdminGuard`
o `RateLimitGuard` de verdad. V5.4's propia lista de mejoras futuras nombró
esto explícitamente ("Supertest para probar la capa HTTP").

`main.ts`'s `bootstrap()` tampoco era reutilizable: toda la configuración
global (body parser, pipes, filtro, CORS, rate limiting, prefijo) vivía
inline en una función que también hacía `app.listen()` — no había forma de
levantar el mismo pipeline en un test sin retipear cada línea (una segunda
fuente de verdad, justo lo que este proyecto evita).

Separado: `@nestjs/swagger` solo enriquece los DTOs con schemas reales
(campo por campo) a través de su plugin de compilación — que corre dentro de
`nest build`, NO dentro de `ts-node --transpile-only` (el mecanismo que usan
las 21 suites existentes).

## Decisión

1. **Extraemos `configureApp()`** (`src/bootstrap/configure-app.ts`) — toda la
   configuración global de `main.ts`, sin `app.listen()`. `main.ts` y el
   nuevo `scripts/smoke-http-contract.ts` llaman a la MISMA función.
2. **Extraemos `buildOpenApiDocument()`** (`src/bootstrap/openapi-document.ts`)
   por la misma razón: el snapshot debe describir EXACTAMENTE el documento
   que `/api/docs` sirve en producción, no uno generado de otra forma.
3. **El contract test suite arranca desde `dist/`**, no desde `src/` vía
   ts-node. `smoke-http-contract.ts` corre `npm run build` como su primer
   paso y luego importa `dist/app.module`, `dist/bootstrap/*`. Esto es lo que
   garantiza que el snapshot refleje el contrato real (con schemas de DTO
   completos, no objetos vacíos).
4. **Supertest como librería dentro de un script ts-node**, con la misma
   convención `check()` / 🎉 TODO VERDE que las 21 suites existentes —
   NO Jest + `.e2e-spec.ts`, a pesar de ser el patrón más común en proyectos
   Nest nuevos.
5. **Reutiliza el patrón de Postgres embebido** (mismo mecanismo que las 21
   suites: `embedded-postgres`, migraciones SQL crudas, sin tocar `.env`).
6. **`RateLimitGuard` queda ACTIVO** durante la suite (no se desactiva por
   env var) — es parte de lo que se verifica, no un obstáculo. Las secciones
   que agotarían su propio presupuesto llaman a
   `RateLimitGuard.resetForTests()` (seam ya expuesto desde V5.3).

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| Jest + Supertest (`test/*.e2e-spec.ts`), el patrón estándar de Nest | Introduce un SEGUNDO framework de test (Jest) coexistiendo con la convención `ts-node`/`check()` ya establecida en 21 suites, sin que exista aún NINGÚN test unitario en Jest (la V5.4 recomendó Jest para unit tests de `pipeline/`, que sigue sin existir). Adoptar Jest solo para e2e ahora fragmentaría la convención de testing en dos paradigmas en vez de uno; mejor adoptarlo de una vez cuando se traigan los unit tests, no a medias aquí |
| Generar el snapshot desde `src/` vía ts-node (sin build) | El plugin de `@nestjs/swagger` no corre fuera de `nest build`; el documento resultante tendría schemas de DTO vacíos (`{type:'object'}` sin propiedades) — un snapshot que no detecta "se eliminó un campo" no cumple su propósito |
| `PluginMetadataGenerator` invocado a mano (sin build completo) | Esta versión de `@nestjs/swagger` (^11.4.6) no expone esa utilidad en su superficie pública (`dist/plugin/index.d.ts` solo exporta `before` y `ReadonlyVisitor`); reimplementar el driver del Compiler API a mano es frágil y acopla el test a internals de la librería |
| Mockear PrismaService en vez de Postgres embebido | Segunda fuente de verdad sobre cómo se comporta la base de datos real; rompe la consistencia con las 21 suites existentes, todas las cuales prueban contra Postgres real |
| Desactivar RateLimitGuard durante la suite | El rate limiting es parte de la capa HTTP que este slice existe para verificar; desactivarlo escondería exactamente el tipo de regresión que la suite debe atrapar |

## Consecuencias

**Positivas:** primera suite que prueba la API HTTP real de punta a punta
(guards, pipes, filtro, serialización); el snapshot describe el contrato que
un cliente real recibe, no una aproximación; `configureApp()`/
`buildOpenApiDocument()` son ahora single-source-of-truth reutilizable por
cualquier test futuro sin retipear main.ts.

**Negativas / coste aceptado:** `smoke:http-contract` es la suite MÁS LENTA
del repo — corre un `npm run build` completo antes de arrancar (los otros 20
smokes no compilan nada). `verify` también corre `build` explícitamente antes
de la cadena de smokes, así que ese build se ejecuta dos veces en una corrida
completa de `verify` — redundante pero deliberado: cada suite debe poder
correr de forma aislada (`npm run smoke:http-contract` sola) y seguir siendo
correcta, sin depender de que otro paso haya compilado antes en el mismo
proceso.

**Cuándo revisar:** cuando el proyecto adopte Jest para unit tests (V5.4's
recomendación pendiente), migrar `smoke-http-contract.ts` a
`test/*.e2e-spec.ts` bajo el mismo runner deja de tener el costo de fragmentar
la convención — en ese punto esta decisión debería revertirse.
