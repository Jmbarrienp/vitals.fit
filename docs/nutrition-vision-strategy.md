# Nutrition Vision — Estrategia de largo plazo (2026→)

**Tipo:** slice de estrategia — SIN código. Gobierna los slices futuros de Vision.
**Estado de partida:** V0 (skeleton) + V1 (cámara) + V2 (primer proveedor real, Claude) construidos en `feature/nutrition-state-2a2`; nada desplegado; ninguna API key configurada; el eval real nunca se ejecutó.
**Documentos que gobierna:** todo slice V3+ debe citar la sección de este documento que lo autoriza o explicar por qué la contradice.

---

## 0. Resumen ejecutivo — las decisiones

1. **El moat no es el modelo.** Claude, GPT y Gemini son commodities que cualquier competidor puede llamar mañana. Los activos durables son cuatro, todos derivados de NUESTROS datos: el catálogo LATAM curado + repertorio del usuario (matching), el corpus `VisionFeedback` (propuesto vs confirmado por humano, in-distribution, gratis y continuo), los *priors de porción por usuario*, y los mapas de calibración de confianza por proveedor. La estrategia invierte ahí y trata a los proveedores como piezas reemplazables.
2. **Un proveedor default por modalidad, elegido por eval — nunca ensembles online.** Los retadores corren en shadow/offline, no en el hot path.
3. **Barcode y extracción OCR NO son trabajo de VLM.** Decodificación determinista on-device + resolución contra catálogo. Usar un modelo de visión ahí es más lento, más caro y menos preciso.
4. **La verdad de calidad es `VisionFeedback`, no un benchmark.** El usuario que confirma/corrige es el etiquetador. La promoción de proveedores se decide con métricas computadas sobre tablas que ya existen.
5. **Auto-accept se gradúa por (usuario, alimento), no globalmente.** Primero comidas repetidas del propio usuario con historial de aceptación; el auto-accept general exige precisión medida ≥95%. Siempre a través de LogsService, siempre con undo.
6. **Determinismo en la frontera:** la verdad de un scan se escribe una vez (detecciones persistidas); todo lo posterior a la persistencia es determinista y puro. Nunca se re-llama al proveedor por el mismo scan.
7. **Fable no entra jamás al request path de Vision.** El reconocimiento de un plato de pollo no es razonamiento de frontera. El default es *el modelo más barato que pase la barra del eval*, no el mejor.
8. **Presupuesto de complejidad:** un solo desarrollador, Render Free (sin cron/workers), tráfico casi nulo hoy. Toda pieza de esta estrategia debe degradar a "config + queries sobre tablas existentes", nunca a un servicio nuevo. Las políticas se DEFINEN ahora (para que el modelo de datos las soporte — ya lo hace); la maquinaria se construye cuando el tráfico la justifique.

---

## 1. Estrategia de proveedores

### 1.1 El trabajo correcto para la herramienta correcta

| Trabajo | Naturaleza | Herramienta correcta | Por qué |
|---|---|---|---|
| Reconocimiento de comida (foto) | Percepción semántica de mundo abierto | **VLM** (Claude/GPT/Gemini/local) — uno a la vez, por eval | Único trabajo que genuinamente necesita un modelo grande |
| Estimación de porción | Regresión débil para TODOS los modelos | **Plataforma**: hint del proveedor < prior del usuario < referencia visual (futuro) | Ningún VLM da gramos absolutos confiables; el historial del usuario sí |
| Barcode | Decodificación determinista (resuelta hace 20 años) | **On-device** (MLKit/expo) + resolver contra OpenFoodFacts/catálogo | Costo ~0, latencia ~0, precisión ~100%. Un VLM aquí es malpractice |
| OCR — extracción (etiquetas, menús, tickets) | Texto de píxeles | OCR especializado (on-device o vendor OCR barato) | 10–100× más barato que un VLM por página |
| OCR — interpretación (menú→conceptos, ticket→items) | Semántica sobre texto | **LLM de texto** (sin imagen: mucho más barato) | La imagen ya se pagó en la extracción |
| Restaurante | Foto + contexto (geo, menús) | VLM + datos de contexto de plataforma | El contexto es nuestro, el modelo es commodity |
| Video | Muestreo de frames → pipeline de foto | Política de muestreo = plataforma; frame = foto | No hay contrato nuevo; `VIDEO_FRAME` ya existe |

