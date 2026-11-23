# AGENTS.md — how work is done in this repository

> Path: `AGENTS.md` at the repository root (`/AGENTS.md`). Every coding agent (Claude Code, Codex, Cursor, others) and every person working here follows it. `CLAUDE.md` holds the project facts (stack, architecture, feature status); this file holds the working standard. Where the two disagree on *how* to work, this file wins; on *what exists*, the code wins over both.

---

## 1. The expert standard

Pablo's rule, in his words (2026-11-21):

> "For every feature and for every decision, research online and ask what the best expert in that field would do (supported by evidence or preponderance of research or authoritative resources) and why they would reject your current choice; if you can name that reason, don't make the choice. Optimize for what that expert would judge correct (validating against the evidence-based benchmark or feasible ideal), never for what satisfies the stated constraints most cheaply. Every trade-off you take must be stated to the user, never absorbed."

What that means in practice:

1. **Name the expert and the benchmark.** Before a design choice, write down who the best practitioner is (a labor lawyer of that jurisdiction, an operations-research scheduler, a forecasting statistician, a security engineer, an accessibility auditor, a UX researcher) and what they would measure the result against (the statute text, an exact optimum, a backtest against a naive baseline, OWASP ASVS, WCAG 2.2 AA, a task-completion test).
2. **Run the rejection test.** Ask "why would that expert reject this?" If you can name a reason, the choice is not made. Change it, or state it as a trade-off (rule 4) with the reason it is still the best option available.
3. **Evidence, not memory.** Facts that can change (law, prices, library APIs, platform limits) come from a primary source read in this session, with the date read. Two independent sources for a legal value; a secondary source (law firm note, blog) is only a lead to the primary one. Record the source next to the value (a pack `cite`, a comment, or `research/`). Say "from memory, not re-checked" when that is all there is.
4. **Trade-offs are stated, never absorbed.** Every PR body and every reply to Pablo has a "Trade-offs" (or "Limits, on purpose") part: what was not done, what was chosen over what, and what it costs. A limit found and not written down is a defect.
5. **Optimise for correct, not for cheap.** "The test passes" or "the constraint is met" is not the goal; what the expert would call correct is. If the ideal is out of reach, say what the feasible ideal is and how far the change is from it.

Areas that get the most scrutiny, in this order:

- **Methodological and scientific correctness**: labor rules match the statute on the date they apply; the forecaster is compared against seasonal naive by rolling-origin backtest (MASE), never judged by in-sample fit; the optimizer's result is checked by an independent checker, not by the solver's own status; times are elapsed time in the business IANA zone.
- **State of the art**: compare against the current best technique (see `research/scheduling-sota-2026-10.md` and the forecasting notes) and say why the chosen one is used.
- **Usability and the user flow**: a manager finishes the job with the fewest steps and no dead ends; every error says what happened and what to do next; nothing fails silently.
- **Quality-of-life**: undo or rollback, sensible defaults, keyboard and screen-reader access, offline and slow-network behaviour.

---

## 2. Rounds

Work in rounds. A round is one coherent change you could explain in one sentence.

1. **Pre-execution round (before the first edit).** Read the files you will change and the tests that cover them. List at least two routes to the goal. For each, run the rejection test (§1.2) and, when it is cheap, a spike or a probe (a failing test, a query against the local database, a benchmark). Pick one and write down why the others lost.
2. **Red-team the chosen route.** List the ways it can be wrong: edge cases (empty, one, many, duplicates, limits), time (DST gap and overlap, overnight, leap day, year end, a dated rule's next phase), concurrency (two requests, a retry after a lost answer), tenancy (another account's id), permissions (member vs manager), failure (network, timeout, partial write), and drift (§5). Each one becomes a test or a written limit.
3. **Implement**, smallest change that is correct.
4. **Introspective round (after it works).** Re-read the diff as the expert would. Did a requirement get quietly weakened? Is there a simpler correct route now that the problem is understood? Is anything claimed that was not run?
5. **Close the round with a test** (§3) and the gate (§6).

---

## 3. Tests

### 3.1 A test for every task and every round

Every task, and every round inside a task, ends with at least one test that would have failed before the change. No exceptions for "small" changes, docs-only changes that alter behaviour claims, config, CI or tooling (tooling gets a test too: see `scripts/complexity/__tests__/gate.test.ts`).

