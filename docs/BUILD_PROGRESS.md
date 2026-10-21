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

## Verification results (actually run)

Windows, Node v24.16.0, npm 11.17.0.

| Check                  | Result                                                                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`    | exit 0                                                                                                                                                   |
| `npm run lint`         | exit 0 (after fixing 14 findings)                                                                                                                        |
| `npm run format:check` | exit 0                                                                                                                                                   |
| `npm run test:run`     | 12 files, 166 tests passed                                                                                                                               |
| `npm run build`        | OK; JS 399.41 kB (124.08 kB gzip), CSS 9.30 kB                                                                                                           |
| Mutation check         | Disabling the "do not overwrite protected data" guard made 5 tests fail; restored, 166 pass                                                              |
| Real browser           | `vite preview` served the build; headless Edge rendered the Events page (screenshot checked) and its DOM contained the expected heading and demo buttons |

The completion check is covered by automated UI tests: create events (form and demos), switch the active event, delete with confirmation, reload and restore the same storage, and recover from corrupt, too-new, unavailable and over-quota storage, plus Clear saved data leaving other keys alone.

Not verified:

- Reload and recovery against a real browser's `localStorage`. These flows are covered only in jsdom (using an in-memory storage double); in Edge only the initial render was checked.
- Screen reader behaviour and keyboard-only flow were not tested with assistive technology.
- Real quota exhaustion and multi-tab behaviour.
- The GitHub Actions workflow has never run (no remote).

Bugs found and fixed this stage: the budget error for a zero amount read "Amount must be at least 1" (ambiguous unit), now "Budget must be greater than zero"; a PowerShell edit helper wrote UTF-8 BOMs into 7 files, which were detected and stripped.

## Remote and push

No remote is configured, so nothing has been pushed. Add one with `git remote add origin <url>` and push `main`.

## Remaining work

1. **Plan generator:** deterministic, explainable plan from rule configuration in `src/data` (amounts, weights and due-date offsets for the template catalog), producing `generated` values.
2. **Constraint changes and consequences:** change budget, date or guest count; show a diff with reasons as a `ProposedChange`; accept or reject it.
3. **Budget, timeline, vendors, guests, ideas pages:** manage the plan, including payments.
4. **Export:** a readable (print or Markdown) export beside JSON, and JSON import with validation.
5. **WebLLM assistant** in a Web Worker behind `AssistantAdapter`, with session-only chat.
6. **E2E tests, accessibility audit, deployment workflow:** add scripts only when implemented.
7. **Replace the provisional evaluation criteria** in `docs/PROJECT_BRIEF.md` once the real six are supplied.
