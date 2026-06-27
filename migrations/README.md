# Migraciones de base de datos

## Historial

Los archivos `001_*.sql` a `007_*.sql` fueron aplicados **manualmente** en Supabase staging y producción. No deben ejecutarse de nuevo.

`node-pg-migrate` está configurado para ignorarlos con `ignore-pattern: ^00[0-7]_.*\.sql$`.

## Nuevas migraciones (008 en adelante)

A partir de la migración 008, usar el formato de `node-pg-migrate` con bloques `-- migrate:up` / `-- migrate:down`.

### Crear una nueva migración

```bash
npm run migrate:create -- nombre-descriptivo
```

Esto genera un archivo con timestamp en `migrations/`. Editar el archivo y agregar el SQL en las secciones `up` y `down`.

### Aplicar migraciones pendientes

```bash
DATABASE_URL=postgresql://user:pass@host:5432/dbname npm run migrate:up
```

### Revertir la última migración

```bash
DATABASE_URL=postgresql://user:pass@host:5432/dbname npm run migrate:down
```

## Regla de dos ambientes

1. Aplicar primero en **Supabase staging** (`aawjhttlaydwsipsifre`)
2. Validar en el piloto (`mundo-cel-diaz-staging.vercel.app`)
3. Aplicar en **Supabase producción** (`rhecnmfivygkayfvauxt`)

Nunca aplicar directamente en producción sin validar en staging.
