# Engineering V5.5 — API Contract Hardening & HTTP Integration Testing

**Fecha:** 2026-07-22 · **Rama:** `feature/nutrition-state-2a2` · **Estado:** implementado y verificado — **WAIT**

Cero funcionalidades nuevas, cero decisiones nutricionales tocadas. El objetivo: convertir la API en un contrato verificable — que un breaking change accidental falle el pipeline, no que dependa de que alguien lo note en QA.

---

## 1. Auditoría completa

| Área | Estado encontrado |
|---|---|
| Decoradores Swagger | **Cero.** `@nestjs/swagger` estaba montado (V5.4) pero ningún controller/DTO tenía `@ApiTags`, `@ApiOperation`, `@ApiProperty` ni `@ApiResponse`. `/api/docs` mostraba rutas sin schemas. |
| `nest-cli.json` | Sin plugin de `@nestjs/swagger` — sin él, ningún DTO puede tener schema de campos aunque se decore a mano, porque `SwaggerModule` no lee `design:type` directamente. |
| Contract testing | Inexistente. Las 21 suites de smoke prueban **servicios** (`new FoodService(...)`), ninguna arranca el servidor HTTP real. |
| `main.ts` / `bootstrap()` | Toda la configuración global (pipes, filtro, CORS, rate limit, prefijo) vivía inline en una función no reutilizable — sin seam para que un test reproduzca el mismo pipeline. |
| DTOs | 14 archivos, en general bien validados (`class-validator` consistente); 3 huecos objetivos: `LogWeightDto.notes` sin `@MaxLength`, y `UpdateProfileDto.{dietaryRestrictions,allergies,medicalConditions}` con `@IsArray()` pero sin validar el TIPO de los elementos. |
| Errores HTTP | `AllExceptionsFilter` (V5.2) normaliza lo no controlado a 500, pero un error `http-errors` (body-parser, ej. payload >8MB) no es `instanceof HttpException` — caía al 500 genérico. Real bug, confirmado por HTTP. |
| Autorización | Sin bugs de fondo — pero SIN ningún test automatizado que lo probara. `LearningController` (guard por ruta, no por clase) es el punto de mayor riesgo de regresión futura. |
| Duplicación | `parseDays`/`parsePercent` copiados **6 veces**, byte-idénticos, en 6 controllers de gobernanza. |
| Ownership checks | 4 patrones distintos para "no existe / no es tuyo" entre Logs, Vision, Recommendations y Food — ninguno es un bug de seguridad, pero la inconsistencia era invisible hasta que se probó por HTTP. |

---

## 2. Hallazgos

**Reales, corregidos:**
1. **413 disfrazado de 500.** Un body JSON >8MB (rechazado por `body-parser`) reportaba 500 al cliente — el error era 100% del cliente, el status decía "el servidor falló".
2. **`FoodService.addFavorite` con FK sin verificar.** `FoodFavorite.foodItemId` tiene una foreign key real hacia `FoodItem`; favoritar un id inexistente llegaba directo al `upsert` de Prisma y la violación de FK (no un `HttpException`) también caía al 500 genérico.
3. **`UpdateProfileDto`: arrays sin validar tipo de elemento.** `[123, {}]` pasaba `@IsArray()` y llegaba a una columna `String[]`.
4. **`LogWeightDto.notes` sin límite.** Único campo de texto libre en la API sin `@MaxLength`.

**Reales, documentados (no corregidos — ver §5 y ADR-0004):**
5. Tres shapes de error coexisten (HttpException con mensaje, HttpException sin mensaje, 500 normalizado) — ninguno es incorrecto, pero no son iguales.
6. Cuatro patrones de ownership distintos (Logs=404/404, Vision=404/403, Recommendations=201+mensaje/201+mensaje, Food=404/N-A).
7. `POST /recommendations/:id/respond` con un id inexistente devuelve **201 Created**, no un error — porque el servicio nunca lanza, y Nest aplica su default de `@Post()`.
8. Ningún endpoint usa 422 — el checklist original asumía que sí; la API real usa 400 (default de Nest), confirmado y documentado en vez de reinterpretado.

**Duplicación eliminada:** `parseDays`/`parsePercent`, 6 copias → 1 módulo compartido.

