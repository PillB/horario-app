/**
 * The proxy's database refusals (dbFailure), as the manager reads them. Only our own
 * trigger and constraint texts are recognised; any other database text stays a generic
 * 500 so schema names never reach the user (PR #62's error-leak rule). CHG-109 added
 * the CHECK roster_notified_needs_published (20261125000111_state_guards.sql).
 *
 * @jest-environment node
 */
type Failure = (context: string, error: { code?: string; message?: string } | null) => { status: number; body: { error?: string } };

let dbFailure: Failure;
beforeAll(() => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  jest.spyOn(console, 'error').mockImplementation(() => {});
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- load after env is set
  ({ dbFailure } = require('../../app/api/secure-proxy+api') as { dbFailure: Failure });
});
afterAll(() => jest.restoreAllMocks());

const answer = (code: string | undefined, message?: string) => {
  const r = dbFailure('test', { code, message });
  return { status: r.status, error: r.body.error };
};

describe('dbFailure', () => {
  it('turns the notified-needs-published CHECK into a sentence the manager can act on', () => {
    // The text Postgres 17 raises for the constraint (seen on the local database).
    expect(answer('23514', 'new row for relation "roster" violates check constraint "roster_notified_needs_published"')).toEqual({
      status: 409,
      error: 'Only a published shift can be marked as told. Publish it first',
    });
  });

  it('keeps any other CHECK violation a generic 500 that names nothing', () => {
    expect(answer('23514', 'new row for relation "roster" violates check constraint "roster_location_check"')).toEqual({
      status: 500,
      error: 'Database request failed',
    });
  });

  it('passes on only our own overlap sentences', () => {
    expect(answer('23P01', 'This person already has a shift on 2026-12-01 from 08:00 to 16:00')).toEqual({
      status: 409,
      error: 'This person already has a shift on 2026-12-01 from 08:00 to 16:00. Reload and try again',
    });
    expect(answer('23P01', 'conflicting key value violates exclusion constraint "x_excl"')).toEqual({ status: 409, error: 'Conflicting record' });
  });

  it('maps duplicates and references, and anything unknown to 500', () => {
    expect(answer('23505', 'dup')).toEqual({ status: 409, error: 'Conflicting record' });
    expect(answer('23503', 'fk')).toEqual({ status: 409, error: 'Record is still referenced' });
    expect(answer('08006', 'connection lost')).toEqual({ status: 500, error: 'Database request failed' });
    expect(answer(undefined)).toEqual({ status: 500, error: 'Database request failed' });
    expect(dbFailure('test', null).status).toBe(500);
  });
});
