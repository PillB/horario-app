/**
 * The batch insert's refusals (addRosterShifts), as the manager reads them
 * (CHG-103). The mapping moved into a lookup table to keep addRosterShifts
 * under the complexity ceiling after #62; these pin each sentence, and that
 * only the overlap trigger's own text is passed on (PR #62's error-leak rule).
 *
 * @jest-environment node
 */
type Failure = (error: { code?: string; message?: string }) => { status: number; body: { error?: string } };

let addRosterShiftsFailure: Failure;
beforeAll(() => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  jest.spyOn(console, 'error').mockImplementation(() => {});
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- load after env is set
  ({ addRosterShiftsFailure } = require('../../app/api/secure-proxy+api') as { addRosterShiftsFailure: Failure });
});
afterAll(() => jest.restoreAllMocks());

const answer = (code: string, message?: string) => {
  const r = addRosterShiftsFailure({ code, message });
  return { status: r.status, error: r.body.error };
};

describe('addRosterShifts refusals', () => {
  it('a slot already taken is 409 and says nothing was added', () => {
    expect(answer('23505', 'duplicate key value violates unique constraint "roster_account_slot_key"')).toEqual({
      status: 409, error: 'One of these shifts is already on the roster. Nothing was added. Reload and try again',
    });
  });

  it("an overlap passes on the trigger's own sentence, which names the clash", () => {
    expect(answer('23P01', 'This person already has a shift on 2026-12-01 from 06:00 to 14:00')).toEqual({
      status: 409, error: 'This person already has a shift on 2026-12-01 from 06:00 to 14:00. Nothing was added. Reload and run auto-assign again',
    });
  });

  it('any other 23P01 text (it names schema objects) is replaced by a plain sentence', () => {
    expect(answer('23P01', 'conflicting key value violates exclusion constraint "private_roster_excl"').error).toBe(
      'One of these shifts overlaps another shift of the same person. Nothing was added. Reload and run auto-assign again',
    );
  });

  it('a deleted worker or template is 409', () => {
    expect(answer('23503')).toEqual({ status: 409, error: 'Something these shifts refer to was just deleted. Nothing was added. Reload and try again' });
  });

  it('any other database error is a 500 without its text', () => {
    const r = answer('42501', 'permission denied for schema private');
    expect(r.status).toBe(500);
    expect(r.error).not.toContain('private');
  });
});
