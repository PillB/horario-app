/**
 * chg048-batch.mjs — CHG-048: Translate 7 missing locale sections for de, fr, it, zh, hi, sw, tl
 *
 * Model: claude-sonnet-4-6 (Batch API — 50% off)
 *
 * Missing sections in all 7 locale files:
 *   - timezone:      (2 keys — live timezone bar from CHG-046)
 *   - shiftNotes:    (15 keys — per-shift tasks panel from CHG-046)
 *   - home.weekStats (3 keys — this-week KPI strip from CHG-046)
 *   - home.invite    (4 keys — team invite CTA from CHG-046)
 *   - weekCalendar:  (8 keys — week/month calendar nav from CHG-042)
 *   - tour:          (full section — interactive tour from CHG-047)
 *
 * Usage:
 *   node --env-file=.env.local scripts/chg048-batch.mjs
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  const abs = path.join(ROOT, relPath);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : `// FILE NOT FOUND: ${relPath}`;
}

function write(relPath, content) {
  const abs = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  console.log(`  ✓ wrote ${relPath} (${content.length} chars)`);
}

// ─── Language configs ─────────────────────────────────────────────────────────

const LANGUAGES = [
  { code: 'de', name: 'German',    native: 'Deutsch',     tone: 'formal Sie-form' },
  { code: 'fr', name: 'French',    native: 'Français',    tone: 'vous-form, professional' },
  { code: 'it', name: 'Italian',   native: 'Italiano',    tone: 'Lei-form, professional' },
  { code: 'zh', name: 'Simplified Chinese', native: '中文', tone: 'polite, concise' },
  { code: 'hi', name: 'Hindi',     native: 'हिन्दी',      tone: 'polite, professional' },
  { code: 'sw', name: 'Swahili',   native: 'Kiswahili',   tone: 'polite, professional' },
  { code: 'tl', name: 'Filipino (Tagalog)', native: 'Filipino', tone: 'polite, professional' },
];

// ─── English source sections to translate ─────────────────────────────────────

const EN_SECTIONS = `
=== TIMEZONE ===
  timezone: {
    schedulingIn: 'Scheduling in:',
    live: 'Live scheduling timezone clock',
  },

=== SHIFT_NOTES ===
  shiftNotes: {
    notesBtn: 'Notes',
    openNotes: 'Open shift notes and tasks',
    panelTitle: 'Shift notes',
    managerNote: 'Manager note',
    managerNotePlaceholder: 'Add instructions, reminders, or context for this shift…',
    tasks: 'Tasks',
    tasksDesc: 'Add to-dos the worker should complete during this shift.',
    addTaskPlaceholder: 'e.g. Check inventory before opening',
    addTaskBtn: 'Add',
    commentPlaceholder: 'Add a comment or update…',
    noTasks: 'No tasks yet — add one above.',
    cycleStatus: 'Cycle task status',
    removeTask: 'Remove task',
    status: {
      todo: 'To do',
      done: 'Done',
      blocked: 'Blocked',
      delayed: 'Delayed',
    },
    doneBtn: 'Close',
  },

=== HOME_EXTRAS ===
    weekStats: {
      title: 'This week',
      scheduled: 'Shifts scheduled',
      gaps: 'Roles to fill',
    },
    invite: {
      title: 'Build your team',
      desc: 'Add workers to unlock auto-assign and coverage tracking. Each worker added means fewer scheduling gaps.',
      cta: 'Invite a team member →',
      ctaA11y: 'Invite a team member to your roster',
    },

=== WEEK_CALENDAR ===
  weekCalendar: {
    prevWeek: 'Previous week',
    nextWeek: 'Next week',
    today: 'Today',
    maximize: 'Fullscreen calendar',
    closeFullscreen: 'Close fullscreen',
    noShifts: 'No shifts this week.',
    legend: 'Legend:',
    legendDraft: 'Draft',
    legendPublished: 'Published',
    coverageMet: '{s}/{r} covered',
    coverageShort: '{s}/{r} short',
  },

=== TOUR ===
  tour: {
  roleSelect: {
    title: 'Who are you?',
    desc: 'Tell us your role so we can personalise your tour and surface the features that matter most to you right away.',
    managerTitle: '👔 Manager / Owner',
    managerDesc: 'Build schedules, manage your team, forecast demand, and keep labour costs under control.',
    workerTitle: '👷 Team Member',
    workerDesc: 'View your shifts, set your availability, and stay in sync with your team — all in one place.',
  },
  nav: {
    stepOf: 'Step {current} of {total}',
    next: 'Next →',
    back: '← Back',
    skip: 'Skip tour',
    done: 'Done ✓',
    whyMatters: 'Why this matters',
    hide: 'Hide',
    actionPrompt: 'Complete the step above to continue ↑',
    startManager: 'Start Manager Tour',
    startWorker: 'Start Team Member Tour',
  },
  manager: {
    step1: {
      title: 'Welcome to Your Command Centre',
      desc: 'This is your Home dashboard — a live snapshot of today\\'s coverage, pending approvals, and team activity the moment you log in.',
      why: 'Managers who review their dashboard daily catch coverage gaps before they become costly call-outs. Starting here keeps your entire operation visible at a glance.',
    },
    step2: {
      title: 'Build Your Scheduling Streak',
      desc: 'Your streak tracks how consistently you publish schedules on time, giving your team the advance notice they need to plan their lives.',
      why: 'Research from 7shifts shows that teams given schedules at least one week in advance experience up to 40% fewer no-shows — your streak makes that habit stick.',
    },
    step3: {
      title: 'Meet the Scheduler',
      desc: 'The Scheduler tab is where you build, edit, and publish weekly rosters using a drag-and-drop visual timeline for every role and location.',
      why: 'A centralised visual scheduler eliminates double-bookings and reduces the back-and-forth emails that steal hours from your week.',
    },
    step4: {
      title: 'Add Your First Team Member',
      desc: 'Invite a worker by entering their name and contact details so Horario can match them to shifts and send automatic notifications.',
      why: 'Getting your roster into the system unlocks auto-scheduling, conflict detection, and real-time coverage alerts that save managers an average of 5 hours per week.',
      action: 'Add your first worker above ↑',
    },
    step5: {
      title: 'Capture Team Availability',
      desc: 'Set or review availability windows for your team members so the scheduler only offers shifts they can actually work.',
      why: 'Scheduling against confirmed availability is the single biggest driver of shift acceptance rates — teams using Horario see up to 35% fewer swap requests when availability is set upfront.',
      action: 'Set availability for a team member above ↑',
    },
    step6: {
      title: 'Create a Shift Template',
      desc: 'Save a reusable shift template — name, role, start time, and duration — so you can drop consistent shifts onto the calendar in seconds.',
      why: 'Templates reduce schedule-build time by up to 60% by removing repetitive data entry, letting you focus on optimising coverage rather than re-typing the same shifts every week.',
      action: 'Create your first shift template above ↑',
    },
    step7: {
      title: 'Assign Your First Shift',
      desc: 'Drag your new template onto the timeline or tap a cell to assign a shift to a team member for an upcoming day.',
      why: 'Publishing even one assigned shift activates Horario\\'s notification pipeline, so your team immediately experiences the reliability that drives higher engagement and retention.',
      action: 'Assign a shift to a team member above ↑',
    },
    step8: {
      title: 'Forecast Demand Like a Pro',
      desc: 'Horario analyses historical traffic, sales, and headcount data to recommend optimal staffing levels before you even open the scheduler.',
      why: 'Demand-informed scheduling helps operators cut excess labour costs by an average of 15% while maintaining service quality — you now have everything you need to schedule smarter from day one.',
    },
  },
  worker: {
    step1: {
      title: 'Welcome to Your Schedule Hub',
      desc: 'This is your Home screen — see your next shift, any open messages from your manager, and your team\\'s live roster the moment you open the app.',
      why: 'Having your schedule and communications in one place means no more missed shifts from lost text threads or forgotten paper printouts.',
    },
    step2: {
      title: 'Grow Your Reliability Streak',
      desc: 'Your streak reflects how consistently you keep your availability up to date, helping your manager schedule you for shifts that actually fit your life.',
      why: 'Workers with complete, current availability profiles receive more preferred shifts and are first in line when extra hours become available.',
    },
    step3: {
      title: 'See the Full Team Schedule',
      desc: 'The Scheduler tab shows the published roster for your location so you always know who you\\'re working with and can plan around your colleagues\\' shifts.',
      why: 'Visibility into the full team schedule makes shift swaps faster and reduces the confusion that leads to understaffed days and stressful surprises.',
    },
    step4: {
      title: 'Set Your Availability Now',
      desc: 'Tell your manager exactly when you\\'re available to work so every shift you\\'re offered is one you can genuinely accept.',
      why: 'Teams using Horario report 35% fewer last-minute conflicts when all members set their availability upfront — your input directly improves the whole team\\'s schedule quality.',
      action: 'Set your weekly availability above ↑',
    },
    step5: {
      title: 'You\\'re Ready to Roll',
      desc: 'You\\'ve explored your dashboard, learned about streaks, seen the team schedule, and locked in your availability — your scheduling experience starts strong from here.',
      why: 'Workers who complete onboarding are significantly more confident managing shift changes, requesting time off, and communicating with their team entirely inside Horario.',
    },
  },
  completed: {
    title: '🎉 You\\'re all set!',
    desc: 'You\\'ve completed the tour and have everything you need to build smarter schedules, reduce no-shows, and keep your team in sync. Your first great week starts now.',
  },
},
`;

// ─── Build batch requests ─────────────────────────────────────────────────────

const requests = LANGUAGES.map(({ code, name, native, tone }) => ({
  custom_id: `L-${code}`,
  params: {
    model: 'claude-sonnet-4-6',
    max_tokens: 6144,
    messages: [{
      role: 'user',
      content: `You are a professional localisation engineer translating UI strings from English to ${name} (${native}) for a mobile scheduling app called Horario.

Translation rules:
- Tone: ${tone}
- Preserve ALL interpolation placeholders exactly: {n}, {current}, {total}, {s}, {r}, {lang}, {day}, {from}, {to}, etc.
- Preserve ALL emoji characters exactly as-is (e.g. 👔 👷 🎉 📅 📊)
- Preserve ALL arrow characters exactly: → ←, ↑
- Preserve ALL TypeScript key names (left side of colon) unchanged
- Do NOT translate: "Horario", "7shifts", "Deputy", "Homebase", numeric values like "40%", "35%", "5", "$12"
- Keep TypeScript syntax (single quotes, commas, nested objects) perfectly valid
- Output ONLY the translated TypeScript sections, NO markdown fences, NO explanatory text

Translate each section below. Keep the exact section markers (=== TIMEZONE ===, etc.) so I can parse them.

${EN_SECTIONS}`,
    }],
  },
}));

// ─── Submit batch ──────────────────────────────────────────────────────────────

const client = new Anthropic();

console.log(`\nSubmitting ${requests.length} translation requests to Batch API...`);
const batch = await client.messages.batches.create({ requests });
console.log(`Batch ID: ${batch.id}  status: ${batch.processing_status}`);

// ─── Poll until done ───────────────────────────────────────────────────────────

let done = false;
let pollCount = 0;
const START = Date.now();

while (!done) {
  await new Promise(r => setTimeout(r, 15_000));
  pollCount++;
  const status = await client.messages.batches.retrieve(batch.id);
  const elapsed = Math.round((Date.now() - START) / 1000);
  console.log(`  [${elapsed}s] poll #${pollCount}: ${status.processing_status} — ` +
    `${status.request_counts.succeeded}/${requests.length} succeeded, ` +
    `${status.request_counts.errored} errored`);
  if (status.processing_status === 'ended') done = true;
}

// ─── Collect results ───────────────────────────────────────────────────────────

console.log('\nCollecting results...');
const results = {};
for await (const item of await client.messages.batches.results(batch.id)) {
  if (item.result.type === 'succeeded') {
    results[item.custom_id] = item.result.message.content[0].text;
    console.log(`  ✓ ${item.custom_id} (${results[item.custom_id].length} chars)`);
  } else {
    console.error(`  ✗ ${item.custom_id}: ${item.result.type}`);
  }
}

// ─── Write raw results ────────────────────────────────────────────────────────

write('scripts/chg048-results.json', JSON.stringify(results, null, 2));

// ─── Parse section from output ────────────────────────────────────────────────

function extractSection(text, marker) {
  const startMarker = `=== ${marker} ===`;
  const sections = ['TIMEZONE', 'SHIFT_NOTES', 'HOME_EXTRAS', 'WEEK_CALENDAR', 'TOUR'];
  const idx = sections.indexOf(marker);
  const nextMarker = idx < sections.length - 1 ? `=== ${sections[idx + 1]} ===` : null;

  const start = text.indexOf(startMarker);
  if (start === -1) return null;

  const contentStart = start + startMarker.length;
  const end = nextMarker ? text.indexOf(nextMarker, contentStart) : text.length;
  return text.slice(contentStart, end !== -1 ? end : text.length).trim();
}

// ─── Apply translations to locale files ────────────────────────────────────────

function applyToLocale(langCode, rawOutput) {
  const filePath = path.join(ROOT, `locales/${langCode}.ts`);
  let content = fs.readFileSync(filePath, 'utf8');

  const timezone     = extractSection(rawOutput, 'TIMEZONE');
  const shiftNotes   = extractSection(rawOutput, 'SHIFT_NOTES');
  const homeExtras   = extractSection(rawOutput, 'HOME_EXTRAS');
  const weekCalendar = extractSection(rawOutput, 'WEEK_CALENDAR');
  const tour         = extractSection(rawOutput, 'TOUR');

  // 1. Insert timezone + shiftNotes after common: section
  //    Strategy: find the errors: top-level key and insert before it
  const errorsMarker = /(\n  \/\/ .* Errors .*\n  errors:|\n  errors:)/;
  const errorsMatch = content.search(errorsMarker);
  if (errorsMatch !== -1 && timezone && shiftNotes) {
    content = content.slice(0, errorsMatch) +
      `\n  // ─── Timezone ──────────────────────────────────────────────────────────────\n` +
      `  ${timezone.startsWith('timezone:') ? timezone : `timezone: ${timezone}`}\n\n` +
      `  // ─── Shift notes panel ─────────────────────────────────────────────────────\n` +
      `  ${shiftNotes.startsWith('shiftNotes:') ? shiftNotes : `shiftNotes: ${shiftNotes}`}\n` +
      content.slice(errorsMatch);
  } else if (timezone && shiftNotes) {
    // Fallback: insert before home:
    const homeIdx = content.indexOf('\n  home:');
    if (homeIdx !== -1) {
      content = content.slice(0, homeIdx) +
        `\n  ${timezone.startsWith('timezone:') ? timezone : `timezone: ${timezone}`}\n\n` +
        `  ${shiftNotes.startsWith('shiftNotes:') ? shiftNotes : `shiftNotes: ${shiftNotes}`}\n` +
        content.slice(homeIdx);
    }
  }

  // 2. Insert weekStats + invite inside home section (before personalizedActions)
  if (homeExtras) {
    const paIdx = content.indexOf('personalizedActions:');
    if (paIdx !== -1) {
      // Find the start of the line with personalizedActions
      const lineStart = content.lastIndexOf('\n', paIdx - 1) + 1;
      const indent = content.slice(lineStart, paIdx); // whitespace indent
      content = content.slice(0, lineStart) +
        `${indent}${homeExtras.replace(/^(\s+)?/m, '')}\n${indent}` +
        content.slice(lineStart);
    }
  }

  // 3. Insert weekCalendar before analytics: section
  if (weekCalendar) {
    const analyticsMarker = content.indexOf('\n  analytics:');
    if (analyticsMarker !== -1) {
      content = content.slice(0, analyticsMarker) +
        `\n  // ─── Week calendar ─────────────────────────────────────────────────────────\n` +
        `  ${weekCalendar.startsWith('weekCalendar:') ? weekCalendar : `weekCalendar: ${weekCalendar}`}\n` +
        content.slice(analyticsMarker);
    }
  }

  // 4. Insert tour before } as const;
  if (tour) {
    const endMarker = '\n} as const;';
    const endIdx = content.lastIndexOf(endMarker);
    if (endIdx !== -1) {
      const tourBlock = tour.startsWith('tour:') ? tour : `tour: ${tour}`;
      content = content.slice(0, endIdx) +
        `\n\n  // ─── Interactive onboarding tour ────────────────────────────────────────────\n` +
        `  ${tourBlock}\n` +
        content.slice(endIdx);
    }
  }

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`  ✓ applied to locales/${langCode}.ts`);
}

console.log('\nApplying translations to locale files...');
for (const { code } of LANGUAGES) {
  const key = `L-${code}`;
  if (results[key]) {
    try {
      applyToLocale(code, results[key]);
    } catch (err) {
      console.error(`  ✗ Failed to apply ${code}: ${err.message}`);
    }
  } else {
    console.warn(`  ⚠ No result for ${code}, skipping`);
  }
}

const total = Math.round((Date.now() - START) / 1000);
console.log(`\n✅ Done in ${total}s`);