Consecuencia arquitectónica: **"proveedor" ≠ "LLM"**. Un decodificador de barcode y un resolver de OpenFoodFacts son proveedores detrás del mismo patrón (port + registry + validador). El día que Vision tenga 3 modalidades activas y solo una toque un LLM, la plataforma habrá demostrado que no es "una feature de IA".

### 1.2 Fixture vs real (respuesta explícita)

- **Fixture:** dev, CI, smokes, demos, y TODO deployment sin key. Es un ciudadano permanente de primera clase — nunca se borra, nunca se deja de registrar. Es también el modo "inerte" de producción.
- **Real:** requiere las tres llaves a la vez: key configurada + `VISION_PROVIDER` fijado + feature flag mobile encendido. Falta una → fixture o manual. Esta triple condición es deliberada: ningún accidente de config puede facturar dinero.

### 1.3 Múltiples proveedores sin caos (respuesta explícita)

- **Online:** exactamente UN default por modalidad (`VISION_PROVIDER`, y a futuro `VISION_PROVIDER_BARCODE`, etc. — config por modalidad, mismo registry). Cero votación, cero ensembles, cero fallback-a-otro-vendor en el hot path (un segundo vendor en cascada duplica el peor caso de latencia y esconde la señal de que el primero falla).
- **Offline:** los retadores viven en `compareProviders()` (golden set) y en shadow mode muestreado (§2.3). Ahí pueden correr los tres a la vez sin tocar al usuario.
- **La cascada de degradación online es siempre la misma y nunca cruza vendors:** proveedor activo → FALLBACK → manual prellenado. La fricción solo puede bajar.

### 1.4 Qué se abstrae ya y qué queda interno (respuesta explícita)

- **Abstraído (contrato):** capacidades (`multiFood/portionHints/barcode/ocr/video` — ya existe), fuentes (`ScanSource`), señales de confianza separadas (recognition/match/portion — ya existe), proveniencia (`providerId/model/providerVersion` — ya existe).
- **Interno al adapter, prohibido en el contrato:** prompts, schemas de structured output, model IDs, encodings de imagen, reintentos, rate limits, tokens, precios. Si un campo del contrato solo tiene sentido para un vendor, no entra.

---

## 2. Marco de evaluación

### 2.1 Tres niveles de verdad, por costo

1. **`VisionFeedback` (producción, gratis, continuo).** Cada confirmación ya registra propuesto-vs-confirmado por ítem (`ACCEPTED/SWAPPED/EDITED_PORTION/ADDED_MANUAL`, gramos propuestos vs confirmados). Es ground truth in-distribution etiquetado por el usuario real. **Es la fuente primaria de calidad del proveedor activo.** Limitación: solo mide al proveedor activo.
2. **Golden set (offline, una vez + mantenimiento).** 30–100 fotos de comidas LATAM etiquetadas a mano (platos reales del catálogo `curated_latam`: arepas, sancocho, arroz-pollo-tajada, empanadas — no el food-101 gringo). Corre por `compareProviders()` sin tocar producción. Responde "¿el retador sería mejor?" antes de exponer un usuario. Es el único gasto de eval que requiere trabajo manual; es también el más rentable.
3. **Shadow mode (producción, muestreado, caro).** El retador procesa async la misma imagen de un % de scans reales y se compara contra lo que el usuario confirmó. Requiere store durable de imágenes (o dual-call transitorio). **Cost-gated y diferido hasta que haya tráfico real** — con un usuario, el golden set es estadísticamente superior al shadow.

