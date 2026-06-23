// Shared Supabase mock: a chainable query builder that resolves immediately
export function makeMockSupabase(defaultRows = []) {
  let _rows = defaultRows;
  let _single = false;
  let _eqCalls = [];

  const q = {
    _getEqCalls: () => _eqCalls,
    select:  () => q,
    eq:      (col, val) => { _eqCalls.push([col, val]); return q; },
    order:   () => q,
    limit:   () => q,
    insert:  () => q,
    update:  () => q,
    delete:  () => q,
    single:  () => Promise.resolve({ data: _rows[0] || null, error: null }),
    then:    (cb) => Promise.resolve({ data: _rows, error: null }).then(cb),
    catch:   (cb) => Promise.resolve({ data: _rows, error: null }),
  };

  const client = {
    from: () => { _eqCalls = []; return q; },
    rpc:  () => Promise.resolve({ data: 'GENERATED-CODE', error: null }),
  };

  return { client, q, getEqCalls: () => _eqCalls };
}
