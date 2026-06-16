# Vitals Fit — Fase 1: MVP Nutrición Competitiva (Implementación)

> Diseño listo para codificar. Basado en lectura directa del backend real.
> Stack: NestJS 11 + Prisma 7.8 + PostgreSQL. Sin cambios de stack, sin microservicios, sin IA.

---

## 1. Executive Summary

La Fase 1 convierte el registro de nutrición de **prototipo** a **base de producto**. Hay un único problema arquitectónico que contamina todo: **el backend confía en macros calculados por el cliente y no persiste ítems**. Eso hace imposible editar, auditar o construir inteligencia encima. Todo lo demás (porciones, edición, agua/fibra) depende de arreglar eso primero.

El alcance es acotado y de complejidad media. No requiere reescrituras grandes: el modelo de datos ya tiene los huesos correctos (`LoggedMealItem`, `FoodItem.barcode`, `Goal.fiberTargetG/waterMl`), simplemente **están muertos o desconectados**. Esta fase los conecta y endurece.

**Cambio mental clave:** el contrato `POST /logs/meal` pasa de "el cliente me dice cuántas calorías comió" a "el cliente me dice **qué ítems** comió y **cuánto**, y yo (servidor) calculo las calorías". Esto es no negociable: es la diferencia entre datos confiables y basura manipulable.

---

## 2. Critical Problems Found (auditoría fría)

