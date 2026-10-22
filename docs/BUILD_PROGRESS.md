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

### Stage 5: Budget editor

The Budget page is now a working editor built on the stage 3 money functions (`allocateTargets`, `forecastExpenses`, `assessFeasibility`, `mulDivFloor`, `allocate`). New pure modules: `src/domain/planning/budget.ts` (ledger, accounting checks, locks, rebalancing) and `src/domain/planning/scenarios.ts` (what-if previews).

- **Ledger (`buildLedger`):** budget, reserve, left after the reserve, category targets (locked and unlocked), forecast, committed, uncommitted, paid, outstanding, headroom, shortfall and gap, per category and per item, plus conflicts and options. `ledgerIdentities` lists the sums that must agree; `reconciles` is shown on the page.
- **Accounting model:** an expense contributes its agreed total when present, otherwise its estimate; payments are part of a commitment, need one and must not exceed it; outstanding is committed minus paid; forecast and payments are never added; the reserve is never an expense; headroom = budget − reserve − forecast (negative when the forecast eats into the reserve or beyond).
- **Editing:** start a budget from the planning configuration (categories and expenses only; tasks and ideas are left to their pages); add and edit expenses with fixed or per-guest estimates; agreed fixed totals or per-guest rates; dated payments with remove; remove an expense (with confirmation, not for required provisions or items with payments); edit category targets; set the reserve percentage. Generated estimates show "Illustrative rate"; edited ones "Your estimate"; agreed items "Agreed"; required and optional items are labelled. Amounts are typed as text with `inputmode="decimal"` and parsed to integer paise on submit; formatted strings are never stored.
- **Locks:** a manually set target is locked (`plannedOrigin: 'user'`) and the unlocked targets re-share the rest by planning weight, never below required provisions. Unlock is an explicit button. Rebalancing never moves or unlocks a locked target. If locked targets exceed the money left after the reserve, the result is a critical conflict and unlocked targets drop to their floor (never below zero). If every target is locked, nothing is allocated (no division by a zero weight) and the unallocated or excess amount is shown with a request to edit or unlock a target.
- **What-if:** reduce the budget by 15%, increase guests by 20%, change the reserve, give a chosen priority 20% more. Each preview shows budget, guests, reserve, forecast, headroom and shortfall before and after, changed target recommendations, changed gap-closing suggestions, conflicts introduced and resolved, and written trade-offs. Previews are computed from a copy and never saved. Apply goes through the reducer with the preview's revision; any other edit makes the preview "out of date" and Apply is withheld until it is previewed again. Discard changes nothing. Scenarios only touch the profile and category targets, so tasks, agreed costs, payments, guests and manual expenses survive. An impossible cap is applied as chosen and the shortfall stays on the page.
- **Display:** a readable table of categories (target, status, forecast, agreed, paid, outstanding, target − forecast, totals, reserve, unallocated, budget) and of expenses, beside decorative bars (budget composition, and target against forecast per category) whose colours passed the dataviz palette validator against the card surface.
- **Navigation:** Budget no longer shows "Soon".

### Stage 6: Timeline and checklist

The Timeline page is now a working checklist for the active event. New pure modules: `src/domain/planning/timeline.ts` (phases, urgency, catch-up, blockers, outdated overrides, schedule health, filters, edits, regeneration) and `src/domain/planning/runOrder.ts` (event-day running order).

