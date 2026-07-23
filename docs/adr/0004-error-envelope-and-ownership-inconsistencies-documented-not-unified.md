# ADR-0004: El envelope de error y los patrones de "no encontrado / no es tuyo" quedan documentados, no unificados

- **Estado:** Accepted
- **Fecha:** 2026-07-22
- **Decide:** Principal Software Architect

## Contexto

La auditoría HTTP de V5.5 encontró que ni el shape de los errores ni el
tratamiento de "el recurso no existe o no es tuyo" son uniformes en la API.
Ninguno de los dos es un bug de comportamiento (nada crashea, nada filtra
datos de otro usuario) — son inconsistencias de **forma**, ya en producción,
que un cliente (mobile) puede depender de exactamente como están hoy.

**Tres shapes de error, no dos:**

1. `HttpException` con mensaje explícito → `{statusCode, message, error}`
   (ej. `NotFoundException('Comida no encontrada.')`).
2. Excepción de Nest construida SIN mensaje (ej. el `UnauthorizedException()`
   que lanza `AuthGuard('jwt')` de Passport cuando no hay token) →
   `{statusCode, message}`, **sin** `error` — comportamiento nativo de
   `HttpException.createBody`, no algo que este proyecto controle.
3. Error no controlado, normalizado por `AllExceptionsFilter` →
   `{statusCode, message, timestamp, path}` — sin `error`, con dos campos que
   los otros shapes no tienen.

**Cuatro patrones de "no encontrado / no es tuyo", los cuatro reales, verificados por HTTP:**

| Módulo | No existe | Existe pero no es tuyo |
|---|---|---|
| `LogsService.getOwnedMeal` | 404 | 404 (nunca distingue) |
| `VisionScanService.getOwnedScan` | 404 | **403** (si distingue) |
| `RecommendationsService.{respond,commit,complete}` | 201/200 + `{message}` (nunca lanza) | 201/200 + `{message}` (igual) |
| `FoodService.addFavorite` (fix V5.5) | 404 (antes: 500 por FK) | N/A (no hay concepto de dueño ajeno) |

El caso de Recommendations es más engañoso de lo que parece a primera lectura:
como el servicio nunca lanza una excepción, Nest aplica SU propio default de
`@Post()` sin `@HttpCode()` — **201 Created** — incluso cuando no se creó
nada. Confirmado por HTTP, no asumido.

Separado pero relacionado: ningún endpoint de la API usa 422. Todo error de
validación (DTO o query param) usa 400, el default de Nest's `ValidationPipe`.

## Decisión

**No se unifica ninguno de los dos.** Se documentan con precisión (OpenAPI +
contract tests que fijan el comportamiento REAL, no el deseado) y se dejan
como "Riesgos encontrados" / trabajo futuro explícito.

Regla aplicada consistentemente en todo V5.5: un endpoint solo se corrige
cuando el defecto es **objetivo** — un 500 donde debía haber un 4xx (el bug
de payload >8MB, corregido: ver más abajo), o una validación que no valida lo
que su propio tipo promete (los arrays de `UpdateProfileDto`, corregidos). Un
status code "no ideal" pero funcionalmente correcto y ya público — como
201-en-vez-de-200, o 403-en-vez-de-404 — no cruza esa barra, porque mobile ya
consume la forma actual y cambiarla sin coordinación es exactamente el tipo
de breaking change silencioso que este slice existe para PREVENIR, no para
introducir.

**Sí se corrigió** (no es una excepción a esta regla — es la aplicación de
ella): `AllExceptionsFilter` ahora reconoce errores estilo `http-errors`
(`.status`/`.statusCode` + `.expose === true`) ANTES de caer al 500 genérico.
Antes de V5.5, un body JSON >8MB (rechazado por `body-parser`, que lanza vía
`http-errors`, no vía `HttpException`) se reportaba como 500 — un error del
cliente disfrazado de falla del servidor. Ahora se reporta como 413, con el
shape estándar de 4xx. Esto no cambia ningún contrato público existente: nadie
podía estar "dependiendo" de que un upload roto devolviera 500 en vez de 413,
porque 500 nunca fue una respuesta válida a propósito.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| Unificar los 3 shapes de error en uno solo | Cambia el body de CADA respuesta de error 401 sin mensaje custom en la API — un breaking change no coordinado con mobile, para un problema que es cosmético (todos los shapes son JSON válido, con `statusCode` y `message` siempre presentes) |
| Normalizar Vision/Logs/Recommendations al mismo patrón 404 | Vision y Recommendations son módulos congelados para este slice; forzar la unificación tocaría lógica de negocio fuera del alcance HTTP que V5.5 tiene permitido |
| Agregar 422 donde "debería" ir semánticamente | Ningún endpoint usa 422 hoy; introducirlo cambiaría el status code de escrituras existentes sin motivo objetivo — 400 es una elección de diseño válida, no un error |
| Dejar el bug de payload >8MB como estaba (documentar solo) | A diferencia de los demás casos, este SÍ cruza la barra de "error objetivo": un 500 para una causa 100% del cliente rompe el contrato implícito de qué significa 5xx, y nada podía depender legítimamente del 500 |

## Consecuencias

**Positivas:** el comportamino real (no el ideal) queda fijado por
`smoke:http-contract`, así que cualquier cambio futuro en cualquiera de estos
shapes será una decisión explícita y visible en un diff de tests, no una
regresión silenciosa. El bug real (413) está corregido con cambio de
comportamiento mínimo y bien acotado.

**Negativas / coste aceptado:** la API sigue teniendo 3 shapes de error y 4
patrones de "no encontrado" distintos — deuda de consistencia real, ahora
visible y con test que la protege de empeorar, pero no reducida.

**Cuándo revisar:** la próxima vez que se toque Recommendations o Vision por
una razón de negocio (no solo HTTP), es el momento de agregar
`@HttpCode(200)` a `respond`/`commit`/`complete` y decidir, coordinado con
mobile, si Vision debería devolver 404 en vez de 403 para "no es tuyo".
Unificar los 3 shapes de error requeriría versionar la API o coordinar un
cambio simultáneo en mobile — evaluar cuando exista una razón de negocio para
tocar `AllExceptionsFilter` de nuevo, no antes.
