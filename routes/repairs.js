const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// GET /api/repairs — obtener todas las reparaciones
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('repairs')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    console.error('GET repairs:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/repairs — crear orden de reparación
router.post('/', async (req, res) => {
  try {
    const {
      id, repCode, clientId, clientName, clientPhone, clientCli,
      brand, model, imei, problemDesc, diagnosis, techName,
      estimatedCost, promisedDate, internalNote, status,
      registradoPor, parts, createdAt
    } = req.body;

    const { data, error } = await supabase
      .from('repairs')
      .insert([{
        id: id,
        rep_code: repCode,
        client_id: clientId || null,
        client_name: clientName,
        client_phone: clientPhone || null,
        client_cli: clientCli || null,
        brand: brand,
        model: model,
        imei: imei || null,
        problem_desc: problemDesc,
        diagnosis: diagnosis || null,
        tech_name: techName || null,
        estimated_cost: estimatedCost || 0,
        promised_date: promisedDate || null,
        internal_note: internalNote || null,
        status: status || 'recibido',
        registrado_por: registradoPor || {},
        parts: parts || [],
        created_at: createdAt || new Date().toISOString()
      }])
      .select()
      .single();
    if (error) throw error;
    res.json(normalizeRepair(data));
  } catch (e) {
    console.error('POST repairs:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/repairs/:id/status — actualizar estado
router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const { data, error } = await supabase
      .from('repairs')
      .update({ status: status, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(normalizeRepair(data));
  } catch (e) {
    console.error('PUT repairs status:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/repairs/:id — actualizar reparación completa
router.put('/:id', async (req, res) => {
  try {
    const {
      clientId, clientName, clientPhone, clientCli,
      brand, model, imei, problemDesc, diagnosis, techName,
      estimatedCost, promisedDate, internalNote, status, parts
    } = req.body;

    const { data, error } = await supabase
      .from('repairs')
      .update({
        client_id: clientId || null,
        client_name: clientName,
        client_phone: clientPhone || null,
        client_cli: clientCli || null,
        brand: brand,
        model: model,
        imei: imei || null,
        problem_desc: problemDesc,
        diagnosis: diagnosis || null,
        tech_name: techName || null,
        estimated_cost: estimatedCost || 0,
        promised_date: promisedDate || null,
        internal_note: internalNote || null,
        status: status,
        parts: parts || [],
        updated_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(normalizeRepair(data));
  } catch (e) {
    console.error('PUT repairs:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/repairs/:id
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('repairs')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE repairs:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Normaliza los nombres snake_case → camelCase para el frontend
function normalizeRepair(r) {
  if (!r) return r;
  return {
    id: r.id,
    repCode: r.rep_code,
    clientId: r.client_id,
    clientName: r.client_name,
    clientPhone: r.client_phone,
    clientCli: r.client_cli,
    brand: r.brand,
    model: r.model,
    imei: r.imei,
    problemDesc: r.problem_desc,
    diagnosis: r.diagnosis,
    techName: r.tech_name,
    estimatedCost: Number(r.estimated_cost || 0),
    promisedDate: r.promised_date,
    internalNote: r.internal_note,
    status: r.status,
    registradoPor: r.registrado_por || {},
    parts: r.parts || [],
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

module.exports = router;
