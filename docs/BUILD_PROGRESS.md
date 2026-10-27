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

### Stage 9: Local AI (WebLLM)

An optional on-device model now runs beside the guided planner. New modules in `src/services/ai/local`: `model.ts` (the model record), `capability.ts` (browser and GPU check), `worker.ts` (dedicated worker), `localModel.ts` (`LocalModelController`, the one engine and its lifecycle), `prompts.ts` (bounded prompts and checks on output) and `localProvider.ts` (`LocalAIProvider`). UI: `LocalAICard`, `LocalModelSession` and `localModelContext` in `src/features/assistant`.

**Model record**

| Item           | Value                                                                                                                                                                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK            | `@mlc-ai/web-llm` **0.2.85**, pinned exactly (0.2.86 was 11 days old, so the previous release was chosen)                                                                                                                                                                                                   |
| Model ID       | `Qwen2.5-1.5B-Instruct-q4f16_1-MLC`; `Qwen2.5-1.5B-Instruct-q4f32_1-MLC` on GPUs without `shader-f16`. Both are in the SDK's `prebuiltAppConfig` (a test checks this)                                                                                                                                       |
| Source         | https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC (MLC conversion of https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct); model library from raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs (`v0_2_84/base/Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm`)                                |
| License        | Apache-2.0 (base model card and LICENSE file). The MLC repository is a format conversion with no separate license. Weights are not redistributed: the browser downloads them from the source                                                                                                                |
| Size           | Measured 2026-10-22: repository 839.5 MiB (39 files), weights 828.3 MiB in 30 shards, model library 5.0 MiB. At run time the app sums the model's own `ndarray-cache.json` and shows that figure, or says the size could not be checked                                                                     |
| Memory         | The SDK lists 1,629.75 MB of VRAM at a 4,096-token window; the app uses a 2,048-token window                                                                                                                                                                                                                |
| Why this model | Small enough for integrated GPUs (flagged low-resource by the SDK), better instruction following and JSON output than 0.5B-class models, and a permissive license. Llama 3.2 1B (community license) and Gemma (Gemma terms) were not chosen because of their license terms; Qwen2.5 0.5B because of quality |

- **Loading:** nothing is fetched on page load. "Enable local AI" checks secure context, Web Worker, WebGPU, an adapter, `shader-f16` (to choose the build), reported device memory and storage quota, then imports the SDK and shows the verified size, the hosts (huggingface.co and raw.githubusercontent.com), the license and any warnings. Only "Download and start" (or "Load the model" when `hasModelInCache` says it is cached) creates the worker and calls `CreateWebWorkerMLCEngine`. The SDK and the worker are separate build chunks (about 6 MB each), not part of the first page load.
- **Lifecycle:** idle, capability-check, unsupported, ready-to-download, downloading (real progress from the SDK), ready, generating (with "stopping"), stopped and error. Stop during a download ends the worker (the SDK cannot interrupt a reload) and says so; Stop during generation calls `interruptGenerate()`; Turn off calls `unload()` and then ends the worker. One engine, one generation at a time; a stale result after a stop is ignored. Load failures and a lost device become an error with Try again; nothing retries by itself.
- **What the model does:** personalised theme and activity ideas (JSON constrained by a schema through `response_format`, then validated with Zod, dietary conflicts and prices removed), invitation wording (invented links, emails and phone numbers replaced; a warning when the date is missing) and plain-language explanations built only from the guided planner's own answers (any amount, percentage, multi-digit number or date not in those facts discards the explanation). Commands, questions and proposals always go to the guided planner and the engine. Model output is labelled "Local AI" with an "AI-written draft" badge and a caution; fallbacks are labelled "Guided planner" and say why.
- **Template fallback:** the guided planner now has a fixed invitation template ("Write invitation wording.") so the template and the model's wording are visibly different.
- **Bounds:** prompts are cut to 3,500 characters; output to 450, 260 and 320 tokens for ideas, invitations and explanations.
- **Privacy:** event data never leaves the browser. The snapshot sent to the model leaves out guest names, notes and contact details. Third-party hosts serve the model files and see the download request, not the event.

### Stage 10: Ideas, export, import and printing

