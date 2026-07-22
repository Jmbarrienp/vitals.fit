# ADR-0002: Checker de límites propio, con trinquete sobre deuda existente

- **Estado:** Accepted
- **Fecha:** 2026-07-22
- **Decide:** Principal Software Architect

## Contexto

El proyecto sostiene invariantes arquitectónicas específicas y documentadas —
Food nunca importa Vision; el Copilot consume contratos, nunca Prisma; los
módulos `pipeline/` son puros; los subsistemas de gobernanza solo observan.
Hasta V5.4 se respetaban **por disciplina humana**, sin ningún gate automático.

Al introducir el checker aparecieron 2 violaciones preexistentes reales:
`nutrition-state/types/{intelligence-snapshot,weekly-ledger}.ts` importan enums
generados por Prisma dentro de contratos, algo que el estándar posterior del
propio proyecto (`CoachingContext`, 2C.0) prohíbe explícitamente.

## Decisión

1. Usamos un checker **propio** (`scripts/check-boundaries.ts`), no
   dependency-cruiser ni madge.
2. Las violaciones preexistentes se fijan en un **baseline explícito** en el
   propio script: no bloquean el build, pero ninguna violación **nueva** puede
   entrar (trinquete).

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| dependency-cruiser / madge | Las reglas hay que expresarlas igual en su dialecto, y la herramienta no puede cargar el *porqué* de cada una; añade dependencia para reglas que son 40 líneas |
| Regla estricta sin baseline | Habría dejado CI en rojo por deuda que V5.4 tiene explícitamente prohibido tocar (nutrition-state congelado) |
| Relajar la regla para que pase | Destruye el valor del checker: la regla correcta pasaría a no existir |
| Arreglar la deuda ahora | Fuera del alcance del slice; toca módulos congelados |

## Consecuencias

**Positivas:** la disciplina arquitectónica pasa de convención a gate; el
`porqué` de cada regla vive junto a la regla; la deuda queda visible en código
en vez de olvidada.

**Negativas / coste aceptado:** el checker es código propio a mantener (~150
líneas, sin dependencias). El baseline puede volverse un vertedero si alguien lo
usa para silenciar violaciones nuevas en vez de arreglarlas — por eso el script
imprime siempre su contenido.

**Cuándo revisar:** si las reglas superan ~15, o si se necesita análisis de
grafo real (ciclos transitivos), dependency-cruiser pasa a valer su coste.

**Deuda a pagar:** mover `BehaviorFlag` / `PlateauStatus` a vocabularios propios
en esos dos contratos, como ya hizo `CoachingContext`, y vaciar el baseline.
