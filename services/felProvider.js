// services/felProvider.js
// Adaptador PROVIDER-AGNOSTIC para Facturación Electrónica (FEL, SAT Guatemala).
//
// "El vagón": el sistema queda listo para anclar un certificador (INFILE / G4S / etc.).
// DORMIDO por defecto (FEL_ENABLED !== 'true'): no certifica nada y no afecta el flujo de
// venta. Para activar: ver el checklist FEL en CLAUDE.md (contratar certificador, env vars,
// correr la migración 017, y escribir el adapter concreto del proveedor elegido).
//
// Contrato que todo proveedor concreto debe implementar:
//   async emitDTE(dte) -> { uuid, serie, numero, fecha, xmlUrl?, pdfUrl? }   (o lanza Error)
//   (a futuro) async verifyStatus(uuid), async cancelDTE(uuid, motivo)
const logger = require('../utils/logger');

function isEnabled()    { return process.env.FEL_ENABLED === 'true'; }
function providerName() { return process.env.FEL_PROVIDER || 'stub'; }

// 'stub' = no-op por defecto: nunca certifica (el sistema corre sin proveedor real).
// Cuando se contrate un certificador, se agrega su adapter concreto en este mapa, p.ej.:
//   infile: require('./felProviders/infile'),
const providers = {
  stub: {
    async emitDTE() {
      throw new Error('FEL sin proveedor real conectado (stub). Configurá FEL_PROVIDER y su adapter.');
    },
  },
};

function getProvider() {
  var name = providerName();
  var p = providers[name];
  if (!p) { logger.warn({ provider: name }, '[FEL] proveedor desconocido — usando stub'); return providers.stub; }
  return p;
}

module.exports = { isEnabled, providerName, getProvider };
