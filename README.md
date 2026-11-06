# Vitals Fit

App de fitness y nutrición con un backend modular en **NestJS + TypeScript**, base de datos **PostgreSQL** (Prisma) y app móvil en **React Native (Expo)**. Incluye registro de comidas con cálculo de macros en el servidor, recomendaciones personalizadas (motor de reglas con integración opcional de Claude) y seguimiento de progreso.

> Proyecto personal, desarrollado de punta a punta: diseño de dominio, API, base de datos, app móvil, despliegue y pipeline de calidad.

## Arquitectura

```
app/
├── backend/   API REST · NestJS 11 · Prisma · PostgreSQL (Supabase)
└── mobile/    App iOS/Android · Expo · React Native · TypeScript
docs/          Diseño por módulo, runbooks y ADRs (Architecture Decision Records)
ai-system/     Contexto y reglas de dominio para los agentes de IA
```

**Backend (`app/backend`)**

- Módulos de dominio independientes: `auth`, `users`, `goals`, `food`, `nutrition`, `logs`, `progress`, `recommendations`, `push`, entre otros.
- Arquitectura orientada a eventos dentro del monolito modular (`@nestjs/event-emitter`): las comidas, el onboarding y el progreso publican eventos que consumen los handlers de recomendaciones y retención.
- Autenticación con **JWT** (Passport) y contraseñas con hash `bcrypt`.
- Validación de entrada con DTOs (`class-validator`) y `ValidationPipe` global con `whitelist`.
- Patrón *adapter/provider* para fuentes externas (catálogo de alimentos, proveedores de IA), con degradación a un modo sin red cuando no hay credenciales.
- Migraciones versionadas con Prisma Migrate y seed de datos.
- Endpoint de salud (`/api/health`) y despliegue en Render/Railway.

**Mobile (`app/mobile`)**

- Expo Router, React Query, Zustand, React Hook Form + Zod, NativeWind.
- Token guardado en `expo-secure-store`, banner de modo offline y notificaciones push con Expo.

## Ramas

| Rama | Contenido |
|---|---|
| `main` | Versión estable desplegada: Fase 1 de nutrición (registro por ítem, catálogo, favoritos, recientes y alimentos personalizados). |
| `feature/nutrition-state-2a2` | Desarrollo más reciente: estado nutricional longitudinal, coach semanal, planificador de comidas, módulo de visión (foto, código de barras y OCR de etiquetas), y endurecimiento para producción. |

La rama de desarrollo añade además:

- **CI en GitHub Actions**: lint (ESLint), formato (Prettier), typecheck, chequeo de límites entre módulos, build y más de 20 suites de smoke tests contra un Postgres embebido.
- **Contrato OpenAPI versionado** y pruebas HTTP con Supertest.
- **Validación de variables de entorno al arrancar** (falla si `JWT_SECRET` falta, es corto o es un placeholder).
- **CORS con allowlist** en producción, *rate limiting* por endpoint y endpoints de operador protegidos por allowlist.
- **ADRs** en `docs/adr/` que documentan las decisiones de arquitectura.

## Ejecutar en local

Requisitos: Node.js 20+, una base PostgreSQL (local o Supabase).

```bash
# Backend
cd app/backend
cp .env.example .env          # completa DATABASE_URL, DIRECT_URL y JWT_SECRET
npm install
npx prisma migrate deploy
npm run start:dev             # http://localhost:3000/api

# Mobile
cd app/mobile
cp .env.example .env          # EXPO_PUBLIC_API_URL apuntando a tu backend
npm install
npx expo start
```

Genera un `JWT_SECRET` seguro con `openssl rand -base64 48`. Los archivos `.env` reales nunca se suben al repositorio.

## Stack

`TypeScript` · `Node.js` · `NestJS` · `Prisma` · `PostgreSQL` · `JWT` · `React Native` · `Expo` · `React Query` · `Zustand` · `Zod` · `GitHub Actions` · `Anthropic Claude API`

## Autor

**Jose Manuel Barrientos Palacio** — Estudiante de Ingeniería de Sistemas, Universidad EAFIT · [github.com/Jmbarrienp](https://github.com/Jmbarrienp)
