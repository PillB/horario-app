/**
 * tour-codegen-batch.mjs
 *
 * Phase 3 — Welcome Tour code generation via Anthropic Batch API.
 *
 * Generates 3 new files in one batch (50% off standard pricing):
 *   1. contexts/WelcomeTourContext.tsx
 *   2. components/TourSpotlight.tsx
 *   3. components/TourStep.tsx
 *
 * Usage:
 *   node --env-file=.env.local scripts/tour-codegen-batch.mjs
 *
 * Outputs:
 *   contexts/WelcomeTourContext.tsx
 *   components/TourSpotlight.tsx
 *   components/TourStep.tsx
 *   scripts/tour-codegen-results.json
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function stripFences(text) {
  return text
    .replace(/^```(?:typescript|tsx|ts|jsx|js)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

// ─── Shared codebase context injected into every prompt ──────────────────────

const LOCALE_CTX    = read('contexts/LocaleContext.tsx');
const IDENTITY_CTX  = read('contexts/IdentityContext.tsx');
const INFO_TOOLTIP  = read('components/InfoTooltip.tsx');
const COLORS        = read('constants/Colors.ts');
const APP_LAYOUT    = read('app/_layout.tsx');
const TABS_LAYOUT   = read('app/(tabs)/_layout.tsx');

const CODING_STANDARDS = `
## Coding standards (must follow exactly):
- TypeScript strict mode — never use \`any\`.
- Functional components only, no class components.
- All interactive elements must have accessibilityRole, accessibilityLabel, accessibilityHint.
- Use StyleSheet.create — no anonymous inline style objects.
- Use useMemo/useCallback for expensive computations or stable prop references.
- Prefer controlled state; no uncontrolled refs for form state.
- Import from '@/' path aliases (e.g. '@/constants/Colors', '@/components/ThemedText').
- Use ThemedText and ThemedView instead of raw Text/View for theming.
- Named exports only (no default exports for components/contexts/hooks).
- File header comment block describing the module's purpose.
- No comments explaining obvious code — only comment non-obvious logic.
- No extra helpers, utilities, or abstractions beyond what is needed.
- Do not add features beyond the specification.
`;

const CONTEXT_FILES = `
## Existing codebase reference files:

### constants/Colors.ts
\`\`\`typescript
${COLORS}
\`\`\`

### contexts/LocaleContext.tsx (follow this pattern for context files)
\`\`\`typescript
${LOCALE_CTX}
\`\`\`

### contexts/IdentityContext.tsx (follow this pattern for provider files)
\`\`\`typescript
${IDENTITY_CTX}
\`\`\`

### components/InfoTooltip.tsx (follow this pattern for Modal + overlay components)
\`\`\`typescript
${INFO_TOOLTIP}
\`\`\`

### app/_layout.tsx (where TourProvider will be added)
\`\`\`typescript
${APP_LAYOUT}
\`\`\`

### app/(tabs)/_layout.tsx (where TourTrigger ? button will be added)
\`\`\`typescript
${TABS_LAYOUT}
\`\`\`
`;

const SYSTEM_PROMPT = `You are an expert React Native / Expo TypeScript engineer.
Generate production-quality source code for the Horario scheduling app.

${CODING_STANDARDS}

${CONTEXT_FILES}

Respond ONLY with the raw TypeScript/TSX source code for the requested file.
No markdown fences, no prose, no explanation. Raw source code only.
The file must compile without errors under TypeScript strict mode.`;

// ─── The 7 tour steps (shared spec) ──────────────────────────────────────────

const TOUR_STEPS_SPEC = `
The tour has exactly 7 steps (stepId 1–7):
  1. id:1  title:"Welcome to Horario!"         description:"Your all-in-one scheduling hub. Let's take a 30-second tour so you get the most out of the app."  target:"home-header"
  2. id:2  title:"Your Daily Streak"            description:"Build a scheduling habit. Your streak grows every day you open the scheduler and make an update."  target:"streak-counter"
  3. id:3  title:"Scheduler Tab"               description:"Add workers, define shift templates, build your roster, and set demand targets — all from here."    target:"scheduler-tab"
  4. id:4  title:"Workers"                     description:"Add your team members with their roles and availability windows so the scheduler knows who is free." target:"workers-section"
  5. id:5  title:"Shift Templates"             description:"Define reusable shift blueprints — role, start time, end time, and minimum coverage required."       target:"shift-templates-section"
  6. id:6  title:"Roster"                      description:"Assign workers to templates for specific dates. The app validates availability and role matches."     target:"roster-section"
  7. id:7  title:"Demand Forecasting"          description:"Set staffing targets per role per day. The AI model can generate forecasts from your historical data." target:"demand-section"

Each TourStep wrapper must accept a \`stepTarget\` prop (string) that matches the target strings above.
The TourSpotlight highlights the registered step by measuring its on-screen layout.
`;

// ─── Batch requests ───────────────────────────────────────────────────────────

const requests = [
  {
    custom_id: 'TOUR_CONTEXT',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Generate the file: contexts/WelcomeTourContext.tsx

Specification:
- Exports: WelcomeTourProvider (component), useWelcomeTour (hook), TourStep type, TOUR_STEPS constant
- TourStep type: { id: number; title: string; description: string; target: string }
- TOUR_STEPS: const array of the 7 steps defined below
- Context state:
    isActive: boolean        // tour overlay is showing
    currentStepIndex: number // 0-based index into TOUR_STEPS
    hasCompleted: boolean    // user has finished or skipped the tour before
    stepLayouts: Record<string, { x: number; y: number; width: number; height: number }>
- Context actions:
    startTour(): void                    // set isActive=true, currentStepIndex=0
    nextStep(): void                     // advance; if last step call completeTour()
    prevStep(): void                     // go back; no-op at index 0
    skipTour(): void                     // set isActive=false, hasCompleted=true, persist
    completeTour(): void                 // set isActive=false, hasCompleted=true, persist
    resetTour(): void                    // clear persisted state, set hasCompleted=false
    registerLayout(target: string, layout: { x: number; y: number; width: number; height: number }): void
- Persistence: AsyncStorage key "horario.tour" stores { hasCompleted: boolean }
  Load on mount. Persist on skipTour/completeTour/resetTour.
- On first app launch (hasCompleted=false and no stored value), do NOT auto-start —
  let the UI trigger startTour() explicitly.
- currentStep computed getter: TOUR_STEPS[currentStepIndex]

${TOUR_STEPS_SPEC}`,
      }],
    },
  },

  {
    custom_id: 'TOUR_SPOTLIGHT',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 6144,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Generate the file: components/TourSpotlight.tsx

Specification:
- No props — reads all state from useWelcomeTour()
- Renders nothing when isActive=false
- When isActive=true, renders a full-screen Modal (transparent, animationType="fade", statusBarTranslucent)
- Backdrop: full-screen semi-transparent overlay (rgba(0,0,0,0.65))
- If the current step has a registered layout in stepLayouts:
    Cut a transparent "spotlight" hole in the backdrop using the measured rect with 8px padding and 12px borderRadius.
    Implement the hole by rendering 4 rectangles (top, bottom, left, right) around the spotlight rect — NOT using SVG or Canvas.
- Callout card (white background, borderRadius 16, shadow elevation 8, padding 20):
    - Step counter: "Step N of 7" (textSecondary color, fontSize 12)
    - Title: bold, fontSize 18, brand.primary color
    - Description: fontSize 14, lineHeight 22, textSecondary color
    - Button row (flexDirection: row, justifyContent: space-between):
        Left: "Skip tour" Pressable (text button, textSecondary color)
               — calls skipTour(); hide when on last step
        Right: primary "Next →" button (brand.primary background, white text, borderRadius 8, paddingHorizontal 20, paddingVertical 10)
               — calls nextStep(); label changes to "Done ✓" on last step
        If currentStepIndex > 0, show a "← Back" text button to the left of "Skip tour"
    - All Pressable elements must have accessibilityRole, accessibilityLabel, accessibilityHint
- Position the callout card:
    - Prefer below the spotlight rect (top = spotlightRect.y + spotlightRect.height + padding + 16)
    - If less than 200px below, place above (bottom = screenHeight - spotlightRect.y + 16)
    - If no layout registered: center vertically in screen
    - Horizontally: center within screen with marginHorizontal 24
- Use brand colors from '@/constants/Colors' (brand object)
- Use ThemedText for all text
- Import useWelcomeTour from '@/contexts/WelcomeTourContext'
- Use useWindowDimensions for screen size

${TOUR_STEPS_SPEC}`,
      }],
    },
  },

  {
    custom_id: 'TOUR_STEP',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Generate the file: components/TourStep.tsx

Specification:
- Exported component: TourStep
- Props:
    target: string          // matches a tour step's target string (e.g. "workers-section")
    children: React.ReactNode
    style?: ViewStyle
- Wraps children in a View with collapsable={false}
- Uses onLayout to capture the layout and calls registerLayout(target, layout) from useWelcomeTour()
- The onLayout callback must be memoized with useCallback
- Passes style prop through to the View
- Full accessibility: the wrapper View should not interfere with children's accessibility
- Keep this component minimal — it is purely a layout-measurement wrapper

Example usage in a parent component:
  <TourStep target="workers-section">
    <WorkerSection ... />
  </TourStep>

Import useWelcomeTour from '@/contexts/WelcomeTourContext'`,
      }],
    },
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  console.log(`📤 Submitting code-generation batch (${requests.length} files)…`);
  console.log('   Model  : claude-sonnet-4-6');
  console.log('   Pricing: ~50% off standard\n');

  const batch = await client.messages.batches.create({ requests });
  console.log(`✅ Batch submitted: ${batch.id}\n`);

  // Save meta
  fs.writeFileSync(
    path.join(__dirname, 'tour-codegen-meta.json'),
    JSON.stringify({ batchId: batch.id, submittedAt: new Date().toISOString() }, null, 2)
  );

  // Poll
  let current = batch;
  let polls = 0;
  while (current.processing_status !== 'ended') {
    const wait = Math.min(20 + polls * 10, 60);
    console.log(`⏳ [${new Date().toLocaleTimeString()}] ${current.processing_status} — waiting ${wait}s…`);
    await new Promise(r => setTimeout(r, wait * 1000));
    current = await client.messages.batches.retrieve(batch.id);
    polls++;
  }

  console.log(`\n🎉 Complete: ${current.request_counts.succeeded} ok, ${current.request_counts.errored} err\n`);

  const OUTPUT_MAP = {
    TOUR_CONTEXT:   'contexts/WelcomeTourContext.tsx',
    TOUR_SPOTLIGHT: 'components/TourSpotlight.tsx',
    TOUR_STEP:      'components/TourStep.tsx',
  };

  const results = {};
  const errors = [];

  for await (const result of await client.messages.batches.results(batch.id)) {
    if (result.result.type === 'succeeded') {
      const text = result.result.message.content
        .filter(b => b.type === 'text').map(b => b.text).join('');
      const code = stripFences(text);
      const outPath = OUTPUT_MAP[result.custom_id];
      if (outPath) {
        const abs = path.join(ROOT, outPath);
        fs.writeFileSync(abs, code, 'utf8');
        console.log(`✅ Wrote ${outPath} (${code.split('\n').length} lines)`);
        results[result.custom_id] = { outPath, lines: code.split('\n').length };
      }
    } else {
      errors.push({ custom_id: result.custom_id, error: result.result.error });
      console.error(`❌ Failed: ${result.custom_id}`, result.result.error);
    }
  }

  fs.writeFileSync(
    path.join(__dirname, 'tour-codegen-results.json'),
    JSON.stringify({ batchId: batch.id, results, errors }, null, 2)
  );

  if (errors.length) {
    console.log(`\n⚠  ${errors.length} error(s) — see scripts/tour-codegen-results.json`);
    process.exit(1);
  }

  console.log('\n✅ All 3 files generated. Next: update app/_layout.tsx and app/(tabs)/_layout.tsx.');
}

main().catch(e => { console.error(e); process.exit(1); });