- **Ideas workspace:** every bundled idea now carries facets (`IdeaFacets`: effort, lead days, budget level, settings, age bands, diets it suits, accessibility needs it helps or suits poorly, priorities, an optional expense template for its cost, a one-task plan and a reason). The configuration check rejects bad facets. `src/domain/planning/ideas.ts` filters by event type, time left before the event, cost level, indoor/outdoor setting, age band, dietary needs, accessibility needs and chosen priorities, and ranks what is left. Every shown suggestion lists why it fits; every hidden one says why (in a closed "Not shown" list). Twelve new ideas were added so each filter has something to act on.
- **Cost bands:** a suggestion shows a cost only when its facet names an expense template of the same event type, and then quotes that template's illustrative estimate with "Nothing is added to your budget". Otherwise it says there is no estimate. Saving an idea or adding it as a task never changes the budget.
- **Sources:** each saved idea shows "Guided suggestion", "Local AI draft" or "User idea". Local AI idea drafts on the Assistant page now have "Save to Ideas"; a saved draft keeps a note that it is an unchecked AI draft. Organizers can add their own ideas.
- **Favourites and tasks:** ideas can be favourited, and "Add as a task" creates exactly one task with the stable id `<idea id>~task` (suggestions themselves have stable ids from their template). Adding again, or adding a suggestion whose task exists, says it is already on the timeline and adds nothing. Assistant proposals no longer add or remove ideas.
- **Plan export (JSON):** Your data has "Export plan (JSON)" for the open event: `{ format: "celebration-planner/event", version: 1, exportedAt, guestsIncluded, event }` with the profile, preferences, budget categories, expenses and payments, tasks, vendors, ideas, guests (optional, on by default) and running order. Local AI state is never included. The assistant conversation is included only when its checkbox is ticked, as plain text for reading, and is never imported back. "Export all events" still writes the full saved-data envelope. Downloads use a Blob URL, which is released a second after the click; a refused download shows an error instead of claiming success.
- **Import:** files over 1 MB are refused before reading. The text is parsed in a try block; non-objects, other formats and other versions are refused (a newer version says so). The event is rebuilt by the Zod schemas, which construct new objects with only approved fields (unknown keys and `__proto__` are dropped) and check whole-paise money, real dates, references and collection limits; up to six problems are listed with their paths. Nothing changes until the preview is confirmed. "Import as a copy" gives the event and everything in it new ids (template items keep template-derived ids under the new event, idea tasks keep their `~task` link, deposits keep `<vendor>~deposit`) and adds "(copy)" if the title is taken. "Replace" appears only for a one-event file whose id matches an event here, and only acts after a confirmation dialog; the reducer also checks the revision. Full backups import as copies.
- **Printable plan:** `/print` shows the summary, assumptions (guest count, reserve, preferences, the rates disclosure), budget by category and by line, the checklist by phase with ☐/☑, vendor confirmations with the organizer's ticked questions, chosen ideas (favourites and ideas on the checklist) and the running order. "Print or save as PDF" opens the browser's print dialog; no PDF library is used. In print, the sidebar, skip link, storage notice and buttons are hidden, tables become full-width wrapping tables with repeated headers, and rows, checklist items and groups do not split across pages.
- **First use and recovery:** the welcome screen offers "Import a plan file". After clearing unreadable saved data, the message points to importing a plan file. Recovery downloads report a refused download. Import errors say that saved plans have not changed.
- **Removed:** the stale "Plan, budget targets and recommendations — Not built yet" card on Overview and the unused `ComingSoon` component. No section is marked "Soon" any more.

### Review: accessibility, security and privacy, efficiency

The working app was audited against these three areas (two read-only audits of the code, then checks in the built app). Only concrete problems were fixed; working features were not rewritten.

**Accessibility (aim: WCAG 2.2 AA)**

