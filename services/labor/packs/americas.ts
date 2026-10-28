/**
 * Rule packs: United States (federal, states, fair-workweek cities), Canada,
 * Latin America. Values and sources come from QA's golden file
 * (qa/labor-rules-golden.md, checked 2026-10-18) and the research notes in
 * research/labor-rules/. Rules marked "unverified" there are not encoded.
 */
import type { RulePack } from '../types';

const FLSA_MINORS_CITE = { source: '29 CFR 570.35', url: 'https://webapps.dol.gov/elaws/whd/flsa/cl/e14.asp', confidence: 'high' } as const;

export const AMERICAS: Record<string, RulePack> = {
  US: {
    code: 'US',
    currency: 'USD',
    overtimePay: {
      weekly: { after: 40, multiplier: 1.5 },
      cite: { source: 'FLSA, 29 USC 207', url: 'https://www.dol.gov/agencies/whd/overtime', confidence: 'high' },
    },
    minors: [
      {
        ageFrom: 14, ageTo: 15,
        schoolDayMaxHours: 3, nonSchoolDayMaxHours: 8, schoolWeekMaxHours: 18, nonSchoolWeekMaxHours: 40,
        allowedWindow: ['07:00', '19:00'], summerAllowedWindow: ['07:00', '21:00'],
        cite: FLSA_MINORS_CITE,
      },
    ],
  },
  'US-CA': {
    code: 'US-CA',
    currency: 'USD',
    overtimePay: {
      weekly: { after: 40, multiplier: 1.5 },
      daily: [{ after: 8, multiplier: 1.5 }, { after: 12, multiplier: 2 }],
      seventhDay: { first8: 1.5, after8: 2 },
      cite: { source: 'California Labor Code 510', url: 'https://www.dir.ca.gov/dlse/faq_overtime.htm', confidence: 'high' },
    },
    mealDeadline: {
      byWorkHours: 5, minMinutes: 30, waivableIfWorkHoursLte: 6, premiumHours: 1,
      cite: { source: 'California Labor Code 512', url: 'https://www.dir.ca.gov/dlse/faq_mealperiods.htm', confidence: 'high' },
    },
  },
  'US-NY': {
    code: 'US-NY',
    currency: 'USD',
    spreadOfHours: {
      overHours: 10, premiumHours: 1,
      cite: { source: '12 NYCRR 142-2.4', url: 'https://dol.ny.gov/system/files/documents/2023/12/ls207.4.pdf', confidence: 'high' },
    },
  },
  'US-NY-NYC': {
    code: 'US-NY-NYC',
    currency: 'USD',
    fairWorkweek: {
      coverage: 'NYC Fair Workweek covers fast-food chains and retail employers with 20+ NYC employees.',
      clopening: {
        minHours: 11, consentRequired: true, premium: { kind: 'flat', amount: 100 }, industries: ['fast_food'],
        cite: { source: 'NYC Fair Workweek Law (fast food)', url: 'https://www.nyc.gov/site/dca/about/fair-workweek-law.page', confidence: 'high' },
      },
      notice: {
        hours: 14 * 24, verdict: 'violation', industries: ['fast_food'],
        cite: { source: 'NYC Fair Workweek Law (fast food)', url: 'https://www.nyc.gov/site/dca/about/fair-workweek-law.page', confidence: 'high' },
      },
    },
    notice: {
      hours: 72, verdict: 'violation', industries: ['retail'],
      cite: { source: 'NYC Fair Workweek Law (retail)', url: 'https://www.nyc.gov/site/dca/about/fair-workweek-law.page', confidence: 'high' },
    },
  },
  'US-OR': {
    code: 'US-OR',
    currency: 'USD',
    fairWorkweek: {
      coverage: 'Oregon predictive scheduling covers retail, hospitality and food service employers with 500+ employees worldwide.',
      clopening: {
        minHours: 10, consentRequired: true, premium: { kind: 'hoursInsideGap', multiplier: 1.5 },
        cite: { source: 'ORS 653.442', url: 'https://www.bclplaw.com/en-US/events-insights-news/oregon-passes-predictable-scheduling-law-how-to-ensure-your-business-complies.html', confidence: 'medium' },
      },
      notice: {
        hours: 14 * 24, verdict: 'violation',
        cite: { source: 'ORS 653.426', confidence: 'medium' },
      },
    },
  },
  'US-WA-SEATTLE': {
    code: 'US-WA-SEATTLE',
    currency: 'USD',
    fairWorkweek: {
      coverage: 'Seattle Secure Scheduling covers retail and food service with 500+ employees worldwide (full-service restaurants also need 40+ locations).',
      clopening: {
        minHours: 10, consentRequired: true, premium: { kind: 'hoursInsideGap', multiplier: 1.5 },
        cite: { source: 'Seattle Secure Scheduling Ordinance', url: 'https://www.seattle.gov/Documents/Departments/Council/Issues/SecureScheduling/Secure-Scheduling-Infographic.pdf', confidence: 'high' },
      },
      notice: { hours: 14 * 24, verdict: 'violation', cite: { source: 'Seattle Secure Scheduling Ordinance', confidence: 'high' } },
    },
  },
  'US-IL-CHICAGO': {
    code: 'US-IL-CHICAGO',
    currency: 'USD',
    fairWorkweek: {
      coverage: 'Chicago Fair Workweek covers 100+ employees (250 for non-profits) in covered industries, for employees earning up to $33.85/h from 2026-07-01.',
      clopening: {
        minHours: 10, consentRequired: true, premium: { kind: 'wholeShift', multiplier: 1.25 },
        cite: { source: 'Chicago Fair Workweek FAQ Q27 (consent documented in writing), Q30 (entire shift at 1.25× the base rate)', url: 'https://chicago.gov/content/dam/city/depts/bacp/OSL/faqfairworkweekv2final.pdf', confidence: 'high' },
      },
      notice: { hours: 14 * 24, verdict: 'violation', cite: { source: 'Chicago Fair Workweek Ordinance', confidence: 'medium' } },
    },
  },
  'US-IL-EVANSTON': {
    code: 'US-IL-EVANSTON',
    currency: 'USD',
    fairWorkweek: {
      coverage: 'Evanston Fair Workweek covers 100+ employees globally in covered industries; food service needs 30+ locations and 200+ employees.',
      clopening: {
        minHours: 11, consentRequired: true, premium: { kind: 'hoursInsideGap', multiplier: 1.5 },
        cite: { source: 'Evanston City Code 3-34-7 (Ordinance 24-O-23): written consent; 1.5× for hours worked less than 11 h after the previous shift', url: 'https://www.cityofevanston.org/Documents/Business/Fair%20Workweek/Correctly%20Amended%2024O23.pdf', confidence: 'high' },
      },
      notice: { hours: 14 * 24, verdict: 'violation', cite: { source: 'Evanston Fair Workweek Ordinance', confidence: 'medium' } },
    },
  },
  'US-PA-PHILADELPHIA': {
    code: 'US-PA-PHILADELPHIA',
    currency: 'USD',
    fairWorkweek: {
      coverage: 'Philadelphia Fair Workweek covers retail, food and hospitality employers with 250+ employees and 30+ locations worldwide.',
      clopening: {
        minHours: 9, consentRequired: true, consentWritten: false, premium: { kind: 'flat', amount: 40 },
        cite: { source: 'Philadelphia Fair Workweek FAQ (Dec 2023): not within 9 h "unless the employee provides consent and payment of $40"', url: 'https://www.phila.gov/media/20231218102835/FWW-FAQ-December-2023.pdf', confidence: 'high' },
      },
      notice: { hours: 14 * 24, verdict: 'violation', cite: { source: 'Philadelphia Fair Workweek', confidence: 'high' } },
    },
  },
  'US-CA-LA': {
    code: 'US-CA-LA',
    currency: 'USD',
    fairWorkweek: {
      coverage: 'Los Angeles Fair Work Week covers retail employers with 300+ employees globally.',
      clopening: {
        minHours: 10, consentRequired: true, premium: { kind: 'wholeShift', multiplier: 1.5 }, industries: ['retail'],
        cite: { source: 'LA Fair Work Week Ordinance', url: 'https://wagesla.lacity.gov/fair-work-week-information', confidence: 'medium' },
      },
      notice: { hours: 14 * 24, verdict: 'violation', industries: ['retail'], cite: { source: 'LA Fair Work Week Ordinance', confidence: 'high' } },
    },
  },
  'US-CA-SF': {
    code: 'US-CA-SF',
    currency: 'USD',
    fairWorkweek: {
      coverage: 'San Francisco FRERO covers formula retail with 40+ locations worldwide and 20+ SF employees.',
      notice: {
        hours: 14 * 24, verdict: 'violation',
        cite: { source: 'SF Formula Retail Employee Rights Ordinance', url: 'https://www.sf.gov/information/formula-retail-employee-rights-ordinance', confidence: 'high' },
      },
    },
  },
  'US-CA-BERKELEY': {
    code: 'US-CA-BERKELEY',
    currency: 'USD',
    fairWorkweek: {
      coverage: 'Berkeley Fair Workweek (BMC 13.102) covers large retail, food service and hospitality employers; check the city thresholds.',
      clopening: {
        minHours: 11, consentRequired: true, premium: { kind: 'hoursInsideGap', multiplier: 1.5 },
        cite: { source: 'Berkeley Fair Workweek Ordinance', url: 'https://berkeleyca.gov/sites/default/files/documents/Fair%20Workweek%20Public%20Notice_City%20of%20Berkeley_January%202024%20%28English%29.pdf', confidence: 'high' },
      },
      notice: { hours: 14 * 24, verdict: 'violation', cite: { source: 'Berkeley Fair Workweek Ordinance', confidence: 'high' } },
    },
  },
  'US-CA-EMERYVILLE': {
    code: 'US-CA-EMERYVILLE',
    currency: 'USD',
    fairWorkweek: {
      coverage: 'Emeryville Fair Workweek covers retail with 56+ employees globally and fast food with 56+ globally and 20+ in Emeryville.',
      clopening: {
        minHours: 11, consentRequired: true, premium: { kind: 'hoursInsideGap', multiplier: 1.5 },
        cite: { source: 'Emeryville Fair Workweek Ordinance', url: 'https://www.emeryville.org/files/assets/city/v/1/development/documents/fair-workweek-ordinance/fair-work-week-poster.pdf', confidence: 'high' },
      },
      notice: { hours: 14 * 24, verdict: 'violation', cite: { source: 'Emeryville Fair Workweek Ordinance', confidence: 'high' } },
    },
  },

  // ── Canada ────────────────────────────────────────────────────────────────
  // CA is the Canada Labour Code: only federally regulated employers (banks,
  // airlines, telecoms, interprovincial transport). Everyone else follows
  // their province; provinces without a pack resolve to CA-OTHER.
  CA: {
    code: 'CA',
    currency: 'CAD',
    restBetweenShifts: { minHours: 8, cite: { source: 'Canada Labour Code 169.2', url: 'https://laws-lois.justice.gc.ca/eng/acts/l-2/page-23.html', confidence: 'high' } },
    breaks: { triggers: [{ afterHours: 5, minMinutes: 30 }], cite: { source: 'Canada Labour Code 169.1', confidence: 'high' } },
    weeklyMax: { hours: 48, cite: { source: 'Canada Labour Code 171', confidence: 'high' } },
    overtimePay: {
      weekly: { after: 40, multiplier: 1.5 },
      daily: [{ after: 8, multiplier: 1.5 }],
      cite: { source: 'Canada Labour Code 169, 174', confidence: 'high' },
    },
    notice: { hours: 96, verdict: 'refusable', cite: { source: 'Canada Labour Code 173.01', confidence: 'high' } },
    weeklyRest: { minHours: 24, cite: { source: 'Canada Labour Code 173', confidence: 'high' } },
  },
  'CA-ON': {
    code: 'CA-ON',
    currency: 'CAD',
    restBetweenShifts: {
      minHours: 8, exemptIfPairTotalHoursLte: 13, dailyRestReviewHours: 11,
      cite: { source: 'Ontario ESA 2000, hours of work', url: 'https://www.ontario.ca/files/2024-12/mlitsd-info-about-how-and-ot-en-2024-12-12.pdf', confidence: 'high' },
    },
    breaks: { triggers: [{ afterHours: 5, minMinutes: 30 }], cite: { source: 'Ontario ESA 2000 s.20', confidence: 'high' } },
    weeklyMax: { hours: 48, cite: { source: 'Ontario ESA 2000 s.17 (more needs a written agreement)', confidence: 'high' } },
    overtimePay: { weekly: { after: 44, multiplier: 1.5 }, cite: { source: 'Ontario ESA 2000 s.22', confidence: 'high' } },
    weeklyRest: { minHours: 24, cite: { source: 'Ontario ESA 2000 s.18 (or 48 h per 2 weeks)', confidence: 'high' } },
  },
  'CA-BC': {
    code: 'CA-BC',
    currency: 'CAD',
    restBetweenShifts: {
      minHours: 8,
      cite: { source: 'BC Employment Standards Act s.36(2) (not in an emergency, s.36(3))', url: 'https://www2.gov.bc.ca/gov/content/employment-business/employment-standards-advice/employment-standards/forms-resources/igm/esa-part-4-section-36', confidence: 'high' },
    },
    breaks: {
      triggers: [{ afterHours: 5, minMinutes: 30 }],
      cite: { source: 'BC Employment Standards Act s.32 (no more than 5 consecutive hours without a 30 min meal break)', url: 'https://www2.gov.bc.ca/gov/content/employment-business/employment-standards-advice/employment-standards/forms-resources/igm/esa-part-4-section-32', confidence: 'high' },
    },
    // s.40(3): only the first 8 h of each day count toward the 40 h week (the engine's daily-then-weekly order).
    overtimePay: {
      weekly: { after: 40, multiplier: 1.5 },
      daily: [{ after: 8, multiplier: 1.5 }, { after: 12, multiplier: 2 }],
      cite: { source: 'BC Employment Standards Act ss.35, 40', url: 'https://www2.gov.bc.ca/gov/content/employment-business/employment-standards-advice/employment-standards/forms-resources/igm/esa-part-4-section-40', confidence: 'high' },
    },
    weeklyRest: {
      minHours: 32, verdict: 'premium', premiumMultiplier: 1.5,
      cite: { source: 'BC Employment Standards Act s.36(1): 32 consecutive hours free each week, or 1.5× for time worked in that period', url: 'https://www2.gov.bc.ca/gov/content/employment-business/employment-standards-advice/employment-standards/forms-resources/igm/esa-part-4-section-36', confidence: 'high' },
    },
  },
  'CA-OTHER': {
    code: 'CA-OTHER',
    currency: 'CAD',
    baselineOnly: 'Your province\'s employment standards law applies here; the Canada Labour Code covers only federally regulated employers (choose that option if your business is one). Horario has no pack for this province yet: conservative generic limits are shown as warnings; set your local rules.',
    restBetweenShifts: { minHours: 11, verdict: 'warning', cite: { source: 'Generic conservative default', confidence: 'low' } },
    dailyTotalMax: { hours: 8, verdict: 'warning', cite: { source: 'Generic conservative default', confidence: 'low' } },
    weeklyMax: { hours: 48, verdict: 'warning', cite: { source: 'Generic conservative default', confidence: 'low' } },
    breaks: { triggers: [{ afterHours: 6, minMinutes: 30 }], verdict: 'warning', cite: { source: 'Generic conservative default', confidence: 'low' } },
    weeklyRest: { minHours: 24, verdict: 'warning', cite: { source: 'Generic conservative default', confidence: 'low' } },
  },
  'CA-QC': {
    code: 'CA-QC',
    currency: 'CAD',
    breaks: { triggers: [{ afterHours: 5, inclusive: true, minMinutes: 30 }], cite: { source: 'Quebec Act respecting labour standards s.79', confidence: 'medium' } },
    overtimePay: { weekly: { after: 40, multiplier: 1.5 }, cite: { source: 'Quebec Act respecting labour standards s.52, s.55', confidence: 'medium' } },
    weeklyRest: { minHours: 32, cite: { source: 'Quebec Act respecting labour standards s.78', confidence: 'medium' } },
    notice: { hours: 5 * 24, verdict: 'refusable', cite: { source: 'Quebec Act respecting labour standards s.59.0.1', url: 'https://www.cnesst.gouv.qc.ca/en/working-conditions/work-schedule-and-termination-employment/work-schedule/right-refuse-work/right-refuse-work-overtime', confidence: 'high' } },
    minors: [
      {
        ageFrom: 0, ageTo: 17, onlyInCompulsorySchooling: true,
        schoolWeekMaxHours: 17, schoolWeekWeekdayMaxHours: 10, bannedWindows: [['23:00', '06:00']],
        cite: { source: 'CNESST, young workers', url: 'https://www.cnesst.gouv.qc.ca/en/working-conditions/work-schedule-and-termination-employment/work-schedule/young-workers', confidence: 'high' },
      },
    ],
  },

  // ── Latin America ─────────────────────────────────────────────────────────
  PE: {
    code: 'PE',
    currency: 'PEN',
    // No general statutory minimum rest between shifts was found, so short
    // rest is advisory only (QA case PE-01), and shifts are never merged into
    // one working day: the warning must show.
    dutyMergeGapHours: 0,
    restBetweenShifts: { minHours: 8, verdict: 'warning', cite: { source: 'No statutory minimum verified (QA golden PE-01)', confidence: 'low' } },
    dailyOrdinaryMax: { hours: 8, excess: 'overtime', cite: { source: 'Constitución art. 25; D.S. 007-2002-TR', confidence: 'high' } },
    weeklyOrdinaryMax: { hours: 48, cite: { source: 'Constitución art. 25', confidence: 'high' } },
    breaks: {
      triggers: [{ afterHours: 6, minMinutes: 45 }], verdict: 'warning',
      cite: { source: 'D.S. 007-2002-TR art. 7 (refrigerio ≥ 45 min in continuous schedules). The 6 h trigger is Horario\'s default, not law.', confidence: 'medium' },
    },
    // Not a surcharge on actual pay: a night worker's pay may not be below the
    // RMV plus 35% (SERVIR Informe Técnico 0947-2021 reads it the same way).
    night: {
      window: ['22:00', '06:00'],
      monthlyPayFloor: {
        minimumMonthlyWage: [
          { from: '2025-01-01', value: 1130 },
          { from: '2026-10-01', value: 1230 },
        ],
        pctOverMinimum: 35,
      },
      cite: { source: 'D.S. 007-2002-TR art. 8 (night pay ≥ RMV + 35%); RMV S/ 1,230 from 2026-10-01 (D.S. 015-2026-TR), S/ 1,130 before (D.S. 006-2024-TR)', url: 'https://elperuano.pe/noticia/305879-desde-hoy-rige-la-nueva-rmv-sueldo-minimo-sube-a-s-1230-y-cambia-otros-conceptos-laborales', confidence: 'high' },
    },
    weeklyRest: { minHours: 24, cite: { source: 'D.Leg. 713', confidence: 'medium' } },
  },
  MX: {
    code: 'MX',
    currency: 'MXN',
    shiftClassification: { night: ['20:00', '06:00'], mixedIfNightHoursLt: 3.5 },
    dailyOrdinaryMax: {
      hours: { day: 8, night: 7, mixed: 7.5 }, excess: 'overtime',
      cite: { source: 'LFT arts. 60-61', url: 'https://www.diputados.gob.mx/LeyesBiblio/ref/lft/LFT_ref52_01may26.pdf', confidence: 'high' },
    },
    weeklyOrdinaryMax: {
      hours: [
        { from: '1970-01-01', value: 48 },
        { from: '2027-01-01', value: 46 },
        { from: '2028-01-01', value: 44 },
        { from: '2029-01-01', value: 42 },
        { from: '2030-01-01', value: 40 },
      ],
      cite: { source: 'LFT art. 59 + transitorio 2º (DOF 2026-05-01)', url: 'https://www.diputados.gob.mx/LeyesBiblio/ref/lft/LFT_ref52_01may26.pdf', confidence: 'high' },
    },
    dailyOvertimeMax: { hours: 4, cite: { source: 'LFT art. 66', confidence: 'high' } },
    overtimeDaysPerWeekMax: { days: 4, cite: { source: 'LFT art. 66 (≤ 4 days a week, DOF 2026-05-01)', confidence: 'high' } },
    dailyTotalMax: { hours: 12, cite: { source: 'LFT art. 68 (ordinary + overtime ≤ 12 h/day)', confidence: 'high' } },
    breaks: { triggers: [{ afterHours: 0, minMinutes: 30 }], verdict: 'warning', cite: { source: 'LFT art. 63 (≥ 30 min in a continuous shift)', confidence: 'high' } },
    weeklyRest: { minHours: 24, cite: { source: 'LFT art. 69', confidence: 'high' } },
  },
  CO: {
    code: 'CO',
    currency: 'COP',
    // CST 161 (Ley 2101 art. 2) has no daily cap for adults: 42 h a week split
    // over 5 or 6 days by agreement. Above 9 h (the jornada flexible maximum)
    // a person checks the agreed split instead of the engine assuming overtime.
    dailyOrdinaryMax: {
      hours: 9, excess: 'review',
      cite: { source: 'CST art. 161 (Ley 2101/2021 art. 2): no adult daily cap; 42 h/week over 5-6 days by agreement; jornada flexible (lit. d) 4-9 ordinary hours a day', url: 'https://cancilleria.gov.co/sites/default/files/Normograma/docs/ley_2101_2021.htm', confidence: 'high' },
    },
    weeklyOrdinaryMax: {
      hours: [
        { from: '1970-01-01', value: 48 },
        { from: '2023-07-15', value: 47 },
        { from: '2024-07-15', value: 46 },
        { from: '2025-07-15', value: 44 },
        { from: '2026-07-15', value: 42 },
      ],
      cite: { source: 'Ley 2101/2021', url: 'https://actualicese.com/horas-extra-y-recargos/', confidence: 'medium' },
    },
    dailyOvertimeMax: { hours: 2, cite: { source: 'CST (≤ 2 h/day, 12 h/week)', confidence: 'medium' } },
    night: {
      window: [
        { from: '1970-01-01', value: ['21:00', '06:00'] },
        { from: '2025-12-25', value: ['19:00', '06:00'] },
      ],
      premiumPct: 35,
      cite: { source: 'CST art. 160 (Ley 2466/2025 art. 10)', url: 'https://actualicese.com/horas-extra-y-recargos/', confidence: 'medium' },
    },
  },
  CL: {
    code: 'CL',
    currency: 'CLP',
    dailyOrdinaryMax: { hours: 10, excess: 'violation', cite: { source: 'Código del Trabajo art. 28', confidence: 'medium' } },
    weeklyOrdinaryMax: {
      hours: [
        { from: '1970-01-01', value: 45 },
        { from: '2024-04-26', value: 44 },
        { from: '2026-04-26', value: 42 },
        { from: '2028-04-26', value: 40 },
      ],
      cite: { source: 'Ley 21.561', url: 'https://www.mintrab.gob.cl/ley-40-horas/', confidence: 'high' },
    },
    dailyOvertimeMax: { hours: 2, cite: { source: 'Código del Trabajo arts. 31-32', confidence: 'medium' } },
    breaks: { triggers: [{ afterHours: 0, minMinutes: 30 }], verdict: 'warning', cite: { source: 'Código del Trabajo art. 34 (colación ≥ 30 min)', confidence: 'high' } },
  },
  BR: {
    code: 'BR',
    currency: 'BRL',
    restBetweenShifts: { minHours: 11, cite: { source: 'CLT art. 66', url: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452compilado.htm', confidence: 'high' } },
    dailyOrdinaryMax: { hours: 8, excess: 'overtime', cite: { source: 'CLT art. 58', confidence: 'high' } },
    // EC 141/2026 (DOU 2026-10-16) art. 6: 42 h two months after publication,
    // 40 h one year later. Dates counted from publication day to day.
    weeklyOrdinaryMax: {
      hours: [
        { from: '1988-10-05', value: 44 },
        { from: '2026-12-16', value: 42 },
        { from: '2027-12-16', value: 40 },
      ],
      cite: { source: 'Constituição art. 7 XIII; EC 141/2026 art. 6', url: 'https://planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc141.htm', confidence: 'high' },
    },
    dailyOvertimeMax: { hours: 2, cite: { source: 'CLT art. 59', confidence: 'high' } },
    breaks: {
      triggers: [{ afterHours: 4, minMinutes: 15 }, { afterHours: 6, minMinutes: 60 }],
      cite: { source: 'CLT art. 71', confidence: 'high' },
    },
    night: { window: ['22:00', '05:00'], premiumPct: 20, hourMinutes: 52.5, cite: { source: 'CLT art. 73', confidence: 'high' } },
    weeklyRest: { minHours: 24, cite: { source: 'CLT art. 67 (24 consecutive hours)', confidence: 'high' } },
    // EC 141/2026 art. 7 XV (in force two months after publication, art. 10 I):
    // 2 paid rest days a week, one preferably Sunday. A collective agreement may
    // average 2 days a week over the month with at least 1 each week (art. 7 §2).
    weeklyRestDays: {
      days: [
        { from: '1988-10-05', value: 1 },
        { from: '2026-12-16', value: 2 },
      ],
      cite: { source: 'Constituição art. 7 XV; EC 141/2026 art. 10 I (a collective agreement may average over the month, art. 7 §2)', url: 'https://planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc141.htm', confidence: 'high' },
    },
  },
  AR: {
    code: 'AR',
    currency: 'ARS',
    restBetweenShifts: { minHours: 12, cite: { source: 'LCT art. 197', url: 'https://www.argentina.gob.ar/normativa/nacional/ley-20744-25552/actualizacion', confidence: 'medium' } },
    dailyOrdinaryMax: { hours: 8, excess: 'overtime', cite: { source: 'Ley 11.544; LCT art. 196', confidence: 'medium' } },
    weeklyOrdinaryMax: { hours: 48, cite: { source: 'Ley 11.544', confidence: 'medium' } },
    weeklyRest: { minHours: 35, cite: { source: 'LCT art. 204', confidence: 'medium' } },
  },
};