| # | Problema | Evidencia (archivo:línea) | Severidad |
|---|---|---|---|
| P1 | **`LoggedMealItem` nunca se escribe.** El logging solo guarda totales agregados en `LoggedMeal`. El modelo de ítems existe en el schema pero está muerto. | [logs.service.ts:30-40](app/backend/src/logs/logs.service.ts#L30) | 🔴 Bloqueante |
| P2 | **Macros se calculan en el cliente** y el backend los acepta a ciegas. `macrosFromPortion` corre en el móvil; el DTO recibe `totalCalories` ya cocinado. Manipulable e inconsistente. | [food.ts:26](app/mobile/src/api/food.ts#L26), [log-meal.dto.ts:19](app/backend/src/logs/dto/log-meal.dto.ts#L19) | 🔴 Bloqueante |
| P3 | **No existe editar ni borrar.** El controller solo expone `POST meal`, `GET today`, `GET /`. Un error de registro es permanente. | [logs.controller.ts](app/backend/src/logs/logs.controller.ts) | 🔴 Bloqueante |
| P4 | **Base de alimentos de ~50 ítems** hardcodeados en el seed. No es una base, es un demo. | [seed.ts:10](app/backend/prisma/seed.ts#L10) | 🔴 Crítico |
| P5 | **Búsqueda con `contains` (substring).** Sin fuzzy, sin acentos, sin ranking real. "pechga" no encuentra "Pechuga". Ordena solo por `isCommon` y alfabético. | [local.adapter.ts:9-22](app/backend/src/food/adapters/local.adapter.ts#L9) | 🟠 Alto |
| P6 | **Porciones solo en gramos** (50/100/150/200). El usuario no sabe cuántos gramos pesa "una arepa". No hay modelo de unidades caseras. | [log.tsx:22](app/mobile/app/(tabs)/log.tsx#L22) | 🟠 Alto |
| P7 | **Barcode declarado pero inexistente.** `FoodItem.barcode` + índice existen; no hay endpoint ni adapter que los use. | [schema.prisma:193,204](app/backend/prisma/schema.prisma#L193) | 🟠 Alto |
| P8 | **Agua y fibra: metas sin tracking.** `Goal.fiberTargetG` y `Goal.waterMl` existen como objetivos, pero `DailyLog` no tiene columnas para registrarlos. | [schema.prisma:277-296](app/backend/prisma/schema.prisma#L277) | 🟠 Alto |
| P9 | **Modo "manual" es efímero.** Lo que el usuario escribe a mano no se guarda como alimento reutilizable. Lo re-escribe cada vez. | [log.tsx:376](app/mobile/app/(tabs)/log.tsx#L376) | 🟡 Medio |
| P10 | **`adapter.normalize` pierde `barcode`, `sodium`, `region`, `aliases`.** El `NormalizedFood` los descarta, así que el cliente nunca puede mostrarlos. | [local.adapter.ts:38](app/backend/src/food/adapters/local.adapter.ts#L38) | 🟡 Medio |
| P11 | **`LoggedMealItem.foodItemId` es obligatorio y `onDelete` por defecto (Restrict).** Si algún día se borra un `FoodItem`, rompe. Y no permite ítems manuales sin alimento. | [schema.prisma:313-324](app/backend/prisma/schema.prisma#L313) | 🟡 Medio |

**Deuda técnica sin suavizar:** el módulo actual está diseñado como si fuera una calculadora de un solo uso, no un diario editable. La decisión de calcular macros en el cliente (P2) es el pecado original: invierte la responsabilidad y deja al servidor como un buzón tonto. Hasta revertir eso, no hay producto serio posible.

---

## 3. Phase 1 Target Architecture

```
                       POST /logs/meal { items[] }
                                  │
                                  ▼
                       ┌──────────────────────┐
                       │   LogsService        │
                       │   logMeal()          │
                       └──────────┬───────────┘
                                  │ por cada item:
              ┌───────────────────┼────────────────────┐
              ▼                   ▼                     ▼
     foodItemId + grams   foodItemId + servingSizeId  customName + macros
              │                   │                     │
              ▼                   ▼                     │
       FoodItem.per100g    ServingSize.grams           │
              │                   │                     │
              └─────────► gramos ─┴──► macros = g/100 × per100g
                                                        │
                                  ▼  (transacción Prisma)
                       ┌──────────────────────┐
                       │ LoggedMeal           │  totales (cache denormalizado)
                       │  └─ LoggedMealItem[] │  ítem real con grams + snapshot
                       └──────────┬───────────┘
                                  ▼
                       recalcDailyLog(dailyLogId)
                       (cal, P, C, G, fibra, recalcula totales)
                                  ▼
                       emit('meal.logged')  ← sin cambios, ya existe
```

**Principios:**
- **Servidor calcula, cliente declara.** El cliente nunca manda `totalCalories`; manda ítems y cantidades.
- **Snapshot histórico.** Cada `LoggedMealItem` guarda `nameSnapshot` y macros congelados al momento del registro. Si el `FoodItem` cambia después, el historial no se altera.
- **Una función de recálculo.** `recalcDailyLog()` es la única fuente de verdad de los totales diarios; la llaman create/edit/delete por igual. Nunca se recalcula a mano en tres sitios.
- **Adapter local-first.** Búsqueda y barcode pegan a la DB local primero; OFF solo como fallback de barcode no encontrado.

---

## 4. Prisma Schema Changes

### 4.1 `FoodItem` — extender
```prisma
model FoodItem {
  id              String  @id @default(uuid())
  name            String
  nameLower       String
  nameNormalized  String  @default("")  // NUEVO: lower + sin acentos, para trgm. Se llena en app.
  nameAliases     String[]
  caloriesPer100g Float
  proteinPer100g  Float
  carbsPer100g    Float
  fatPer100g      Float
  fiberPer100g    Float   @default(0)
  sugarPer100g    Float?                 // NUEVO (opcional, barato)
  sodiumMgPer100g Float?
  source          String
  barcode         String?
  brand           String?                // NUEVO (marcas comerciales)
  region          String?
  isVerified      Boolean @default(false)
  isCommon        Boolean @default(false)
  createdByUserId String?                // NUEVO (alimento creado por usuario; null = global)
  usageCount      Int     @default(0)    // NUEVO (popularidad global, para ranking)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  servingSizes     ServingSize[]          // NUEVO
  favoritedBy      UserFavoriteFood[]     // NUEVO
  plannedMealItems PlannedMealItem[]
  loggedMealItems  LoggedMealItem[]

  @@index([nameLower])
  @@index([barcode])
  @@index([isCommon])
  @@index([createdByUserId])              // NUEVO
  // GIN trgm sobre nameNormalized → vía migración SQL (Prisma no lo expresa)
}
```

### 4.2 `ServingSize` — nuevo (unidades caseras)
```prisma
model ServingSize {
  id         String   @id @default(uuid())
  foodItemId String
  label      String   // "1 huevo", "1 taza", "1 rebanada", "1 arepa", "1 cucharada"
  grams      Float    // 1 huevo = 50g
  isDefault  Boolean  @default(false)

  foodItem FoodItem @relation(fields: [foodItemId], references: [id], onDelete: Cascade)

  @@index([foodItemId])
}
```

### 4.3 `LoggedMealItem` — revivir y endurecer
```prisma
model LoggedMealItem {
  id            String  @id @default(uuid())
  loggedMealId  String
  foodItemId    String?                  // CAMBIO: ahora opcional (ítem manual one-off)
  servingSizeId String?                  // NUEVO: si se registró por unidad casera
  nameSnapshot  String                   // NUEVO: nombre congelado al registrar
  quantity      Float   @default(1)      // NUEVO: 2 (huevos) o 150 (g)
  unit          String  @default("g")    // NUEVO: "g" | "ml" | "serving"
  amountG       Float                     // gramos efectivos (resueltos en backend)
  calories      Int
  proteinG      Float
  carbsG        Float
  fatG          Float
  fiberG        Float   @default(0)       // NUEVO

  loggedMeal LoggedMeal   @relation(fields: [loggedMealId], references: [id], onDelete: Cascade)
  foodItem   FoodItem?    @relation(fields: [foodItemId], references: [id], onDelete: SetNull) // CAMBIO

  @@index([loggedMealId])
  @@index([foodItemId])                   // NUEVO: para query de "frecuentes"
}
```

### 4.4 `LoggedMeal` — añadir fibra al cache
```prisma
model LoggedMeal {
  // ... sin cambios ...
  totalFiberG   Float    @default(0)  // NUEVO
}
```

### 4.5 `DailyLog` — tracking real de agua y fibra
```prisma
model DailyLog {
  // ... campos existentes ...
  fiberG  Float @default(0)   // NUEVO
  waterMl Int   @default(0)   // NUEVO
  // sugarG / sodiumMg: opcionales, añadir solo si la UI los muestra
}
```

### 4.6 `UserFavoriteFood` — nuevo
```prisma
model UserFavoriteFood {
  id         String   @id @default(uuid())
  userId     String
  foodItemId String
  createdAt  DateTime @default(now())

  user     User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  foodItem FoodItem @relation(fields: [foodItemId], references: [id], onDelete: Cascade)

  @@unique([userId, foodItemId])
  @@index([userId])
}
```
(Añadir `favoriteFoods UserFavoriteFood[]` a `User`.)

> **Frecuentes y recientes NO necesitan tabla.** Se derivan por query agregada sobre `LoggedMealItem` join `LoggedMeal` join `DailyLog` filtrando por `userId`. Crear tablas para eso sería sobreingeniería.

### 4.7 Migración SQL manual (extensiones + índice trgm)
```sql
-- migración: enable_fuzzy_search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- índice fuzzy sobre el campo ya normalizado en la app (evita problema de inmutabilidad de unaccent)
CREATE INDEX food_item_name_normalized_trgm
  ON "FoodItem" USING gin (("nameNormalized") gin_trgm_ops);
```

---

## 5. API Changes

### 5.1 Modificar — `POST /api/logs/meal` (nuevo contrato)
**Request:**
```jsonc
{
  "mealType": "LUNCH",            // opcional → se infiere por hora si falta
  "loggedAt": "2026-06-09T13:10:00Z", // opcional
  "name": "Almuerzo",            // opcional, se autogenera si falta
  "items": [
    { "foodItemId": "uuid", "unit": "g", "quantity": 150 },
    { "foodItemId": "uuid", "servingSizeId": "uuid", "quantity": 2 },  // 2 × "1 huevo"
    { "customName": "Postre casa", "quantity": 1, "calories": 200, "proteinG": 3, "carbsG": 30, "fatG": 8, "fiberG": 1 }
  ]
}
```
**Response (200):** el `DailyLog` actualizado con `meals` (incluye items) y `remaining` vs `goal`. Misma forma que `GET today` para que el cliente refresque sin segunda llamada.

**Regla:** rechazar (400) si `items` vacío, o si un ítem no tiene ni `foodItemId` ni `customName+calories`.

### 5.2 Nuevos — edición
```
PATCH  /api/logs/meal/:mealId          actualiza mealType/name y/o reemplaza items[]
DELETE /api/logs/meal/:mealId          borra la comida completa
DELETE /api/logs/meal/:mealId/item/:itemId   borra un ítem
```
Todos: verifican ownership (la comida pertenece a un `DailyLog` del `userId`), aplican el cambio en transacción, llaman `recalcDailyLog()`, devuelven el `DailyLog` actualizado. Si tras borrar items la comida queda vacía → borrar la comida.

### 5.3 Nuevos — registro por fecha
```
GET /api/logs/day/:date    // YYYY-MM-DD; igual que /today pero parametrizado
```

### 5.4 Nuevos — agua
```
POST /api/logs/water   { "deltaMl": 250 }   // suma (o resta si negativo, clamp a 0) al día de hoy
```
Devuelve `{ date, waterMl, targetMl }`.

### 5.5 Modificar — `GET /api/food/search`
- Mismo endpoint, motor nuevo (sección 7).
- `NormalizedFood` ahora incluye `servingSizes`, `barcode`, `brand`, `isFavorite`, `isVerified`.

### 5.6 Nuevos — food
```
GET    /api/food/recent                 últimos N alimentos distintos del usuario
GET    /api/food/frequent               top alimentos por frecuencia (agregado)
GET    /api/food/favorites              favoritos del usuario
POST   /api/food/favorites/:foodItemId  marcar favorito
DELETE /api/food/favorites/:foodItemId  quitar favorito
POST   /api/food                        crear alimento de usuario (custom)
GET    /api/food/barcode/:code          lookup local → OFF fallback → 404
```
**`POST /food` payload:** `{ name, caloriesPer100g, proteinPer100g, carbsPer100g, fatPer100g, fiberPer100g?, servingSizes?: [{label, grams, isDefault}] }`. Crea `FoodItem` con `source="custom"`, `createdByUserId=userId`, `isVerified=false`.

---

## 6. Business Logic Rules

### 6.1 Resolución de un ítem → gramos → macros (backend)
```
resolveItem(item):
  if item.customName:                       # manual one-off
     grams = null
     return { nameSnapshot: customName, amountG: 0,
              calories, proteinG, carbsG, fatG, fiberG }   # tal cual los mandó

  food = FoodItem.findUnique(item.foodItemId)
  if !food: throw BadRequest("Alimento no encontrado")

  if item.servingSizeId:
     ss = ServingSize where id = servingSizeId AND foodItemId = food.id
     if !ss: throw BadRequest
     grams = item.quantity * ss.grams        # 2 × 50g = 100g
  else if item.unit == "g" or "ml":
     grams = item.quantity
  else:
     grams = item.quantity                   # default g

  ratio = grams / 100
  return {
    foodItemId: food.id, servingSizeId, nameSnapshot: food.name,
    quantity, unit, amountG: grams,
    calories: round(food.caloriesPer100g * ratio),
    proteinG: round1(food.proteinPer100g * ratio),
    carbsG:   round1(food.carbsPer100g   * ratio),
    fatG:     round1(food.fatPer100g     * ratio),
    fiberG:   round1(food.fiberPer100g   * ratio),
  }
```

### 6.2 `recalcDailyLog(dailyLogId)` — única fuente de verdad
```
meals = LoggedMeal.findMany({ dailyLogId, include: items })
sum cal/P/C/G/fiber sobre todos los items de todas las meals
DailyLog.update({ caloriesLogged, proteinG, carbsG, fatG, fiberG })
# water NO se toca aquí (lo maneja POST /water)
# LoggedMeal.total* se recalcula igual desde sus items al crear/editar
```

### 6.3 Inferencia de `mealType` por hora (si falta)
```
hour < 11        → BREAKFAST
11 ≤ hour < 16   → LUNCH
16 ≤ hour < 21   → DINNER
else             → SNACK
```
(Mejora futura: usar `UserHabits.typicalMealTimes`. Para Fase 1, la tabla de horas basta.)

### 6.4 Favoritos / recientes / frecuentes
- **Favoritos:** explícito. Tabla `UserFavoriteFood`. El usuario marca con ⭐.
- **Recientes:** `LoggedMealItem` del usuario, `DISTINCT foodItemId`, ordenado por `MAX(loggedMeal.loggedAt)` desc, limit 15. Excluye `customName` sin foodItemId.
- **Frecuentes:** `LoggedMealItem` del usuario, `GROUP BY foodItemId`, `COUNT(*)` desc, limit 15, ventana últimos 60 días.

### 6.5 Agua
- `DailyLog.waterMl` acumulado. `POST /water { deltaMl }` → `waterMl = max(0, waterMl + deltaMl)`. Botones rápidos en UI (+250, +500). Sin tabla de historial en Fase 1.

### 6.6 Fibra
- Es un macro más: se suma desde los items en `recalcDailyLog`. La meta ya existe en `Goal.fiberTargetG`. Se muestra como barra junto a P/C/G.

---

## 7. Search and Ranking Strategy

### 7.1 Normalización (resuelve acentos y typos)
- Al **escribir** cualquier `FoodItem`, llenar `nameNormalized = unaccent(lower(name))` en código de app (función `normalize()` reutilizable). Incluir aliases concatenados.
- Al **buscar**, normalizar el query igual.

### 7.2 Motor: pg_trgm (raw query)
Reemplazar el `findMany({ contains })` por una raw query con similitud trigram:
```sql
SELECT *, similarity("nameNormalized", $1) AS sim
FROM "FoodItem"
WHERE
  "nameNormalized" ILIKE '%' || $1 || '%'        -- coincidencia parcial directa
  OR "nameNormalized" % $1                          -- fuzzy (umbral pg_trgm)
  OR EXISTS (SELECT 1 FROM unnest("nameAliases") a WHERE a ILIKE '%' || $1 || '%')
ORDER BY
  ("nameNormalized" = $1) DESC,                     -- match exacto primero
  ("nameNormalized" ILIKE $1 || '%') DESC,          -- prefijo
  "isCommon" DESC,
  "usageCount" DESC,
  sim DESC
LIMIT $2;
```
- `%` usa el GIN trgm index → rápido incluso con 100k+ filas.
- `set_limit(0.2)` para tolerancia de typo (ajustable).

### 7.3 Ranking personalizado
Sobre el resultado base, **re-rankear en servicio** elevando: favoritos del usuario > frecuentes del usuario > resto. (Join ligero o set en memoria con los IDs de favoritos/frecuentes del usuario, que ya son ≤30.)

### 7.4 Manejo de errores tipográficos
- pg_trgm cubre "pechga"→"pechuga" (similarity alta).
- Si 0 resultados → respuesta vacía + el cliente ofrece "crear alimento" / "manual". No es error 500.

---

## 8. UX Implications for Mobile

| Cambio | Por qué |
|---|---|
| **Eliminar `macrosFromPortion` del cliente como fuente de verdad.** El cliente lo puede usar para *preview* optimista, pero el `POST` manda items, no totales. | Quita P2. El número que cuenta lo da el server. |
| **Selector de porción con unidades caseras.** Mostrar `servingSizes` del alimento como chips ("1 huevo", "1 taza") + opción gramos. Default = `isDefault`. | Quita P6. El usuario elige "2 huevos", no "100g". |
| **Lista recientes/favoritos/frecuentes en la pantalla de registro**, antes del search. ⭐ para favoritear. | El 80% de registros son repetición. 1 tap. |
| **Tap en comida del dashboard → editar/borrar; swipe-to-delete.** | Quita P3. Hoy un error es permanente. |
| **Botón "barras" → cámara → `GET /food/barcode/:code`.** Si 404 → form de crear alimento prellenado. | Quita P7. |
| **Card de agua con botones +250/+500ml** y barra vs `Goal.waterMl`. Barra de fibra junto a macros. | Quita P8. |
| **Inferir `mealType` por hora**, override 1 tap. Quitar el paso obligatorio. | Menos fricción. |
| **Modo manual → opción "guardar como alimento"** (`POST /food`). | Quita P9. |

> El rediseño visual completo de `log.tsx` (recientes-first) está en el doc de visión general. Para Fase 1 basta con: items reales, porciones caseras, edición, agua/fibra. El móvil debe migrar el `POST` al nuevo contrato **en el mismo PR** que el backend, o se rompe.

---

## 9. Implementation Order

Orden estricto por dependencias. Cada paso es deployable.

1. **Schema + migraciones** (4.1–4.7). Genera cliente Prisma. Incluye migración SQL de extensiones/índice. *Sin esto nada compila.*
2. **`normalize()` util + backfill** de `nameNormalized` en alimentos existentes (script one-off).
3. **`POST /logs/meal` nuevo contrato** + `resolveItem()` + `recalcDailyLog()` + persistencia de `LoggedMealItem`. *El cimiento (P1, P2).*
4. **Editar/borrar** (`PATCH/DELETE meal`, `DELETE item`) reusando `recalcDailyLog()`. *(P3)*
5. **Agua + fibra** (`POST /water`, fibra en recalc, `GET day/:date`). *(P8)*
6. **Búsqueda pg_trgm** + ranking + `NormalizedFood` enriquecido. *(P5, P10)*
7. **ServingSize**: seed de porciones para los alimentos comunes + exponerlas en search. *(P6)*
8. **Favoritos/recientes/frecuentes** endpoints. *(food DB UX)*
9. **`POST /food`** (custom) + barcode lookup con OFF fallback. *(P7, P9)*
10. **Expansión de base** (import OFF/USDA batch) — script independiente, sin bloquear lo anterior. *(P4)*
11. **Migración del móvil** al nuevo contrato (en paralelo desde el paso 3).

> Pasos 3 y 4 son el corazón. Si solo hubiera tiempo para dos cosas, son esas.

---

## 10. Risks and Tradeoffs

| Riesgo | Análisis | Mitigación |
|---|---|---|
| **Breaking change del `POST /logs/meal`** | El móvil actual manda totales; el nuevo backend espera items. Apps viejas en producción romperían. | Versionar: aceptar **ambos** payloads temporalmente (si viene `totalCalories` sin `items`, crear una `LoggedMeal` con un único item `customName`). Deprecar tras forzar update. |
| **Logs históricos sin items** | Los `LoggedMeal` ya guardados no tienen items; no se pueden editar a nivel ítem. | Aceptarlo. Editar viejos = solo borrar. No hay backfill posible. |
| **Inmutabilidad de `unaccent` en índice** | `unaccent()` no es IMMUTABLE → no se puede indexar directo. | Por eso se normaliza **en app** a `nameNormalized` y se indexa esa columna. Evita el problema entero. |
| **OFF API: latencia/caída/licencia** | Barcode fallback depende de un tercero (ODbL, requiere atribución). | Timeout 3s; si falla → 404 limpio + crear manual. Cachear hits como `FoodItem`. Atribución en créditos. |
| **Calidad de datos OFF** | Datos incompletos/ruidosos, sobre todo LATAM. | Marcar `isVerified=false`. No mezclar con verificados en ranking alto. |
| **`onDelete: SetNull` en LoggedMealItem** | Si se borra un `FoodItem`, el item de log queda sin referencia. | Por eso existe `nameSnapshot` + macros congelados: el historial sobrevive sin el FoodItem. |
| **Tradeoff: agua sin historial** | `DailyLog.waterMl` acumulado, sin tabla de eventos. No hay "deshacer preciso". | Aceptable en Fase 1. Si se pide historial, añadir `WaterLog` después. |
| **Cálculo en server = más carga** | Resolver N items por request vs cliente. | Trivial (queries indexadas + aritmética). Una transacción. No es un problema real. |

---

## 11. Acceptance Checklist

**Logging a nivel ítem**
- [ ] `POST /logs/meal` acepta `items[]` y **rechaza** payloads sin items (salvo modo compat).
- [ ] El servidor calcula todos los macros; ignora cualquier total enviado por el cliente.
- [ ] Cada ítem persiste como `LoggedMealItem` con `amountG`, `nameSnapshot` y macros congelados.
- [ ] `LoggedMeal.total*` y `DailyLog` cuadran exactamente con la suma de los items (test).

**Edición**
- [ ] `PATCH /logs/meal/:id` reemplaza items y recalcula.
- [ ] `DELETE /logs/meal/:id` borra comida y recalcula el día.
- [ ] `DELETE /logs/meal/:id/item/:itemId` borra ítem; si la comida queda vacía, se borra.
- [ ] Todos verifican ownership (otro usuario → 403/404).
- [ ] Tras cualquier mutación, `GET today` refleja totales correctos.

**Porciones**
- [ ] Un alimento común tiene ≥1 `ServingSize` con `isDefault`.
- [ ] Registrar "2 × 1 huevo" produce `amountG = 100` y macros correctos.

**Búsqueda**
- [ ] "pechga" devuelve "Pechuga de pollo" (fuzzy).
- [ ] "platano" (sin acento) devuelve "Plátano maduro".
- [ ] Favoritos y frecuentes del usuario rankean por encima del resto.
- [ ] Search responde <150ms con la base ampliada.

**Barcode**
- [ ] Código existente local → devuelve el `FoodItem`.
- [ ] Código no local → consulta OFF, cachea y devuelve.
- [ ] Código inexistente / OFF caído → 404 limpio (no 500).

**Agua y fibra**
- [ ] `POST /water { deltaMl: 250 }` incrementa y nunca baja de 0.
- [ ] Fibra se suma desde items y se muestra vs `Goal.fiberTargetG`.
- [ ] `GET /logs/day/:date` devuelve agua y fibra del día.

**Custom foods**
- [ ] `POST /food` crea alimento con `source="custom"`, `createdByUserId`.
- [ ] El alimento custom aparece en la búsqueda del propio usuario.

**No regresiones**
- [ ] `tsc --noEmit` sin errores.
- [ ] El evento `meal.logged` sigue emitiéndose (recomendaciones + push intactos).
- [ ] El móvil migrado registra, edita y borra sin romper el dashboard.

---

## Prioritización (resumen)

**MUST HAVE (deja de ser prototipo):** items reales + macros en server (P1/P2), editar/borrar (P3), agua/fibra (P8), ServingSize (P6), búsqueda pg_trgm (P5).

**SHOULD HAVE (competitivo):** favoritos/recientes/frecuentes, barcode lookup (P7), custom foods (P9), expansión de base OFF/USDA (P4).

**NICE TO HAVE (si no añade complejidad):** `sugarPer100g`/`sodiumMg` en DailyLog, `WaterLog` con historial, ranking por región del usuario.

**DO NOT BUILD (ahora):** recetas, IA foto/voz/texto, nutricionista proactivo, objetivos adaptativos, micronutrientes completos, base de restaurantes, gamificación. Todo eso es Fase 2+.