### 2.2 Métricas canónicas (definir ahora, versionar siempre)

Sobre `VisionFeedback` + `VisionScan` (todo ya en el schema — la maquinaria es una query):

- **acceptance-rate**: candidato top-1 aceptado sin cambios
- **swap-rate**: alimento equivocado (el error más caro: mina la confianza)
- **miss-rate**: `ADDED_MANUAL` (el modelo no lo vio)
- **portion-error**: mediana de |propuesto − confirmado| / confirmado
- **fallback-rate**: scans abandonados a manual
- **contract-invalid-rate**, p50/p95 latencia, costo/scan
- **Métrica norte: % de scans que le ganan al manual** — un scan "gana" si confirmarlo costó menos acciones que registrar a mano. Operacionaliza "la fricción solo puede bajar": si el scan promedio no le gana al manual, Vision no merece existir, con cualquier proveedor.

Toda métrica se reporta cortada por `providerId + model + providerVersion + CONFIDENCE_POLICY_VERSION` — la proveniencia ya se estampa por scan, así que los cortes son gratis.

### 2.3 Reglas de rigor

- Nunca comparar proveedores con casos distintos: mismo golden set, mismo port, mismo validador (ya garantizado por el harness).
- `probeDeterminism` apagado contra vendors de pago (ya implementado); el no-determinismo de un modelo real es un *hallazgo reportado*, no un fallo — el determinismo de la plataforma vive después de la persistencia.
- Eval offline por Batch API cuando el vendor la tenga (50% de descuento; la latencia no importa offline).
- Un eval sin costo anotado es inválido: cada reporte registra $/scan del run.

---

## 3. Política de promoción / democión

Máquina de estados **por (proveedor, modalidad)** — es config + datos, nunca un cambio de código:

```
REGISTERED → CANDIDATE → SHADOW → DEFAULT → DEPRECATED
```

- **REGISTERED:** adapter existe en el registry (1 línea en el módulo). Costo cero.
- **CANDIDATE:** key configurada + pasa el harness sobre el golden set (contract-valid 100%, latencia p95 dentro del timeout, costo dentro del presupuesto §7).
- **SHADOW:** corre muestreado contra tráfico real sin exposición a usuario. *Se salta a la escala actual* — con tráfico de un usuario, golden set + una semana de dogfooding personal es un sustituto legítimo.
- **DEFAULT:** gana al incumbente en la métrica norte (o acceptance-rate a igual costo, o igual calidad a menor costo) sobre n suficiente. El cambio es fijar `VISION_PROVIDER`.
- **DEPRECATED / democión inmediata si:** contract-invalid-rate se dispara, el vendor anuncia EOL del modelo, el costo/scan sube por encima del presupuesto, o acceptance-rate cae sostenidamente. La democión es también config: se vuelve al anterior o a fixture.

**Regla de migración de modelo** (los vendors retiran modelos — es churn garantizado): un cambio de `VISION_MODEL` es un cambio de proveedor a efectos de eval: re-correr golden set antes de fijarlo. El pin del modelo es explícito en config, jamás "latest".

**A escala actual, el camino concreto:** fixture es default hasta que exista una key → correr golden set con Claude (y GPT/Gemini si hay keys) → decisión documentada → `VISION_PROVIDER=claude` (o quien gane) → dogfooding → deploy. La formalidad completa (shadow, ventanas de n) se activa cuando haya usuarios reales, no antes.

---

## 4. Política de confianza y fallback

### 4.1 Principios

- La política vive en la plataforma (`confidence.ts` + `deriveUxMode`), versionada. Introducir **`CONFIDENCE_POLICY_VERSION`** cuando los umbrales (hoy 0.75/0.45) cambien por primera vez — sin él, las métricas históricas de `VisionFeedback` se vuelven ininterpretables tras un cambio de umbral.
- **La confianza auto-reportada de un modelo no está calibrada** y difiere entre vendors. La corrección es empírica: acceptance-rate medido por bucket de confianza por proveedor (query sobre `VisionFeedback`) → tabla de calibración por proveedor, aplicada plataforma-side antes del banding. Solo tras calibrar, un 0.8 de Claude y un 0.8 de Gemini significan lo mismo. Hasta tener datos, los umbrales actuales son el default honesto.

