# Testing

How Celebration Planner is tested, how to run the tests, and what they do and do not show.

## Commands

| Command                 | Runs                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`         | `typecheck`, `lint`, `format:check`, unit and component tests **with coverage** (one Vitest run), then `vite build`. This is the CI gate. |
| `npm run test:coverage` | Vitest once, with coverage in `coverage/` (`index.html`, `coverage-summary.json`).                                                        |
| `npm run test:run`      | Vitest once, without coverage. `npm test` watches.                                                                                        |
| `npm run test:e2e`      | Playwright: builds the app, serves the production build with `vite preview` on port 4183, then runs the browser journeys and axe scans.   |

`check` does not run the browser tests, and `test:e2e` does not repeat the unit tests: each suite runs once. `check` builds with `vite build` directly because `typecheck` has already run `tsc -b`.

### From a clean clone (and in CI)

```bash
npm ci
npm run check
npx playwright install --with-deps chromium
npm run test:e2e
```

- **Node.js** 24.15 or later in the 24 line (`.nvmrc`, `engines`).
- **Browser:** Playwright is configured with one project, Chromium, so only Chromium is installed. It is Playwright's own build (about 118 MB for the headless shell), stored in `%LOCALAPPDATA%\ms-playwright` on Windows, `~/Library/Caches/ms-playwright` on macOS and `~/.cache/ms-playwright` on Linux. It does not use or change an installed Chrome.
- **`--with-deps`:**
  - **Linux:** also installs the system libraries Chromium needs (fonts, NSS, GTK and similar). It uses `apt`, so it needs root or `sudo` and supports Debian and Ubuntu only. On other distributions, install those libraries with the system package manager.
  - **Windows and macOS:** nothing extra is needed.
- **Network:** `npm ci` and the browser install need the internet; the tests do not. Every request a test page makes to anything other than `localhost` is blocked and recorded.
- **Ports:** 4183 must be free. Locally an already-running server on 4183 is reused; with `CI` set it never is.
- **CI** (`.github/workflows/ci.yml`): two jobs on `ubuntu-latest`, `check` and `e2e`. The e2e job uploads the Playwright report when it fails.

## Unit and component tests (Vitest, React Testing Library, user-event)

34 files in `src/**/*.test.ts(x)`, run in jsdom. Component tests find elements by role and label, as assistive technology would.

| Area                                                    | Where                                                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Money in whole paise, rounding, exact allocation totals | `domain/money.test.ts`, `planning/allocation.test.ts`                                                   |
| Locked targets, infeasible budgets, conflicts           | `planning/allocation.test.ts`, `budget.test.ts`, `feasibility.test.ts`                                  |
| Forecasts independent of targets, reserve accounting    | `planning/forecast.test.ts`, `budget.test.ts`                                                           |
| Per-guest versus fixed costs                            | `planning/forecast.test.ts`, `scenarios.test.ts`                                                        |
| Payments and deposits counted once                      | `planning/forecast.test.ts`, `budget.test.ts`, `vendors.test.ts`                                        |
| Calendar boundaries, same-day and next-day events       | `domain/dates.test.ts`, `planning/deadlines.test.ts`, `generate.test.ts`                                |
| Short lead time and saved past events                   | `planning/generate.test.ts`, `timeline.test.ts`, `ideas.test.ts`                                        |
| Regeneration keeps completed, custom and manual records | `planning/timeline.test.ts`, `preview.test.ts`                                                          |
| Vendor hard constraints and unknown capabilities        | `planning/vendors.test.ts`                                                                              |
| Storage recovery, denied and quota-limited saving       | `services/storage.test.ts`, `persistence.test.ts`, `app/App.test.tsx`                                   |
| Import validation and copies                            | `services/importPlan.test.ts`                                                                           |
| Malformed model proposals, forbidden operations         | `services/ai/assistant.test.ts`, `ai/local/local.test.ts`                                               |
| Stale revisions and cancelled requests                  | `app/state/plannerReducer.test.ts`, `ai/assistant.test.ts`, `features/assistant/AssistantPage.test.tsx` |
| New-event form validation and completion                | `app/App.test.tsx`                                                                                      |
| Real budget values, preview versus Apply                | `features/budget/BudgetPage.test.tsx`, `AssistantPage.test.tsx`                                         |
| Keyboard, focus, storage notices, dialogs               | `components/components.test.tsx`, `app/App.test.tsx`                                                    |

### Coverage

The project's own goal is at least **85% branch coverage for the core planning logic** (`src/domain/planning`). It is set as a Vitest threshold, so `check` fails below it. Interface code is covered mainly by the browser journeys, which are not counted.

## Browser journeys (Playwright, `e2e/`)

All of these run against the production build.

| Journey                                     | File                    | What it checks                                                                                                           |
| ------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1. Each event type gets its own plan        | `planner.spec.ts`       | Created through the form; each type's budget categories and tasks appear and the others' do not                          |
| 2. Cutting the budget                       | `planner.spec.ts`       | "₹… over the whole budget" and "Ways to close the gap" appear                                                            |
| 3. More guests                              | `planner.spec.ts`       | A preview changes nothing; after Apply, Catering (per guest) rises and Venue hire (fixed) does not                       |
| 4. Completed task and edit survive a reload | `planner.spec.ts`       | Task stays done and the new city stays after editing the event and reloading                                             |
| 5. Same vendor quote twice                  | `planner.spec.ts`       | One Venue hire line at ₹1,10,000 agreed, ₹30,000 paid, ₹80,000 to pay                                                    |
| 6. Export and import                        | `planner.spec.ts`       | A real download; a bad file is refused with saved data unchanged; a good one previews and imports as a copy with new ids |
| 7. Local AI states                          | `assistant.spec.ts`     | Unsupported, failed, stopped and successful, with a stand-in SDK (below)                                                 |
| 8. Switching events during a reply          | `assistant.spec.ts`     | The generation is interrupted and the reply appears in neither event nor in saved data                                   |
| Accessibility                               | `accessibility.spec.ts` | axe scans; keyboard only; reflow at 320 and 640 px; reduced motion                                                       |

Every journey runs on a fixed date (21 October 2026) with the network beyond `localhost` blocked.

### AI in automated tests

The automated tests never download a model and need no GPU.

- **Unit and component tests:** inject a fake SDK into the controller (`local.test.ts`, `LocalAICard.test.tsx`).
- **Browser journeys** replace the built SDK and worker chunks with a stand-in (`e2e/fakes/fake-webllm.js`), give the page a pretend WebGPU adapter and storage estimate, and answer the one manifest request locally.

The stand-in streams fixed text, can fail, hang or be interrupted, and counts calls. These tests show how the **app** handles the adapter's states (loading, failure, stopping, labelling, saving, discarding stale replies). They are **not model verification**: they say nothing about whether a real model loads, runs on a given GPU, or writes useful text.

### Real-inference smoke test (manual)

Run this by hand on a machine with WebGPU, after any change to `src/services/ai/local`, the WebLLM version or the model.

1. `npm run build`, then `npx vite preview --port 5183 --strictPort` (the origin where the model may already be cached), and open http://localhost:5183 in Chrome or Edge.
2. Create the demo wedding, open Assistant, choose **Enable local AI**, check the size, hosts and license shown, then **Download and start** (about 870 MB the first time) or **Load the model**.
3. Ask "Suggest theme ideas for this event." and "Write invitation wording.". Check that each answer is labelled "Local AI" and "AI-written draft", that the ideas avoid prices and conflicting food, and that the invitation has the right date and no invented contact details.
4. Ask "Explain my budget." and compare every figure with the Budget page.
5. Press **Stop** during an answer (ready again within about a second, except the first ideas request after loading, which prepares its grammar for about 25 s), then **Turn off local AI**.
6. Check the console has no errors and no Content-Security-Policy violations.

**Last performed:**

- **2026-10-26, production build with the CSP, Intel integrated GPU in the Claude desktop app's Chromium:** model loaded from cache in 9.7 s; ideas arrived in 40 s, valid and labelled; no CSP violations or console errors.
- **Stage 9 (2026-10-22):** the fuller run, including the first download, stopping and the budget explanation (see `docs/BUILD_PROGRESS.md`).

It was not repeated after the test work in this change, which did not touch the local AI code.

## Accessibility verification

**Automated, in Chromium with axe-core** (`@axe-core/playwright`, WCAG 2.0, 2.1 and 2.2 A and AA rules):

- the welcome screen;
- every section of a populated plan (Overview, Budget, Timeline, Vendors, Assistant, Ideas, Your data);
- the printable plan;
- an open confirmation dialog.

All report no violations.

**Automated real-browser checks:**

- **Keyboard only, with real key presses:** skip link; navigation, with focus moving to the new heading; a button that removes itself; a modal dialog that keeps focus off the page behind it and returns focus on Escape.
- **Reflow:** no sideways page scrolling at 320 px and at 640 px (the width of a 1280 px window at 200% zoom).
- **Reduced motion:** transitions are effectively zero when the preference is set.

Automated scans and scripted checks do not prove that the app is accessible. They miss problems of meaning, reading order, how announcements sound, and real assistive technology behaviour.

**Manual checks actually performed** (in the Claude desktop app's built-in Chromium, during the review on 2026-10-26):

- page reflow at 320 and 640 px with an emulated viewport;
- address and Back navigation;
- focus after a removed control;
- focus on an invalid field;
- touch target sizes measured on every page.

That browser pane was hidden, so those checks were scripted rather than done by hand with a keyboard.

**Not done:**

- a screen reader (NVDA, JAWS, VoiceOver or TalkBack);
- real browser zoom to 200% and 400%;
- the operating system's reduced-motion setting;
- Firefox, Safari and phones;
- colour contrast measured on screen (the audit computed it from the design tokens).
