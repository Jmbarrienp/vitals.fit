# ADR-0001: Registrar decisiones arquitectónicas

- **Estado:** Accepted
- **Fecha:** 2026-07-22
- **Decide:** Principal Software Architect

## Contexto

La plataforma acumula ~20 documentos de slice (`docs/nutrition-*.md`) que
narran qué se construyó y por qué, con mucho detalle. Pero responder "¿por qué
esta decisión concreta es así?" exige leer un documento largo completo y confiar
en que el razonamiento esté ahí. Varias decisiones vinculantes (dirección de
dependencias Vision→Food, LogsService como único productor de LoggedMeal,
proveedores intercambiables por puerto) viven solo en comentarios de código.

## Decisión

Adoptamos ADRs en `docs/adr/` para toda decisión arquitectónica futura, con el
formato de `template.md`. Un ADR es inmutable una vez aceptado; cambiar de
opinión significa escribir uno nuevo que supersede al anterior.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| Seguir solo con docs de slice | Narran implementación, no decisión; no son buscables por pregunta |
| Migrar toda la historia a ADRs | Semanas de trabajo retroactivo, alto riesgo de reescribir razonamiento con sesgo retrospectivo |
| Wiki externa | Se desincroniza del código; un ADR versionado con el repo no puede |

## Consecuencias

**Positivas:** las decisiones caras de revertir quedan localizables en segundos;
las alternativas descartadas dejan de reproponerse.

**Negativas / coste aceptado:** disciplina adicional por slice. Los docs
existentes quedan como historia, sin migrar — hay dos lugares donde buscar
contexto durante un tiempo.

**Cuándo revisar:** si el equipo crece lo suficiente para justificar una
herramienta dedicada de gestión de decisiones.
