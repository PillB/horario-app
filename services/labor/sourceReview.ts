/**
 * When each rule pack was last checked against its sources, and by which
 * record (CHG-103). The labor-drift monitor (`npm run labor:drift`, weekly
 * workflow) uses it to say which packs are due for a new check and which
 * dated phases take effect soon.
 *
 * The dates are those of the QA records that checked the pack, not of the
 * last code change: a value edited without a new check keeps its old date.
 * When you re-check a pack against its primary sources, update its entry in
 * the same commit and name the record (a file in qa/ or research/).
 */
import type { DateKey } from './types';

export type PackReview = { reviewedOn: DateKey; record: string };

const GOLDEN = 'qa/labor-rules-golden.md (checked 2026-10-18)';
const AUDIT = 'qa/research-audit-2026-10-28.md';
const OPEN_ITEMS = 'qa/labor-rules-golden.md §21a, §21b, §23 and qa/redteam-app-walkthrough-2026-10-28.md (CHG-099, 2026-11-11)';

const golden = (): PackReview => ({ reviewedOn: '2026-10-18', record: GOLDEN });
const audited = (): PackReview => ({ reviewedOn: '2026-10-28', record: AUDIT });
const openItems = (): PackReview => ({ reviewedOn: '2026-11-11', record: OPEN_ITEMS });

export const PACK_REVIEWS: Readonly<Record<string, PackReview>> = {
  US: golden(), 'US-CA': golden(), 'US-NY': golden(), 'US-NY-NYC': golden(), 'US-OR': golden(),
  'US-WA': openItems(), 'US-WA-SEATTLE': openItems(), 'US-IL': openItems(),
  'US-IL-CHICAGO': audited(), 'US-IL-EVANSTON': audited(), 'US-PA-PHILADELPHIA': audited(),
  'US-CA-LA': golden(), 'US-CA-SF': golden(), 'US-CA-BERKELEY': golden(), 'US-CA-EMERYVILLE': golden(),
  CA: audited(), 'CA-ON': golden(), 'CA-BC': openItems(), 'CA-AB': openItems(), 'CA-OTHER': audited(), 'CA-QC': golden(),
  PE: audited(), MX: openItems(), CO: audited(), CL: golden(), BR: audited(), AR: golden(),
  EU: golden(), ES: golden(), FR: audited(), DE: golden(), IT: golden(), PT: golden(), NL: golden(),
  BE: golden(), IE: golden(), PL: openItems(), GB: golden(), AU: golden(), GENERIC: golden(),
};

/**
 * A person checked, close to its start date, that a dated phase still takes
 * effect as encoded (the gazette, the consolidated text, no suspension).
 * The monitor stops asking about a phase once it has a confirmation made in
 * the UPCOMING_PHASE_DAYS before `from`; an older one does not count,
 * because a reform can be amended between publication and its start.
 */
export type PhaseConfirmation = { pack: string; path: string; from: DateKey; confirmedOn: DateKey; record: string };

export const PHASE_CONFIRMATIONS: readonly PhaseConfirmation[] = [];