---

## 3. Decisiones arquitectónicas

**`configureApp()` + `buildOpenApiDocument()` extraídos de `main.ts`** ([ADR-0003](../docs/adr/0003-contract-testing-boots-from-dist-not-jest.md)). Antes de esto no existía forma de que un test reprodujera el pipeline HTTP real sin retipear cada línea de `bootstrap()` — una segunda fuente de verdad esperando a divergir. Ahora `main.ts` y `smoke-http-contract.ts` llaman a las MISMAS funciones.

**El contract suite arranca desde `dist/`, no desde `src/` vía ts-node** (ADR-0003). El plugin de `@nestjs/swagger` que enriquece los DTOs con schemas reales solo corre a través de `nest build`. Generar el snapshot desde código sin compilar habría descrito un contrato más pobre que el que un cliente real recibe — el snapshot existe precisamente para que eso NUNCA sea verdad.

**Supertest dentro de un script `ts-node`, no Jest + `.e2e-spec.ts`** (ADR-0003). Es la desviación más consciente de este slice respecto al patrón "estándar" de Nest — justificada porque el proyecto no tiene aún NINGÚN test en Jest (ni siquiera unitario), y adoptarlo solo para e2e fragmentaría la convención de testing en dos paradigmas parciales en vez de uno completo. Queda explícitamente marcado como "revisar cuando se adopte Jest para unit tests".

**Decoradores de error compuestos, no repetidos 85 veces** (`src/common/swagger/error-responses.ts`): `ApiAuthErrors()`, `ApiAdminErrors()`, `ApiValidationError()`, etc. — aplicados a nivel de CLASE cuando todas las rutas comparten el mismo requisito (Swagger fusiona decoradores de clase y método), a nivel de MÉTODO solo donde varía. Documenta los dos shapes de error reales (`HttpErrorResponseDto`, `InternalErrorResponseDto`) en vez de inventar uno ideal.

**El envelope de error y los 4 patrones de ownership NO se unifican** ([ADR-0004](../docs/adr/0004-error-envelope-and-ownership-inconsistencies-documented-not-unified.md)). Cambiar cualquiera de los dos rompe un contrato público que mobile ya consume, sin que exista un error objetivo que lo justifique (todos son JSON válido, todos traen `statusCode`). Se documentan con precisión y se fijan con contract tests — la próxima persona que los toque lo hará a propósito, no por accidente.

**Sí se corrigió el 413/500** — ese caso SÍ cruza la barra de "error objetivo": un 500 para una causa 100% del cliente no es una elección de diseño legítima en ningún shape.

**Matriz de autorización con cobertura calibrada por riesgo, no exhaustiva por fuerza bruta.** `LearningController` (guard por ruta) recibe cobertura de sus 10 rutas una por una — es el único lugar donde un desarrollador futuro puede olvidar un guard sin que nada lo detecte a nivel de clase. Los otros 5 controllers de gobernanza (guard por clase) reciben un spot-check de una ruta cada uno — suficiente para probar que el guard de clase está bien cableado, porque una regresión ahí rompería TODAS sus rutas a la vez, no una.

---

## 4. Implementación

**Nuevos:**
- `src/bootstrap/configure-app.ts`, `src/bootstrap/openapi-document.ts` — wiring extraído de `main.ts`.
- `src/common/http/query-parsers.ts` — `parseDays`/`parsePercent` deduplicados.
- `src/common/swagger/error-responses.ts` — DTOs de error + 7 decoradores compuestos.
- `scripts/smoke-http-contract.ts` — ~550 líneas, boot real desde `dist/` + Supertest + snapshot.
- `contracts/openapi.snapshot.json` + `contracts/README.md` — baseline del contrato, con instrucciones de actualización intencional.
- `docs/adr/0003-...md`, `docs/adr/0004-...md`.

