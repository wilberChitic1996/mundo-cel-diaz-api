# STORAGE_GUIDE.md — Guía de Almacenamiento PraxisGT

## 1. Análisis: ¿Qué tablas crecen más rápido?

### Tablas de alto crecimiento (ordenadas por velocidad)

| Tabla | Filas por venta/día | Tamaño estimado/fila | Observaciones |
|---|---|---|---|
| **audit_logs** | ~10–30 por acción de usuario | ~400–800 bytes | Crece con CADA acción: login, venta, edición, etc. Es la tabla más peligrosa. |
| **sale_items** | 2–5 por venta | ~180 bytes | Una venta con 3 artículos = 3 filas. Crece proporcional al volumen de ventas. |
| **sales** | 1 por venta | ~250 bytes | Incluye JSONB `registrado_por` que puede pesar 100–200 bytes. |
| **account_payments** | 1–3 por cuenta cobrada | ~150 bytes | Cada abono genera una fila. |
| **repairs** | Variable | ~600 bytes | Campos TEXT largos: `issue`, `diagnosis`, `notes`. |
| **warranties** | 1 por venta/reparación | ~200 bytes | Crece con ventas pero no tan rápido como audit_logs. |

### Tablas de bajo crecimiento

| Tabla | Crecimiento | Notas |
|---|---|---|
| `clients` | Solo cuando se agrega cliente nuevo | Baja rotación |
| `products` | Solo cuando se agrega/modifica producto | Catálogo estable |
| `push_subscriptions` | 1 por usuario que acepta push | Muy pocos registros |
| `refresh_tokens` | 1 por sesión activa | Se limpian al expirar (30 días) |
| `store_settings` | Prácticamente estático | Pocos registros por tenant |

---

## 2. Columnas innecesariamente grandes

### `audit_logs.details` (JSONB)
- Almacena el payload completo de cada acción. En ventas puede incluir el array completo de items.
- **Riesgo:** Una venta con 10 productos puede generar un JSONB de 2–5 KB.
- **Recomendación:** Limitar `details` a máximo 2 KB; si el payload es mayor, guardar solo un resumen.

### `sales.registrado_por` (JSONB) y `accounts.registrado_por` (JSONB)
- Guarda nombre + role + id del usuario en cada venta como snapshot. Útil para historial pero duplica datos.
- **Alternativa:** Guardar solo `user_id` y hacer JOIN con `users` al leer. Ahorra ~100–200 bytes/fila.

### `repairs.issue`, `repairs.diagnosis`, `repairs.notes` (TEXT ilimitado)
- Campos de texto libre sin límite. Un técnico puede escribir párrafos largos.
- **Recomendación:** Considerar `VARCHAR(1000)` para `issue` y `notes`, `VARCHAR(2000)` para `diagnosis`.

### `sale_items.name` (TEXT)
- Guarda snapshot del nombre del producto en el momento de la venta. Útil para historial.
- **Observación:** Es correcto guardar snapshot (el nombre puede cambiar), pero considerar `VARCHAR(200)`.

---

## 3. Tamaño estimado por fila (tablas críticas)

| Tabla | Estimado/fila | Base (overhead PostgreSQL ~50 bytes + UUID 16 bytes) |
|---|---|---|
| `audit_logs` | 500–2 000 bytes | UUID + tenant_id + user info + action + JSONB details |
| `sale_items` | 150–200 bytes | UUID + sale_id + code + name + price + qty |
| `sales` | 200–350 bytes | UUID + JSONB registrado_por + campos varios |
| `repairs` | 400–800 bytes | UUID + múltiples TEXT largos |
| `account_payments` | 130–160 bytes | UUID + amount + method + JSONB |

---

## 4. ¿Cuántas filas antes de llegar a 500 MB?

Supabase free tier: **500 MB de base de datos**.

Estimación conservadora (promedio 600 bytes/fila en audit_logs, 200 bytes en resto):

| Escenario | audit_logs | Otras tablas | Total filas | Tamaño estimado |
|---|---|---|---|---|
| Negocio pequeño (50 ventas/día) | 500/día × 365 = 182 500/año | ~91 250/año | ~273 750/año | ~120 MB/año |
| Negocio mediano (200 ventas/día) | 2 000/día × 365 = 730 000/año | ~365 000/año | ~1 095 000/año | ~480 MB/año |
| Multi-tenant (5 negocios medianos) | 3 650 000/año | 1 825 000/año | ~5 475 000/año | ~2.4 GB/año |

**Conclusión:** Un solo negocio mediano puede agotar el free tier en ~1 año. Con varios tenants, en 2–3 meses.

