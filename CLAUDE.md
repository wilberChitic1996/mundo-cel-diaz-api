# CLAUDE.md — API / Backend (PraxisGT · Mundo Cel Diaz)

**INSTRUCCIÓN:** Leé este archivo COMPLETO al inicio de cada sesión que toque el backend.
Este es el contexto del **repo del API**. La **fuente de verdad completa del proyecto** (reglas,
estado global, pendientes, manual técnico) vive en el repo del **frontend**
(`wilberchitic1996/mundo-cel-diaz` → `CLAUDE.md`, `DEFINITION_OF_DONE.md`, `docs/MANUAL-TECNICO.md`).
Si los tenés clonados al lado, leelos también.

---

## 🔴 Reglas de trabajo (idénticas en ambos repos)

1. **Un paso a la vez** — terminar algo, reportar, esperar "Listo" del usuario antes de seguir.
2. **Scripts SQL siempre inline en el chat** — el USUARIO los corre. NUNCA asumir que se ejecutó.
3. **Cambios de BD requieren aprobación explícita** del usuario antes de ejecutar.
4. **NUNCA PR directo a `main`.** Flujo: rama de trabajo → `staging` (piloto) → validar → PR `staging → main`.
5. **CI verde antes de mergear** — verificar con las herramientas de GitHub.
6. **No tocar lo que funciona** sin instrucción explícita.
7. **Todo lo nuevo se anota** en este archivo o en el del frontend (nada queda "en el aire").
8. **Esperas de CI/deploy:** sondear activamente y reportar; nunca dejar al usuario esperando a ciegas.

> El usuario NO es programador: explicar en simple y guiar paso a paso.

---

## ⚠️ Aislamiento de ambientes — NO TOCAR sin aprobación

El API tiene **DOS ramas** que despliegan a **DOS Railway** independientes, cada uno con **SU propia BD**:

| | Producción | Staging (Piloto) |
|---|---|---|
| Rama (deploy) | `main` | `staging` |
| Railway | `remarkable-warmth` (`...up.railway.app/api`) | `observant-possibility` (`...-e546.up.railway.app/api`) |
| Supabase | `rhecnmfivygkayfvauxt` | `aawjhttlaydwsipsifre` |
| `FRONTEND_URL` | `https://mundoceldiaz.com` | `https://mundo-cel-diaz-staging.vercel.app` |

- **Un fix de backend debe llegar a la rama correcta** (a veces a AMBAS: main y staging).
- **NUNCA** apuntar staging a la BD/URL de producción.
- **NUNCA** cambiar `SUPABASE_URL` / `SUPABASE_KEY` / `FRONTEND_URL` sin aprobación.
- Railway despliega solo por rama (sin límite de deploys, a diferencia de Vercel).
- Health: `curl https://mundo-cel-diaz-api-production-e546.up.railway.app/api/health` (staging).

---

## 🛢️ Lección transversal #1: DESAJUSTE DE ESQUEMA

La causa #1 de bugs. El código a veces usa columnas que NO existen en la BD real:
`sales.date` (es `created_at`), `accounts.due_date` (no existe; aging por `created_at`),
`repairs.client`/`device` (son `client_name`/`brand`+`model`). **Antes de escribir cualquier query
nueva**, verificar columnas reales:
```sql
SELECT column_name FROM information_schema.columns WHERE table_name='X';
```
Ver `docs/DB-SCHEMA-REAL.md` en el repo frontend. Tablas que NO existen: `repair_items`,
`caja_sessions`, `product_price_history`. Multi-tenant: TODA query lleva `WHERE tenant_id = ?`
(usar `utils/tenant.js` → `withTenant()`/`tid()`).

---

## Stack y estructura

**Express 5.2 + Node ≥18**, Supabase (service_role, bypassa RLS), Redis o Map en memoria (caché).
Puerto 4000. Tests: Vitest + Supertest (`npm test`). Migraciones: node-pg-migrate (`npm run migrate:up`, desde 008).

```
app.js          Express + CORS (*.vercel.app + FRONTEND_URL) + Helmet (CSP estricta) + rate limit.
                Body parsers selectivos (repairs 4MB fotos; webhooks raw para HMAC). Monta /api/* y /api/v1/*.
index.js        Levanta server + startCronJobs().
supabase.js     Cliente Supabase service_role.
routes/         auth, products, variants, serials, sales, accounts, returns, defectives, repairs,
                clients, warranties, caja, categories, locations, suppliers, settings, admin,
                reminders, push, backup, audit, public, webhooks.
middleware/     auth.js (JWT + revocación de sesión), requireRole.js (RBAC), enforceSubscription.js
                (403 si tenant vencido), rateLimit.js.
services/       subscriptionService, felService + felProvider (DORMIDOS), client/product/saleService.
utils/          tenant, audit, crypto (AES-256-GCM DPI), paging, cache, reminders (cron), backup,
                logger (Pino), sentry.
migrations/     000-008 base; 009 product_serials; 016 decrement_stock robusto; 017 fel_fields (dormido).
```

