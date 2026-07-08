# 📒➡️💻 Migración del Cuaderno al Sistema — Diseño consolidado

> **Estado:** Fase 1 (Deudas) — backend construido en la rama `claude/migracion-cuaderno-deudas`,
> **SIN mergear a producción**. Pendiente: revisión de Wilber + decisión sobre la idea de "producto
> placeholder" + correr la migración SQL `026` (requiere su «cambia») + construir el frontend.
> Diseñado el 2026-06-29 con 3 agentes en paralelo (datos/DBA, UX/producto, contable/negocio).

Este documento es la "foto" del plan para revisar con calma. NADA está en producción todavía.

---

## 1. La idea en una frase
El día que se arranca, se le toma una **foto de saldos** al negocio (lo que le deben, reparaciones
abiertas, inventario) y eso entra como **punto de partida**, NO como ventas de hoy.

## 2. Las 3 reglas de oro (por qué así)
1. **Lo viejo NO se registra como venta nueva.** Re-registrarlo inflaría ventas del día, IVA del
   período, caja e inventario. Entra como "saldo inicial / partida de apertura".
2. **Cargar una deuda ≠ recibir dinero.** La deuda no está en el cajón → **no toca la caja**. El
   abono futuro a esa deuda **sí** entra a la caja el día que se cobre (por el flujo normal).
3. **Cada cosa con su fecha real** (la del cuaderno), para que la antigüedad/mora de las cuentas y el
   orden del historial salgan correctos.

## 3. Cómo se logra técnicamente (clave)
Los efectos colaterales de una venta (descontar stock, sumar a caja, IVA, movimientos de inventario)
**viven en el código de `routes/sales.js`**, no en triggers de la base. Por eso, si la migración
**inserta directo** en las tablas (sin pasar por `POST /api/sales`), **por construcción NO dispara
ningún efecto colateral**. Esa es la regla de oro técnica:
> **La migración NUNCA pasa por la API de ventas ni de caja. Inserta directo y marcado.**

---

## 4. Modelo de datos — marca de origen (migración `026_account_origin.sql`)

Columna nueva en `accounts` (y a futuro en `sales`/`repairs` para Fases 2-3):
- `origin TEXT NOT NULL DEFAULT 'operacion'` → valores `'operacion'` | `'migracion'`.
- `migrated_at TIMESTAMPTZ` → cuándo se importó (auditoría).
- `migration_batch_id UUID` → identifica el lote, para **deshacer una carga completa**.

Por qué `origin` y no otras opciones:
- **No** usar un `status` especial: `status` ya significa pendiente/parcial/pagado; meter 'migracion'
  ahí destruiría esa info y rompería todos los filtros existentes. Es ortogonal (una deuda puede ser
  migrada **y** parcial).
- **No** tabla aparte: una deuda migrada debe comportarse como cuenta por cobrar normal (recibir
  abonos por el flujo estándar). Tabla aparte = reimplementar `accounts`.
- `origin` es aditivo, default seguro (todas las filas viejas quedan 'operacion'), no rompe nada.

**SQL (idempotente, solo agrega, no borra):** ver `migrations/026_account_origin.sql`.
La **fecha del cuaderno va en `created_at`** (no columna nueva) para que la antigüedad/orden funcionen.

---

## 5. Backend Fase 1 — endpoints (`routes/migration.js`, montado en `/api/migration`)
- `POST /api/migration/debts` — carga masiva de deudas. Body `{ debts: [{ client, total, paid?, items?, date?, note? }] }`.
  Crea cuentas con `origin='migracion'`, `sale_id=NULL`, balance/status derivados, fecha del cuaderno,
  un `migration_batch_id` por lote. Detalle: usa `items` si vienen; si no, una línea genérica. Inserta
  secuencialmente y **revierte todo el lote si algo falla**. Devuelve `{ batchId, created, totalDebt }`.
  **RBAC: solo `admin`.** Registra en auditoría (`migracion_historica`).
- `GET /api/migration/batches` — lista los lotes cargados del tenant (para revisar/deshacer).
- `DELETE /api/migration/debts/:batchId` — deshace una carga completa (FK-safe, solo lo marcado
  migración del tenant). Como NO se tocó stock ni caja al cargar, **deshacer no requiere compensar nada**.
  Registra `migracion_revertida`.

Multi-tenant: todo filtra por `tenant_id`. Probar con ≥2 negocios (sandbox TechStore) antes de liberar.

---

## 6. Frontend Fase 1 — PENDIENTE de construir
Módulo nuevo y **temporal** "📒 Pasar mi cuaderno" (solo `admin`), con la tarjeta **Deudas de clientes**:
- **Dos caminos:** "Agregar una" (formulario simple) y "Importar Excel" (plantilla descargable,
  reusando el patrón XLSX de `ProductsScreen.jsx`).
