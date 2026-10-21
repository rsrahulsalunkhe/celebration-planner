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

### Stage 4: Interface shell and design system

No domain logic was changed: the planning engine, schemas, reducer and persistence are as in stage 3.

- **Shell:** navy sidebar (brand, event switcher, navigation, "Your data") on wide screens; sticky compact bar with brand, active event title and a labelled Menu button below 62rem. Skip link, one banner, one main, a labelled nav and aside, focus moved to the page heading after navigation, tab title following the page, error boundary so a failing page never blanks the app, and a Page not found screen inside the shell.
- **Pages:** Overview (event details, preferences, **guest planning** with add, reply and remove, edit and delete), New event (demonstrations plus the form), and Budget, Timeline, Vendors, Ideas and Assistant, which show only real figures from the active event (budget, reserve, left to plan, dates, counts) beside a clear "Not built yet" card. Your data restyled.
- **Components:** Button (with an icon-only mode that keeps a text label), ButtonLink, FormField with TextField, Select, Checkbox and CheckboxGroup built on it, Card, Badge, EmptyState, ErrorState, ConfirmDialog (native modal `<dialog>`) with ConfirmAction, StatusMessage (always-present live region), FactList, Stack, ComingSoon.
- **Hosting:** `BASE_PATH` configures the Vite base for repository subpaths; the default stays relative.
- **Visual system:** warm light surfaces, navy, restrained gold and coral, system fonts. The earlier dark colour scheme was dropped deliberately.

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

- **Stage 4:** the interface is light only. The stage 1 to 3 dark scheme was removed so the navy and warm palette could be tuned for contrast once.
- **Stage 4:** confirmation uses the native `<dialog>` with `showModal()`, so the browser provides the inert background and focus containment; jsdom lacks it, so unit tests use a small stand-in and real behaviour was verified in Edge.
- **Stage 4:** the skip link is handled in script (`preventDefault` then focus `main`), because a plain `#main` link would be read by HashRouter as a route change.
- **Stage 4:** the menu is "open for" one navigation (state keyed by `location.key`), so any navigation closes it without an effect. The error boundary is keyed by path, so replacing history state does not remount a page.
- **Stage 4:** the creation notice travels in router state with the new event's id and is cleared once shown, so it never appears under a different event.
- **Stage 4:** the old `/events` address redirects to the Overview.
- **Stage 4:** Budget, Timeline, Vendors and Ideas pages do not call the planning engine; they show only simple values already in state. Showing generated plans is the next stage.

## Verification results (actually run)

Windows, Node v24.16.0, npm 11.17.0, at the end of stage 4.

| Check                  | Result                                          |
| ---------------------- | ----------------------------------------------- |
| `npm run typecheck`    | exit 0                                          |
| `npm run lint`         | exit 0                                          |
| `npm run format:check` | exit 0                                          |
| `npm run test:run`     | 21 files, 338 tests passed                      |
| `npm run build`        | OK; JS 421.14 kB (130.95 kB gzip), CSS 15.16 kB |
| Real browser (Edge)    | 168 of 168 checks passed (details below)        |

**Real-browser check** (headless Edge driven over the DevTools protocol with real mouse and keyboard events; a scratch script, not part of the repository). Run at 1280 px, 390 px and 320 px, against the default build, a `BASE_PATH=/celebration-planner/` build served under that subpath, and the default build served from an unrelated subfolder:

- Landmarks (one banner, main and nav), no horizontal scroll, navy 280 px sidebar on desktop, menu button and hidden navigation on mobile, event title visible in the bar, content not under the bar, heading never hidden under the sticky bar after focus.
- Keyboard: skip link is first and visible and does not change the route; Tab reaches the Menu button and links; Enter and Space open the menu; Escape closes it and returns focus to the button; Enter on a link navigates, closes the menu and focuses the new heading; the tab title follows.
- Mouse: create a demo, add a guest (live-region announcement, counts update), switch events, delete with confirmation, all persisted to localStorage.
- Dialog: modal (`:modal`), focus starts on Cancel, Tab and Shift+Tab never reach the page behind, Escape and a backdrop click close it and return focus, cancelling deletes nothing.
- Unknown address shows a page inside the shell. Reduced motion removes transitions.
- axe-core (WCAG 2.0 to 2.2 A and AA plus best practices): no violations on welcome, menu open, new event, overview with an event and a guest, Budget, Timeline, Vendors, Assistant, Ideas, Your data, not found and the open dialog, at each width.
- No console errors, warnings, exceptions or failed requests in any run; deep links work in both base-path builds.

Defects found by the real browser or screenshots and fixed this stage: content outside any landmark (axe "region"); the menu staying open over the content after choosing an event on mobile; a stale "Created ..." notice appearing under a different event (found in a screenshot, regression test added and mutation-checked); a truncated event select; at 320 px the brand wrapped and the focused heading sat under the sticky bar; `replace` navigation remounting the page and losing its message. An unrelated test timeout under heavy parallel load was also fixed with an explicit timeout.

Not verified:

- No real screen reader (NVDA, JAWS, VoiceOver) was used; axe and keyboard checks do not replace that.
- Only Edge (Chromium) was driven. Firefox and Safari were not run, nor a physical phone (touch, on-screen keyboard, viewport changes).
- The browser script is not in the repository, so these browser checks are not repeatable by the project's own commands. Unit tests cover behaviour in jsdom only.
- Print layout, zoom to 400% and Windows high-contrast mode were not checked.
- Colour contrast was checked by axe only on the states listed.
- The GitHub Actions workflow has never run (no remote).

## Remote and push

No remote is configured, so nothing has been pushed. Add one with `git remote add origin <url>` and push `main`.

## Remaining work

1. **Show the plan:** generated plan with reasons, forecast against budget, shortfall, conflicts and options on Overview and Budget, with an apply button, using the existing engine.
2. **Constraint-change flow in the UI:** edit guests, budget, date, reserve or needs; show the `previewChanges` result; accept or reject. Add an editable reserve field.
3. **Timeline, Vendors, Ideas pages:** manage tasks and status, vendors with quotes, commitments, deposits and payments, and ideas.
4. **Export:** a readable (print or Markdown) export beside JSON, and JSON import with validation.
5. **WebLLM assistant** in a Web Worker behind `AssistantAdapter`, with session-only chat and proposals going through `previewChanges`.
6. **Repeatable browser checks:** turn the scratch Edge script into a maintained e2e script and CI job, and test Firefox and a real phone.
7. **Replace the provisional evaluation criteria** in `docs/PROJECT_BRIEF.md` once the real six are supplied.
