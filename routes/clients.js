const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// GET /api/clients — obtener todos
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    console.error('GET clients:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/clients — crear cliente
router.post('/', async (req, res) => {
  try {
    const { id, cliCode, name, dpi, phone, address, active, createdAt } = req.body;
    const { data, error } = await supabase
      .from('clients')
      .insert([{
        id: id,
        cli_code: cliCode,
        name: name,
        dpi: dpi || null,
        phone: phone || null,
        address: address || null,
        active: active !== false,
        created_at: createdAt || new Date().toISOString()
      }])
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error('POST clients:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/clients/:id — actualizar cliente
router.put('/:id', async (req, res) => {
  try {
    const { cliCode, name, dpi, phone, address, active } = req.body;
    const { data, error } = await supabase
      .from('clients')
      .update({
        cli_code: cliCode,
        name: name,
        dpi: dpi || null,
        phone: phone || null,
        address: address || null,
        active: active !== false,
        updated_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error('PUT clients:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/clients/:id — eliminar cliente
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('clients')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE clients:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