**Modificados:**
- `nest-cli.json` — plugin de `@nestjs/swagger` (`classValidatorShim`, `introspectComments`).
- `main.ts` — ahora compone `configureApp()` + `buildOpenApiDocument()`; comportamiento idéntico, verificado por regresión completa.
- **23 controllers** — `@ApiTags`, `@ApiBearerAuth`, `@ApiOperation` (o comentario JSDoc + `introspectComments`), decoradores de error compuestos, `@ApiQuery` en los parámetros de query sin DTO.
- `src/common/filters/all-exceptions.filter.ts` — reconoce errores `http-errors` con `expose:true` antes de caer al 500 genérico (el fix del 413).
- `src/food/food.service.ts` — `addFavorite` verifica existencia antes de escribir (el fix del FK).
- `src/progress/dto/log-weight.dto.ts`, `src/users/dto/update-profile.dto.ts` — gaps de validación cerrados.
- `src/push/controllers/push.controller.ts` — guard normalizado a nivel de clase (estilo, cero cambio de comportamiento).
- `package.json` — `smoke:http-contract`, `verify:smokes`, `verify` ahora incluye `format:check` + build + las 22 suites.
- `.github/workflows/ci.yml` — paso "HTTP Contract" en el job de smokes.
- `docs/adr/README.md` — índice actualizado.

**Congelado y respetado:** cero cambios de lógica en Planner, Vision (motor), Learning (motor), Governance, Rollout, Meal Planner, Copilot, Nutrition Engine, Weekly Review, Recommendation Engine, CoachingContext. Las anotaciones Swagger en los controllers de Vision/Learning/gobernanza son puramente aditivas — ningún import, guard ni ruta cambió.

---

## 5. Riesgos encontrados

| Riesgo | Cómo se manejó |
|---|---|
| **413→500**: payload de body-parser no reconocido | Corregido en `AllExceptionsFilter` — clasificación general por `.expose===true`, no un parche solo-413 |
| **Food favorite → 500 por FK** | Corregido con el mismo patrón `getOwnedX` ya usado en Logs/Vision |
| **El snapshot podía describir un contrato "más pobre"** que el real si se generaba sin compilar | Resuelto arrancando desde `dist/` (ADR-0003); confirmado con test de determinismo (genera el doc 2 veces, compara byte a byte) |
| **La suite de contract tests podía auto-limitarse** (rate limiter propio) | `RateLimitGuard.resetForTests()` entre secciones que consumen el bucket AUTH (5/15min) — descubierto en la propia depuración: 3 fallos falsos por 429 en la primera corrida, diagnosticados y corregidos |
| **`smoke:http-contract` es la suite más lenta** (corre `npm run build` internamente) | Aceptado explícitamente (ADR-0003) — la alternativa (confiar en un build previo) es frágil entre jobs de CI que no comparten filesystem |
| **3 shapes de error + 4 patrones de ownership sin unificar** | Documentado en ADR-0004 y fijado con contract tests — no es deuda oculta, es deuda visible con una prueba que impide que empeore |
| **`verify` ahora corre 22 suites de smoke** (antes: ninguna) | Aceptado — completa la promesa de "un solo comando reproduce todo" que V5.4 dejó pendiente; el pre-commit hook NO se tocó (sigue rápido) |

---

## 6. Verificación

- `npm run lint` → 0 errores (21 warnings preexistentes, sin cambios).
- `npm run format:check` → limpio (51+10 archivos formateados con Prettier en total entre V5.4 y V5.5).
- `npm run typecheck` → limpio.
- `npm run check:boundaries` → 6/6 reglas verdes, baseline sin cambios (2 violaciones preexistentes, ninguna nueva).
- `npm run build` → limpio; confirmado que `dist/**/*.dto.js` lleva `_OPENAPI_METADATA_FACTORY` (el plugin corre de verdad, no solo está configurado).
- `smoke:engineering` (V5.4) → 🎉 TODO VERDE (2 chequeos actualizados tras mover el `DocumentBuilder` fuera de `main.ts` — el comportamiento no cambió, la ubicación del código sí).
- `smoke:http-contract` (V5.5, nuevo) → 🎉 TODO VERDE, ~95 aserciones.

---

## 7. Smokes

**Todas las 21 suites preexistentes + la nueva, verdes:**

`engineering` · `http-contract` (nuevo) · `1c` · `state` · `rec` · `ledger` · `review` · `contract` · `coach` · `planner` · `mealplan` · `vision` · `learning` · `rollout` · `governance` · `promotion` · `rollback` · `canary` · `copilot` · `dailycopilot` · `production` · `deploy`

