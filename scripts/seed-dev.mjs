#!/usr/bin/env node
/**
 * Seeds the DEV cloud environment with two isolated test tenants for QA and
 * red-team checks, and prints every id it created as JSON.
 *
 *   Tenant A: personal account of user A (account id = user A's Clerk id)
 *   Tenant B: Clerk organization owned by user B (account id = org id)
 *   User C:   signed-in user with no data and no organization
 *
 * Each tenant gets 4 workers, weekly availability, 3 shift templates (one
 * overnight), one week of roster and demand targets. Re-running is safe: ids
 * are deterministic and rows are upserted.
 *
 * Required env:
 *   SUPABASE_URL                 dev project URL
 *   SUPABASE_SERVICE_ROLE_KEY    dev project service/secret key
 *   CLERK_SECRET_KEY             Clerk DEV instance secret (sk_test_...)
 *   QA_PASSWORD                  password for the three test users
 * Optional env:
 *   QA_EMAIL_DOMAIN              default example.com (Clerk "+clerk_test" emails)
 *   SEED_WEEK_START              Monday YYYY-MM-DD, default next Monday
 *
 * Refuses to run against a Clerk production key or a project whose URL
 * contains "prod".
 */
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const env = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    console.error(`Missing required env var ${name}`);
    process.exit(1);
  }
  return value;
};

const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const CLERK_SECRET_KEY = env('CLERK_SECRET_KEY');
const QA_PASSWORD = env('QA_PASSWORD');
const EMAIL_DOMAIN = env('QA_EMAIL_DOMAIN', 'example.com');

if (!CLERK_SECRET_KEY.startsWith('sk_test_')) {
  console.error('Refusing to seed: CLERK_SECRET_KEY is not a development (sk_test_) key.');
  process.exit(1);
}
if (/prod/i.test(SUPABASE_URL)) {
  console.error('Refusing to seed: SUPABASE_URL looks like a production project.');
  process.exit(1);
}

// ── Clerk Backend API ────────────────────────────────────────────────────────

const clerk = async (method, path, body) => {
  const res = await fetch(`https://api.clerk.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Clerk ${method} ${path} failed (${res.status}): ${JSON.stringify(json.errors ?? json)}`);
  return json;
};

async function ensureUser(label) {
  // "+clerk_test" addresses are Clerk test emails: no real mail is sent and
  // the verification code is always 424242 in development instances.
  const email = `horario-qa-${label}+clerk_test@${EMAIL_DOMAIN}`;
  const found = await clerk('GET', `/users?email_address=${encodeURIComponent(email)}`);
  if (found.length) return { id: found[0].id, email };
  const created = await clerk('POST', '/users', {
    email_address: [email],
    password: QA_PASSWORD,
    first_name: 'QA',
    last_name: label.toUpperCase(),
  });
  return { id: created.id, email };
}

async function ensureOrg(name, ownerId) {
  const found = await clerk('GET', `/organizations?query=${encodeURIComponent(name)}&limit=10`);
  const existing = (found.data ?? []).find((o) => o.name === name);
  if (existing) return existing.id;
  const created = await clerk('POST', '/organizations', { name, created_by: ownerId });
  return created.id;
}

// ── Data ─────────────────────────────────────────────────────────────────────

/** Deterministic UUID (v5-style layout) so re-runs upsert the same rows. */
const uuidFor = (...parts) => {
  const h = createHash('sha1').update(parts.join('|')).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const nextMonday = () => {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
};
const WEEK_START = process.env.SEED_WEEK_START ?? nextMonday();
const addDays = (key, n) => {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function tenantData(accountId, tag) {
  const workers = [
    ['Ana', 'Barista'], ['Bruno', 'Barista'], ['Carla', 'Cook'], ['Diego', 'Cook'],
  ].map(([name, role]) => ({ id: uuidFor(accountId, 'worker', name), account_id: accountId, name: `${name} ${tag}`, role, skills: [] }));

  const templates = [
    ['Morning bar', 'Barista', '07:00', '15:00', 1],
    ['Evening kitchen', 'Cook', '15:00', '23:00', 1],
    ['Night kitchen', 'Cook', '22:00', '06:00', 1],
  ].map(([name, role, start, end, coverage]) => ({
    id: uuidFor(accountId, 'template', name), account_id: accountId, name, role, start_time: start, end_time: end, coverage,
  }));

  const availability = workers.flatMap((w) =>
    DAYS.slice(0, 6).map((day) => ({
      id: uuidFor(accountId, 'availability', w.id, day),
      account_id: accountId,
      worker_id: w.id,
      day_of_week: day,
      from_time: w.role === 'Cook' && w.name.startsWith('Diego') ? '21:00' : '06:00',
      to_time: w.role === 'Cook' && w.name.startsWith('Diego') ? '07:00' : '23:30',
    })),
  );

  const roster = DAYS.slice(0, 5).flatMap((_, i) => {
    const date = addDays(WEEK_START, i);
    return [
      { id: uuidFor(accountId, 'roster', date, 'bar'), account_id: accountId, date, worker_id: workers[i % 2].id, template_id: templates[0].id, status: 'Draft' },
      { id: uuidFor(accountId, 'roster', date, 'kitchen'), account_id: accountId, date, worker_id: workers[2].id, template_id: templates[1].id, status: 'Draft' },
    ];
  });

  const targets = DAYS.map((_, i) => addDays(WEEK_START, i)).flatMap((date) => [
    { account_id: accountId, date, role: 'Barista', required: 2, source: 'override' },
    { account_id: accountId, date, role: 'Cook', required: 2, source: 'override' },
  ]);

  return { workers, templates, availability, roster, targets };
}

async function writeTenant(db, accountId, tag) {
  const data = tenantData(accountId, tag);
  const steps = [
    ['workers', data.workers, 'id'],
    ['shift_templates', data.templates, 'id'],
    ['worker_availability', data.availability, 'id'],
    ['roster', data.roster, 'id'],
    ['demand_targets', data.targets, 'account_id,date,role'],
  ];
  for (const [table, rows, onConflict] of steps) {
    const { error } = await db.from(table).upsert(rows, { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  return {
    accountId,
    workerIds: data.workers.map((w) => w.id),
    templateIds: data.templates.map((t) => t.id),
    availabilityIds: data.availability.map((a) => a.id),
    rosterIds: data.roster.map((r) => r.id),
  };
}

const userA = await ensureUser('a');
const userB = await ensureUser('b');
const userC = await ensureUser('c');
const orgB = await ensureOrg('Horario QA Tenant B', userB.id);

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const tenantA = await writeTenant(db, userA.id, 'A');
const tenantB = await writeTenant(db, orgB, 'B');

console.log(JSON.stringify({
  weekStart: WEEK_START,
  users: {
    a: { ...userA, tenant: 'A (personal account)' },
    b: { ...userB, tenant: 'B (organization owner)', orgId: orgB },
    c: { ...userC, tenant: 'none' },
  },
  tenantA,
  tenantB,
}, null, 2));
