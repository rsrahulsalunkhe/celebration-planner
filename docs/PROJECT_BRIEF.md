# Project brief: Celebration Planner

Challenge 5, Celebration & Event Planner. A complete static frontend application.

## Scope

**Essential journey:** enter event context → generate an explainable plan → change a constraint → inspect its consequences → manage the plan → export it.

**In scope:** event details, rule-based plan generation with visible reasoning, budget, timeline, vendor tracking, ideas, an optional on-device assistant, local persistence, and JSON export.

**Out of scope:** backend, serverless functions, authentication, hosted database, paid APIs, any browser-exposed API secret, user accounts, multi-user sync.

## Personas

- **Wedding organizers**: many guests, large budgets, long lead times, many vendors.
- **Birthday hosts**: small to mid-size events, tight timelines, budget-sensitive.
- **Community volunteers**: low or zero budget, shared logistics, need clear task lists.

## Architecture

Static single-page app. No server; all data stays in the browser.

| Layer      | Choice                                                                   |
| ---------- | ------------------------------------------------------------------------ |
| UI         | React 19, TypeScript (strict), Vite                                      |
| Routing    | React Router with `HashRouter` (works on any static host)                |
| Styling    | CSS Modules plus CSS variables (`src/styles/tokens.css`, light and dark) |
| State      | React Context with `useReducer` (`src/app/state`)                        |
| Validation | Zod; types are inferred from the schemas (`src/domain`)                  |
| Icons      | `lucide-react`                                                           |
| Tests      | Vitest, jsdom, Testing Library                                           |

Layout:

- `src/app`: shell (sidebar, compact menu, event switcher), providers, routing, state, error boundary.
- `src/domain`: types, Zod schemas, money and date utilities, selectors, and `planning/`, the pure planning engine (no React, no browser, no clock; enforced by a test).
- `src/features`: `events`, `budget`, `timeline`, `vendors`, `assistant`, `ideas`, plus `data` (saved-data explanation, export and clear).
- `src/components`: reusable accessible controls (Button, ButtonLink, FormField, TextField, Select, Checkbox, CheckboxGroup, Card, Badge, EmptyState, ErrorState, ConfirmDialog, ConfirmAction, StatusMessage, FactList, Stack, ComingSoon).
- `src/services`: storage, export, AI adapters.
- `src/data`: demo presets, labels, and `planning/`, the typed rule configuration (one file per event type).
- `src/styles`, `src/test`, plus `e2e`, `scripts`, `docs`, `.github/workflows` when needed.

Key design rules:

- Money is INR as an integer count of paise; never a float. Budgets must be positive; blank or invalid input is an error, never zero.
- Dates are `YYYY-MM-DD` strings; arithmetic runs in UTC. Anything derived from "today" takes an injected `CalendarHelper`.
- Birthdays use an optional age band, never a birth date.
- One canonical state (`SavedAppState`) changed only by a pure reducer; totals, percentages and filtered lists are derived by selectors and never stored.
- The planned allocation, estimated expense, committed total and payments are separate fields. Generated defaults carry an `origin` of `generated`; explicit edits carry `user`. Generated items have stable template-derived ids.
- Persisted data is a versioned, size-bounded envelope validated with Zod on load. Corrupt, too-new or unreadable data is never silently overwritten: saving pauses until the user downloads or clears it.
- Chat messages and proposed changes are session-only and never persisted.
- Data stays in this browser's localStorage under keys prefixed `celebration-planner:`. It is not an account and is not encrypted.
- Core planning is deterministic and rule-based. It must work without a model.
- The planning engine takes today's date as an argument and never reads the clock or randomness. Identical input gives identical output.

### Interface

- **Information architecture:** Overview (event details, preferences and guest planning), Budget, Timeline, Vendors, Assistant, Ideas, plus New event and Your data. Guest planning is a card inside Overview, not a top-level section. An event switcher in the sidebar chooses the active event.
- **Routes (HashRouter):** `/` Overview, `/new`, `/budget`, `/timeline`, `/vendors`, `/assistant`, `/ideas`, `/data`; `/events` redirects to `/`; any other address shows a Page not found screen inside the shell.
- **Layout:** a navy sidebar with warm light surfaces and restrained gold and coral accents (`src/styles/tokens.css`), light only, system fonts, no images beyond a small SVG icon. Below 62rem the sidebar becomes a sticky bar showing the brand, the active event title and a labelled Menu button that opens the navigation beneath it.
- **Honesty:** sections that are not built say so ("Soon" in the menu, a "Not built yet" card on the page) and show only figures computed from the active event. There are no placeholder totals, fake controls or invented notifications. Status messages appear only for real outcomes.
- **Accessibility:** one banner, one main, a labelled navigation and an aside; a skip link (handled in script, because a bare `#main` link would change the HashRouter route); one `h1` per page that receives focus after navigation, with the tab title following it; visible labels and focus rings; native controls; a modal `<dialog>` for confirmations (focus starts on Cancel, Escape and a backdrop click cancel, focus returns to the opener); always-present live regions; 44px minimum targets; reduced-motion support; focus never hidden under the sticky bar.
- **Hosting:** `vite.config.ts` reads `BASE_PATH` (default `./`, relative). Set it to `/repo-name/` for repository subpath hosting; invalid values stop the build. See the README.