`smoke:http-contract` cubre, con HTTP real contra el server Nest completo:
documentación OpenAPI (tags, security, ≥40 rutas, schemas de DTO enriquecidos), autenticación (401 sin token / con token inválido), autorización (10 rutas de `LearningController` una por una + 5 controllers de gobernanza por spot-check), validación (incluye pines de regresión de los 2 fixes de DTO), consistencia de errores (los 3 shapes reales, el fix de 413, el caso 409/401 de auth), headers (`X-RateLimit-*`, `content-type`), rate limiting (429 real con `Retry-After`), ownership/IDOR (scan de Vision, meal de Logs, favorito de Food — con los 3 patrones distintos correctamente pineados), determinismo (documento generado 2 veces, idéntico), y snapshot del contrato.

---

## 8. Estado del deploy

**Sin cambios de infraestructura.** No hay nada que desplegar de forma distinta — es tooling y documentación. `SWAGGER_ENABLED` sigue apagado en producción por defecto (sin cambios respecto a V5.4). El único cambio de comportamiento en tiempo de ejecución (el fix de 413) es un cambio de status code para una condición que antes SIEMPRE era un 500 — no había ningún cliente legítimo dependiendo de ese 500.

---

## 9. Por qué este slice fortalece permanentemente la plataforma

Antes de V5.5, la corrección de la capa HTTP dependía de que un humano recordara mirar el código de cada controller y su servicio. Ahora:

- **Un breaking change de contrato falla el pipeline, no se descubre en producción.** El snapshot de OpenAPI hace estructural lo que antes era "espero que nadie haya cambiado un DTO sin darse cuenta".
- **Un desarrollador que agregue una ruta a `LearningController` y olvide `@UseGuards(AdminGuard)` lo sabrá en segundos**, no cuando un usuario normal descubra que puede ver analíticas de la plataforma.
- **El 413/500 y el bug de FK en favoritos no se habrían encontrado sin probar la API real** — ambos eran invisibles a nivel de servicio (las pruebas anteriores nunca pasaban por `body-parser` ni por el guard HTTP).
- **`configureApp()`/`buildOpenApiDocument()` son ahora la única fuente de verdad** de cómo arranca la aplicación — cualquier cambio futuro a CORS, rate limiting o el prefijo global se prueba automáticamente, en vez de solo manualmente contra un `curl`.
- **La inconsistencia real que queda (3 shapes de error, 4 patrones de ownership) ya no es invisible.** Está en un ADR, con su costo y su condición de revisión explícitos — la siguiente persona que la toque lo hará informada, no por sorpresa.

---

## 10. Mejoras futuras recomendadas

1. **Adoptar Jest para unit tests** (V5.4's recomendación, aún pendiente) y, en ese momento, migrar `smoke-http-contract.ts` a `test/*.e2e-spec.ts` bajo el mismo runner (ADR-0003 marca explícitamente esta condición de revisión).
2. **Unificar el envelope de error** a un solo shape — requiere coordinación con mobile (breaking change de contrato), evaluar junto con un versionado de API.
3. **`@HttpCode(200)` en `respond`/`commit`/`complete`** de Recommendations — corrige el 201-para-un-no-op sin tocar el patrón 404-vs-200+mensaje más profundo.
4. **Decidir, con mobile, si Vision debería devolver 404 en vez de 403** para "scan existe pero no es tuyo" (reduce superficie de enumeración de ids).
5. **Cobertura de contract tests para el resto de los ~87 endpoints** que no recibieron un caso dedicado — la cobertura actual es deliberadamente calibrada por riesgo, no exhaustiva.
6. **Pagar la deuda del baseline de boundaries** (ADR-0002, aún pendiente desde V5.4).
7. **Branch protection exigiendo CI verde** (V5.4's recomendación, aún pendiente) — ahora con más razón: el pipeline informa pero no bloquea.
8. **Sentry/APM** (heredado de V5.2/V5.4, sigue abierto) — habría detectado el 500 del 413 en producción; con esta suite, ya no hace falta esperar a eso.

**WAIT** — sin commit, sin push, sin merge, sin deploy.
