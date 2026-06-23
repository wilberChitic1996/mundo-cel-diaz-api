// Manual mock for supabase — used when vi.mock('../supabase') is called
let _eqCalls = [];

const makeChain = () => {
  const q = {
    select:  () => q,
    eq:      (col, val) => { _eqCalls.push([col, val]); return q; },
    order:   () => q,
    limit:   () => q,
    single:  () => Promise.resolve({ data: null, error: null }),
    insert:  () => q,
    update:  () => q,
    delete:  () => q,
    then:    (cb) => Promise.resolve({ data: [], error: null }).then(cb),
  };
  return q;
};

const mockSupabase = {
  from: () => { _eqCalls = []; return makeChain(); },
  rpc:  () => Promise.resolve({ data: 'PROD-001', error: null }),
  _getEqCalls: () => _eqCalls,
};

module.exports = mockSupabase;
