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

- `src/app`: shell, providers, routing, state.
- `src/domain`: types, Zod schemas, money and date utilities, planning rules.
- `src/features`: `events`, `budget`, `timeline`, `vendors`, `assistant`, `ideas`, plus `data` (saved-data explanation, export and clear).
- `src/components`: reusable accessible controls.
- `src/services`: storage, export, AI adapters.
- `src/data`: small fictional fixtures and rule configuration.
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
- Genuine generation will later run locally through WebLLM in a Web Worker behind `AssistantAdapter` (`src/services/ai/adapter.ts`).

## Assumptions

- Target browsers are current evergreen browsers.
- Currency is INR only; locale formatting is `en-IN`.
- Demo presets are fictional demonstration inputs, not recommended market budgets.
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
