// middleware/requireRole.js
// Autorización por rol a nivel de endpoint. Debe usarse SIEMPRE después del
// middleware `auth` (que inyecta req.user desde el JWT).
//
// `superadmin` siempre pasa (acceso total al SaaS), de forma coherente con
// withTenant(), que tampoco filtra por tenant para ese rol.
//
// Uso:  router.post('/', auth, requireRole('admin', 'cajero'), handler)
module.exports = function requireRole(...roles) {
  return function (req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    if (req.user.role === 'superadmin' || roles.includes(req.user.role)) return next();
    return res.status(403).json({ error: 'Sin permisos' });
  };
};
