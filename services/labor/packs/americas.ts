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
        cite: { source: 'Chicago Fair Workweek Ordinance (base of 1.25× not verified)', url: 'https://www.illinoislegalaid.org/legal-information/what-are-my-rights-my-work-schedule-chicago', confidence: 'medium' },
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
        minHours: 11, consentRequired: true, premium: { kind: 'unknown' },
        cite: { source: 'Evanston Fair Workweek Ordinance', url: 'https://www.cityofevanston.org/business/fair_workweek.php', confidence: 'medium' },
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
        minHours: 9, consentRequired: false, premium: { kind: 'flat', amount: 40 },
        cite: { source: 'Philadelphia Fair Workweek', url: 'https://www.phila.gov/media/20200213173852/Fair-Workweek-Poster-Translations.pdf', confidence: 'high' },
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
    // rest is advisory only (QA case PE-01).
    restBetweenShifts: { minHours: 8, verdict: 'warning', cite: { source: 'No statutory minimum verified (QA golden PE-01)', confidence: 'low' } },
    dailyOrdinaryMax: { hours: 8, excess: 'overtime', cite: { source: 'Constitución art. 25; D.S. 007-2002-TR', confidence: 'high' } },
    weeklyOrdinaryMax: { hours: 48, cite: { source: 'Constitución art. 25', confidence: 'high' } },
    breaks: {
      triggers: [{ afterHours: 6, minMinutes: 45 }], verdict: 'warning',
      cite: { source: 'D.S. 007-2002-TR art. 7 (refrigerio ≥ 45 min)', confidence: 'medium' },
    },
    night: {
      window: ['22:00', '06:00'], premiumPct: 35,
      cite: { source: 'MTPE: night pay ≥ RMV + 35%', url: 'https://www.buk.pe/blog/ley-jornada-trabajo-horario-sobretiempo', confidence: 'medium' },
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
    dailyTotalMax: { hours: 12, cite: { source: 'LFT art. 68 (ordinary + overtime ≤ 12 h/day)', confidence: 'high' } },
    breaks: { triggers: [{ afterHours: 0, minMinutes: 30 }], verdict: 'warning', cite: { source: 'LFT art. 63 (≥ 30 min in a continuous shift)', confidence: 'high' } },
    weeklyRest: { minHours: 24, cite: { source: 'LFT art. 69', confidence: 'high' } },
  },
  CO: {
    code: 'CO',
    currency: 'COP',
    dailyOrdinaryMax: { hours: 8, excess: 'overtime', cite: { source: 'CST art. 161', confidence: 'medium' } },
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
    weeklyOrdinaryMax: { hours: 44, cite: { source: 'Constituição art. 7 XIII; CLT art. 58', confidence: 'high' } },
    dailyOvertimeMax: { hours: 2, cite: { source: 'CLT art. 59', confidence: 'high' } },
    breaks: {
      triggers: [{ afterHours: 4, minMinutes: 15 }, { afterHours: 6, minMinutes: 60 }],
      cite: { source: 'CLT art. 71', confidence: 'high' },
    },
    night: { window: ['22:00', '05:00'], premiumPct: 20, hourMinutes: 52.5, cite: { source: 'CLT art. 73', confidence: 'high' } },
    weeklyRest: { minHours: 24, cite: { source: 'CLT art. 67', confidence: 'high' } },
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
