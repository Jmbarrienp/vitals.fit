# Architecture Decision Records

Un ADR registra **una** decisión arquitectónica: qué se decidió, en qué contexto, y qué se aceptó a cambio.

## Por qué existe este directorio

La plataforma ya tiene documentación extensa (`docs/nutrition-*.md`), pero es **narrativa por slice**: cuenta qué se construyó. Un ADR responde una pregunta distinta y más duradera: *"¿por qué esto es así, y qué pasaría si lo cambio?"*

Cuando alguien dentro de un año se pregunte por qué el rate limiter es propio en vez de `@nestjs/throttler`, o por qué los operadores se definen por variable de entorno y no por una columna, la respuesta debe estar en un documento de una página que se encuentra en diez segundos — no enterrada en un doc de slice de 300 líneas.

**No se migran los documentos existentes.** Siguen siendo válidos como historia de implementación. Los ADR arrancan aquí, hacia adelante.

## Cuándo escribir uno

Escribe un ADR cuando la decisión:

- es **costosa de revertir** (esquema, contrato público, dependencia, frontera de módulo);
- **descarta alternativas razonables** que alguien volverá a proponer;
- establece un **precedente** que otros slices seguirán;
- introduce **deuda deliberada** con un plan de pago.

No escribas uno para: elecciones de estilo, cambios internos reversibles en una tarde, o cualquier cosa que el propio código explique.

## Cómo

1. Copia `template.md` a `NNNN-titulo-en-kebab-case.md` (numeración correlativa, nunca reutilizada).
2. Un ADR es **inmutable** una vez aceptado. Si cambias de opinión, escribe uno nuevo que lo supersede y marca el anterior como `Superseded by ADR-NNNN`.
3. Referéncialo desde el código cuando la decisión sea sorprendente: `// Ver ADR-0003`.

## Estados

| Estado | Significado |
|---|---|
| `Proposed` | En discusión, aún no vinculante |
| `Accepted` | Vinculante — el código debe respetarlo |
| `Superseded by ADR-NNNN` | Reemplazado; se conserva por trazabilidad |
| `Deprecated` | Ya no aplica, sin reemplazo |

## Índice

| ADR | Título | Estado |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Registrar decisiones arquitectónicas | Accepted |
| [0002](0002-custom-boundary-checker-with-ratchet.md) | Checker de límites propio con trinquete | Accepted |
| [0003](0003-contract-testing-boots-from-dist-not-jest.md) | Contract testing arranca desde `dist/`, no Jest e2e | Accepted |
| [0004](0004-error-envelope-and-ownership-inconsistencies-documented-not-unified.md) | Envelope de error y patrones de ownership: documentados, no unificados | Accepted |