- **Tasks:** each shows its title, the reason and how its date was set ("Why this step and date"), deadline, prerequisites, status, and whether it is from the plan or the user's own. Grouped by planning phase (more than two months before, one to two months, final month, final week, event day, after the event) and filtered by status, category, urgency (including "past its usual deadline" and "waiting for another task") and an optional owner label.
- **Editing:** create a timeline from the plan (tasks only; budget and ideas untouched), add custom tasks (title, when, deadline, category, importance, owner, notes, prerequisites), edit notes, owners and deadlines, set status, mark done or reopen. These are local planning records; nothing is sent or scheduled to notify anyone.
- **Dates:** preparation, event-day and follow-up tasks are a third task kind (`event-day`) and an `on-day` timing in the configuration. Urgency comes from the calendar helper. A step whose usual lead time has passed shows the original deadline, a catch-up recommendation and the problem in plain words. When there is more catch-up work than about two steps a day can cover before the event, the page says the schedule is not feasible rather than implying that moving deadlines to today fixes it. Completed steps no longer take catch-up slots.
- **Dependencies:** unfinished prerequisites are shown as "Waiting for"; marking a task done never changes its prerequisites, and the message says they are still open. Missing or cyclic dependencies in the planning rules or in saved tasks are shown as configuration errors.
- **Regeneration:** saving "Edit event" on the Overview recalculates generated deadlines and adds or removes steps that start or stop applying. Completed tasks, custom tasks, notes, owners and manual deadlines are kept. A manual deadline records the event date it was set for (`dueDateSetFor`); if the event moves it is listed under "Deadlines to review" with Keep this date or Use the planned deadline. Generated tasks with notes or an owner are no longer removed when they stop applying. Past events are history and are not rewritten.
- **Running order:** items with explicit local `HH:MM` start and end times, validated end after start, sorted by time, overlaps flagged with their length. Items are moved by editing their times in a form; there is no drag-and-drop.
- **Personalisation:** community events add basic access walks when no needs are listed, a backup plan for volunteers, power and supplies, a day-running task and cleanup. Birthdays add supervision and food-safety steps for under-13s, pick-up arrangements for teenagers, and seating and quieter space for 65 and over. Wedding tasks follow chosen priorities (ceremony, food, decor, entertainment); the ceremony step appears only when the ceremony is a priority, and no tradition is assumed. Every task template now has a category.
- **Schema (version stays 1):** tasks gain optional `category`, `owner` and `dueDateSetFor`, and the `event-day` kind; events gain a `runOrder` collection that defaults to empty, so saved data from earlier stages still loads.

### Stage 7: Vendors and guests

New pure modules: `src/domain/planning/vendors.ts` (requirements, matching, ranking, organizer checklist, shortlisting, agreed quote to expense) and `src/domain/planning/guests.ts` (RSVP suggestions and the forecasting-count preview). Sample data in `src/data/sampleVendors.ts`.

