# Nutrition Vision V4.1 — Live Provider Governance

**Fecha:** 2026-07-16 · **Rama:** `feature/nutrition-state-2a2` · **Estado:** implementado y verificado — **WAIT: sin commit, sin push, sin migraciones aplicadas**

---

## 1. El problema que existe para resolver

V3.5 ya podía "comparar proveedores". Pero la comparación estaba **confundida**: puntuaba a cada proveedor sobre **su propio tráfico** — distintos scans, distintos usuarios, distintos alimentos, distinta iluminación. Si el incumbente corrió un mes de comida empaquetada y el challenger uno de restaurantes, los números describen el tráfico, no los proveedores.

V4.1 añade la comparación **pareada**: ambos proveedores puntuados sobre **el mismo scan**, contra **la misma confirmación del usuario** como etiqueta. Misma entrada, misma verdad ⇒ la diferencia es atribuible al proveedor. Esa es la única evidencia sobre la que debería descansar una promoción.

**El usuario nunca siente la comparación. La plataforma sí siente la evidencia.**

---

## 2. Auditoría

| Búsqueda | Hallazgo |
|---|---|
| Lógica de selección de proveedor escondida | **Ninguna.** Las 4 llamadas `.active()` viven todas en `vision-scan.service.ts`. La selección ya estaba centralizada. |
| Duplicación de ground truth / calibración / trust / evaluación | **Ninguna** y ninguna introducida: V4.1 consume `GroundTruthReader`, `EvaluationEngine` y — crítico — pasa las detecciones del challenger por el **mismo `buildCandidates`** que producción. Puntuar al challenger con otro matcher mediría el matcher, no al proveedor. |
| **La restricción que dicta todo el diseño** | Las imágenes son **efímeras por diseño** (privacidad > replayabilidad — decisión de V2, reafirmada por el replay de V3.5, que por eso mismo no puede re-ejecutar proveedores). `createScan` libera los bytes en su `finally`. Por tanto **un challenger solo puede ver una foto real EN EL MOMENTO DEL SCAN**. No existe un "después". |
| Fallo encontrado en mi propio wiring | Mi primera versión llamaba a `shadow.capture()` sin envolver. Un `TypeError` en gobernanza **tumbaba el scan del usuario** — violando exactamente la regla de sombra que yo mismo escribí. Corregido en el servicio (defensa en profundidad), no solo en el test que lo destapó. |

---

## 3. Arquitectura

```
usuario ──► createScan ──► proveedor ACTIVO ──► propuesta ──► usuario
                              │                                  ▲
                              │  (la ruta del usuario termina aquí,
                              │   idéntica a V4.0 — nada la retrasa)
                              ▼
                  shadow.capture()   ← SOLO memoria (resolve + put propio).
                  Existe para tomar los bytes ANTES del `finally`; sin él
                  el challenger correría contra el discard.
                              │
                  shadow.run()  ← fire-and-forget: llama al challenger,
                  escribe evidencia append-only, libera su propio ref.
                  Envuelto tres veces: nunca puede lanzar a la petición.
                              ▼
                  VisionShadowRun (append-only, unique(scanId, providerId))
                              ▼
   ┌────────────────────────────────────────────────────────────┐
   │ GovernanceEngine (READ-ONLY, sin una sola escritura)        │
   │   paired-comparison  mismo scan · misma verdad · McNemar    │
   │   drift              el incumbente contra SÍ MISMO          │
   │   governance-decision PROMOTE/MAINTAIN/DEMOTE/HOLD/         │
   │                       REQUIRE_MORE_DATA — solo recomienda   │
   └────────────────────────────────────────────────────────────┘
                              ▼
        GET /vision/governance/{shadow,comparison,drift,recommendation}
```

### 3.1 Por qué McNemar y no el z de V3.5

