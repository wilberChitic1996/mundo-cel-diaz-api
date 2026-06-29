// Provide minimal env vars so modules load without crashing
process.env.JWT_SECRET = 'test-secret-key';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_KEY = 'test-key';
process.env.RESEND_API_KEY = 're_test_mock';
// Las consultas de revocación/suscripción hacen fail-open ante una BD inalcanzable.
// En tests la BD no existe: un timeout corto evita esperar el default de prod (1500ms) por request.
process.env.DB_LOOKUP_TIMEOUT_MS = '50';