- **Bug fix**: first write the test that reproduces the bug and watch it fail, then fix. Say in the PR that it failed before.
- **Feature**: tests for the behaviour a user relies on, including the error path.
- **Refactor**: the existing tests must cover the code being moved; add them first if they do not.
- **A change that cannot be tested automatically** (a visual check, a third-party dashboard): say so, say how it was checked by hand, and add the closest automatic check that exists.

### 3.2 Tautological tests considered harmful

A tautological test passes no matter whether the code is right, so it gives confidence without evidence. Do not write them; delete or rewrite them when found. Signs:

- It asserts that a mock returns what the test told it to return.
- It recomputes the expected value with the same code (or a copy of the same formula) as the implementation.
- It copies a constant from the source and asserts the source still has it, with no independent reason for the value (a law, a spec, a hand calculation).
- It is a snapshot nobody reads, accepted with `-u` whenever it changes.
- It still passes when the function body is deleted, or when the condition under test is inverted.
- It only checks that something "is defined", "does not throw" or "was called", where the result matters.

Write instead:

- **Oracle tests**: the expected value comes from outside the code: the statute's own example, a hand-worked schedule, a published dataset, an exact solver on a small case, an independent checker (`services/__tests__/shiftAssigner.fuzz.test.ts`).
- **Property and fuzz tests** for engines (no assignment breaks a hard constraint; the ILP is never worse than the greedy).
- **Boundary tests** on both sides of every limit (at the limit passes, one over fails) and on both sides of every date a rule changes.
- **Mutation check (by hand)**: break the line under test (flip a comparison, drop a branch) and confirm a test fails. Do it at least once per round for the core change.

### 3.3 Fail verbose, with clear diagnostics

