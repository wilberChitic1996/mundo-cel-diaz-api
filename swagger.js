const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi    = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'PraxisGT API',
      version: '2.2.0',
      description: 'API de gestión empresarial para Guatemala — Sistema multi-tenant POS/ERP',
      contact: { name: 'Soporte PraxisGT' },
    },
    servers: [
      { url: 'https://mundo-cel-diaz-api-production.up.railway.app/api', description: 'Producción' },
      { url: 'https://mundo-cel-diaz-api-production-e546.up.railway.app/api', description: 'Staging (Piloto)' },
      { url: 'http://localhost:4000/api', description: 'Local' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT obtenido en POST /auth/login. Expira en 8h.',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string', example: 'Mensaje de error' },
          },
        },
        LoginRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email:    { type: 'string', format: 'email', example: 'admin@demo.com' },
            password: { type: 'string', format: 'password', example: 'Admin2026!' },
          },
        },
        LoginResponse: {
          type: 'object',
          properties: {
            token:        { type: 'string', description: 'JWT de acceso (8h)' },
            refreshToken: { type: 'string', description: 'Token de renovación (30 días)' },
            user: {
              type: 'object',
              properties: {
                id:        { type: 'string', format: 'uuid' },
                name:      { type: 'string' },
                email:     { type: 'string' },
                role:      { type: 'string', enum: ['superadmin', 'admin', 'cajero', 'auditor'] },
                tenant_id: { type: 'string', format: 'uuid', nullable: true },
              },
            },
          },
        },
        Product: {
          type: 'object',
          properties: {
            id:          { type: 'string', format: 'uuid' },
            tenant_id:   { type: 'string', format: 'uuid' },
            name:        { type: 'string' },
            sku:         { type: 'string', nullable: true },
            price:       { type: 'number', format: 'float' },
            cost:        { type: 'number', format: 'float', nullable: true },
            stock:       { type: 'integer' },
            category_id: { type: 'string', format: 'uuid', nullable: true },
            active:      { type: 'boolean' },
            created_at:  { type: 'string', format: 'date-time' },
          },
        },
        Sale: {
          type: 'object',
          properties: {
            id:         { type: 'string', format: 'uuid' },
            tenant_id:  { type: 'string', format: 'uuid' },
            client:     { type: 'string' },
            total:      { type: 'number', format: 'float' },
            method:     { type: 'string', enum: ['Efectivo', 'Tarjeta', 'Transferencia', 'Crédito'] },
            items:      { type: 'array', items: { type: 'object' } },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        Client: {
          type: 'object',
          properties: {
            id:        { type: 'string', format: 'uuid' },
            tenant_id: { type: 'string', format: 'uuid' },
            name:      { type: 'string' },
            phone:     { type: 'string', nullable: true },
            email:     { type: 'string', nullable: true },
            dpi:       { type: 'string', nullable: true },
            notes:     { type: 'string', nullable: true },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Auth',       description: 'Autenticación y gestión de sesión' },
      { name: 'Products',   description: 'Catálogo de productos' },
      { name: 'Sales',      description: 'Ventas (POS)' },
      { name: 'Accounts',   description: 'Cuentas por cobrar (crédito)' },
      { name: 'Returns',    description: 'Devoluciones' },
      { name: 'Defectives', description: 'Productos defectuosos' },
      { name: 'Clients',    description: 'Clientes' },
      { name: 'Repairs',    description: 'Reparaciones' },
      { name: 'Warranties', description: 'Garantías' },
      { name: 'Caja',       description: 'Sesiones de caja / cortes' },
      { name: 'Settings',   description: 'Configuración del negocio' },
      { name: 'Suppliers',  description: 'Proveedores' },
      { name: 'Categories', description: 'Categorías de productos' },
      { name: 'Locations',  description: 'Ubicaciones / secciones de inventario' },
      { name: 'Users',      description: 'Usuarios del sistema' },
      { name: 'Audit',      description: 'Registro de auditoría' },
      { name: 'Admin',      description: 'Super Admin — gestión de tenants' },
      { name: 'Public',     description: 'Endpoints públicos (sin autenticación)' },
    ],
  },
  apis: ['./routes/*.js'],
};

const spec = swaggerJsdoc(options);

function setupSwagger(app) {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec, {
    customSiteTitle: 'PraxisGT API Docs',
    swaggerOptions: { persistAuthorization: true },
  }));
  app.get('/api-docs.json', function(_req, res) { res.json(spec); });
}

module.exports = { setupSwagger, spec };