Las muestras aquí son **pareadas**: cada scan lo vieron ambos proveedores. Los scans en que **ambos** acertaron (o ambos fallaron) no dicen nada sobre su *diferencia* — solo la diluyen. McNemar mira exactamente los pares **discordantes**, que es donde vive la evidencia. Usar un test no pareado sobre datos pareados subestimaría una diferencia real y desperdiciaría el propósito entero de la evaluación en sombra.

Los dos tests **coexisten sin duplicarse**: el z de V3.5 juzga tráfico de producción no pareado (lo único que tiene), este juzga evidencia pareada de sombra. Distintos datos, distinta pregunta, distinta herramienta — y la decisión declara cuál usó.

Con menos de 10 pares discordantes la aproximación normal no aplica: el motor devuelve `null` y **se niega a calcular** en vez de fingir un número (verificado en smoke).

### 3.2 Por qué el orden de la decisión es DEMOTE antes que PROMOTE

Un incumbente a la deriva es un **problema activo del usuario**; un challenger prometedor es una **oportunidad**. Una oportunidad nunca debe distraer de un problema. `HOLD` queda en medio: cuando ambas señales disparan a la vez, la respuesta honesta es "algo va mal aquí, párate a mirar", no un cambio confiado.

La barra de PROMOTE es alta y asimétrica a propósito, igual que la política de V3.5: cambiar de proveedor **resetea la curva de calibración del challenger**, lo que resetea la graduación de auto-accept de **cada usuario** (V3.6). Los usuarios pagan una promoción en confianza re-ganada; el challenger la paga en pruebas.

### 3.3 Generosidad deliberada con el challenger

Los índices de detección no se alinean entre proveedores, así que puntuar al challenger solo por su índice 0 mediría *alineación*, no reconocimiento. El motor le concede su mejor candidato para el alimento confirmado. Ser generoso con el challenger mantiene **conservadora** la recomendación de PROMOTE: la barra que supera es justa.

### 3.4 Lo que se declara NO disponible

El banding por calidad de imagen/iluminación **no existe**: la plataforma no almacena esa señal, e inferirla de la confianza del proveedor sería circular (la confianza es justo lo que intentamos juzgar). Se reporta como `unavailableDimensions` explícito, no como una dimensión fabricada.

---

## 4. Reglas de sombra — cómo se cumple cada una

| Regla | Cómo |
|---|---|
| Nunca afecta el resultado del usuario | Nada lee el resultado de sombra; `run()` es fire-and-forget y va envuelto en el servicio, en `capture()` y en `run()` mismo |
| Nunca ralentiza visiblemente | `capture()` es solo Map en memoria (sub-ms); la llamada al vendor no se espera |
| Nunca reemplaza al proveedor activo | Producción sigue usando `providers.active()`, una sola vez; no hay voto, no hay ensemble, no hay cadena de fallback entre vendors |
| Nunca muta tablas de verdad | El único escritor es `VisionShadowRun` (tabla nueva, append-only) |
| Nunca crea una segunda fuente de verdad | La etiqueta sigue siendo la confirmación del usuario; el challenger produce hipótesis, igual que el incumbente |
| Evidencia append-only | `unique(scanId, providerId)` + `update: {}` en el upsert: un reintento nunca infla ni reescribe |

**Muestreo determinista por `scanId`** (no aleatorio): el mismo scan siempre toma la misma decisión, así un operador puede razonar sobre qué scans tienen evidencia y un test puede afirmarlo.

---

## 5. Archivos

**Nuevos (backend):** `governance/types/governance-contract.ts`, `governance/shadow-evaluation.runner.ts`, `governance/pipeline/{paired-comparison,drift,governance-decision}.ts`, `governance/governance.engine.ts`, `governance/governance.controller.ts`, `scripts/smoke-governance.ts`, migración `20260716140000_nutrition_vision_v4_1_shadow_runs`.
**Modificados (backend):** `vision-scan.service.ts` (una llamada envuelta + una dependencia), `vision.module.ts`, `schema.prisma`, `.env.example`, `package.json`, `scripts/smoke-vision.ts`.
**Mobile:** `src/api/rollout.ts` (+4 rutas), `app/admin-rollout.tsx` (tarjeta de gobernanza).
**Cero cambios** a LogsService, `meal.logged`, el ciclo de vida del scan, los motores de porción/trust/promoción/rollout, planner, coach, ledger, review o meal planner.

