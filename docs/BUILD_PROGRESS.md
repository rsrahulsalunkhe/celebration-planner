# Build progress

## Completed stages

### Stage 1: Scaffold

- Repository initialised on `main`. Vite + React 19 + strict TypeScript, `HashRouter`, CSS Modules and CSS variables (light and dark), Context + `useReducer`, Zod, `lucide-react`.
- ESLint 10 (type-checked rules), Prettier, Vitest + Testing Library, CI workflow, project docs.
- Domain utilities: integer-minor-unit money and UTC calendar-date arithmetic.

### Stage 2: Domain model, state, demos, persistence

- **Types and runtime schemas** (Zod; types are inferred) for `EventProfile`, `Preferences`, `BudgetCategory`, `ExpenseItem` (with `Payment`), `PlanningTask`, `Vendor`, `GuestRecord`, `Idea`, `AssistantMessage`, `ProposedChange` (with `ChangeOperation`) and `SavedAppState` (per-event `EventRecord`).
- **Validation:** INR and integer paise only; finite, safe-integer-bounded numbers; positive budget; positive integer guest count; real calendar dates (2000 to 2100); trimmed, length-bounded text with control characters rejected; documented collection limits in `LIMITS`; unique ids, unique template ids and referential integrity (expense to category or vendor, task to vendor) checked on every load and every edit.
- **No silent zero:** the form reports blank or malformed amounts and counts as field errors; `committedPaise` and `quotePaise` use `null` for "none yet" instead of `0`.
- **Separate money views:** planned allocation (`BudgetCategory.plannedPaise`), estimated expense (`ExpenseItem.estimatePaise`), committed total (`committedPaise`), and dated `payments`. Paid totals are derived.
- **Provenance:** `plannedOrigin`, `estimateOrigin` and `dueDateOrigin` record `generated` versus `user`. Demo events carry `demoPresetId`.
- **Stable ids:** `src/data/templates.ts` holds the category, expense and task template catalog; `generatedId(eventId, templateId)` derives deterministic ids. Amounts, weights and due-date offsets are left to the plan generator stage.
- **Birthdays:** optional age band only; an age band on a non-birthday is rejected.
- **State:** one canonical `SavedAppState` with multiple events and one active event. Pure reducer actions: `event/create`, `event/switch`, `event/delete`, `event/edit` (list of `ChangeOperation`s, optional `expectedRevision`), `state/reset`. Invalid, stale or over-limit actions return the same state object. Each accepted edit raises `profile.revision` by one. Selectors (`src/domain/selectors.ts`) derive budget summary, task progress, overdue tasks, guest summary and days-until; nothing derived is persisted.
- **Demo presets:** wedding (200 guests, ₹5,00,000, +90 days), birthday (40, ₹50,000, +14), outdoor community event (150, ₹2,00,000, +30, wheelchair access), each clearly labelled fictional. Dates come from an injected `CalendarHelper`.
- **Persistence:** versioned envelope (`schemaVersion` 1) under `celebration-planner:saved-state`; payload capped at 2,000,000 characters on read and write; every read and write is in try/catch. `PersistenceStore` (plain class, no React) owns the lifecycle. Chat is never persisted.
- **Recovery:** corrupt, too-new, oversized or unreadable saved data pauses saving, so it is never overwritten, while the app keeps working in memory. A notice offers Download saved data, a confirmed Clear saved data, and Keep working. Blocked storage shows an export prompt. A full quota or failed write shows Try saving again. Clear saved data removes only keys starting with `celebration-planner:`.
- **UI:** Events page (list, switch, delete with confirmation, create and edit form with error summary and focus on the first error, demo presets) and a Data page explaining that data stays in this browser, is not an account and is not encrypted. New accessible controls: `TextField`, `SelectField`, `CheckboxGroup`, `ConfirmAction`.

### Stage 3: Planning engine

Pure TypeScript in `src/domain/planning` (no React, no browser, no clock; a test enforces it) with typed rule configuration in `src/data/planning`. Rules are documented in `docs/PROJECT_BRIEF.md`.

