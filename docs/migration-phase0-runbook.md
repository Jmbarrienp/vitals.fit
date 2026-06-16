# FASE 0 — Runbook de ejecución (baseline + adopción de Prisma Migrate)

> Solo infraestructura de migraciones. No toca lógica, endpoints, DTOs ni modelos.
> Los pasos marcados **[PROD]** los ejecutas tú (tocan la base de producción).

## Qué ya quedó hecho en el repo (commits locales)
- `app/backend/prisma/migrations/0_init/migration.sql` — baseline del schema actual (28 tablas, 16 enums, 34 índices, 27 FKs).
- `app/backend/prisma/migrations/migration_lock.toml` — `provider = "postgresql"`.
- `package.json` — scripts nuevos: `migrate:deploy`, `migrate:status`.
- `prisma.config.ts` — ya usaba `DIRECT_URL`; **sin cambios**.

---

## Pre-requisitos

- [ ] **`DIRECT_URL`** disponible en tu shell local. Supabase → Project → Connect → "Direct connection" (puerto **5432**, NO el pooler 6543).
  ```bash
  # local, temporal para correr los comandos de migración:
  export DIRECT_URL="postgresql://postgres:[PASS]@db.[REF].supabase.co:5432/postgres"
  ```
- [ ] **Snapshot/backup** de Supabase tomado antes de tocar nada (Database → Backups).

---

## Paso 1 — [PROD] Verificar drift (schema local == producción)

Confirma que el `schema.prisma` describe **exactamente** lo que hay en prod. Es **read-only**.

```bash
cd app/backend
npx prisma migrate diff \
  --from-schema prisma/schema.prisma \
  --to-url "$DIRECT_URL" \
  --script
```

**Interpretación:**
- **Salida vacía / "No difference"** → ✅ no hay drift. Continúa al Paso 2.
- **Aparece SQL** → ⚠️ hay drift (prod difiere del schema). **DETENTE.** Ese SQL es lo que habría que reconciliar antes de baselinizar. Revísalo conmigo antes de seguir.

> Nota: `--from-schema` = lo que quieres tener; `--to-url` = lo que hay en prod. El script muestra cómo pasar de prod → schema. Si está vacío, son idénticos.

---

## Paso 2 — [PROD] Registrar el baseline como YA APLICADO

Esto crea la tabla `_prisma_migrations` en prod y marca `0_init` como aplicada **sin ejecutar el SQL** (las tablas ya existen).

```bash
cd app/backend
npx prisma migrate resolve --applied 0_init
```

> ⚠️ **NUNCA** `npx prisma migrate deploy` para `0_init` sobre prod — intentaría `CREATE TABLE` sobre tablas existentes y fallaría. Solo `resolve --applied`.

**Resultado esperado:** `Migration 0_init marked as applied.`

---

## Paso 3 — [PROD] Confirmar estado limpio

```bash
cd app/backend
npm run migrate:status
```

**Resultado esperado:**
```
1 migration found in prisma/migrations
Database schema is up to date!
```

Si dice "up to date" → la adopción de Migrate quedó completa. A partir de aquí, futuras migraciones se aplican con `migrate deploy`.

---

## Paso 4 — Configurar Render (Pre-Deploy)

En el dashboard del servicio **backend** de Render:

| Campo | Valor |
|---|---|
| **Pre-Deploy Command** | `npm run migrate:deploy` |
| **Env var nueva** | `DIRECT_URL` = (misma direct connection, puerto 5432) |

Verifica que sigan presentes: `DATABASE_URL` (pooler 6543, runtime), `JWT_SECRET`.

**Por qué Pre-Deploy y no Build/Start:**
- Corre **una sola vez** tras el build, **antes** de promover la versión nueva → sin carrera entre instancias.
- Si la migración falla, **el deploy aborta y la versión vieja sigue sirviendo** → cero downtime por schema.
- El `build` no debe tocar la DB; el `start` correría en cada instancia (carrera).

> `prisma` está en `dependencies` → el CLI existe en el entorno de Render. ✅

---

## Paso 5 — Validar el pipeline sin cambios de schema

Antes de Fase 1, prueba que el Pre-Deploy funciona haciendo un deploy normal (cualquier commit trivial):
- El deploy debe correr `migrate deploy` → reportar "No pending migrations to apply" → promover.
- Esto confirma que `DIRECT_URL` y el Pre-Deploy están bien **sin riesgo** (no hay migraciones pendientes).

---

## Checklist de aceptación FASE 0

- [ ] Paso 1: drift check → salida vacía.
- [ ] Paso 2: `0_init` marcada como aplicada en prod.
- [ ] Paso 3: `migrate:status` → "up to date".
- [ ] Paso 4: Pre-Deploy Command + `DIRECT_URL` configurados en Render.
- [ ] Paso 5: un deploy de prueba corre `migrate deploy` sin pendientes y promueve OK.

Cuando los 5 estén ✅, la rama `feature/nutrition-phase1` queda libre para mergear con seguridad: cualquier `migrate dev` futuro se aplicará en prod automáticamente vía Pre-Deploy.

---

## Rollback de la propia FASE 0 (si algo sale mal)

La FASE 0 es casi inocua (solo crea `_prisma_migrations` y registra una fila). Para revertir:
```sql
-- contra DIRECT_URL, solo si fuese necesario abortar la adopción:
DROP TABLE IF EXISTS "_prisma_migrations";
```
Y revertir el Pre-Deploy Command en Render. El código de la app no cambia, así que no hay rollback de aplicación.