### 4.2 Cuándo confiar / confirmar / rechazar (respuesta explícita)

| Situación | Acción | Regla |
|---|---|---|
| Banda HIGH | CONFIRM (un tap) | Confirmación humana, mínima fricción |
| Banda MEDIUM | REVIEW (revisar con incertidumbre explícita) | Ya implementado |
| LOW / vacío / error / refusal del proveedor | FALLBACK a manual prellenado | Nunca un dead-end; nunca bloquea |
| Imagen no-comida / inválida | FALLBACK (el "rechazo" es solo no proponer) | Rechazar un scan jamás rechaza el registro |
| Auto-accept | Solo por graduación (§4.3) | Nunca por defecto de modelo |

### 4.3 Escalera de graduación del auto-accept

- **Etapa 0 (hoy):** confirmación obligatoria siempre. El usuario es el quality gate.
- **Etapa 1:** CONFIRM = un solo tap (UX, no política — la propuesta HIGH se confirma sin abrir edición).
- **Etapa 2 — comidas repetidas por usuario:** auto-accept solo cuando (usuario U, alimento F) tiene ≥k confirmaciones previas ACCEPTED en banda HIGH (k≈3), con undo instantáneo visible. El scope por-(usuario,alimento) es deliberado: es donde la precisión es demostrablemente máxima y donde vive el moat (nadie más tiene el historial de U).
- **Etapa 3 — general:** solo con precisión medida ≥95% sobre n significativo en `VisionFeedback`, por proveedor y banda.
- **Invariantes de todas las etapas:** el write es siempre `LogsService.logMeal`; el undo existe siempre y su uso se registra como señal negativa en el corpus; la porción con confianza baja nunca se auto-acepta aunque el reconocimiento sea HIGH (una etiqueta correcta con gramos inventados es peor que preguntar).

### 4.4 Porciones — la apuesta de largo plazo

La chain actual (`PROVIDER_ESTIMATE → SERVING_DEFAULT`) gana dos estrategias, ambas plataforma-side y provider-independientes:

1. **`USER_PRIOR`** (el método `USER` ya existe en el vocabulario): cuando U confirmó gramos para F ≥3 veces, la mediana de SUS gramos confirmados **supera al hint del proveedor** para F. Es la mejora de porción más barata y más precisa disponible, y es 100% nuestra.
2. **`REFERENCE_OBJECT` / `PLATE_RATIO`** (ya anticipados en el vocabulario): visión geométrica, mucho después, solo si el portion-error medido lo justifica.

Prioridad de la chain futura: `USER_PRIOR (k≥3) → PROVIDER_ESTIMATE → SERVING_DEFAULT`, método siempre registrado.

---

## 5. Roadmap multimodal

Ordenado por (fricción eliminada × factibilidad ÷ costo). Cada modalidad = nueva fuente + adapter; el pipeline, el lifecycle, la política de confianza y el write path NO cambian.

| # | Modalidad | Qué es | Por qué en este orden |
|---|---|---|---|
| 1 | **Barcode** | Decode on-device + resolver OpenFoodFacts/catálogo + porción por serving | Determinista, costo ~0, gran fricción eliminada en empacados, y prueba que la plataforma no es "una feature de LLM". `BARCODE` ya existe en `ScanSource` |
| 2 | **Store durable de imágenes** | `SupabaseImageStore` tras el port ya existente | Prerequisito de shadow eval y del corpus visual; entra cuando el eval lo necesite, no antes |
| 3 | **OCR de etiqueta nutricional** | Foto de la etiqueta → extracción OCR → parse con LLM de texto → alimento custom con macros | Alto valor LATAM (empacados ausentes de OpenFoodFacts); reutiliza el flujo custom-food existente |
| 4 | **Restaurante** | Interim: una foto con atributo `restaurant`; después: geo + menús | El contexto (geo/menú) es el trabajo real; el reconocimiento ya existe |
| 5 | **Tickets/receipts** | OCR + parse batch, sin latencia | Baja urgencia; naturalmente batch (50% descuento) |
| 6 | **Video** | Muestreo de frames → pipeline de foto | Explícitamente diferido años; sin consumidor; cero contrato nuevo necesario |