### Planning engine

Entry points in `src/domain/planning`:

- `generatePlan(event, configuration, today)`: a complete, explained plan. `event` is the profile plus preferences (priorities, dietary, accessibility and cultural text live in preferences), and optionally existing categories so user-fixed targets are kept.
- `proposeChange({ record, patch, preferences, configuration, today, id })`: a `ProposedChange` carrying the constraint change and every consequence for generated values.
- `previewChanges(state, proposedChange, today)`: what accepting a proposal would do (before and after, field changes, money, expenses, tasks, conflicts), without changing anything.
- Explicit building blocks: `allocateTargets`, `forecastExpenses`, `assessFeasibility`, `scheduleTasks`, `buildRecommendations`, `analyzeEvent`.

Money rules:

1. The budget includes a contingency reserve: 10% by default, editable per event (`reserveBasisPoints`, 0 to 50%), rounded down.
2. Spendable money (budget minus reserve) is shared by normalized integer weights with an exact largest-remainder allocation (BigInt), after user-fixed targets and floors.
3. When the allocation is valid, targets plus reserve equal the budget to the paisa. If it is not valid (fixed targets or required provisions do not fit), the result says so and is not "balanced".
4. Targets are spending goals. Forecasts are computed separately from fictional fixed or per-guest rates, or from agreed quotes.
5. Per-guest estimates and agreed per-guest rates change with the guest count; fixed costs and agreed fixed quotes do not.
6. A deposit is part of a commitment, never added to the cost. Outstanding is committed minus paid.
7. If the forecast exceeds the budget or the spendable amount, the result gives a numerical shortfall and gap, explicit conflicts, and options with exact numbers (use reserve, drop optional items, fewer guests, raise the budget).
8. Affordability is judged by forecast against budget. Redistributing targets cannot make a plan look affordable.
9. Required accessibility provisions and stated dietary needs are flagged, floored in the allocation, and never offered as savings. Removing one while its need is still stated blocks a proposal.
10. Accounting (`src/domain/planning/budget.ts`): an expense contributes its agreed total when present, otherwise its estimate. Payments are part of a commitment, need one and must not exceed it. Forecast and payments are never added together. The reserve is never an expense. Headroom = budget − reserve − forecast.
11. A target the user sets is locked (`plannedOrigin: 'user'`) until they press Unlock. Rebalancing moves only unlocked targets, by planning weight, never below required provisions and never below zero. Locked targets that no longer fit are a conflict, never silently unlocked; when every target is locked the excess or unallocated amount is shown instead of being shared.
12. What-if scenarios (`src/domain/planning/scenarios.ts`: cut the budget, more guests, change the reserve, favour a priority) are previews computed from a copy. Apply uses the preview's revision, so a preview made before another edit is rejected as stale. Scenarios change only the profile and category targets.
13. An agreed vendor quote updates exactly one linked expense; recording it again updates the same expense and replaces, never adds, its deposit payment.
14. The expected guest count is the forecasting input. Guest replies are counted separately and change it only through an explicit preview and apply.

Vendor rules:

- Bundled vendors are fictional sample data with illustrative prices, labelled as such, with no ratings, contact details, availability or bookings.
- Matching checks event type, service area, capacity and required capabilities from the event's stated needs. A stated "cannot" is unsuitable; an unstated capability is Needs confirmation. Ranking criteria are shown with each result, and exclusions give their reasons.
- Vendor checklists (availability, quote scope, accessibility, dietary where applicable, payment and cancellation terms) are the organizer's checks, not verification. Recording "Booked" never claims a reservation was made.

Date rules:

- Dates are validated calendar dates. Each task has a stable id, dependencies, an ideal deadline and a due date; urgency is derived from today and never stored.
- The ideal deadline is preserved. When normal lead time has passed, critical steps become immediate catch-up work (two per day from today, in dependency order) and other steps are compressed in proportion to the time left. The plan explains the compressed schedule.
- Preparation is never due after the event. Explicit follow-ups may be later. A step is never due before its dependencies. Template cycles are detected and rejected.
- New events cannot be created in the past. Saved events that have passed are history: no plan is generated or rewritten for them.
- Tasks are preparation, event-day or follow-up. Urgency is derived from the calendar helper. A step past its usual lead time keeps and shows its original deadline with a catch-up recommendation and the problem stated; when the catch-up work exceeds about two steps a day before the event, the timeline says the schedule is not feasible.
- Prerequisites are never completed automatically. Missing or cyclic dependencies are shown as configuration errors.
- Changing the event regenerates generated deadlines only. Completed tasks, custom tasks, notes, owners and manual deadlines are kept; a manual deadline set for a different event date is flagged for review.
- The event-day running order uses explicit local start and end times (`HH:MM`), requires the end after the start, flags overlaps, and is edited through forms rather than dragging.