- **Lost focus:** about 30 actions removed the control that had focus (a button that goes once used, a removed row, a closed form, a rebuilt card), dropping keyboard focus to the top of the page. `src/app/focusRescue.ts` now moves focus to the heading of the section the control was in (the same heading, or one with the same text after a rebuild), or the page's h1. A form sent with problems moves focus to its first invalid field when its own handler did not move it.
- **Route changes:** pages reached by typing an address or with Back did not update the tab title or move focus to the new heading. Those history entries all get the router key "default", so the shell now keys on the key plus the path.
- **Mobile menu:** closes when focus moves past it, so the open panel cannot cover the focused control.
- **Status messages:** an empty live region was `display: none`, which takes it out of the accessibility tree so the first message could be missed. It now stays in the tree with no padding or border.
- **Accessible names now contain the visible label:** "Mark done: …", "Reopen: …", "Keep this date (…) for “…”", "Add as a task: …" (then "Task added: …"), and "Save to Ideas: …". The vendor "Compare" button keeps its text and shows its state with `aria-pressed`.
- **Announced results:** the import preview and the guest-count preview receive focus when they appear. The vendor search result count is announced once typing pauses (600 ms), not on every key.
- **Headings:**
  - Vendors: "Not suitable" is now an h3 section.
  - Error states take a heading level: h3 inside a form, h1 for the page-level error fallback, and no heading for the storage notice above the page heading.
- **Not colour alone:**
  - Timeline health messages start with "Problem:" or "Warning:".
  - Favourite buttons show a filled star when pressed.
- **Reflow:** badges wrap long text. Printed-plan tables are real tables inside keyboard-focusable, named scroll regions; only money columns stay on one line.
- **Fields:** required fields show "(required)" (guest name, agreed amount, payment amount, guest count, category target). The before-and-after table region in assistant proposals has a role and name.
- **Touch targets:** the plan file input is now 44 px high.

**Security and privacy**

- **Content-Security-Policy:**
  - Added to the build as a meta tag. The dev server needs inline scripts, so it is not added there.
  - Allows: scripts from the site only, plus `'wasm-unsafe-eval'` for the model's WebAssembly.
  - Network requests: the site plus huggingface.co, *.huggingface.co, *.hf.co and raw.githubusercontent.com.
  - Blocks: objects, base-uri changes and form posts.
- **Text checks:** names, titles and notes now refuse bidirectional override and isolate characters (U+202A–202E, U+2066–2069), which can make stored text display in a different order.
- **Model files:**
  - "Clear saved data" said it removed everything, but the downloaded model (about 870 MB) stays in browser storage. The wording now says so.
  - Your data has "Delete downloaded model", which calls the SDK's `deleteModelAllInfoInCache` for both builds. It is refused while a model is loaded.
- **Conversations:** a deleted event's conversation, or all conversations after clearing data, is dropped from memory.
- **Model errors:** shown in the chat cut to 200 characters.
- **Model output keys:** repeated idea titles from the model can no longer collide as React keys.
- **Dependencies:** `npm audit` and `npm audit --omit=dev` found 0 vulnerabilities, so nothing was upgraded.
- **Checked and fine:** no secrets or VITE_ variables; no raw HTML, `eval`, `new Function` or non-literal dynamic import; links in assistant replies come from the guided planner only, never from the model; model ids and URLs are constants; stored data, imports, proposals and model output are validated at their boundaries; clearing removes only this app's key and asks first; guest names never reach the assistant.

**Efficiency**

- **Streaming:** while a model writes, the streamed text is redrawn at most every 150 ms instead of on every token. Previews for pending proposals are computed once per change, not on every render or keystroke.
- **Planner results:** the timeline, budget ledger, idea suggestions and vendor matches are memoised on the event (vendor matching no longer reruns on every search key).
- **Formatting:** number and date formatters are cached instead of rebuilt for every amount and date.
- **Local model:**
  - A model already in the browser's storage is no longer refused when free space is below the download size.
  - Leaving the page sets the status to stopped, so a page restored from the back/forward cache does not show "Ready" with no engine.
  - The chat follows new replies after the conversation reaches its 40-message cap (it followed the length, which stops changing).
- **Not changed:** each edit is still validated by the page and again by the reducer, and saving still happens on every state change (synchronous, at most about 2 MB). Both are correct and measured fast enough; changing them would touch every editor.

### Submission preparation

- **README:** rewritten to describe the actual implementation. It covers:
  - Challenge 5, the personas and the main journey.
  - Features, and context-to-decision examples with figures from the engine.
  - Setup and commands, architecture, and the money, date and regeneration rules.
  - The Guided planner and Local AI with model details, hardware needs and the manual verification status.
  - Fictional data, privacy and limits, export and import, test evidence, and a walkthrough of the three demonstrations.
  - It claims no score, live vendor availability, verified prices, universal browser support or accessibility certification.