**Frontera plataforma/adapter (permanente):** la plataforma posee fuentes, lifecycle, confianza, matching, porciones, UX modes, feedback y el write path; los adapters poseen convertir un ref/payload en `RecognitionResult`. Una modalidad nueva jamás toca un módulo de nutrición.

---

## 6. Evolución del contrato

**El contrato mínimo que debe sobrevivir 5 años** (todo lo demás puede churnear):

```
entrada:  ref opaco + fuente tipada + hints
salida:   detecciones[ label, confianza, ¿geometría?, ¿hint de porción? ]
          + proveniencia (providerId/model/version) + latencia
```

Reglas permanentes:

1. **Aditivo-solo.** Campos nuevos son opcionales; remociones/renames = versión nueva de contrato con ventana de convivencia. Mobile refleja tipos, nunca los inventa.
2. **String + TS union, jamás enum de Postgres** (lección 2B.1, ya pagada en producción).
3. **`RecognitionResult` transporta percepción, nunca nutrición.** El día que un vendor devuelva calorías, el parser las tira. La verdad nutricional es catálogo + `LogsService`, para siempre — este es el guardarraíl del moat.
4. **`imageRef` es opaco para siempre.** Bytes nunca en el port, nunca en la DB.
5. **La proveniencia es sagrada:** cada scan lleva quién/qué/versión lo reconoció; sin ella no hay eval, ni calibración, ni promoción.
6. Payloads crudos del vendor no cruzan el adapter (hoy `raw` lleva solo usage; mantener).

---

## 7. Control de costos

- **Presupuesto por scan:** techo explícito (orden de magnitud: $0.01/scan con tier medio; ~$0.001–0.005 con tier bajo). Un proveedor que lo excede no puede ser DEFAULT, gane lo que gane en calidad.
- **Techo por usuario/día:** N scans/día (config); al excederlo, FALLBACK con copy amable. Protege contra bugs de cliente y abuso, no contra usuarios legítimos.
- **Tiering de modelo:** el default es el modelo MÁS BARATO que pasa la barra del golden set. Reconocer comidas comunes no es trabajo de frontera; lo esperable es que un tier Haiku/Sonnet baste — el eval decide, la config lo fija, el código no cambia.
- **La imagen es el costo dominante:** compresión en captura (ya `quality: 0.6`), tope 5MB (ya), y en un slice futuro resize a ~1024px de lado largo antes de subir (las señales de porción sobreviven).
- **Prompt caching:** system prompt byte-idéntico entre scans (ya implementado en el adapter).
- **Nunca segunda llamada por el mismo scan** (regla de determinismo §0.6) — de paso es la regla de costo más importante.
- **Shadow muestreado** (≤10%), jamás 100%; eval offline por Batch API.

---

## 8. Análisis de riesgos