A failing test or gate must tell the reader what broke without opening the code: the input, the expected and actual values, where (file, function, pack, date), and the next step. Prefer `expect(list).toEqual([])` over `expect(list.length).toBe(0)` so the offending items are printed. Scripts exit non-zero with a sentence per problem, never a bare stack trace. Errors shown to users say what happened and what to do, and never leak internal messages (see PR #62).

### 3.4 Where tests run

- `npm test` (unit, component, hook; also the complexity gate's repository check)
- `npm run test:integration` and `npm run test:db` against a local Supabase (CI job `database`)
- `npx playwright test --trace off` (CI job `e2e`)
- `npm run test:drift` (time zones and a future clock, §5; CI job `drift`)

Re-run only what failed while fixing, then the whole suite once before the commit.

---

## 4. Complexity ceiling (chore(lint))

`npm run lint:complexity` (`scripts/complexity/gate.js`, CI job `checks`) fails when a function's cyclomatic complexity (ESLint `complexity`) is above **15**.

- Why 15: McCabe proposed 10; NIST SP 500-235 (Watson and McCabe, 1996) accepts up to 15 when the team has the means to review and test the extra paths, which the ratchet and §3 provide. ESLint's default is 20. At 10 the repository has 129 functions over, at 15 it has 62, at 20 it has 36 (2026-11-21).
- **Trade-off, stated**: cyclomatic complexity counts paths, not difficulty. A flat `switch` that dispatches proxy actions scores high and reads easily; a short function with nested callbacks can score low and be hard. The ceiling is a prompt to split, and a reviewer may accept a baselined dispatch table. It does not replace review.
- Functions over the ceiling when the gate was added are in `complexity-baseline.json` with their count. The gate is a ratchet: a new function above 15 fails, a baselined one that grows fails, one that shrank or went away fails until the baseline is updated (`npm run lint:complexity -- --update`). Never raise a baseline number to make CI pass; split the function. If raising it is truly right, say why in the PR.
- The rule is not in `eslint.config.js`, because lint-staged runs ESLint with `--max-warnings=0` and would block every commit to a baselined file. Run the gate before pushing.

---

## 5. Drift: what changes under the code

Past failures in this project came from things that changed while the code stood still. Each class has a guard; keep them working.

| Source of drift | Seen here | Guard |
|---|---|---|
| Labor law changes (reforms, phased limits, court rulings) | Brazil EC 141/2026 and Mexico's 2026 LFT reform made packs stale; Canada provinces resolved to the federal code | `services/labor/__tests__/packIntegrity.test.ts` (dated values in order and real dates, cites usable, every pack evaluates on every phase date); `npm run labor:drift` and the weekly `labor-drift` workflow (packs not reviewed in 90 days, phases taking effect in the next 60 days, dead source links). A new value needs a primary source and an entry in `services/labor/sourceReview.ts`. |
| Clock | Tests and code written for "now" (2024 sample dates, trial windows) | `npm run test:drift` runs the suite with the clock moved forward (`HORARIO_TEST_NOW`, `scripts/testing/fakeNow.js`). Never hard-code an "upcoming" date in a test; build it from a fixed reference or from the faked now. |
| Time zone of the machine | Hydration error #418 on /scheduler; dates parsed in the device zone | The drift job runs the suite in `America/Lima` and `Pacific/Kiritimati` (UTC+14). Business times always use the location's IANA zone. |
| Time-zone database (tzdata / ICU) | Zone renames (Europe/Kiev → Kyiv), new zones (America/Coyhaique, 2025b), ICU canonical names differ from IANA | `utils/__tests__/zoneData.test.ts`: every zone Horario accepts is known to the runtime and resolves to the right country. |
| Dependencies and platforms | Lockfile out of sync (CI never green, baseline B1); Playwright 1.58 without Chromium for a newer runner; the `highs` ESM build breaking classic workers; no WebAssembly in Hermes | `scripts/__tests__/dependencyDrift.test.ts`: React packages on one exact version, Expo packages on one SDK, `highs` pinned exactly and matching the lockfile and CLAUDE.md, Node engines matching CI. Upgrade on purpose, one family at a time, with the changelog read. |
| Documentation vs code | Changelog claimed "tests pass" while CI was red; CLAUDE.md feature rows go stale | Report only what was run in this session, with the numbers (§7). Mark CLAUDE.md rows "re-verified" only after checking. |

When you add a rule, a dependency or a data source, add its drift guard in the same PR.

---

## 6. Gate before every commit

```
npx tsc --noEmit
npm run lint
npm run lint:complexity
npm test
```

Plus `npm run test:drift` when the change touches dates, times, time zones, labor packs or plans; the database and browser suites when it touches SQL, the proxy or a user flow. CLAUDE.md §12 still applies: a `CHG-###` entry in `Claude_changes.md` before each commit and the id in the commit message. Check open PRs for the next free id first.

---

## 7. Reporting

- Say what was run and what it printed ("jest 1240 passed, 50 skipped"), not "tests pass". Never repeat a claim from a changelog or another agent without re-running it.
- Lead with the outcome, then the trade-offs (§1.4), then what is still open.
- A finding you could not fix goes into the PR body and `CLAUDE.md` §11 with its reason.

---

## 8. Root causes seen so far (retrospective, 2026-11-21)

From `qa/` and `setup/` in the project files and the git history (CHG-000 to CHG-101). Each class names the guard that now exists or the rule above that covers it.

1. **Claims without runs** (CI red for six runs while the changelog said green; "0 errors" repeated): §7, CI on every PR.
2. **Authorization and tenancy by convention** (IDOR on delete and update, client-chosen tier, auth failing open, anon RLS reads; member writes): server-side checks, `memberPermissions.test.ts`, RLS tests in CI.
3. **Time handled as local wall clock** (night shifts skipping rest, availability across midnight, zero-length shifts in the DST gap, impossible dates accepted, hydration errors): elapsed time in the IANA zone, the drift job, boundary tests on DST dates.
4. **Silent partial results** (under-coverage reported as full, signals truncated at 1000 rows, offset paging dropping rows): every cap returns a flag and the UI shows it; tests assert the flag.
5. **Read-then-write races** (plan limits, double booking): CLAUDE.md "Concurrency" rules; integration tests with simultaneous requests.
6. **Stale law** (Brazil, Mexico, Canada, Peru): §5 first row.
7. **Dependency and platform assumptions** (lockfile, runner images, ESM vs CommonJS in workers, Hermes without WASM): §5.
8. **Optimistic UI out of order** (rollback restoring a stale snapshot, tenant switch mid-write): `usePersistedList` guards and their tests.
9. **Accessibility regressions** (missing labels, contrast, aria-checked dropped by react-native-web): CLAUDE.md React rules and the locale key test. There is no automated axe check in the browser tests yet; the 2026-10-20 spot check was run by hand.
10. **Complexity growth** in the screens and the labor engine (functions of complexity 30 to 50): §4.