- **CI** (`.github/workflows/ci.yml`):
  - Triggers: pushes to `main` and manual runs (no pull request or branch triggers).
  - Permissions: `contents: read` only.
  - Node from `.nvmrc`; a `check` job (`npm ci`, `npm run check`) and an `e2e` job (Chromium with `--with-deps`, `npm run test:e2e` with `CI=true`).
  - Failures are reported as annotations and in the job summary, with the Playwright report uploaded.
  - No model is downloaded: the browser tests block every request beyond localhost.
- **Optional Pages demo** (`.github/workflows/pages.yml`):
  - Started by hand only.
  - Builds with `BASE_PATH=/<repository>/` after the full check, then deploys through `upload-pages-artifact` and `deploy-pages`, with no `gh-pages` branch.
  - Not run.
- **`npm run submission:check`** (`scripts/submission-check.mjs`): a read-only preflight covering branches, visibility, a clean and pushed tree, unwanted tracked files and secret-like strings, tracked bytes, history size, GitHub's reported size and the margin below 10,000,000 bytes.
  - `--clean-clone` reproduces install, checks, browser tests and build from a fresh full clone.
  - Checks that cannot be made report UNVERIFIED, never PASS.
  - It is kept out of CI, whose checkout may be shallow or detached.
  - Manual checks are in [docs/SUBMISSION.md](SUBMISSION.md).
- **`.gitignore`:** now covers `.claude/` (local assistant settings such as the preview server config), so a clean working tree can be checked.
- **Project brief:** stale lines corrected: light theme only, no "coming soon" sections, and Playwright and axe in the test stack.

### Testing: coverage, browser journeys and axe

How to run everything and what each suite shows: [docs/TESTING.md](TESTING.md).

- **Tools:** `@vitest/coverage-v8` 5.0.5 (matches Vitest), `@playwright/test` 1.64.0, `playwright-core` 1.64.0 and `@axe-core/playwright` 4.13.0, all pinned exactly.
  - Playwright 1.64.1 and axe 4.14.0 were under two weeks old, so the previous releases were chosen.
  - `playwright-core` is listed so that axe's peer dependency resolves to the same copy as Playwright's; it had pulled a second copy, which broke the types.
- **Scripts:** `test:coverage`, `test:e2e` and `check` (typecheck, lint, format check, tests with coverage, `vite build`). Each suite runs once.
- **Coverage:** a Vitest threshold keeps branch coverage of `src/domain/planning` at 85% or more, the project's own goal.
- **New unit tests:**
  - Malformed provider intents are refused, not repaired: 12 shapes, including money as text, fractional paise and unknown change types.
  - Extra fields in an intent cannot carry operations or another event id into a change.
  - A proposal for a missing event is refused.
  - Import copies: ordinary payments get new ids; an event with nothing planned copies; invalid new ids give no copy.
- **Playwright:** 27 tests in `e2e/` (20 when first written; the populated-planner axe scan was later split into one test per page), against the production build from `vite preview` on port 4183.
  - The eight journeys, axe in the initial, populated and open-dialog states, a keyboard-only run, reflow at 320 and 640 px, and reduced motion.
  - Every test runs on a fixed date with requests beyond `localhost` blocked.
- **AI in tests:** the journeys swap the built WebLLM SDK and worker chunks for a stand-in (`e2e/fakes/fake-webllm.js`) with a pretend WebGPU adapter. Nothing is downloaded and no GPU is used.
  - These tests cover the app's handling of the adapter, not a model.
  - A manual real-inference smoke test is written down in `docs/TESTING.md`.
- **CI:** two jobs, `check` and `e2e` (`npx playwright install --with-deps chromium`, then `npm run test:e2e`, with the report uploaded on failure).

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