- **Functions:** `generatePlan(event, configuration, today)`, `proposeChange`, `previewChanges(state, proposedChange, today)`, and explicit `allocateTargets`, `forecastExpenses`, `assessFeasibility`, `scheduleTasks`, `buildRecommendations`, `analyzeEvent`, `reconcileOperations`.
- **Configuration:** wedding, birthday and community each have their own category weights, milestone tasks (with dependencies and lead times), vendor checklists, idea tags and ideas, planning horizon and written reasoning. Config is validated (unique ids, known references, positive weights, task cycles, ordering).
- **Money:** 10% default reserve, editable per event; exact BigInt largest-remainder allocation with locked targets and floors; forecasts independent of targets; per-guest versus fixed costs and agreements; deposits inside commitments; shortfall, conflicts and options with exact numbers; required accessibility and dietary provisions floored and never offered as savings.
- **Dates:** stable task ids, dependencies, ideal deadlines preserved, catch-up and compression with an explanation, preparation never after the event, follow-ups allowed later, urgency derived from today, cycle detection, past events treated as history, new events in the past rejected (create form).
- **Recommendations:** each names the facts behind it; outdoor backup without any weather forecast; cultural practices only for entries the user typed.
- **Schema changes this stage:** `ExpenseItem` now has `estimate` and `commitment` unions (fixed or per-guest, with a deposit) instead of `estimatePaise` and `committedPaise`, plus `requirement`, `optional` and `rationale`; `PlanningTask` gains `kind`, `importance`, `idealDueDate` and `dependsOn`; `Idea` gains `tags`; the profile gains optional `reserveBasisPoints`. No stored data could contain expenses yet (no UI created them), so the saved-data version stays 1.
- **Wired into the UI so far:** only the past-date rule on the new-event form. The engine is not yet shown on any page.

## Decisions

- **Node 24 LTS**, `engines: >=24.15.0 <25`, `.nvmrc` is `24`. Needed by Vitest 5 and jsdom 30.
- **TypeScript 6.0.3, not 7.0.2.** `typescript-eslint` 8.72.0 declares `typescript <6.1.0`.
- **No `eslint-plugin-jsx-a11y`.** Its latest release supports ESLint up to 9 only.
- Path alias `@/` maps to `src/`. `base: './'` so the build works from any sub-path.
- `EventProfile` holds identity and core facts; `Preferences` holds priorities, dietary, accessibility and cultural text. Both live in the event record.
- Currency is fixed to INR (no per-event currency field). The stage 1 field was removed.
- All edits go through `ChangeOperation`s, so user edits and accepted proposals share one validated path and one revision rule.
- Removing a category removes its expenses; removing a vendor unlinks it from expenses and tasks, so references never dangle.
- "Clear saved data" also resets the events open in the tab, so cleared data is not immediately re-saved.
- The stage 1 key `celebration-planner:v1` is not migrated (it only held a fictional sample). It is removed by Clear saved data.
- The stage 1 `src/data/fixtures.ts` sample was replaced by the demo presets.
- No `e2e/` or `scripts/` directories yet; nothing implements them.

- **Stage 3:** `generatePlan` takes the event (profile plus preferences) rather than the profile alone, because priorities, dietary and accessibility needs live in preferences.
- **Stage 3:** the reserve is held back from targets, so "unallocated" is measured against budget minus reserve (the stage 2 selector changed accordingly).
- **Stage 3:** the engine returns generated values as ordinary schema objects, and consequences of a constraint change are expressed as ordinary `ChangeOperation`s, so previewing and accepting share the validated edit path.
- **Stage 3:** generated items that no longer apply are removed only when nothing is at stake (no commitment or payment, not started, not saved or dismissed); otherwise they are kept.
- **Stage 3:** blocking conflicts (required provision removed, date moved into the past) stop a proposal; critical ones (over budget) are shown but do not, because the user may choose to accept them.
- **Stage 3:** category weights approximate cost shares under the fictional rates, so targets and forecasts start roughly aligned. The rates are illustrations, not market data.
- **Stage 3:** `src/data/templates.ts` (stage 2 id catalog) was replaced by the full configuration. Template ids are unchanged in form.

