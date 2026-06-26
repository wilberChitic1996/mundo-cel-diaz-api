# PraxisGT — Estado de Seguridad

Última actualización: 2026-06-26

---

## ✅ Corregido y en Producción

| # | Hallazgo | Archivo | Descripción |
|---|---|---|---|
| 1 | Mass assignment en productos | `routes/products.js` | PUT y POST solo aceptan campos del whitelist `PRODUCT_FIELDS`. Antes aceptaba `req.body` completo, un admin podía modificar `tenant_id`, `id`, etc. |
| 2 | CORS wildcard con credentials | `app.js` | Si `FRONTEND_URL` no estaba configurada, CORS abría a `*` con `credentials: true`. Ahora el fallback deshabilita CORS completamente. |
| 3 | Reset-password sin token | `routes/auth.js` | El flujo verify-answer → reset-password no tenía estado. Ahora `verify-answer` emite un JWT `purpose=password_reset` con 15 min de vida. `reset-password` solo acepta ese token. |
| 4 | Salt SHA-256 hardcodeado | `routes/auth.js` | `'mnpos_salt_2026'` estaba literal en el código. Ahora lee de env var `LEGACY_SALT` con ese valor como fallback. |
| 5 | RLS habilitado en BD | Supabase SQL | Row Level Security habilitado en 24 tablas. Políticas de aislamiento por `tenant_id` creadas. Ver script abajo. |

---

## ⏳ Pendiente — Requiere ventana de mantenimiento

### 🔴 ALTA PRIORIDAD: Migrar de `service_role` a `anon` key en Supabase

**Problema:** La API usa la `service_role` key de Supabase, que bypasea toda la seguridad RLS. Si esa key se filtra, toda la base de datos queda expuesta sin restricciones.

**Por qué no se hizo aún:** Supabase migró a llaves ECC (P-256). Cambiar el JWT secret para que coincida con el `JWT_SECRET` del API requiere un proceso de rotación que temporalmente podría romper el app.

**Pasos para completarlo (en ventana de mantenimiento):**

1. En Supabase (staging primero):
   - Settings → JWT Keys → Legacy JWT Secret
   - Copiar el valor actual
   - En Railway: reemplazar `JWT_SECRET` con ese valor (o viceversa — lo importante es que coincidan)

2. En `supabase.js`: crear dos clientes:
   ```js
   // Cliente admin (service_role) — solo para operaciones de superadmin
   const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
   // Cliente normal (anon) — para todas las operaciones de tenant
   const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
   ```

3. Actualizar todas las rutas para pasar el JWT del usuario al cliente anon:
   ```js
   // En cada request, crear un cliente con el JWT del usuario
   const client = supabase.auth.setSession({ access_token: req.headers.authorization.split(' ')[1] });
   ```
   O bien crear un helper `tenantClient(req)` que devuelva un cliente autenticado.

4. Las políticas RLS ya están creadas — solo se activarán automáticamente al cambiar a anon key.

5. Probar exhaustivamente en staging antes de producción.

**Variables de entorno que necesitarás agregar:**
- `SUPABASE_ANON_KEY` — la anon key de Supabase (está en Settings → API Keys)
- `SUPABASE_SERVICE_KEY` — la service_role key actual (renombrar la actual)

---

### 🟠 MEDIA PRIORIDAD: 2FA para Superadmin

**Problema:** El superadmin no tiene segundo factor de autenticación.

**Por qué no se hizo aún:** El dominio `mundoceldiaz.com` no está verificado en Resend. Sin eso los emails no salen y el login del superadmin quedaría bloqueado.

**Código listo en:** `routes/auth.js` — bloque comentado con instrucciones detalladas.

**Pasos para activarlo:**
1. Verificar `mundoceldiaz.com` en https://resend.com/domains
2. Descomentar el bloque 2FA en `routes/auth.js` (está marcado claramente)
3. Probar en piloto: login superadmin → debe llegar código al email
4. Mergear a producción

**Alternativa a futuro:** Migrar a TOTP (Google Authenticator / Authy) con librería `otplib` — no depende de email, más seguro y mejor UX.

---

## 📋 Script RLS — Ejecutar en cada BD nueva

```sql
ALTER TABLE products          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales             ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_payments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE returns           ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE defectives        ENABLE ROW LEVEL SECURITY;
ALTER TABLE users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients           ENABLE ROW LEVEL SECURITY;
ALTER TABLE repairs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE warranties        ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE caja_sesiones     ENABLE ROW LEVEL SECURITY;
ALTER TABLE caja_gastos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories        ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements   ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases         ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_items    ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE
  tbls TEXT[] := ARRAY[
    'products','sales','sale_items','accounts','account_items',
    'account_payments','returns','return_items','defectives','users',
    'clients','repairs','warranties','audit_logs','caja_sesiones',
    'caja_gastos','suppliers','categories','locations',
    'stock_movements','store_settings','purchases','purchase_items'
  ];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('
      DROP POLICY IF EXISTS tenant_isolation ON %I;
      CREATE POLICY tenant_isolation ON %I
        USING (
          tenant_id::text = (auth.jwt() ->> ''tenant_id'')
          OR (auth.jwt() ->> ''role'') = ''superadmin''
        );
    ', t, t);
  END LOOP;
END $$;
```
