# Plan de Recuperación ante Desastres (DR) — PraxisGT / Mundo Cel Diaz

> **F2.** Este documento describe cómo se respaldan los datos, qué se puede recuperar y los
> pasos exactos para restaurar. Está pensado para un operador (no programador) guiado por Claude.
> El restore se ejecuta con `scripts/restore-tenant.js` (ver al final).

---

## 1. Qué respaldos existen (dos capas)

| Capa | Qué cubre | Frecuencia | Dónde | Retención |
|---|---|---|---|---|
| **A. Respaldo de plataforma (Supabase)** | TODA la base de datos (todas las tablas, todos los tenants) | Automático por Supabase | Infra de Supabase (PITR / daily backups según plan) | Según plan Supabase |
| **B. Respaldo lógico por tenant (la app)** | Datos de negocio de UN tenant (13 tablas, ver §3) | Diario 2 AM (cron) + manual desde el panel | Supabase Storage, bucket `backups`, ruta `<tenant>/<fecha>.json` | 30 días |

**La capa A es la red de seguridad real ante una pérdida total de la BD.** La capa B sirve para
recuperar los datos de un negocio puntual (ej. alguien borró/dañó datos de un tenant) sin tocar a los demás.

---

## 2. Objetivos (RPO / RTO)

- **RPO (cuánto dato se puede perder):** hasta **~24 h** con la capa B (respaldo diario). Los cambios
  hechos *después* del último respaldo de esa noche no están en el JSON. La capa A (Supabase PITR, si
  el plan lo incluye) reduce esto a minutos.
- **RTO (cuánto tarda recuperar):** **minutos** para restaurar el JSON de un tenant con el script.

---

## 3. Qué incluye / NO incluye el respaldo lógico (capa B)

**Incluye (13 tablas):** `clients`, `products`, `sales`, `sale_items`, `accounts`, `repairs`,
`warranties`, `returns`, `defectives`, `suppliers`, `categories`, `locations`, `store_settings`.

**NO incluye (recuperar por capa A si hace falta):**
- **Usuarios y contraseñas** (`users` se guarda sin `password_hash` → el restore NO los recrea; ver §6).
- `account_items`, `account_payments`, `return_items`, `purchases`, `purchase_items`, `stock_movements`,
  `audit_logs`, `push_subscriptions`, `refresh_tokens`, `product_serials`, `product_variants`, `payment_webhooks`.

> ⚠️ Esto significa que el restore de capa B reconstruye el **catálogo, ventas, cuentas, reparaciones,
> garantías y configuración**, pero **no** los abonos individuales ni el detalle de compras. Para una
> recuperación total fiel, usar la capa A (Supabase). La capa B es para rescates rápidos y parciales.

---

## 4. Escenarios y qué hacer

### Escenario 1 — Un tenant perdió/dañó sus datos (borrado accidental, mala importación)
1. Identificar el último backup bueno del tenant (panel de Backups o bucket `backups`).
2. Restaurar **primero en STAGING** con el script en modo simulación, validar, luego `--commit`.
3. Si se ve bien, restaurar en **PRODUCCIÓN** (con `--prod`), siguiendo §5.
4. Recrear usuarios si se perdieron (§6).

### Escenario 2 — Pérdida/corrupción TOTAL de la base de datos
- **Usar la capa A (Supabase).** En el dashboard de Supabase → Database → Backups / Point-in-Time
  Recovery → restaurar al punto más reciente. Esto recupera TODO (todas las tablas y tenants).
- La capa B (script) **no** es suficiente para esto (le faltan tablas, ver §3).

### Escenario 3 — Migración/upgrade que salió mal
- Si fue un cambio de esquema: revertir la migración (`npm run migrate:down`) o restaurar por capa A.
- Si fue corrupción de datos de un tenant: capa B.

---

## 5. Procedimiento de restore (capa B) — paso a paso

> El script vive en `scripts/restore-tenant.js`. **Siempre** corré primero la SIMULACIÓN (sin `--commit`).

**Preparar las variables** de la BD destino (las mismas del API de ese ambiente):
- Staging: `SUPABASE_URL` y `SUPABASE_KEY` de `aawjhttlaydwsipsifre`.
- Producción: los de `rhecnmfivygkayfvauxt` (exige además `--prod`).

**A) Restaurar desde un archivo descargado del panel:**
```bash
# 1) SIMULACIÓN (no escribe nada — solo muestra qué haría)
SUPABASE_URL=... SUPABASE_KEY=... \
  node scripts/restore-tenant.js --tenant <UUID-del-tenant> --file backup.json

# 2) Si la simulación se ve bien, APLICAR:
SUPABASE_URL=... SUPABASE_KEY=... \
  node scripts/restore-tenant.js --tenant <UUID-del-tenant> --file backup.json --commit
```

**B) Restaurar desde un backup que ya está en Storage (por su `storage_path`):**
```bash
SUPABASE_URL=... SUPABASE_KEY=... \
  node scripts/restore-tenant.js --tenant <UUID> --path "<tenant>/<archivo>.json"        # simulación
SUPABASE_URL=... SUPABASE_KEY=... \
  node scripts/restore-tenant.js --tenant <UUID> --path "<tenant>/<archivo>.json" --commit
```

**Para producción** agregá `--prod` (el script aborta si detecta la BD de prod sin esa bandera):
```bash
SUPABASE_URL=...prod... SUPABASE_KEY=...prod... \
  node scripts/restore-tenant.js --tenant <UUID> --file backup.json --commit --prod
```

**Garantías del script (por diseño):**
- Modo simulación por defecto; escribe solo con `--commit`.
- Aborta si el tenant del archivo ≠ `--tenant` (no mezcla negocios).
- Aborta en la BD de producción si falta `--prod`.
- Upsert por `id` → correrlo dos veces deja el mismo estado (idempotente, no duplica).
- Fuerza `tenant_id` en cada fila (refuerzo multi-tenant).

---

## 6. Recrear usuarios tras un restore

El backup guarda usuarios **sin contraseña**, por eso el script NO los restaura (evita logins rotos).
Si se perdieron usuarios, recrealos desde el panel de superadmin (o con el endpoint de creación de
usuarios), asignando rol y una contraseña temporal que el usuario cambia luego.

---

## 7. Cómo PROBAR este plan (recomendado, en STAGING)

> Requiere autorización de escritura en BD («cambia»). Hacerlo cuando se pueda validar tranquilo.

1. En staging, generar un backup manual del tenant demo desde el panel (o `createTenantBackup`).
2. Anotar los conteos actuales (productos, ventas, etc.).
3. Borrar/alterar a propósito unas pocas filas de prueba del tenant demo.
4. Correr el restore en **simulación** → confirmar que reportaría las filas esperadas.
5. Correr con `--commit` → verificar que los conteos vuelven a los del paso 2.
6. Documentar el tiempo que tomó (afinar el RTO real).

> **Estado actual:** el script está validado en *dry-run* (lógica de parseo, guardas de tenant y de
> producción, orden FK-safe). **Falta una corrida real `--commit` en staging** (paso 5) para certificar
> el restore de punta a punta — pendiente de una ventana con validación.

---

## 8. Contactos / accesos necesarios en una emergencia

- **Supabase** (capa A, PITR): acceso al dashboard del proyecto correspondiente (prod `rhecnmfivygkayfvauxt`).
- **Railway**: variables de entorno del API (para conocer `SUPABASE_URL/KEY` de cada ambiente).
- **Bucket `backups`**: en Supabase Storage de cada ambiente.
