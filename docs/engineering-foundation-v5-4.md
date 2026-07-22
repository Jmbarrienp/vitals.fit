# Engineering Foundation V5.4 — Professional Tooling & Quality Gates

**Fecha:** 2026-07-22 · **Rama:** `feature/nutrition-state-2a2` · **Estado:** implementado y verificado — **WAIT**

Cero funcionalidades nuevas. El objetivo: que el proceso de ingeniería dependa de **tooling**, no de disciplina humana.

---

## 1. Auditoría

| Área | Estado encontrado |
|---|---|
| ESLint | **No existía.** Ninguna configuración, ningún linter. |
| Prettier | **No existía.** Formato por convención manual. |
| Husky / pre-commit | **No existía.** Nada impedía commitear código roto. |
| GitHub Actions | **`.github/` no existía.** Las 20 suites dependían de que un humano las recordara. |
| Jest / tests unitarios | **No instalado.** Solo `@nestjs/testing` como dependencia huérfana. |
| Swagger / OpenAPI | **No instalado.** API sin documentación de contrato. |
| ADRs | **No existían.** ~20 docs narrativos por slice, sin registro de decisiones. |
| Dependency boundaries | **Sin gate.** Invariantes documentadas respetadas solo por disciplina. |
| Scripts npm | Buenos para smokes; **sin** lint, format, typecheck ni verify. |
| tsconfig | Correcto (`tsconfig.json` + `tsconfig.smoke.json` separados). |

---

## 2. Decisiones arquitectónicas

**Checker de boundaries propio, no dependency-cruiser** ([ADR-0002](adr/0002-custom-boundary-checker-with-ratchet.md)). Las reglas de este repo son específicas y documentadas (Food nunca importa Vision; Copilot consume contratos, nunca Prisma; `pipeline/` es puro). Una herramienta genérica exige expresarlas igual en su dialecto y **no puede cargar el porqué** de cada una. 150 líneas sin dependencias, con la justificación junto a la regla.

**Trinquete sobre deuda preexistente.** El checker encontró **2 violaciones reales** en su primera ejecución: `nutrition-state/types/{intelligence-snapshot,weekly-ledger}.ts` importan enums de Prisma dentro de contratos — algo que el estándar posterior del propio proyecto (`CoachingContext`) prohíbe explícitamente. V5.4 tiene **congelado** nutrition-state, así que: baseline explícito, CI verde, **ninguna violación nueva puede entrar**, deuda visible en código (el script la imprime siempre).

**ESLint deliberadamente conservador.** Un ruleset maximalista sobre un código de 5 fases produce miles de hallazgos y enseña al equipo a ignorar la herramienta. Se habilitan reglas que cazan **defectos reales**; el formato es trabajo de Prettier, y `eslint-config-prettier` (último en la cadena) garantiza que nunca se contradigan.

**Pre-commit rápido, CI exhaustivo.** El hook corre lint-staged + typecheck + boundaries (~20s). Las 21 suites son trabajo de CI: *un hook más lento que ~30s se saltea con `--no-verify`, que es peor que no tener hook.*

---

## 3. Tooling incorporado

| Herramienta | Versión | Rol |
|---|---|---|
| ESLint 9 (flat config) + typescript-eslint | ^9.39 / ^8.65 | Defectos reales, no estilo |
| Prettier + eslint-config-prettier | ^3.9 | Formato único, sin conflicto con lint |
| Husky + lint-staged | ^9.1 / ^17.1 | Gate pre-commit |
| GitHub Actions | — | 3 jobs: `static`, `mobile`, `smokes` |
| @nestjs/swagger | instalado | OpenAPI en `/api/docs` |
| check-boundaries (propio) | — | 6 invariantes arquitectónicas |

**Comando único para un desarrollador nuevo:**
```bash
cd app/backend && npm install --legacy-peer-deps && npx prisma generate && npm run verify
```
`verify` = lint → typecheck → boundaries → build.

---

## 4. Riesgos encontrados

| Riesgo | Cómo se manejó |
|---|---|
| **Conflicto de peers**: `typescript-eslint` moderno exige eslint@10; el repo fija ^9 | `--legacy-peer-deps` (convención ya establecida aquí por Expo/reanimated), documentado en CI |
| **5 errores de lint reales** | 3 declaraciones muertas verificadas como **no referenciadas** (borradas: cambio-cero-comportamiento), 1 aserción `!` insegura en mi propio smoke (corregida), 1 regla nueva `preserve-caught-error` desactivada por tocar módulo congelado |
| **Prettier reformateó 51 archivos** | Riesgo real de romper algo por accidente → mitigado ejecutando **las 21 suites completas** después: todas verdes |
| Swagger expone endpoints de operador | Apagado en producción salvo `SWAGGER_ENABLED=true` |
| El baseline puede volverse vertedero | El script lo imprime siempre; ADR-0002 fija el plan de pago |

---

## 5. Cambios realizados

**Nuevos:** `.github/workflows/ci.yml`, `.husky/pre-commit`, `.prettierrc.json`, `.prettierignore`, `app/backend/eslint.config.mjs`, `scripts/check-boundaries.ts`, `scripts/smoke-engineering.ts`, `docs/adr/{README,template,0001,0002}.md`.
**Modificados:** `package.json` (8 scripts + lint-staged + devDeps), `main.ts` (OpenAPI), 51 archivos reformateados por Prettier, 4 correcciones de lint.
**Congelado y respetado:** cero cambios de lógica funcional en CoachingContext, Vision, Copilot, Planner, Meal Planner, Runtime, Recommendation, Ledger, Review, Governance, Rollout.

---

## 6. Resultado de todos los smokes

**21/21 verdes** tras el reformateo — la prueba de que el formateo no cambió comportamiento:

`engineering 59` · deploy · production · dailycopilot · copilot · canary · rollback · promotion · governance · rollout · learning · vision · 1c · state · rec · ledger · review · contract · coach · planner · mealplan

**Backend build limpio · backend tsc limpio · mobile tsc limpio · lint 0 errores · format check limpio · boundaries verde.**

## 7. Estado del pipeline CI

`.github/workflows/ci.yml`, 3 jobs, corre en **push y pull_request** de toda rama:
- **static** — install → prisma generate → lint → format:check → typecheck → boundaries → build
- **mobile** — install → tsc
- **smokes** — las 21 suites, **`needs: static`** (un typo de lint falla en ~1 min sin gastar 20 Postgres)

Con `cancel-in-progress` para no gastar minutos en commits superseded. Aún **no ejecutado en GitHub** — se validará en el primer push.

## 8. Mejoras futuras recomendadas

1. **Jest + tests unitarios.** La pirámide sigue invertida: los smokes son integración. Los módulos `pipeline/` son puros y trivialmente testeables unitariamente.
2. **Supertest** para probar la capa HTTP real (guards, DTOs, códigos de estado) — hoy se prueban servicios, no endpoints.
3. **Cobertura** con umbral mínimo en CI.
4. **Pagar la deuda del baseline**: vocabularios propios en los 2 contratos, y vaciar el baseline.
5. **Sentry/APM** (heredado de V5.2, sigue abierto).
6. **Dependabot/Renovate** para actualizaciones de dependencias.
7. **Branch protection** exigiendo CI verde antes de merge — sin esto, el pipeline informa pero no bloquea.
8. **`@nestjs/swagger` decorators** en los DTOs para enriquecer el OpenAPI (hoy es introspección automática).

**WAIT** — sin commit, sin push, sin merge, sin deploy.