- **Stage 9:** the local model never proposes changes. It writes drafts only; the guided planner and the engine keep every number, deadline and change, so there is nothing for a model to get wrong that could be applied.
- **Stage 9:** WebLLM 0.2.85 clears its interrupt flag when a generation starts and cannot interrupt prompt processing, so an interrupt sent before the first token was lost (seen in the real browser, then confirmed in the SDK source). The controller now sends the interrupt again when streaming begins, and the card shows "Stopping" until the engine has finished. The first schema-constrained request after loading spends about 25 s preparing its grammar, which cannot be interrupted; later ones stop in about a second.
- **Stage 9:** the grounding check compares figures and dates, not meaning. In the real run an explanation used the correct ₹580 per-guest figure but called it "food and drink"; the caution on every Local AI answer covers this, and the planner's own figures are shown beside it.
- **Stage 9:** the controller lives above the routes for the session, so leaving the Assistant page keeps the model loaded; reloading the page starts over (the files stay cached). Whether local AI was enabled is not saved, so a reload never starts a download by itself.
- **Stage 9:** `.claude/launch.json` (local preview config, not committed) uses port 5183 with `--strictPort`: the browser caches the model per origin, and another project already used 5173.

- **Stage 10:** a copy always gets new ids, even when nothing here has the same id. That makes "Import as a copy" one predictable action, and an id can never decide by itself whether data is overwritten.
- **Stage 10:** replacing keeps the existing event's place and raises its revision above the current one, so any assistant proposal shown for the old version is stale.
- **Stage 10:** a "chosen idea" in print is a favourite or an idea on the checklist; other saved ideas are counted but not printed.
- **Stage 10:** money in imported files must be whole paise numbers; text such as "₹5,00,000" or fractions are refused rather than converted, so an import can never change an amount by guessing.

- **Review:** focus is rescued centrally instead of in each of the about 30 components. It acts only when focus has actually been lost, so components that already move focus keep their behaviour.
- **Review:** the CSP is a meta tag because the app is static and may be hosted anywhere. A meta CSP cannot set `frame-ancestors` and does not cover the model worker, whose own response headers would. Hosts that can send headers should send the same policy as a header.
- **Review:** WebLLM appears twice in the build (main thread and worker, about 6 MB each). Neither is in the first page load. Moving the cache check into the worker would remove the main-thread copy; that was not done.

- **Testing:** the e2e stand-in replaces the SDK at the network layer (Playwright routes for `assets/lib-*.js` and `assets/worker-*.js`), so the production build contains no test hooks.
- **Testing:** a native modal `<dialog>` lets Tab move from its last button to the browser's own controls. The keyboard test checks that focus never reaches the page behind the dialog, not that it never leaves the document; that is how native modal dialogs work.

## Verification results (actually run)

### Fix: browser tests timing out

- **Failure:** `npm run test:e2e` failed with `populated planner: every section with a plan in it` → `frame.evaluate: Test timeout of 30000ms exceeded`. 19 tests passed; run alone, this test failed 3 of 3 times (about 34 s each).
- **Root cause:** in the test setup, not the app.
  - That one test ran eight full-page axe scans (1.5 to 3.4 s each, timed one by one) plus its setup inside Playwright's 30 s per-test limit.
  - Locally, Playwright's default of 8 workers (half of 16 logical CPUs) started 8 Chromium instances at once.
  - The failed test's trace shows its first page load took 13.9 s and creating the browser context 11.6 s, all counted against the same 30 s.
- **Fix:**
  - The populated-planner scan is now one test per page (7 sections plus the printable plan), sharing a `beforeEach` setup, so every scan and assertion is kept.
  - Local workers are capped at 4 (CI stays at 2).
  - No timeout was raised, no rule or test was removed, and the app is unchanged.
- **Results after the fix:**
  - `npm run test:e2e` three times in a row: 27 passed each time (38 to 47 s).
  - With `CI=1` (2 workers): 27 passed.
  - The accessibility file with `--repeat-each=3`: 42 passed.
  - Typecheck, lint and format check are clean.
  - Before the fix, `npm run check` already passed (570 tests).

### Submission preparation

`npm run submission:check -- --clean-clone` on Windows 11, Node 24.22.1, 2026-10-27, before this change was committed and with no remote:

- **PASS:**
  - only `main` locally;
  - 212 tracked files, none unwanted and no secret-like strings;
  - tracked bytes 1,531,408;
  - history of 12 commits, packed 551,936 bytes in a fresh full clone, 3,688,559 bytes uncompressed;
  - clean clone: `npm ci` 13 s, `check` 99 s, browser install 1 s, `test:e2e` 29 s, `build` 7 s, all passing.
