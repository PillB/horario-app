/**
 * Labor-source drift monitor (CHG-103). Run with `npm run labor:drift`
 * (set HORARIO_DRIFT_LINKS=1 to also check every source link). The weekly
 * `labor-drift` workflow runs both and fails, with one line per item, when:
 *   - a pack was not re-checked against its sources within 90 days;
 *   - a dated value (a reform phase) takes effect within 60 days;
 *   - a source link answers 404 or 410.
 * It cannot read the law; it tells a person which sources to read and why.
 * See services/labor/sourceDrift.ts.
 *
 * It is a Jest file only to reuse the TypeScript and `@/` setup; the default
 * test match skips `.check.ts`, so `npm test` does not run it.
 *
 * @jest-environment node
 */
import { expect, it } from '@jest/globals';
import { PACKS } from '@/services/labor/packs';
import { classifyLink, driftReport, walkPack, type LinkStatus } from '@/services/labor/sourceDrift';

const out = (s: string) => process.stdout.write(`${s}\n`);
const today = (process.env.HORARIO_DRIFT_TODAY ?? new Date().toISOString()).slice(0, 10);
const checkLinks = process.env.HORARIO_DRIFT_LINKS === '1';

async function linkStatus(url: string): Promise<{ status: number | null; note: string }> {
  for (const method of ['HEAD', 'GET'] as const) {
    try {
      const res = await fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'labor-source-link-check' } });
      // Many servers refuse or mishandle HEAD (403, 404, 405, 503) but serve GET.
      if (method === 'HEAD' && !(res.status >= 200 && res.status < 400)) continue;
      return { status: res.status, note: `${method} ${res.status}` };
    } catch (e) {
      if (method === 'GET') return { status: null, note: String((e as Error).message ?? e) };
    }
  }
  return { status: null, note: 'no answer' };
}

it('labor sources: nothing due for review, no phase starting soon, no dead link', async () => {
  const report = driftReport(PACKS, today);
  out(`\nLabor-source drift check for ${today} (${Object.keys(PACKS).length} packs)\n`);
  const section = (title: string, items: string[], what: string) => {
    out(`${items.length ? '✗' : '✓'} ${title}: ${items.length}${items.length ? ` — ${what}` : ''}`);
    for (const i of items) out(`    ${i}`);
  };
  section('Packs due for review', report.dueForReview, 'read the primary sources again and update services/labor/sourceReview.ts');
  section('Phases taking effect soon', report.upcomingPhases, 'confirm each one in the official gazette before it applies');
  out(`ℹ High-confidence cites without a link (cannot be checked automatically): ${report.unlinkedHighConfidence.length}`);

  const dead: string[] = [];
  if (checkLinks) {
    const urls = new Map<string, string[]>();
    for (const [code, pack] of Object.entries(PACKS)) {
      for (const c of walkPack(code, pack).cites) if (c.cite.url) urls.set(c.cite.url, [...(urls.get(c.cite.url) ?? []), `${code} › ${c.path}`]);
    }
    const counts: Record<LinkStatus, number> = { ok: 0, blocked: 0, dead: 0, unreachable: 0 };
    for (const [url, refs] of urls) {
      const { status, note } = await linkStatus(url);
      const kind = classifyLink(status);
      counts[kind] += 1;
      if (kind === 'dead') dead.push(`${url} (${note}), used by ${refs.join(', ')}`);
      if (kind !== 'ok') out(`    ${kind.padEnd(11)} ${note.padEnd(10)} ${url}`);
    }
    section(`Dead source links (of ${urls.size}: ${counts.ok} ok, ${counts.blocked} refused automated clients, ${counts.unreachable} unreachable)`, dead, 'find where the text moved; the law may have been replaced');
  }
  out('');
  expect({ dueForReview: report.dueForReview, upcomingPhases: report.upcomingPhases, dead }).toEqual({ dueForReview: [], upcomingPhases: [], dead: [] });
}, 600_000);