---

## 6. Análisis de migración

**Una tabla nueva, cero modificaciones a tablas existentes.** `VisionShadowRun` es aditiva y append-only; su índice único hace la ingestión idempotente. Sin backfill (la evidencia no existía), sin riesgo de lock. Migraciones pendientes de deploy: las de V3.1/3.3/3.5/3.6 + esta.

---

## 7. Análisis de riesgo

| Riesgo | Mitigación |
|---|---|
| La sombra degrada la experiencia del usuario | Triple envoltura + fire-and-forget + timeout propio (20s) más corto que el de producción; verificado que un fallo de sombra deja el scan intacto |
| Coste: cada scan muestreado es una llamada extra al vendor | Apagado por defecto (requiere **ambos** switches); muestreo fraccional; el coste comparado se reporta en `operations` |
| Memoria (Render Free) al duplicar bytes | Una entrada extra solo en scans muestreados, durante una llamada; el store está acotado por TTL y tope de 32 entradas con evicción |
| Promoción por ruido | McNemar + IC 95% + mínimo de 30 scans pareados + generalización entre modalidades y usuarios + techos de latencia/coste/disponibilidad |
| El challenger gana en un solo segmento | `generalizes()` exige ≥75% de buckets sin regresión; si no, HOLD |
| Evidencia reescrita | Append-only por constraint; el upsert nunca actualiza |
| Payloads de vendor expuestos a operadores | La evidencia se guarda ya normalizada (`Detection[]` de plataforma); no hay payload crudo que filtrar |

---

## 8. Verificación

| Check | Resultado |
|---|---|
| `smoke:governance` (nuevo) | ✅ **70/70** |
| Comparación pareada end-to-end | ✅ incumbente 4/16 vs challenger 12/16 **sobre los mismos scans**; McNemar (12−4)/√16 = 2.0 |
| Guard estadístico | ✅ con 7 pares discordantes devuelve `null` — se niega a calcular bajo el mínimo |
| Los 5 veredictos de gobernanza | ✅ PROMOTE / MAINTAIN / DEMOTE / HOLD / REQUIRE_MORE_DATA, cada uno con su evidencia |
| Techos operativos | ✅ 2× latencia, 2× coste, o disponibilidad <95% ⇒ HOLD aunque sea más preciso |
| Sombra apagada por defecto | ✅ requiere challenger **y** muestreo >0; nunca se sombrea a sí mismo; challenger no registrado falla en silencio |
| Read-only / append-only / idempotencia | ✅ pasada completa = 0 filas cambiadas; evidencia byte-idéntica; reintento no duplica |
| Determinismo + independencia de proveedor | ✅ comparación byte-idéntica; muestreo reproducible |
| Regresión | ✅ `smoke:vision` 310, `smoke:learning` 117, `smoke:rollout` 58, los 9 suites de Fase 1–2, build y tsc ×2 |

---

## 9. Definition of done

- [x] La plataforma puede comparar proveedores de forma segura (sombra, read-only, sobre la misma entrada)
- [x] La plataforma puede **explicar** por qué uno es mejor (McNemar, IC, breakdowns por modalidad/alimento/cocina/banda/usuario)
- [x] La promoción es evidence-driven y gobernada por humanos (el motor no tiene acceso de escritura a configuración)
- [x] El comportamiento de producción no cambia (un proveedor por modalidad, sin ensembles, sin voting, sin cadena de fallback)
- [x] Sin verdad duplicada (auditado; el challenger se puntúa con el pipeline de producción)
- [x] Smokes verdes, TypeScript limpio, build limpio

**Estado: WAIT.** Nada commiteado, nada pusheado, ninguna migración aplicada.