## Verification results (actually run)

Windows, Node v24.16.0, npm 11.17.0, at the end of stage 3.

| Check                  | Result                                                     |
| ---------------------- | ---------------------------------------------------------- |
| `npm run typecheck`    | exit 0                                                     |
| `npm run lint`         | exit 0                                                     |
| `npm run format:check` | exit 0                                                     |
| `npm run test:run`     | 19 files, 300 tests passed                                 |
| `npm run build`        | OK; JS 403.98 kB (125.43 kB gzip), CSS 9.36 kB             |
| Mutation checks        | 6 deliberate rule breaks, each caught by tests (see below) |

Required numeric cases, all asserted: 10,001 paise with a 1,000 reserve and weights 50:30:20 gives 4,501, 2,700 and 1,800; INR 400 per guest gives INR 48,000 for 120 guests and INR 72,000 for 180; INR 10,000 committed with INR 3,000 paid leaves INR 7,000 outstanding; identical input gives identical output (byte-identical JSON); today, tomorrow, month-end and leap-day deadlines; infeasible budgets give explicit conflicts and options.

Completion check: the engine produces distinct, explainable plans for the three presets. With today pinned to 2026-10-21: wedding forecast ₹4,39,000 (spendable ₹4,50,000), birthday ₹37,000 (₹45,000), community ₹1,43,000 (₹1,80,000). Targets plus the 10% reserve equal each budget exactly.

Mutation checks (each rule was broken in turn, tests run, then restored): deposit added to cost (2 tests failed), required items offered as savings (2), preparation allowed after the event (1), a hidden `Date.now()` in the engine (1), reserve dropped from the allocation (16), cultural tasks added unasked (4). The "after the event" mutant first survived because the clamp is unreachable for valid templates; a test with a follow-up dependency was added and now kills it.

Defects found by tests or checks while building: a wedding at ₹2,00,000 correctly offers no fewer-guests option because fixed costs alone exceed the budget (the expectation, not the engine, was wrong); category weights initially ignored the rates and left targets far from forecasts (retuned); Prettier reformatting broke two of my scripted edits, caught before they could change files silently.

Not verified:

- The engine is not displayed in the UI; no page shows a plan, shortfall, conflicts or a before-and-after preview, and nothing applies a plan from the app. It is covered only by unit and integration tests on domain data.
- Rates, weights, lead times and horizons are fictional or illustrative and have not been checked against real events or reviewed by anyone who plans them.
- Performance beyond the tests (about 360 plan generations in under two seconds) was not measured.
- Reload and recovery against a real browser's `localStorage`, assistive-technology use, real quota exhaustion, multi-tab behaviour, and the CI workflow remain unverified, as in stage 2.

## Remote and push

No remote is configured, so nothing has been pushed. Add one with `git remote add origin <url>` and push `main`.

## Remaining work

1. **Show the plan:** an Overview or Budget page for the active event: the generated plan with reasons, forecast against budget, shortfall, conflicts and options, with a button to apply the plan.
2. **Constraint-change flow in the UI:** edit guests, budget, date, reserve or needs; show the `previewChanges` result; accept or reject. Add an editable reserve field.
3. **Budget, timeline, vendors, guests, ideas pages:** manage the plan, including commitments, deposits and payments, and task status.
4. **Export:** a readable (print or Markdown) export beside JSON, and JSON import with validation.
5. **WebLLM assistant** in a Web Worker behind `AssistantAdapter`, with session-only chat and proposals going through `previewChanges`.
6. **E2E tests, accessibility audit, deployment workflow:** add scripts only when implemented.
7. **Replace the provisional evaluation criteria** in `docs/PROJECT_BRIEF.md` once the real six are supplied.
