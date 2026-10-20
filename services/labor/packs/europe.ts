/**
 * Rule packs: EU Working Time Directive floor, EU member states with their own
 * pack, the UK, Australia, and the generic fallback. Sources: QA's golden file
 * (qa/labor-rules-golden.md) and research/labor-rules/europe.md, checked
 * 2026-10-18. Sector agreements (convenios, cao, CCNL, awards) often change
 * these values; businesses record those as per-location overrides.
 */
import type { RulePack } from '../types';

const WTD = 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32003L0088';
const ET = 'https://www.boe.es/buscar/act.php?id=BOE-A-2015-11430';
const ARBZG = 'https://www.gesetze-im-internet.de/arbzg/BJNR117100994.html';
const JARBSCHG = 'https://www.gesetze-im-internet.de/jarbschg/BJNR009650976.html';
const OWTA = 'https://revisedacts.lawreform.ie/eli/1997/act/20/revised/en/html';

const HOSPITALITY = ['food_service', 'fast_food', 'full_service_restaurant', 'hospitality', 'hotel'] as const;

export const EUROPE: Record<string, RulePack> = {
  EU: {
    code: 'EU',
    currency: 'EUR',
    baselineOnly: 'Only the EU Working Time Directive floor is applied for this country. National law and sector agreements may be stricter; review them.',
    restBetweenShifts: { minHours: 11, cite: { source: 'Directive 2003/88/EC art. 3', url: WTD, confidence: 'high' } },
    breaks: { triggers: [{ afterHours: 6, minMinutes: 15 }], verdict: 'warning', cite: { source: 'Directive 2003/88/EC art. 4 (length set nationally)', url: WTD, confidence: 'high' } },
    weeklyRest: { minHours: 35, cite: { source: 'Directive 2003/88/EC art. 5 (24 h + 11 h)', url: WTD, confidence: 'high' } },
    averageWeeklyMax: [{ hours: 48, weeks: 17, optOutAllowed: true, cite: { source: 'Directive 2003/88/EC arts. 6, 16, 22', url: WTD, confidence: 'high' } }],
    nightWorker: { averageDailyHours: 8, referenceDays: 119, cite: { source: 'Directive 2003/88/EC art. 8', url: WTD, confidence: 'high' } },
  },
  ES: {
    code: 'ES',
    currency: 'EUR',
    baselineOnly: undefined,
    restBetweenShifts: { minHours: 12, cite: { source: 'Estatuto de los Trabajadores art. 34.3', url: ET, confidence: 'high' } },
    dailyOrdinaryMax: { hours: 9, excess: 'violation', cite: { source: 'Estatuto de los Trabajadores art. 34.3 (unless a convenio redistributes)', url: ET, confidence: 'high' } },
    breaks: { triggers: [{ afterHours: 6, minMinutes: 15 }], cite: { source: 'Estatuto de los Trabajadores art. 34.4', url: ET, confidence: 'high' } },
    weeklyRest: { minHours: 36, verdict: 'warning', cite: { source: 'Estatuto de los Trabajadores art. 37.1 (1.5 days; may be accumulated over 14 days)', url: ET, confidence: 'high' } },
    night: { window: ['22:00', '06:00'], cite: { source: 'Estatuto de los Trabajadores art. 36.1', url: ET, confidence: 'high' } },
    nightWorker: { averageDailyHours: 8, referenceDays: 15, noOvertime: true, cite: { source: 'Estatuto de los Trabajadores art. 36.1', url: ET, confidence: 'high' } },
    minors: [
      {
        ageFrom: 0, ageTo: 17, maxDailyHours: 8, bannedWindows: [['22:00', '06:00']], noOvertime: true, weeklyRestHours: 48,
        breaks: [{ afterHours: 4.5, minMinutes: 30 }],
        cite: { source: 'Estatuto de los Trabajadores arts. 6, 34.3-34.4, 37.1', url: ET, confidence: 'high' },
      },
    ],
  },
  FR: {
    code: 'FR',
    currency: 'EUR',
    baselineOnly: undefined,
    restBetweenShifts: { minHours: 11, cite: { source: 'Code du travail L3131-1', url: 'https://code.travail.gouv.fr/themes/repos-quotidien-et-hebdomadaire', confidence: 'medium' } },
    dailyTotalMax: { hours: 10, cite: { source: 'Code du travail L3121-18 (12 h by agreement)', url: 'https://code.travail.gouv.fr/code-du-travail/l3121-18', confidence: 'high' } },
    weeklyOrdinaryMax: { hours: 35, cite: { source: 'Code du travail L3121-27 (hours above 35 are heures supplémentaires)', confidence: 'high' } },
    weeklyMax: { hours: 48, cite: { source: 'Code du travail L3121-20', url: 'https://code.travail.gouv.fr/code-du-travail/l3121-20', confidence: 'high' } },
    averageWeeklyMax: [{ hours: 44, weeks: 12, cite: { source: 'Code du travail L3121-22 (46 h by agreement)', url: 'https://code.travail.gouv.fr/code-du-travail/l3121-22', confidence: 'high' } }],
    breaks: { triggers: [{ afterHours: 6, inclusive: true, minMinutes: 20 }], cite: { source: 'Code du travail L3121-16', url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F1911', confidence: 'high' } },
    weeklyRest: { minHours: 35, cite: { source: 'Code du travail L3132-2', confidence: 'medium' } },
    night: { window: ['21:00', '06:00'], cite: { source: 'Code du travail L3122-2 (without an agreement)', url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F2212', confidence: 'high' } },
    minors: [
      {
        ageFrom: 0, ageTo: 15, maxDailyHours: 7, minRestHours: 14, bannedWindows: [['20:00', '06:00']],
        cite: { source: 'Code du travail L3162-1, L3163, L3164', url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F2216', confidence: 'high' },
      },
      {
        ageFrom: 16, ageTo: 17, maxDailyHours: 8, maxWeeklyHours: 35, minRestHours: 12, bannedWindows: [['22:00', '06:00']],
        breaks: [{ afterHours: 4.5, minMinutes: 30 }],
        cite: { source: 'Code du travail L3162-1 to -3, L3163, L3164', url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F2216', confidence: 'high' },
      },
    ],
  },
  DE: {
    code: 'DE',
    currency: 'EUR',
    baselineOnly: undefined,
    restBetweenShifts: { minHours: 11, cite: { source: 'ArbZG §5(1)', url: ARBZG, confidence: 'high' } },
    // 8 h, extendable to 10 h when the average stays at 8 h per working day
    // (48 h per 6-day week) over 24 weeks.
    dailyTotalMax: { hours: 10, cite: { source: 'ArbZG §3', url: ARBZG, confidence: 'high' } },
    averageWeeklyMax: [{ hours: 48, weeks: 24, cite: { source: 'ArbZG §3 (8 h per working day over 24 weeks)', url: ARBZG, confidence: 'high' } }],
    breaks: {
      triggers: [{ afterHours: 6, minMinutes: 30 }, { afterHours: 9, minMinutes: 45 }], minBlockMinutes: 15,
      cite: { source: 'ArbZG §4', url: ARBZG, confidence: 'high' },
    },
    weeklyRest: { minHours: 35, cite: { source: 'Directive 2003/88/EC art. 5 (ArbZG §9 Sunday rest)', url: WTD, confidence: 'medium' } },
    night: { window: ['23:00', '06:00'], cite: { source: 'ArbZG §2(3)', url: ARBZG, confidence: 'high' } },
    nightWorker: { averageDailyHours: 8, referenceDays: 28, cite: { source: 'ArbZG §6(2)', url: ARBZG, confidence: 'high' } },
    minors: [
      {
        ageFrom: 15, ageTo: 17, maxDailyHours: 8, maxWeeklyHours: 40, minRestHours: 12,
        allowedWindow: ['06:00', '20:00'],
        industryAllowedWindows: [{ industries: [...HOSPITALITY], window: ['06:00', '22:00'] }],
        breaks: [{ afterHours: 4.5, minMinutes: 30 }, { afterHours: 6, minMinutes: 60 }],
        cite: { source: 'JArbSchG §§8, 11, 13, 14', url: JARBSCHG, confidence: 'high' },
      },
    ],
  },
  IT: {
    code: 'IT',
    currency: 'EUR',
    baselineOnly: undefined,
    restBetweenShifts: { minHours: 11, cite: { source: 'D.Lgs. 66/2003 art. 7', confidence: 'medium' } },
    weeklyOrdinaryMax: { hours: 40, cite: { source: 'D.Lgs. 66/2003 art. 3', confidence: 'medium' } },
    averageWeeklyMax: [{ hours: 48, weeks: 17, cite: { source: 'D.Lgs. 66/2003 art. 4 (4 months)', confidence: 'medium' } }],
    breaks: { triggers: [{ afterHours: 6, minMinutes: 10 }], cite: { source: 'D.Lgs. 66/2003 art. 8', confidence: 'medium' } },
    weeklyRest: { minHours: 24, cite: { source: 'D.Lgs. 66/2003 art. 9', confidence: 'medium' } },
    nightWorker: { averageDailyHours: 8, referenceDays: 1, cite: { source: 'D.Lgs. 66/2003 art. 13', confidence: 'medium' } },
  },
  PT: {
    code: 'PT',
    currency: 'EUR',
    baselineOnly: 'Portugal rules come from secondary copies of the Código do Trabalho; review them with your adviser.',
    restBetweenShifts: { minHours: 11, cite: { source: 'Código do Trabalho art. 214', confidence: 'medium' } },
    dailyOrdinaryMax: { hours: 8, excess: 'overtime', cite: { source: 'Código do Trabalho art. 203', confidence: 'medium' } },
    weeklyOrdinaryMax: { hours: 40, cite: { source: 'Código do Trabalho art. 203', confidence: 'medium' } },
    breaks: { triggers: [{ afterHours: 5, minMinutes: 60 }], cite: { source: 'Código do Trabalho art. 213 (no more than 5 h in a row)', confidence: 'medium' } },
    night: { window: ['22:00', '07:00'], cite: { source: 'Código do Trabalho art. 223', confidence: 'medium' } },
  },
  NL: {
    code: 'NL',
    currency: 'EUR',
    baselineOnly: undefined,
    dutyMergeGapHours: 8,
    restBetweenShifts: {
      minHours: 11, afterNightDuty: { endsAfter: '02:00', minHours: 14 },
      cite: { source: 'Arbeidstijdenwet 5:3, 5:8 (11 h may be cut to 8 h once a week)', url: 'https://ondernemersplein.overheid.nl/personeel/arbeidsvoorwaarden/werktijden/', confidence: 'medium' },
    },
    dailyTotalMax: { hours: 12, cite: { source: 'Arbeidstijdenwet 5:7', confidence: 'medium' } },
    weeklyMax: { hours: 60, cite: { source: 'Arbeidstijdenwet 5:7', confidence: 'medium' } },
    averageWeeklyMax: [
      { hours: 55, weeks: 4, cite: { source: 'Arbeidstijdenwet 5:7', confidence: 'medium' } },
      { hours: 48, weeks: 16, cite: { source: 'Arbeidstijdenwet 5:7', confidence: 'medium' } },
    ],
    breaks: {
      triggers: [{ afterHours: 5.5, minMinutes: 30 }, { afterHours: 10, minMinutes: 45 }], minBlockMinutes: 15,
      cite: { source: 'Arbeidstijdenwet 5:4', confidence: 'medium' },
    },
    weeklyRest: { minHours: 36, cite: { source: 'Arbeidstijdenwet 5:5 (or 72 h per 14 days)', confidence: 'low' } },
    nightDuty: {
      window: ['00:00', '06:00'], moreThanHours: 1, maxHours: 10,
      cite: { source: 'Arbeidstijdenwet 1:7 ("meer dan een uur"; government pages say "at least 1 h")', url: 'https://wetten.overheid.nl/BWBR0007671/2025-07-01/0', confidence: 'medium' },
    },
  },
  BE: {
    code: 'BE',
    currency: 'EUR',
    baselineOnly: undefined,
    restBetweenShifts: { minHours: 11, cite: { source: 'SPF Emploi: working time rules', url: 'https://emploi.belgique.be/fr/themes/international/detachement/conditions-de-travail-respecter-en-cas-de-detachement-en-0', confidence: 'medium' } },
    dailyOrdinaryMax: { hours: 9, excess: 'overtime', cite: { source: 'Loi du 16 mars 1971 (8 h; 9 h on a ≤ 5.5-day week)', confidence: 'medium' } },
    weeklyOrdinaryMax: { hours: 38, cite: { source: 'Loi du 16 mars 1971 (38 h)', confidence: 'medium' } },
    dailyTotalMax: { hours: 11, cite: { source: 'SPF Emploi (derogation cap 11 h/day)', confidence: 'medium' } },
    weeklyMax: { hours: 50, cite: { source: 'SPF Emploi (derogation cap 50 h/week)', confidence: 'medium' } },
    breaks: { triggers: [{ afterHours: 6, minMinutes: 15 }], cite: { source: 'SPF Emploi (absent a CCT)', confidence: 'medium' } },
    weeklyRest: { minHours: 35, cite: { source: 'SPF Emploi', confidence: 'medium' } },
  },
  IE: {
    code: 'IE',
    currency: 'EUR',
    baselineOnly: undefined,
    restBetweenShifts: { minHours: 11, cite: { source: 'Organisation of Working Time Act 1997 s.11', url: OWTA, confidence: 'high' } },
    breaks: {
      triggers: [{ afterHours: 4.5, minMinutes: 15 }, { afterHours: 6, minMinutes: 30 }],
      cite: { source: 'Organisation of Working Time Act 1997 s.12', url: OWTA, confidence: 'high' },
    },
    weeklyRest: { minHours: 24, cite: { source: 'Organisation of Working Time Act 1997 s.13', url: OWTA, confidence: 'high' } },
    averageWeeklyMax: [{ hours: 48, weeks: 17, cite: { source: 'Organisation of Working Time Act 1997 s.15 (4 months)', url: OWTA, confidence: 'high' } }],
    night: { window: ['00:00', '07:00'], cite: { source: 'Organisation of Working Time Act 1997 s.16', url: OWTA, confidence: 'high' } },
    nightWorker: { averageDailyHours: 8, referenceDays: 61, cite: { source: 'Organisation of Working Time Act 1997 s.16 (2 months)', url: OWTA, confidence: 'high' } },
    notice: { hours: 24, verdict: 'refusable', onlyNoFixedHours: true, cite: { source: 'Organisation of Working Time Act 1997 s.17', url: OWTA, confidence: 'high' } },
  },
  PL: {
    code: 'PL',
    currency: 'PLN',
    baselineOnly: undefined,
    restBetweenShifts: { minHours: 11, cite: { source: 'Kodeks pracy art. 132', url: 'https://www.gov.pl/web/rodzina/ustalanie-i-rozliczanie-czasu-pracy', confidence: 'high' } },
    dailyOrdinaryMax: { hours: 8, excess: 'overtime', cite: { source: 'Kodeks pracy art. 129', confidence: 'high' } },
    weeklyOrdinaryMax: { hours: 40, cite: { source: 'Kodeks pracy art. 129 (average over the reference period)', confidence: 'high' } },
    weeklyRest: { minHours: 35, cite: { source: 'Kodeks pracy art. 133', confidence: 'high' } },
    breaks: {
      triggers: [{ afterHours: 6, inclusive: true, minMinutes: 15 }, { afterHours: 9, minMinutes: 30 }, { afterHours: 16, minMinutes: 45 }],
      cite: { source: 'Kodeks pracy art. 134', confidence: 'high' },
    },
    night: { window: ['21:00', '07:00'], premiumPct: 20, cite: { source: 'Kodeks pracy art. 151^7-151^8 (20% of the minimum-wage hourly rate)', confidence: 'high' } },
    notice: { hours: 7 * 24, verdict: 'violation', cite: { source: 'gov.pl: schedule at least 1 week before the period', confidence: 'high' } },
    minors: [{ ageFrom: 0, ageTo: 17, bannedWindows: [['22:00', '06:00']], cite: { source: 'gov.pl: no night work for minors', confidence: 'high' } }],
  },
  GB: {
    code: 'GB',
    currency: 'GBP',
    restBetweenShifts: { minHours: 11, cite: { source: 'Working Time Regulations 1998 reg 10', url: 'https://www.gov.uk/rest-breaks-work', confidence: 'high' } },
    breaks: { triggers: [{ afterHours: 6, minMinutes: 20 }], cite: { source: 'Working Time Regulations 1998 reg 12', url: 'https://www.gov.uk/rest-breaks-work', confidence: 'high' } },
    weeklyRest: { minHours: 24, cite: { source: 'Working Time Regulations 1998 reg 11 (or 48 h per fortnight)', url: 'https://www.gov.uk/rest-breaks-work', confidence: 'high' } },
    averageWeeklyMax: [{ hours: 48, weeks: 17, optOutAllowed: true, cite: { source: 'Working Time Regulations 1998 reg 4', url: 'https://www.gov.uk/maximum-weekly-working-hours', confidence: 'high' } }],
    night: { window: ['23:00', '06:00'], cite: { source: 'Working Time Regulations 1998 reg 2', url: 'https://www.gov.uk/night-working-hours', confidence: 'high' } },
    nightWorker: { averageDailyHours: 8, referenceDays: 119, cite: { source: 'Working Time Regulations 1998 reg 6 (no opt-out)', url: 'https://www.gov.uk/night-working-hours', confidence: 'high' } },
    minors: [
      {
        ageFrom: 16, ageTo: 17, maxDailyHours: 8, maxWeeklyHours: 40, minRestHours: 12,
        bannedWindows: [['22:00', '06:00'], ['00:00', '04:00']], alternativeBannedWindow: ['23:00', '07:00'],
        breaks: [{ afterHours: 4.5, minMinutes: 30 }],
        cite: { source: 'Working Time Regulations 1998 regs 5A, 6A, 10, 12', url: 'https://www.acas.org.uk/young-workers-and-work-experience', confidence: 'high' },
      },
    ],
  },
  AU: {
    code: 'AU',
    currency: 'AUD',
    baselineOnly: 'Australia: breaks, rest between shifts, overtime and roster notice are set by your modern award or agreement, not the NES. Add your award\'s rules as location overrides.',
    weeklyMax: {
      hours: 38, verdict: 'warning',
      cite: { source: 'Fair Work Act 2009 s.62 (38 h plus reasonable additional hours)', url: 'https://www.fairwork.gov.au/tools-and-resources/fact-sheets/minimum-workplace-entitlements/maximum-weekly-hours', confidence: 'high' },
    },
    payByClock: true,
  },
  GENERIC: {
    code: 'GENERIC',
    currency: 'USD',
    baselineOnly: 'There is no rule pack for this country yet. Conservative generic limits are shown as warnings; set your local rules.',
    restBetweenShifts: { minHours: 11, verdict: 'warning', cite: { source: 'Generic conservative default', confidence: 'low' } },
    dailyTotalMax: { hours: 8, verdict: 'warning', cite: { source: 'Generic conservative default', confidence: 'low' } },
    weeklyMax: { hours: 48, verdict: 'warning', cite: { source: 'Generic conservative default', confidence: 'low' } },
    breaks: { triggers: [{ afterHours: 6, minMinutes: 30 }], verdict: 'warning', cite: { source: 'Generic conservative default', confidence: 'low' } },
    weeklyRest: { minHours: 24, verdict: 'warning', cite: { source: 'Generic conservative default', confidence: 'low' } },
  },
};