---

## 5. Límites de Supabase

### Plan Free (actual)
- Base de datos: **500 MB**
- Storage (archivos): **1 GB**
- Bandwidth: **2 GB/mes**
- Backups: 1 día de retención
- Proyectos pausados si sin actividad por 7 días

### Plan Pro ($25/mes)
- Base de datos: **8 GB**
- Storage: **100 GB**
- Bandwidth: **250 GB/mes**
- Backups: PITR (Point In Time Recovery) 7 días
- Sin pausa por inactividad
- SLA 99.9%

### Cómo verificar uso actual
1. Ir a [app.supabase.com](https://app.supabase.com)
2. Seleccionar el proyecto
3. Settings → Usage
4. Ver "Database size" en tiempo real

---

## 6. Umbrales de alerta

| Nivel | Tamaño BD | Registros totales | Acción recomendada |
|---|---|---|---|
| **OK** | < 300 MB | < 300 000 | Normal, sin acción |
| **Warning** | 300–400 MB | 300 000–500 000 | Revisar retención de audit_logs |
| **Critical** | > 400 MB | > 500 000 | Limpiar audit_logs + considerar upgrade |
| **Urgente** | > 450 MB | > 600 000 | Upgrade a Pro inmediato |

El API monitorea esto automáticamente:
- `GET /api/admin/storage-stats` retorna `warning_level: 'ok'|'warning'|'critical'`
- `GET /health` retorna `total_records` como indicador rápido
- Cron job semanal (lunes 9:05 AM Guatemala) envía push notification si se supera el umbral

---

## 7. Política de retención — SQL de limpieza

### Limpiar audit_logs mayores a 180 días (ya automatizado con cron mensual)

```sql
-- Ver cuántos hay a eliminar
SELECT COUNT(*) FROM audit_logs
WHERE created_at < NOW() - INTERVAL '180 days';

-- Eliminar (ejecutar en Supabase SQL Editor)
DELETE FROM audit_logs
WHERE created_at < NOW() - INTERVAL '180 days';
```

### Limpiar push_subscriptions inactivas (> 90 días sin actualizar)

```sql
-- Ver cuántas hay
SELECT COUNT(*) FROM push_subscriptions
WHERE updated_at < NOW() - INTERVAL '90 days';

-- Eliminar
DELETE FROM push_subscriptions
WHERE updated_at < NOW() - INTERVAL '90 days';
```

### Limpiar refresh_tokens expirados

```sql
-- Los tokens expiran en 30 días. Limpiar los vencidos:
DELETE FROM refresh_tokens
WHERE expires_at < NOW();
```

### Limpiar ventas completadas muy antiguas (PRECAUCIÓN — requiere aprobación)

```sql
-- NUNCA ejecutar sin aprobación explícita del cliente.
-- Esto elimina historial de ventas. Usar solo si el cliente acepta.
-- Primero exportar a Excel desde la app.
DELETE FROM sales
WHERE created_at < NOW() - INTERVAL '2 years'
  AND status = 'completado';
-- Los sale_items se eliminan en cascada (ON DELETE CASCADE).
```

---

## 8. Cuándo hacer upgrade: estimación de meses

Para estimar cuándo se llegará al límite:

```sql
-- Tamaño actual de cada tabla (ejecutar en Supabase SQL Editor)
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
  n_live_tup AS row_count
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

**Regla práctica:**
- Si audit_logs crece > 10 000 filas/mes → upgrade en < 12 meses con plan free
- Si total de registros crece > 30 000/mes → upgrade en < 10 meses
- Si ya estás en Warning (300 MB) → upgrade en < 2 meses

**Recomendación:** Hacer upgrade a Pro **antes de llegar a 400 MB**. A 450 MB Supabase puede pausar escrituras.

---

## 9. Recomendaciones de implementación futura

1. **Comprimir `audit_logs.details`:** Guardar solo campos esenciales, no el objeto completo. Ahorra 50–70% de espacio en audit_logs.
2. **Eliminar `registrado_por` JSONB:** Reemplazar con solo `user_id` y resolver por JOIN. Ahorra ~150 bytes/venta.
3. **Archivar ventas antiguas:** Después de 1 año, mover a tabla `sales_archive` comprimida o exportar a JSON/CSV.
4. **Supabase Storage para imágenes:** Si se implementan fotos de productos/reparaciones, usar Supabase Storage (no BD) — el plan free da 1 GB separado.
5. **Índices parciales:** Agregar índice parcial en `audit_logs(created_at)` con condición reciente para acelerar queries sin escanear historial completo.
