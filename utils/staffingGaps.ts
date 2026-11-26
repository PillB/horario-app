/**
 * Staffing gaps: one rule for Home, the Scheduler and Analytics (CHG-109).
 *
 * - Only stored demand overrides count. A model forecast that is only in
 *   memory (the Scheduler after "Run forecast") is a suggestion, not demand,
 *   and Home / Analytics never see it.
 * - Only Published roster rows count. A draft has not been told to anyone.
 * - One roster row is one person in one position. The template's `coverage`
 *   is how many people the template needs, not how many one row supplies.
 * - Counted per (date, role), so extra people on one day do not hide a gap
 *   on another day or in another role.
 */

export type GapTarget = { date: string; role: string; required: number; source?: string };
export type GapShift = { date: string; templateId: string; status: string };
export type GapTemplate = { id: string; role: string };

export type TargetCoverage<T extends GapTarget> = T & { scheduled: number; gap: number };

const slotKey = (date: string, role: string) => `${date}::${role}`;

/** Published people per date and role. Rows whose template is unknown count nowhere. */
export function publishedByDateRole(shifts: readonly GapShift[], templates: readonly GapTemplate[]): Map<string, number> {
  const roleOf = new Map(templates.map((t) => [t.id, t.role]));
  const counts = new Map<string, number>();
  for (const shift of shifts) {
    if (shift.status !== 'Published') continue;
    const role = roleOf.get(shift.templateId);
    if (role === undefined) continue;
    const key = slotKey(shift.date, role);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Every stored (override) target with its published people and open positions (never negative). */
export function coverageByTarget<T extends GapTarget>(
  targets: readonly T[],
  shifts: readonly GapShift[],
  templates: readonly GapTemplate[],
): TargetCoverage<T>[] {
  const scheduledBy = publishedByDateRole(shifts, templates);
  return targets
    .filter((target) => target.source === undefined || target.source === 'override')
    .map((target) => {
      const scheduled = scheduledBy.get(slotKey(target.date, target.role)) ?? 0;
      return { ...target, scheduled, gap: Math.max(0, target.required - scheduled) };
    });
}

/** The targets that still have open positions. */
export function computeStaffingGaps<T extends GapTarget>(
  targets: readonly T[],
  shifts: readonly GapShift[],
  templates: readonly GapTemplate[],
): TargetCoverage<T>[] {
  return coverageByTarget(targets, shifts, templates).filter((t) => t.gap > 0);
}