- **Sample data:** 17 fictional vendors across venue, catering, photography, music, decor, transport and equipment, each with a service area, event types, capacity where relevant, an illustrative fixed or per-guest price, stated capabilities and things to confirm. Labelled "Sample data" everywhere, with a disclosure on the page. No ratings, contact details, availability or bookings; a test checks the data for them. Shortlisting stores only the name, kind and `sampleId`; facts are read from the dataset, never copied into saved records.
- **Vendor features:** search (name, area, summary, notes and capabilities the vendor can provide), category filter, shortlist, compare up to three side by side, add your own vendor, and record contact, latest quote, selection status, notes and confirmed capabilities. "Booked" is labelled as the organizer's own record; nothing is contacted or reserved.
- **Matching:** event type, service area, capacity (venues and caterers must state one, otherwise Needs confirmation) and required capabilities: each accessibility need for venues, wheelchair access for transport, each dietary need for caterers, a covered alternative for outdoor or mixed settings, plus anything extra the organizer ticks. An explicit "cannot" makes a vendor unsuitable; an unstated capability is Needs confirmation. The organizer's own confirmation overrides the sample data. Ranking is per category: suitable before needs confirmation, fewer unknowns, within the category's budget target, lower illustrative estimate, then name; the summary states each step. Exclusions list their reasons.
- **Checklists:** availability, quote scope, accessibility (naming the listed needs), dietary capability for caterers or when dietary needs are listed, payment terms and cancellation terms, then the plan's own questions for that kind of vendor and the sample's questions. Ticks are saved as `checksDone` and described as the organizer's checks, not verification.
- **Budget integration:** recording an agreed quote updates the one expense linked to that vendor, or links the chosen unlinked expense (by default the category's existing estimate, so the cost is not counted twice), or creates one new expense. Repeating it updates the same expense. The deposit is part of the commitment; a paid deposit is one payment with the stable id `<vendorId>~deposit`, replaced on repeat. Accounting rules from stage 5 (deposit and payments within the agreed total) apply.
- **Guest panel (Overview):** name or alias, group size, reply, optional dietary or access notes; add, edit and remove. No email, phone, birthday or invitations. RSVP counts are shown beside the expected guest count, which stays the forecasting input. "Change the expected guest count" previews a count (from accepted replies, accepted plus no reply, or a typed number) with forecast and headroom before and after; Apply uses the preview's revision; Discard changes nothing. RSVP edits never change the count or the budget.
- **Schema (version stays 1):** vendors gain optional `sampleId` (unique per event), `serviceArea`, `capacityMax`, `capabilities` and `checksDone`. `CAPABILITIES` lists accessibility needs, dietary needs, `weather-cover` and `power-backup`.

### Stage 8: Assistant

The Assistant page is now a working, rule-based assistant. New modules in `src/services/ai`: `assistant.ts` (the replaceable `AssistantProvider` contract and typed requests, responses and change intents), `context.ts` (bounded context snapshot), `guidedProvider.ts` (`GuidedPlannerProvider`) and `proposals.ts` (intent to engine proposal, operation guard, re-check before apply). The stage 1 `adapter.ts` placeholder was replaced.

- **Contract:** a request carries the event id, revision, request id, a bounded context snapshot and the message (at most 500 characters). A response is a question, an informational reply, a creative draft or a proposed change, and always echoes the request id, event id, revision and provider label. A provider never receives the saved record and never returns operations: a change is a Zod-validated intent (set guests, set budget, reduce budget by a percentage, set setting, set reserve). Payments, deleting events, marking vendors booked and running code are not representable.
- **Snapshot:** event facts, preferences, money totals, the five largest categories, the five most pressing open tasks with blockers, vendor and guest counts, and up to five concerns. Guest names, notes and contact details are never included.
- **Guided planner:** labelled "Guided planner" everywhere and described as rule-based, not a language model. Supported: what to do next, explain the budget, reduce the budget by a percentage or an explicit rupee amount, set the budget (rupees or lakh), set guests to an exact number, move indoors, outdoors or both, set the reserve, idea drafts (with dietary filters), and help. A bare number for money or the reserve, a vague or ranged guest count, an out-of-range value, a mismatched event type or more than one change in one message gets a focused question with answer chips. Payments, deleting events, vendors and bookings, tasks, guests and the date get a short explanation and a link to the right page. Anything else gets the list of supported commands.
- **Proposals:** built by the planning engine (`previewChanges`) from the event as it is when the reply arrives. Consequences are added only for parts of the plan the event already has, so a change never quietly creates a budget, timeline or idea list. Each shows field changes, a before-and-after table (budget, reserve, forecast, over the whole budget, into the reserve), changed costs, timeline changes and new or resolved problems, with Apply change and Dismiss. The preview is recomputed on every render; once the event changes, the proposal says so and offers "Ask again with the current event". Apply checks the active event, the revision, validity and the operation guard again, then edits through the reducer with the expected revision.
- **Experience:** one conversation per event in memory for the session (at most 40 messages; never saved or exported), example chips when empty, suggestion chips, a working state with Cancel, an error state with Ask again, Enter to send and Shift+Enter for a new line, focus kept in the message box, completion announced once in a polite status region (the message list itself is not live), and automatic scrolling only for someone already at the end (otherwise a "New reply below" button). Leaving the event cancels the request; a reply for a cancelled or replaced request, another event, or an older revision is discarded with a note. All text is rendered as React text.

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

- **Stage 5:** "Locked" reuses `plannedOrigin: 'user'`, which the plan generator and `reconcileOperations` already treat as fixed, so no schema change was needed and the saved-data version stays 1.
- **Stage 5:** rebalancing uses the same planning weights (with priority boosts) as `generatePlan`, so a rebalance and a later plan regeneration agree. A category without a configured weight is kept as it is and cannot be unlocked.
- **Stage 5:** "payments need a commitment and must fit inside it" is enforced by the editor, not the Zod schema. A per-guest agreement shrinks when the guest count falls, which could otherwise make an unrelated guest edit invalid; instead the ledger reports the overpayment as a critical conflict and the identities still hold (committed + overpaid = paid + outstanding).
- **Stage 5:** "Give a priority more" raises the unlocked categories that serve the priority by 20% of their targets, takes exactly that from the other unlocked targets in proportion to what they hold above required provisions, and locks the raised targets on Apply, because applying is an explicit choice a later rebalance should keep. It does not edit the event's priorities.
- **Stage 5:** setting the reserve, editing a target and unlocking all re-share unlocked targets in the same edit. Changing the budget or guests on the Overview does not; the Budget page then shows "Rebalance unlocked targets".
- **Stage 5:** the reserve is never an expense, so the whole forecast is "non-reserve forecast" in the headroom formula.
- **Stage 5:** budget-page buttons use the normal 44 px size; the stage 4 guest "Remove" button still uses the 36 px small size.
- **Stage 5:** the JS bundle now includes the planning configuration and passes Vite's 500 kB warning threshold (533 kB, 161 kB gzip). Code-splitting is left for later.

- **Stage 6:** an outdated manual deadline is detected by comparing `dueDateSetFor` with the current event date, not guessed from how far the date is from the plan. Manual deadlines from before stage 6 have no `dueDateSetFor` and are not flagged unless a preparation step falls after the event.
- **Stage 6:** planning phases count back from the usual (ideal) deadline, so a step that is being caught up stays in the phase it belongs to while its due date shows the catch-up date.
- **Stage 6:** "not feasible" is a capacity check (open steps past their usual deadline against about two catch-up steps per day before the event). It is a plain warning, not a proof; a feasible-looking count can still be unrealistic for long lead-time steps, which the per-step "problem" text says.
- **Stage 6:** the running order is a separate per-event collection with `.default([])`, not part of tasks, so its times never mix with task deadlines. Times are local wall-clock times with no time zone, and an item cannot cross midnight.
- **Stage 6:** the Overview's "Edit event" now regenerates the timeline (tasks only) in the same edit. It still does not rebalance budget targets.
- **Stage 6:** a `not` condition was added to the configuration language for "no accessibility needs listed".

- **Stage 7:** sample vendors stay in code, not in saved data. Saved vendor records point at them by `sampleId`, so the illustrative facts can never be mistaken for the organizer's own notes, and correcting the sample data needs no migration.
- **Stage 7:** a capability the organizer records for a vendor (can or cannot) overrides the sample data for that vendor only.
- **Stage 7:** a user-entered service area that does not mention the event's city is Needs confirmation, not unsuitable, because it is free text ("Pune district" may still cover the venue).
- **Stage 7:** the agreed quote updates the vendor's latest quote to the agreed total but does not change its selection status; the organizer sets "Booked" themselves.
- **Stage 7:** changing the expected guest count from the guest panel regenerates the timeline like any event edit, and does not re-share budget targets, matching the Overview edit.
- **Stage 7:** labels in the guest form are now "Name or alias" and "Group size" (stage 4 tests updated).

- **Stage 8:** providers return intents, not operations, and the app builds the proposal with the engine. A future model-based provider can therefore never put payment, vendor or deletion operations into a proposal; `forbiddenOperations` checks again before applying in case a later change to the engine ever produced one.
- **Stage 8:** "Reduce my budget by 15" (no unit) is a question, and so is "Set the budget to 450000": rupees must be written with ₹, Rs, INR, rupees or lakh. "15%" and "₹15" are accepted as written.
- **Stage 8:** more than one command in one message is split on "and", "then", commas and semicolons and answered with one chip per command, so each change gets its own preview.
- **Stage 8:** the provider is injected through `AssistantProviderContext` (default: the guided planner), so tests use slow and failing providers, and a local model could be added without touching the page.
- **Stage 8:** conversations are held by `AssistantSessionProvider` around the routes, so leaving the Assistant page keeps them for the session; reloading clears them.
- **Stage 8:** Vitest's per-test timeout is 20 s. Page tests that type into many fields passed alone but went over 5 s under a full parallel run.

## Verification results (actually run)

### Stage 8

Windows, Node v24.16.0, npm 11.17.0.

| Check                  | Result                                                                   |
| ---------------------- | ------------------------------------------------------------------------ |
| `npm run typecheck`    | exit 0                                                                   |
| `npm run lint`         | exit 0                                                                   |
| `npm run format:check` | exit 0                                                                   |
| `npm run test:run`     | 30 files, 476 tests passed (36 new: provider, proposals, page)           |
| `npm run build`        | OK; JS 658.06 kB (197.23 kB gzip), CSS 30.73 kB; Vite chunk-size warning |

- **Completion check:** each supported command reads the current event (the budget explanation and "set guests" figures equal the ledger's; "reduce by 15%" previews ₹5,00,000 → ₹4,25,000); proposals change nothing until Apply; a proposal is refused for a different event and after any other edit, by `checkBeforeApply` and by the reducer; on the page, applying one proposal makes an older one stale and only "Ask again" produces a fresh one; a slow reply that arrives after the event changed is discarded; switching events cancels the request and starts that event's own conversation.
- **Mutation checks:** accepting stale proposals failed 1 test; treating a bare number as a percentage failed 2. Both were reverted.
- **Real browser** (Claude desktop browser pane, Chromium, dev server): created the demo wedding and budget; typed "Reduce my budget by 15" and pressed Enter (question with 15% and ₹15 chips), then "What changes if we move outdoors?" (proposal: setting indoor → outdoor, forecast ₹4,39,000 → ₹4,69,000 from the covered backup, ₹19,000 into the reserve). Focus stayed in the message box and "Guided planner replied." was announced once. axe-core 4.10: no violations at 1280 px and at 320 px with two proposals open; no horizontal page scroll; no console errors.
- **Defect found and fixed:** at 320 px the proposal's calculation table scrolled sideways but could not be reached with the keyboard (axe `scrollable-region-focusable`); its wrapper is now focusable and described by the caption, without adding a landmark per proposal.
- **Not verified this stage:** a screen reader's actual announcements, Firefox, Safari and a physical phone.

### Stage 7

Windows, Node v24.16.0, npm 11.17.0.

| Check                  | Result                                                                   |
| ---------------------- | ------------------------------------------------------------------------ |
| `npm run typecheck`    | exit 0                                                                   |
| `npm run lint`         | exit 0                                                                   |
| `npm run format:check` | exit 0                                                                   |
| `npm run test:run`     | 28 files, 440 tests passed (26 new: vendors, guests, page)               |
| `npm run build`        | OK; JS 616.38 kB (185.11 kB gzip), CSS 27.59 kB; Vite chunk-size warning |

- **Completion check:** adding wheelchair access moves Riverside Lawns from suitable to Needs confirmation (not stated) and adding a step-free route makes it unsuitable (stated "cannot"), while Lotus Courtyard Hall stays suitable (`vendors.test.ts`); unknown capabilities are listed under Needs confirmation on the page; an agreed quote updates the existing "Venue hire" expense, and recording it again leaves one linked expense and one deposit payment with the ledger reconciling (domain and page tests, and in the real browser); adding, editing and changing guest replies leaves the expected count and the forecast unchanged until a previewed count is applied.
- **Mutation checks:** treating a stated "cannot" as not stated failed 3 tests; keeping the old deposit payment when the quote is recorded again failed 2. Both were reverted.
- **Real browser** (Claude desktop browser pane, Chromium, dev server): created the demo wedding and its budget, shortlisted Lotus Courtyard Hall, recorded an agreed quote of ₹1,10,000 with a ₹30,000 deposit paid, then ₹1,15,000: one linked "Venue hire" expense, one deposit payment. Previewed 180 expected guests on the Overview (forecast and headroom before and after shown). axe-core 4.10 (WCAG 2.0 to 2.2 A and AA plus best practices): no violations on Vendors with a comparison open or on the Overview with a guest-count preview, at 1280 px and 320 px; no horizontal page scroll at 320 px. One contrast result on the pressed Compare buttons appeared only when axe ran during the button's colour transition; the settled colours (white on navy) pass.
- **Defect found and fixed:** search matched capabilities a vendor explicitly cannot provide (searching "halal" listed a caterer that cannot); it now matches only stated or confirmed capabilities. Negative headroom in the guest-count preview used a hyphen instead of a minus sign.
- **Not verified this stage:** Firefox, Safari, a physical phone and a screen reader.

### Stage 6

Windows, Node v24.16.0, npm 11.17.0.

| Check                  | Result                                                                   |
| ---------------------- | ------------------------------------------------------------------------ |
| `npm run typecheck`    | exit 0                                                                   |
| `npm run lint`         | exit 0                                                                   |
| `npm run format:check` | exit 0                                                                   |
| `npm run test:run`     | 26 files, 414 tests passed (32 new: timeline, scheduler, schema, page)   |
| `npm run build`        | OK; JS 567.34 kB (171.17 kB gzip), CSS 23.63 kB; Vite chunk-size warning |

- **Completion check** (`timeline.test.ts` and `TimelinePage.test.tsx`): a wedding planned 90 days ahead, with two steps done, a note and owner on one, a manual deadline and a custom task, is moved to five days ahead. Generated preparation deadlines fall between today and the event, event-day steps on the event date; done steps keep their status and dates; the custom task, note, owner and manual deadline are unchanged; the manual deadline and the custom task's deadline are flagged for review; catch-up steps show the original deadline, a recommendation and the problem; some steps are due today and others within the week; the capacity check reports the schedule as not feasible. The same journey passes through the real Overview edit form and Timeline page in the UI test. Same-day and past events open, show their status and can still be edited.
- **Mutation checks:** letting regeneration move completed tasks failed 3 tests; disabling the capacity check failed 2. Both were reverted.
- **Real browser** (Claude desktop browser pane, Chromium, dev server; pane hidden, so layout was checked through the DOM and screenshots taken at the top of the page): created a timeline for the demo wedding (18 steps in six phase groups); moved the event to five days ahead through Overview, Edit event ("17 planned deadlines were recalculated"); the Timeline showed catch-up advice with usual deadlines and the "would not make this schedule feasible" warning; added two overlapping running-order items and saw the overlap flagged with its length. axe-core 4.10 (WCAG 2.0 to 2.2 A and AA plus best practices): no violations with a task editor, the custom-task form and the running order open, at desktop width and at 320 px. No horizontal page scroll at 320 px.
- **Not verified this stage:** Firefox, Safari, a physical phone, a screen reader; native date and time pickers were only driven programmatically in the browser and through `fireEvent` in jsdom.

### Stage 5

Windows, Node v24.16.0, npm 11.17.0.

| Check                  | Result                                                                   |
| ---------------------- | ------------------------------------------------------------------------ |
| `npm run typecheck`    | exit 0                                                                   |
| `npm run lint`         | exit 0                                                                   |
| `npm run format:check` | exit 0                                                                   |
| `npm run test:run`     | 24 files, 382 tests passed (44 new: ledger, locks, scenarios, page)      |
| `npm run build`        | OK; JS 533.13 kB (160.95 kB gzip), CSS 20.09 kB; Vite chunk-size warning |

- **Completion check** (`scenarios.test.ts`): increasing guests by 20% raises every per-guest estimate and per-guest agreement by rate × 40, leaves fixed estimates and the agreed fixed venue (with its payment) unchanged, every ledger identity holds, and repeated increases leave a visible shortfall and negative headroom.
- **Mutation checks:** adding payments into headroom failed 8 tests; treating every preview as current failed 2. Both were reverted.
- **Real browser** (Claude desktop browser pane, Chromium, dev server; the pane was hidden, so screenshots were used only at the top of the page and layout was checked through the DOM): created the demo wedding and a starting budget; locked Venue at ₹1,50,000 with the keyboard (Enter submits; status announced; other targets re-shared; targets still total ₹4,50,000; focus returned to the Edit button); opened the expense editor and a scenario preview; applied "Increase guests by 20%" (saved guest count 240). axe-core 4.10 (WCAG 2.0 to 2.2 A and AA plus best practices) reported no violations on the default page, with the editor and preview open at desktop width, and at 320 px. No horizontal page scroll at 390 px or 320 px. No console errors on a clean load.
- **Defects found in the browser and fixed:** a visually hidden table header escaped its scroll container and widened the phone layout to 728 px (the wrapper is now a containing block); a duplicate region name between the preview's target table and the "Category targets" card (axe `landmark-unique`); budget buttons below the project's 44 px target size; a missing legend entry for "forecast above target" in the bars.
- **Not verified this stage:** Firefox, Safari, a physical phone, a screen reader, print, 400% zoom and high-contrast mode; the stage 4 subpath builds were not re-run.

### Stage 4

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

1. **Show the plan:** generated tasks, ideas and recommendations with reasons on Overview, with an apply button, using the existing engine. (The budget part is done in stage 5.)
2. **Constraint-change flow on the Overview:** route event edits (guests, budget, date, needs) through `proposeChange` and `previewChanges` with accept or reject, and rebalance unlocked targets there too. (Budget, guest and reserve what-ifs are done on the Budget page.)
3. **Ideas page:** save, dismiss and add ideas. (Timeline is done in stage 6, vendors in stage 7.)
4. **Export:** a readable (print or Markdown) export beside JSON, and JSON import with validation.
5. **Optional local model:** a WebLLM provider in a Web Worker implementing `AssistantProvider` and returning the same validated intents. (The guided planner, contract and proposal flow are done in stage 8.)
6. **Repeatable browser checks:** turn the scratch Edge script into a maintained e2e script and CI job, and test Firefox and a real phone.
7. **Replace the provisional evaluation criteria** in `docs/PROJECT_BRIEF.md` once the real six are supplied.
8. **Bundle size:** split the planning configuration or routes so the main chunk drops below Vite's 500 kB warning.