Recommendations name the facts they rest on. Outdoor backup steps are added for outdoor or mixed settings without any weather forecast. Cultural practices appear only for entries the user typed.

Assistant rules:

- Assistants implement `AssistantProvider` (`src/services/ai/assistant.ts`). They receive a bounded context snapshot and the message, never the saved record, and answer with a question, an informational reply, a creative draft or a proposed change.
- A proposed change is a validated intent. The planning engine builds the proposal and its before-and-after preview from the current event, and the user must press Apply change. Apply checks the event and revision again. Payments, deleting events, marking vendors booked and running code are not possible.
- The built-in `GuidedPlannerProvider` is deterministic and labelled "Guided planner". It never guesses units, asks one focused question when a request is ambiguous or combines changes, and points to the right form for anything it does not support.
- Conversations are kept per event for the session only and are never saved. Replies for another event or an older revision are discarded.
- Optional local AI (`LocalAIProvider`, `src/services/ai/local`): WebLLM 0.2.85 running Qwen2.5-1.5B-Instruct (Apache-2.0) in a dedicated Web Worker. Nothing is downloaded until the user enables it after a capability check and a download estimate. It only writes ideas, invitation wording and explanations of the planner's own facts; its output is validated, labelled "Local AI", and never becomes a change. Commands and changes always go to the guided planner and the engine. Event data is never sent to a hosted AI service; the model files come from Hugging Face and GitHub.

## Assumptions

- Target browsers are current evergreen browsers.
- Currency is INR only; locale formatting is `en-IN`.
- Demo presets are fictional demonstration inputs, not recommended market budgets.
- All planning rates are fictional illustrations, not market prices or quotes (`RATES_DISCLOSURE`). Category weights approximate each category's cost share under those rates, and are meant to be replaced once real quotes exist.
- Default planning horizons are short, illustrative minimums: wedding 90 days, birthday 14, community 30. The three demo presets sit exactly at their horizon, so none starts compressed; a shorter window triggers the catch-up rules.
- Dietary needs are budgeted across all guests (the plan does not know how many guests have each need). This is deliberately cautious.
- Documented limits live in `LIMITS` (`src/domain/primitives.ts`): 10 events; 30 categories, 200 expenses, 200 tasks, 100 vendors, 1,000 guest records and 100 ideas per event; 5,000 expected guests; 2,000,000 characters of saved data.
- Multiple browser tabs editing the same saved data are not coordinated; the last write wins.
- Node.js 24 LTS (`>=24.15.0 <25`), recorded in `package.json` and `.nvmrc`. Vitest 5 and jsdom 30 need Node 22.12+/24.
- TypeScript is held at 6.0.x because `typescript-eslint` 8.72 supports `<6.1.0`. Move to TypeScript 7 once typescript-eslint supports it.
- `eslint-plugin-jsx-a11y` is not used: its latest release does not support ESLint 10. Accessibility is covered by semantic markup, tests, and later e2e checks.

## The six evaluation criteria

**Not supplied.** The original brief refers to "the six evaluation criteria" but does not list them. The list below is a **provisional placeholder** derived from the essential journey, so work can proceed. It must be replaced with the real criteria once provided.

1. Journey completeness: every step of the essential journey works end to end.
2. Explainability: each plan element shows why it was chosen.
3. Consequence visibility: changing a constraint shows what changed and why.
4. Usability and accessibility: keyboard, screen reader, responsive, light and dark.
5. Engineering quality: strict types, lint, tests, clear structure.
6. Constraint compliance: static only, local-first, no secrets, small repository.

## Repository constraints

- Work only on `main`. Never create feature, development, deployment, or automated dependency-update branches.
- Ignore `node_modules`, `dist`, `coverage`, `.vitest`, `playwright-report`, `test-results`, `traces`, model weights, downloaded binaries, caches, and secret environment files.
- Keep the repository well under 10 MB. Commit `package-lock.json`.
- Add scripts only when their implementations exist. No command may succeed without doing work.

## Working contract

For every stage:

1. Read this document and `docs/BUILD_PROGRESS.md`, and inspect the existing code.
2. Implement the requested stage.
3. Run the relevant available checks and fix failures.
4. Update `docs/BUILD_PROGRESS.md`.
5. Commit relevant changes on `main`.
6. Push when the remote and authentication are available.
7. Report access problems without requesting secrets in chat.

Preserve previously working features. Report changed files, commands actually run with their outcomes, and the next stage.