- **Previsualización obligatoria** antes de confirmar (tabla de revisión + resumen: "vas a cargar 23
  clientes con Q12,400; la fila 7 se omite porque falta el nombre").
- **Badge "📒 Del cuaderno"** en `AccountsScreen` para `origin='migracion'`.
- **Deshacer la última carga** (llama al DELETE por lote).

Plantilla Excel "Deudas": `Cliente* | Teléfono | Total* | Ya abonó | Desde (MM/AAAA) | Nota / Qué llevó`.

---

## 7. Idea de Wilber sobre Jhonatan (producto placeholder) + análisis

**Su propuesta (29 jun):** para una deuda a crédito histórica sin detalle conocido, **crear un producto**
con el precio de esa deuda, **stock 1**, y enlazarlo; después se edita ese producto por el real, y al
ser un producto de verdad, los cambios afectan a todo lo relacionado.

**Análisis y complementos (para decidir juntos otro día):**
1. ✅ **Lo bueno:** convierte la deuda en una referencia **real y editable** del catálogo, no en texto
   muerto. Queda visible en Inventario para corregirlo luego.
2. ⚠️ **Stock: recomiendo 0, no 1.** El artículo ya salió de la tienda (la venta a crédito ya ocurrió).
   Poner stock 1 crea **inventario fantasma** (1 unidad que no existe físicamente) e infla el valor del
   inventario. Si se deja en 0, refleja la realidad. (Si igual querés 1 para "verlo/editarlo", hay que
   acordarse de ajustarlo.)
3. ⚠️ **Agrupar los placeholders** para que no ensucien el catálogo: categoría dedicada
   **"📒 Por revisar (del cuaderno)"** y/o código con prefijo `HIST-###`. Así se encuentran y limpian fácil.
4. ⚠️ **Aclaración importante sobre "que afecte a todo lo relacionado":** la tabla `account_items`
   guarda el detalle como **foto** (code/name/price/qty), **no** tiene enlace vivo (FK) al producto. Por
   eso, cuando edites el producto después, la **línea histórica de la deuda NO cambia sola** (y está
   bien: un registro histórico es una foto del momento). Lo que SÍ usa el producto editado es todo lo
   **nuevo** de aquí en adelante (ventas, inventario, reportes). Si querés que la línea vieja también se
   actualice, habría que guardar `product_id` en `account_items` (cambio de esquema) — lo podemos evaluar.
5. 💡 **Para Jhonatan puntual:** como **tu cliente SÍ sabe** qué llevó, lo ideal NO es placeholder sino
   cargar los **productos reales** directamente. El placeholder es el **plan B** para cuando NO se sabe
   el detalle (típico en cargas masivas por Excel). Recomendación: placeholder = fallback; producto real
   = cuando se conoce.
6. ⚠️ **Volumen:** un producto por cada deuda puede generar muchos productos basura si hay cientos de
   deudas. Para cargas grandes conviene la **línea genérica** (sin producto); el placeholder-producto es
   mejor para el camino manual / pocas deudas conocidas.

**Decisión a tomar otro día:** ¿placeholder-producto (stock 0 + categoría "Por revisar") como opción en
el formulario manual, y línea genérica para el Excel masivo? Cuando confirmes, ajusto el endpoint para
crear el producto + enlazar (hoy el endpoint usa la línea genérica/los items que se le pasen).

---

## 8. Lo que podría faltar (revisión de completitud)
- **Reparaciones (Fase 2)** y **ventas históricas / historial (Fase 3)** — diseñadas, no construidas.
- **Inventario inicial:** es un **conteo físico**, no compras (no genera cuenta por pagar ni IVA crédito).
  Ya existe import de productos por Excel; faltaría un modo "saldo inicial de stock".
- **Fecha de corte:** elegir "desde cuándo arranca lo digital" (idealmente inicio de mes + un cierre de
  caja) y **marcar/cerrar el cuaderno** para no cobrar dos veces (riesgo de doble conteo).
- **Checklist de validación post-migración:** suma de deudas cargadas = suma del cuaderno; caja del día
  no se movió; IVA del mes no cambió; ventas del día no se inflaron. (Detalle en la sección 6 del análisis
  contable, guardado en memoria.)
- **Riesgo de esquema:** ids TEXT (prod) vs UUID (staging). El `migration_batch_id` es columna propia UUID
  (sin problema); las cuentas usan el `id` por defecto de cada ambiente (no se hardcodea).
- **Respaldo previo obligatorio** antes de cargar en prod (snapshot Supabase + export Excel del tenant).
- **Argumento de venta:** "Migramos tu cuaderno gratis: arrancás sin empezar de cero."

---

## 9. Próximos pasos cuando Wilber retome
1. Revisar este diseño + decidir lo del placeholder-producto (sección 7).
2. «cambia» para correr `026_account_origin.sql` en BD staging → validar → prod.
3. Mergear el backend (rama `claude/migracion-cuaderno-deudas`) staging→main.
4. Construir el frontend del módulo "📒 Pasar mi cuaderno" (Deudas).
5. Cargar las 3 deudas reales de Jhonatan con sus productos (su cliente los sabe) — requiere «cambia».
6. Seguir con Fase 2 (reparaciones) y Fase 3 (ventas históricas).
