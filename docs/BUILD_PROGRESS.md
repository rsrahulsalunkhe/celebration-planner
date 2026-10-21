# Build progress

## Completed stages

### Stage 1: Scaffold

- Repository initialised on `main`; the directory was empty, so there was nothing to preserve.
- Vite + React 19 + TypeScript (strict) app with `HashRouter`, CSS Modules and CSS variables (light and dark), Context + `useReducer` state, Zod schemas, `lucide-react` icons.
- Feature routes: Event, Budget, Timeline, Vendors, Assistant, Ideas, plus a not-found page.
- Working today: load a fictional sample wedding, see its facts, persist it to `localStorage`, export it as JSON, clear it.
- Placeholder (honestly labelled in the UI): Budget, Timeline, Vendors, Ideas, and the Assistant (no model).
- Domain utilities with tests: integer-minor-unit money (format, parse, exact allocation) and UTC calendar-date arithmetic.
- Services: validated storage with safe fallbacks, JSON export, `AssistantAdapter` interface with a no-model implementation.
- Tooling: ESLint 10 (type-checked rules, react-hooks, react-refresh, Prettier compat), Prettier, Vitest + Testing Library, CI workflow.

## Decisions

- **Node 24 LTS**, `engines: >=24.15.0 <25`, `.nvmrc` is `24`. Needed by Vitest 5 (`^22.12 || ^24`) and jsdom 30 (`^24.15`).
- **TypeScript 6.0.3, not 7.0.2.** `typescript-eslint` 8.72.0 declares `typescript <6.1.0`. Upgrade when it supports 7.
- **No `eslint-plugin-jsx-a11y`.** Its latest release supports ESLint up to 9 only.
- Path alias `@/` maps to `src/` (in `tsconfig.app.json` and `vite.config.ts`).
- `base: './'` in Vite so the build works from any sub-path.
- Money as integer minor units; dates as `YYYY-MM-DD` strings with UTC arithmetic.
- No `e2e/` or `scripts/` directories and no Playwright yet: they have no implementation, so no scripts reference them.
- The sample fixture is shown as a convenience until the real event form exists.

## Verification results (actually run)

Run on Windows, Node v24.16.0, npm 11.17.0, after a clean `npm ci`.

| Check                    | Result                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `npm install` / `npm ci` | OK, 0 vulnerabilities reported                                                       |
| `npm run typecheck`      | exit 0                                                                               |
| `npm run lint`           | exit 0                                                                               |
| `npm run format:check`   | exit 0 (after fixing Markdown formatting it first flagged)                           |
| `npm run test:run`       | 7 files, 37 tests passed                                                             |
| `npm run build`          | OK; `dist` JS 361.77 kB (112.58 kB gzip), CSS 4.56 kB                                |
| `npm run dev`            | Server started on a test port; `/` and `/src/main.tsx` returned HTTP 200             |
| Typecheck/lint sanity    | A deliberately broken probe file was rejected by both `tsc` and ESLint, then removed |

Bugs found by the tests and fixed in this stage: `formatMoney` printed `₹123.5` instead of `₹123.50`; `parseMoney('-5')` returned 500 instead of `null`.

Not verified:

- The GitHub Actions workflow has never run (no remote yet).
- No visual check in a real browser; the UI is covered only by jsdom tests.
- `npm run preview` was not started.

## Remote and push

No remote is configured, so nothing has been pushed. Add one with `git remote add origin <url>` and push `main`.

## Remaining work

1. **Event form**: validated entry of event context (type, date, guests, budget, city, notes).
2. **Planning rules and generator**: deterministic, explainable plan from rule configuration in `src/data`.
3. **Constraint changes and consequences**: change budget, date or guest count and show a diff with reasons.
4. **Budget, timeline, vendors, ideas**: manage the plan.
5. **Export**: add a readable (print/Markdown) export beside JSON, plus JSON import.
6. **WebLLM assistant** in a Web Worker behind `AssistantAdapter`.
7. **E2E tests, accessibility audit, deployment workflow**: add scripts only when implemented.
8. **Replace the provisional evaluation criteria** in `docs/PROJECT_BRIEF.md` once the real six are supplied.