- **UNVERIFIED** (no remote): remote branches, public visibility, push state, GitHub's reported size and therefore the overall margin.
- **FAIL:** the working tree, because this change was still uncommitted.
- **Remote paths:** exercised in a throwaway clone pointed at the public `mlc-ai/web-llm` repository. Its extra branches, unknown remote commits and 69 MB size were reported as FAIL and its visibility as PASS, so the GitHub API and `ls-remote` paths work.
- **Not run:** the CI workflow on GitHub and the Pages workflow, since there is no remote.

### Testing

Windows 11, Node v24.22.1, npm 11.17.0. Playwright's Chromium is Chrome Headless Shell 156.0.8078.4.

| Command                                                          | Result                                                                                                                                                                                          |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                                  | exit 0: typecheck, lint and format check clean; 34 files, 570 tests passed; build OK                                                                                                            |
| Coverage (from `check`)                                          | all code: statements 88.99%, branches 79.58%, functions 88.55%, lines 90.95%. Core planning (`src/domain/planning`): branches 86.5% (1,145 of 1,324), so the 85% threshold passes               |
| `npm run test:e2e`                                               | 20 passed (about 27 s)                                                                                                                                                                          |
| `npx playwright test --repeat-each=2`                            | 40 passed; an earlier `--repeat-each=3` of the first 16 tests also passed (48 of 48)                                                                                                            |
| Clean copy (only files git would track, in a new folder, `CI=1`) | `npm ci`, `npm run check`, `npx playwright install --with-deps chromium` and `npm run test:e2e` all exited 0 (570 and 16 passed; the 4 keyboard, reflow and motion tests were added afterwards) |
| `npm audit`                                                      | 0 vulnerabilities                                                                                                                                                                               |

- **Failures fixed while writing the journeys:** all were in the tests, not the app.
  - "Your data" is outside the Main navigation.
  - "Last list item" also matched lists nested inside a message.
  - The cancel button is called Stop while a model writes.
  - Focus is already on the heading after navigating, so the skip-link check needs a fresh load.
  - At narrow widths the sidebar links are inside the closed menu.
- **Mutation check:** with the event switch removed from journey 8, the reply appears and the test fails.
- **Coverage gaps:** branch coverage is lower in interface code that the browser journeys exercise but Vitest does not count, for example the printable plan (32%) and Ideas (53%).
- **Not verified:**
  - Linux and macOS, where the CI workflow has not run yet because there is no remote;
  - Firefox and WebKit;
  - a screen reader;
  - real browser zoom;
  - the operating system's reduced-motion setting.
  - The real-inference smoke test was last run on 2026-10-26 and not repeated here (no local AI code changed).

### Review

Windows 11, Node v24.16.0.