| Riesgo | Severidad | Mitigación |
|---|---|---|
| Churn de vendor (retiro de modelos, cambios de precio) | Alta, garantizada | Adapter + config + regla de re-eval en migración de modelo (§3); el pin nunca es "latest" |
| Garbage confiado (el modelo se equivoca con confianza alta) | Alta | Confirmación humana por defecto; calibración empírica; auto-accept solo con precisión medida; swap-rate como métrica de primera clase |
| Blowout de costo | Media | Techos por scan y por usuario/día; tiering; sin ensembles; sin re-llamadas |
| Responsabilidad de porción (app de salud sugiriendo gramos errados) | Media | Método siempre registrado; lenguaje "estimado" en UI; porción LOW nunca auto-aceptada; `USER_PRIOR` reduce dependencia del modelo |
| Privacidad de imágenes (fotos de comida = dato personal, a veces con contexto de hogar) | Media | El store efímero ES una feature de privacidad; el store durable requiere política de retención explícita y encuadre de consentimiento antes de existir; el corpus de feedback no contiene imágenes (mantener) |
| Sobre-ingeniería a escala de 1 usuario | Alta, autoinfligida | §0.8: todo degrada a config+queries; shadow/promoción formal diferidos a tráfico real |
| Overfitting al shape actual de VLM (imagen→JSON) | Baja | El pipeline es puro y post-provider; el contrato tolera ausencia de bbox/porción; OCR/barcode ya prueban formas no-VLM |
| Render Free (sin cron) | Conocida | Toda maquinaria de eval/calibración es lazy-on-read o script manual, patrón ya establecido (ledger, sweeps) |

---

## 9. Próximos slices recomendados (en orden)

1. **Deploy gate pendiente** (no es de Vision, pero lo bloquea todo): las 6 migraciones + merge → main. V2 viaja inerte en ese tren.
2. **V3a — Golden set + eval real:** ~50 fotos LATAM etiquetadas; correr `compareProviders()` con las keys que existan; memo de decisión; fijar `VISION_PROVIDER`. *Primer slice que requiere gastar dinero (centavos).* 
3. **V3b — Barcode:** decode on-device + resolver (OpenFoodFacts → catálogo → custom). Primera modalidad no-VLM; valida §1.1.
4. **V3c — Proyección de métricas de Vision:** las métricas de §2.2 como query/endpoint read-only sobre `VisionFeedback` (patrón weekly-review: proyección pura, sin persistir). Habilita §3 y §4.1 con datos.
5. **V4a — `USER_PRIOR` en la chain de porciones:** la mejora de precisión más barata disponible; puro + una query.
6. **V4b — Store durable + shadow muestreado:** solo cuando haya tráfico que lo justifique.
7. **V4c — Graduación etapa 2** (repeat meals con undo): requiere V3c midiendo y V4a maduro.
8. **V5 — OCR de etiqueta → restaurante → receipts → video**, en ese orden, cada uno gated por demanda observada.

---

## 10. Fable vs Opus/Sonnet — recomendación fría

**Dentro del producto (request path de Vision): Fable jamás.**
Es el modelo equivocado en todos los ejes que importan aquí: precio máximo ($10/$50 vs $1/$5 de Haiku), thinking siempre activo (latencia en un flujo donde el usuario está parado frente a su plato), clasificadores de refusal (un modo de fallo extra), y requisito de retención de datos de 30 días. Reconocer "pollo a la plancha, arroz, brócoli" no es razonamiento de frontera — es percepción, y la gana el tier barato. Revisar solo si el eval demuestra que los tiers baratos fallan en comida LATAM *y* la brecha justifica 3–10× el costo. Improbable.

**Offline, dentro del producto:** tampoco es necesario. Adjudicar casos difíciles del golden set o sintetizar análisis de calibración lo hace Opus 4.8 sobradamente, por batch.

**Como modelo de ingeniería (construir Vitals Fit):** aquí sí hay un patrón correcto, y es el que ya estás usando —
- **Fable:** slices de estrategia/arquitectura (como este) y auditorías donde un error de diseño cuesta meses.
- **Opus:** slices de implementación con superficie de riesgo (adapters, migraciones, write paths).
- **Sonnet:** trabajo rutinario, regresiones, docs, refactors mecánicos.

La regla general es la misma dentro y fuera del producto: **el modelo más barato que pasa la barra del trabajo.** Para percibir comida, esa barra es baja. Para decidir la arquitectura de cinco años, es alta — por eso este documento se escribió con Fable y el scanner no lo usará nunca.
