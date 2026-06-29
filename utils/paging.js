// utils/paging.js
// Paginación OPCIONAL y retrocompatible para listados (A14).
// Si la query no trae page/limit → hasPaging=false → el endpoint devuelve todo como hoy
// (cero cambio para el frontend actual). Si trae page o limit → se pagina con .range().
//
// limit acotado a [1, 200] (evita pedir toda la tabla); page mínimo 1; basura → defaults.
function parsePaging(query, defaultLimit) {
  query = query || {};
  var hasPaging = query.page !== undefined || query.limit !== undefined;
  var page  = Math.max(1, parseInt(query.page, 10) || 1);
  var limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || defaultLimit || 50));
  var from  = (page - 1) * limit;
  return { hasPaging: hasPaging, page: page, limit: limit, from: from, to: from + limit - 1 };
}

module.exports = { parsePaging };