| Check                                       | Result                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run typecheck`, `lint`, `format:check` | exit 0                                                                                                                                                                                                                                                                                                       |
| `npm run test:run`                          | 34 files, 553 tests passed (9 new: focus rescue, invalid field focus, address and Back navigation, menu closing, cached model with little storage, page-left status, model file deletion, two bidirectional-control cases). The focus, navigation and menu tests were each checked to fail without their fix |
| `npm audit`, `npm audit --omit=dev`         | 0 vulnerabilities                                                                                                                                                                                                                                                                                            |
| `npm run build`                             | main JS 738.37 kB (221.19 kB gzip, 218.6 kB at gzip -9), CSS 35.98 kB; WebLLM chunk 6,038.37 kB and worker 6,025.48 kB                                                                                                                                                                                       |

Main chunk by minified bytes, from the source map: react-dom 202.4 kB, app features 143.9 kB, domain 90.4 kB, zod 88.9 kB, planning data 58.1 kB, services 43.8 kB, react-router 37.5 kB, app shell 13.5 kB.

In the built-in browser (Chromium), against the production build (`vite preview` at http://localhost:5183, same origin as the cached model):

| Step                                          | Result                                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| First load                                    | Only `index-*.js` and `index-*.css` requested; no SDK, worker or model                                                                            |
| All 8 pages with the CSP                      | No CSP violations, no console errors                                                                                                              |
| Enable local AI                               | SDK chunk loaded only then; "already in this browser’s storage"                                                                                   |
| Load from cache, under the CSP                | Ready in 9.7 s                                                                                                                                    |
| Theme ideas from the real model               | Reply in 40 s, valid; 3 announcements in total ("working on it", "replied" and the earlier "ready"); 88 text updates for the whole streamed reply |
| Save to Ideas, then lost focus                | Before the last fix focus fell to the page; after it focus is on the suggestion’s heading                                                         |
| Invalid guest count sent                      | Focus on the field, `aria-invalid`, error linked by `aria-describedby`                                                                            |
| Address and Back navigation                   | Title and h1 focus follow every page (before the fix they stopped after the first one)                                                            |
| Reflow at 320 px and at 640 px (200% of 1280) | No horizontal page scroll on any of 9 pages; wide tables scroll inside their focusable regions                                                    |
| Touch targets                                 | Nothing under 24 px except an inline link in a sentence (exempt); the file input was 21 px and is now 44 px                                       |
| Reduced motion                                | Global rule disables transitions, animations and smooth scrolling                                                                                 |

- **Not verified:**
  - **Screen readers:** no real screen reader (NVDA, JAWS, VoiceOver) was used.
  - **axe:** not run; loading it from a CDN into the page was not permitted in this session.
  - **Contrast:** computed from the design tokens by the audit (every text pair at least 4.5:1, borders, focus ring and chart fills at least 3:1, except decorative stripes and card borders), not measured on screen.
  - **Model deletion:** "Delete downloaded model" was tested with a fake SDK only; it was not run against the real cache, so the about 870 MB model stays.
  - **Focus events:** the browser pane was hidden, so Chrome sent no focus events. The focus rescue was changed to work without them; real keyboard Tab presses were not tried.
  - **Real 200% zoom:** not tried; only an emulated 640 px viewport.
  - **Identical messages:** a status message repeated with identical text is not announced again.

### Stage 10

Windows 11, Node v24.16.0.

| Check                  | Result                                                                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`    | exit 0                                                                                                                                                                     |
| `npm run lint`         | exit 0                                                                                                                                                                     |
| `npm run format:check` | exit 0                                                                                                                                                                     |
| `npm run test:run`     | 34 files, 544 tests passed (32 new: idea filters, cost grounding and one linked task; export/import round trip, copies, rejected files, reducer replace guard; page flows) |
| `npm run build`        | OK; main JS 732.10 kB (219.13 kB gzip), CSS 35.85 kB                                                                                                                       |

