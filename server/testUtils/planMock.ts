/**
 * For proxy tests that replace Supabase with a fake query builder: answers the
 * plan lookups (server/plans.ts) so the test's own recordings only hold the
 * queries of the action under test.
 */
export const PLAN_TABLES = new Set(['account_entitlements', 'subscriptions']);

const CHAIN = ['select', 'eq', 'is', 'order', 'limit', 'insert', 'update', 'maybeSingle', 'single'];

/** A builder that answers "this account is on Pro, without an end date". */
export function planTableBuilder(table: string, plan: 'gratis' | 'esencial' | 'pro' = 'pro'): Record<string, unknown> {
  const rows =
    table === 'account_entitlements'
      ? [
          {
            id: '00000000-0000-4000-8000-000000000001',
            account_id: 'test',
            plan: 'pro',
            source: 'trial',
            starts_at: '2020-01-01T00:00:00Z',
            // An expired trial: the account already had one.
            ends_at: '2020-01-15T00:00:00Z',
            location_quota: null,
            granted_by: 'system',
            reason: null,
            revoked_at: null,
            revoked_by: null,
            created_at: '2020-01-01T00:00:00Z',
          },
          ...(plan === 'gratis'
            ? []
            : [
                {
                  id: '00000000-0000-4000-8000-000000000002',
                  account_id: 'test',
                  plan,
                  source: 'comp',
                  starts_at: '2020-01-01T00:00:00Z',
                  ends_at: null,
                  location_quota: null,
                  granted_by: 'test',
                  reason: 'test',
                  revoked_at: null,
                  revoked_by: null,
                  created_at: '2020-01-01T00:00:00Z',
                },
              ]),
        ]
      : null;
  const builder: Record<string, unknown> = {};
  for (const method of CHAIN) builder[method] = () => builder;
  builder.then = (resolve: (r: { data: unknown; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve);
  return builder;
}
