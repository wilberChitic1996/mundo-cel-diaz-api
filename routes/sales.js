const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../supabase');

// GET /api/sales
router.get('/', auth, async (req, res) => {
  const { data, error } = await supabase
    .from('sales').select('*, sale_items(*)').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/sales (crear venta + items + actualizar stock)
router.post('/', auth, async (req, res) => {
  const { client, total, method, items } = req.body;
  if (!client || !items || !items.length)
    return res.status(400).json({ error: 'Datos incompletos' });

  // Crear la venta
  const { data: sale, error: saleErr } = await supabase
    .from('sales')
    .insert({ client, total, method, status: 'completado', user_id: req.user.userId })
    .select().single();
  if (saleErr) return res.status(500).json({ error: saleErr.message });

  // Insertar items
  const saleItems = items.map(i => ({
    sale_id: sale.id, product_id: i.id || null,
    code: i.code, name: i.name,
    price: i.price, qty: i.qty,
    subtotal: i.price * i.qty
  }));
  const { error: itemErr } = await supabase.from('sale_items').insert(saleItems);
  if (itemErr) return res.status(500).json({ error: itemErr.message });

  // Actualizar stock
  for (const item of items) {
    if (item.id && item.unit !== 'serv') {
      await supabase.rpc('decrement_stock', { p_id: item.id, p_qty: item.qty })
        .catch(() => {});
    }
  }

  res.status(201).json(sale);
});

module.exports = router;