In the built-in browser (dev server, http://localhost:5183) with the demo wedding:

| Step                                         | Result                                                                                                                                                    |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add a suggestion as a task, twice            | First: "Added the task … No cost was added to the budget." Second: "… is already on the timeline, so nothing was added."                                  |
| Import a file with bad money                 | Refused with the field paths listed; saved data byte-for-byte unchanged                                                                                   |
| Import a valid plan file                     | Preview with "Import as a copy", "Replace …" (behind a dialog) and Cancel; saved data unchanged until confirmed                                           |
| Import as a copy                             | Two events; the copy is open; no id shared with the original; idea task link and agreed amounts kept                                                      |
| Print layout (print rules applied at 720 px) | Sidebar, skip link and buttons hidden; both budget tables render as tables at full width with repeated headers; no element clipped or wider than the page |

- **Not verified:** a real print preview or saved PDF (the browser pane was hidden, so the print CSS was checked by applying its rules and measuring); axe this stage (loading it from a CDN into the page was not permitted in this session); Firefox, Safari and phones.

### Stage 9

Windows 11, Node v24.16.0, npm 11.17.0.

| Check                  | Result                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`    | exit 0                                                                                                                          |
| `npm run lint`         | exit 0                                                                                                                          |
| `npm run format:check` | exit 0                                                                                                                          |
| `npm run test:run`     | 32 files, 512 tests passed (36 new: capability, lifecycle, validation, provider, page, template)                                |
| `npm run build`        | OK; main JS 684.79 kB (206.22 kB gzip), CSS 30.93 kB; SDK chunk 6,038.37 kB and worker chunk 6,025.48 kB load only after Enable |

The unit and page tests use a fake SDK and engine. They check the lifecycle, routing and validation; they do **not** show that inference works. Real inference was checked in a browser:

**Device and browser:** the Claude desktop app's built-in browser (Chromium 152.0.7977.167) on Windows, Intel Gen12LP integrated graphics (adapter vendor "intel", architecture "gen-12lp"), `shader-f16` supported, maxBufferSize 2 GiB, about 6.5 GB of browser storage quota. Dev server at http://localhost:5183.

| Step                                 | Result                                                                                                                                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page load                            | No SDK, worker or model request                                                                                                                                                                            |
| Enable local AI                      | SDK imported; one request for `ndarray-cache.json`; "Download: about 869 MB of model weights (from the model’s own file list)"; graphics and storage shown                                                 |
| First download and load              | Real progress from the SDK (e.g. "Fetching param cache[6/30]: 151MB fetched. 18%"); ready after 86 s                                                                                                       |
| Load from cache (later)              | "already in this browser’s storage"; ready after 7 to 8 s                                                                                                                                                  |
| Invitation wording                   | 58.5 s, about 120 words; used the real title, city and date (24 January 2027); placeholders for RSVP details; labelled "AI-written draft"; announced once ("Local AI replied.")                            |
| Theme ideas (JSON)                   | 29.5 s; valid JSON, 3 ideas, all passed the checks. Quality was generic: "Spring Blossom" for a January wedding and "Ocean's Edge" for an indoor event in Pune                                             |
| Budget explanation                   | 24.5 s; every figure matched the planner (₹5,00,000, ₹50,000, ₹4,39,000, ₹11,000, ₹580); it called the ₹580 per-guest total "food and drink", which is wrong                                               |
| Plan explanation                     | 26 s after several stops; grounded in the timeline facts                                                                                                                                                   |
| "Set guests to 120" with local AI on | About 1 s, answered by the guided planner with an engine preview and Apply change; no model call                                                                                                           |
| Stop mid-answer                      | Ready again 397 ms after Stop                                                                                                                                                                              |
| Stop before the first token          | Before the fix: the engine ran on for 32 s. After the fix: plain text 667 ms; ideas 1,084 ms; the very first JSON request after loading about 26 s (grammar preparation), with "Stopping" shown throughout |
| Turn off local AI                    | "The model was unloaded from memory"; later requests answered by the guided planner (with the new template for invitations)                                                                                |
| Accessibility                        | axe-core 4.10: no violations with the card stopped and ready to load                                                                                                                                       |
| Console                              | No errors                                                                                                                                                                                                  |

- **Not verified:** an unsupported browser (only covered by tests with a fake environment; the guided planner path itself was verified with local AI off), a discrete GPU, a phone, Firefox and Safari, a real device-lost event, the q4f32 build, and output quality beyond the runs above. The first download used the earlier origin http://localhost:5173 and had to be repeated at :5183 after another project took that port; the copy cached under :5173 is still in the built-in browser's storage.

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

No remote is configured, so nothing has been pushed and the GitHub checks are unverified. Create the public repository, run `git remote add origin <url>` and `git push -u origin main`, then `npm run submission:check` (see `docs/SUBMISSION.md`).

## Remaining work

1. **Show the plan:** generated tasks, ideas and recommendations with reasons on Overview, with an apply button, using the existing engine. (The budget part is done in stage 5.)
2. **Constraint-change flow on the Overview:** route event edits (guests, budget, date, needs) through `proposeChange` and `previewChanges` with accept or reject, and rebalance unlocked targets there too. (Budget, guest and reserve what-ifs are done on the Budget page.)
3. **Print and accessibility checks:** look at a real print preview and saved PDF in Chromium and Firefox; test with a real screen reader and real browser zoom. (axe scans, keyboard-only, reflow and reduced-motion checks run in Playwright.)
4. **Local model follow-ups:** run "Delete downloaded model" against the real cache, move the cache check into the worker so WebLLM is not bundled twice, and check a discrete GPU and phones. (The guided planner is done in stage 8, local AI in stage 9.)
5. **Browser coverage:** run the CI workflow once a remote exists, and add Firefox and WebKit projects (with their own `npx playwright install` lines) and a real phone. (Chromium journeys and axe scans are done.)
6. **Replace the provisional evaluation criteria** in `docs/PROJECT_BRIEF.md` once the real six are supplied.
7. **Bundle size:** split the planning configuration or routes so the main chunk drops below Vite's 500 kB warning.