**Orden de middleware en escrituras:** `auth → requireRole → enforceSubscription`.

### Endpoints (resumen — detalle completo en `docs/MANUAL-TECNICO.md` del frontend)
auth (login/refresh/logout/recuperación) · products (+adjust-stock, stock/price-history) ·
variants · serials (IMEI, Luhn) · sales (idempotencia, FEL hook, marca reparación entregada,
pago dividido, IVA) · accounts (+payments, idempotencia B5) · returns · defectives · repairs
(+status, +photos) · clients (DPI cifrado) · warranties · caja (sesiones+gastos) · categories ·
locations (+move-product) · suppliers (+purchases) · settings · admin (superadmin: tenants, stats,
storage, subscription) · reminders · push (VAPID) · backup · audit · public (verify QR) ·
webhooks/payment (DORMIDO).

---

## Estado actual (29 jun 2026)

- **Cierre v1.0:** 10/13 bloqueantes cerrados (ver `DEFINITION_OF_DONE.md` en frontend).
- **Backend cerrado (API PR #74, en `staging`):** B3 (whitelist roles), A8 (requireRole en escrituras),
  B2 (enforceSubscription), B4 (revocación de sesión), B5 (idempotencia en accounts), A13 (cifrado
  DPI), A1/A15 (decrement_stock robusto + drop overload — SQL corrido en staging por el usuario).
  Suite de tests ~125/125. Timeout de lookups configurable (`DB_LOOKUP_TIMEOUT_MS`).
- **Vagones DORMIDOS (listos, no afectan nada hasta activarse):**
  - **FEL** (facturación SAT): `services/felProvider.js` (stub adapter-agnóstico) + `felService.certifySale()`
    + `migrations/017_fel_fields.sql` + hook en `sales`. Activar con `FEL_ENABLED=true` + adapter del
    certificador elegido. Ver "Checklist FEL" en CLAUDE.md del frontend.
  - **Cobro recurrente:** `routes/webhooks.js` (`POST /api/webhooks/payment`, HMAC-SHA256, 503 si
    `PAYMENTS_ENABLED!=='true'`) + `subscriptionService.renewSubscription()`. Se ata a B2: un pago
    extiende `expires_at` y desbloquea el tenant. Ver "Checklist Cobro" en CLAUDE.md del frontend.
- **Pendiente del usuario:** (1) `ENCRYPTION_KEY` en Railway para activar cifrado DPI (+ correr
  `scripts/reencrypt-dpi.js`); (2) correr el SQL de A1/A15 en BD de producción al liberar staging→main;
  (3) traer proveedor de cobro (A16) y certificador FEL (B1).

---

## Variables de entorno (NO TOCAR sin aprobación)

```
SUPABASE_URL / SUPABASE_KEY   (service_role; cada ambiente apunta a SU BD)
FRONTEND_URL                  (CORS; prod=mundoceldiaz.com, staging=...staging.vercel.app)
JWT_SECRET, RESEND_API_KEY, REDIS_URL (opcional)
VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY  (Web Push)
ENCRYPTION_KEY                (opcional, A13: cifra DPI AES-256-GCM; NUNCA cambiar tras cifrar datos)
DB_LOOKUP_TIMEOUT_MS          (opcional, default 1500; tests usan 50)
# DORMIDOS:
FEL_ENABLED / FEL_PROVIDER / FEL_USERNAME / FEL_PASSWORD / FEL_CERT_PATH / FEL_CERT_PASSWORD
PAYMENTS_ENABLED / WEBHOOK_SECRET / PAYMENT_PROVIDER
```

---

## Migraciones — flujo

1. `npm run migrate:create nombre` → editar el SQL (up/down).
2. Probar en **BD staging** primero (el usuario corre/aprueba; regla #2 y #3).
3. Validar en piloto.
4. Aplicar en **BD producción** al liberar.

> Detalle profundo de arquitectura, pantallas, flujos de negocio y deuda técnica:
> **`docs/MANUAL-TECNICO.md`** en el repo frontend. Este archivo es el resumen operativo del backend.
