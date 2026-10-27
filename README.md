# Celebration Planner

**Challenge 5: Celebration & Event Planner.** A static, local-first web app for planning weddings, birthdays and community events.

Everything runs in the browser: no backend, no account, no paid API and no secret in the code. Planning is deterministic and rule-based. An optional on-device AI model can write drafts, but it never decides a number or changes the plan.

- Scope and rules: [docs/PROJECT_BRIEF.md](docs/PROJECT_BRIEF.md)
- Stage-by-stage record with measured results: [docs/BUILD_PROGRESS.md](docs/BUILD_PROGRESS.md)
- Testing: [docs/TESTING.md](docs/TESTING.md)
- Submission checks: [docs/SUBMISSION.md](docs/SUBMISSION.md)

## Who it is for, and the main journey

| Persona             | Typical situation                                         | What the planner gives them                                                    |
| ------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Wedding organizer   | Many guests, a large budget, long lead time, many vendors | Category targets, per-guest versus fixed costs, vendor matching and quotes     |
| Birthday host       | Small to mid-size, budget-sensitive, short notice         | A short checklist, age-appropriate steps, a tight budget with a reserve        |
| Community volunteer | Low budget, shared work, outdoor sites, access needs      | Permissions and volunteer tasks, weather backup, access provisions kept funded |

**Main journey:** enter the event's context → get an explained plan → change a constraint → see exactly what changes and why → manage the plan → export or print it.

## Features

- **Events:** a create and edit form with an error summary, three fictional demonstrations, an event switcher and up to 10 events.
- **Budget:**
  - Category targets with a contingency reserve, and forecasts from fixed and per-guest estimates.
  - Agreed quotes, deposits and payments, with every money view kept separate.
  - Locking and unlocking targets.
  - What-if previews (budget cut, more guests, reserve, favour a priority) that change nothing until Apply.
- **Timeline:** tasks with reasons, dependencies, phases and filters. It also has catch-up scheduling when time is short, custom tasks, and an event-day running order.
- **Vendors:** 17 fictional sample vendors that are matched against the event's needs, ranked with reasons, and comparable side by side.
  - You can add your own vendors.
  - Each vendor has a checklist of questions to ask.
  - An agreed quote links to exactly one budget line.
- **Guests:** names or aliases, party size, replies and needs. The expected guest count changes only through a preview.
- **Ideas:** filtered suggestions, each saying why it fits or why it is hidden. Sources are labelled Guided suggestion, Local AI draft or User idea.
  - Favourites.
  - "Add as a task" creates one linked task, never a duplicate.
- **Assistant:** the rule-based Guided planner answers questions and proposes changes. You apply a change only after seeing the engine's before and after. Optional Local AI writes drafts.
- **Your data:**
  - Export one event as a versioned plan file, and import with a preview and validation.
  - Back up all events.
  - Clear saved data, and delete the downloaded model files.
- **Printable plan:** summary, assumptions, budget, checklist, vendor confirmations, chosen ideas and the running order. Print it, or save it as a PDF from the browser's print dialog.

### Context to decision: examples

| Context you enter                     | What the planner does                                                                                                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setting: outdoor or mixed             | Adds weather backup steps (it uses no weather forecast); venues and equipment must offer a covered alternative                                                              |
| Accessibility need: wheelchair access | Funds an access category as a floor that is never offered as a saving; venues that state they cannot provide it are unsuitable; unsuitable ideas are hidden with the reason |
| Dietary need: vegetarian              | Caterers must confirm it; food ideas that conflict are hidden; dietary provisions are never offered as savings                                                              |
| Birthday with an under-13 age band    | Adds supervision and food-safety steps                                                                                                                                      |
| 200 → 240 guests (demo wedding)       | Per-guest costs rise by 40 × ₹580 = ₹23,200 and the forecast goes from ₹4,39,000 to ₹4,62,200, ₹12,200 into the reserve; fixed costs and agreed fixed quotes stay the same  |
| Budget cut by 15% (demo wedding)      | ₹5,00,000 → ₹4,25,000: the ₹4,39,000 forecast is ₹14,000 over the whole budget, and the page lists conflicts and ways to close the gap                                      |
| Event 10 days away instead of 90      | Ideal deadlines are kept and shown; critical steps become catch-up work (two a day, in dependency order) and the plan says if that is not feasible                          |

## Setup

**Runtime:** Node.js **24 LTS**, at least 24.15.0 and below 25 (`.nvmrc`, `engines` in `package.json`). npm comes with Node.

```bash
npm ci
npm run dev
```

Vite prints the local address. Before running the browser tests once:

```bash
npx playwright install chromium
```

On Linux, add `--with-deps` to that command to install the system libraries Chromium needs.

| Command                    | What it does                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| `npm run dev`              | Start the Vite dev server                                                                       |
| `npm run build`            | Type-check, then build to `dist/`                                                               |
| `npm run preview`          | Serve the production build locally                                                              |
| `npm run typecheck`        | TypeScript strict check                                                                         |
| `npm run lint`             | ESLint (type-checked rules)                                                                     |
| `npm run format:check`     | Prettier check (`npm run format` fixes)                                                         |
| `npm test`                 | Vitest in watch mode                                                                            |
| `npm run test:run`         | Vitest, single run                                                                              |
| `npm run test:coverage`    | Vitest with coverage (`coverage/`)                                                              |
| `npm run check`            | Typecheck, lint, format check, unit and component tests with coverage, then build (the CI gate) |
| `npm run test:e2e`         | Playwright journeys and axe scans against the production build (`vite preview` on port 4183)    |
| `npm run submission:check` | Read-only preflight for submission: branches, remote, working tree, tracked files and sizes     |

### Hosting

The app is static and uses `HashRouter`, so every route lives after the `#` and no server rewrites are needed.

- By default the build uses relative asset URLs (`base: './'`) and works from any folder.
- For a repository subpath such as a GitHub Pages project site, set the base explicitly:

```bash
BASE_PATH=/celebration-planner/ npm run build
```

- **In PowerShell:** `$env:BASE_PATH = '/celebration-planner/'; npm run build`.
- **In Git Bash:** values starting with `/` are rewritten into Windows paths and the build stops with a `BASE_PATH must be...` error. Prefix the command with `MSYS_NO_PATHCONV=1`.

**Optional live demo:** `.github/workflows/pages.yml` builds with `BASE_PATH=/<repository>/` and deploys through GitHub Pages artifacts, with no `gh-pages` branch. It runs only when started by hand and needs Pages set to "GitHub Actions" in the repository settings. It has not been run.

## Architecture

React 19, strict TypeScript, Vite, `HashRouter`, CSS Modules, React Context with `useReducer`, Zod and `lucide-react`. There is no server: data lives in the browser's `localStorage`.

| Folder                | Responsibility                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/app`             | Shell (sidebar, compact menu, event switcher, storage notice, focus management), routes, error boundary, state (`state/plannerReducer.ts`)                                           |
| `src/domain`          | Types and Zod schemas, money (integer paise) and date (UTC calendar) utilities, selectors, edit operations, import copies                                                            |
| `src/domain/planning` | The pure planning engine: allocation, forecasts, ledger, scenarios, feasibility, timeline, vendors, guests, ideas, recommendations. No React, browser or clock; a test enforces this |
| `src/data`            | Fictional configuration: per-type rules (`planning/wedding.ts`, `birthday.ts`, `community.ts`), demos, sample vendors, labels                                                        |
| `src/features`        | Pages: overview, events, budget, timeline, vendors, ideas, assistant, data (export and import), print                                                                                |
| `src/components`      | Accessible building blocks: buttons, fields, cards, dialogs, status messages                                                                                                         |
| `src/services`        | Persistence and storage, export and import, the assistant contract (`ai/`), the guided planner and the local AI controller (`ai/local/`)                                             |
| `src/styles`          | Design tokens and global styles (light theme, reduced-motion rules, print rules)                                                                                                     |
| `e2e`                 | Playwright journeys, axe scans and the stand-in SDK used instead of a real model                                                                                                     |
| `scripts`             | `submission-check.mjs`                                                                                                                                                               |
| `docs`                | Brief, build record, testing, submission checks                                                                                                                                      |

All edits go through one reducer as validated operations with an expected revision. A stale or invalid edit returns the state unchanged.

## How the numbers and dates work

All money is Indian rupees held as **whole paise** (integers, never floats). Dates are `YYYY-MM-DD` calendar dates computed in UTC. The engine takes today's date as an argument, so the same input always gives the same plan.

- **Reserve:** a contingency kept aside from the budget, 10% by default and editable from 0 to 50%, rounded down. Spendable = budget − reserve.
- **Targets:** spendable money is shared across categories by integer planning weights with an exact largest-remainder method. When the allocation is valid, targets plus reserve equal the budget to the paisa.
  - A target you set is locked until you unlock it.
  - Rebalancing moves only unlocked targets, never below required provisions or zero.
  - Locked targets that no longer fit are shown as a conflict, never silently unlocked.
- **Forecasts:** calculated separately from targets, so moving targets can never make a plan look affordable. Each budget line counts its agreed total if there is one, otherwise its estimate. Forecast = fixed costs + per-guest rate × guests.
- **Payments:** a deposit is part of the agreed total, never an extra cost. Outstanding = agreed − paid, and a payment is counted once.
- **Headroom and shortfall:** headroom = budget − reserve − forecast. A negative headroom means the forecast is eating into the reserve. Beyond the whole budget, the shortfall is a number with conflicts and options (use the reserve, drop optional items, fewer guests, raise the budget).
- **Dates:** each task has an ideal deadline from its lead time and dependencies.
  - Preparation is never due after the event, and a step is never due before its prerequisites.
  - When time is short, the ideal deadline stays visible and critical steps become catch-up work.
  - New events cannot be in the past; saved past events are kept as history.
- **Regeneration:** editing the event recalculates generated deadlines and adds or removes steps that start or stop applying.
  - It keeps completed tasks, custom tasks, notes, owners and manual deadlines.
  - A manual deadline set for an earlier event date is flagged for review.
  - Budget and vendor records you made are never overwritten.

## Assistant: Guided planner and Local AI

The two are labelled separately on every answer.

- **Guided planner (always on).** Deterministic rules, not a language model.
  - It explains the budget and the next steps from the event's real figures.
  - It drafts ideas and invitation wording from fixed templates.
  - It turns requests such as "Reduce my budget by 15%" or "Set guests to 120" into a **proposed change**. The planning engine builds the preview, and nothing changes until you press Apply change.
  - It asks instead of guessing when a request is ambiguous.
  - It cannot make payments, delete events or mark vendors booked.
- **Local AI (optional, off by default).** A real language model running on your device in the browser, through [WebLLM](https://github.com/mlc-ai/web-llm).
  - It writes **drafts only**: theme and activity ideas, invitation wording, and plain-language explanations of the planner's own figures.
  - Its output is validated: ideas must match a schema, and prices and conflicting food are removed. Invented links, emails and phone numbers are removed from invitations, and explanations containing figures the planner did not supply are discarded.
  - Every answer is labelled "Local AI · AI-written draft" with a caution.
  - Number commands and changes always go to the Guided planner and the engine, even when Local AI is on.
  - If Local AI is unsupported, fails or is off, the Guided planner answers instead and says so.

### Local AI model details and requirements

| Item          | Value                                                                                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK           | `@mlc-ai/web-llm` 0.2.85 (pinned exactly)                                                                                                                                                    |
| Model         | Qwen2.5-1.5B-Instruct, 4-bit (`Qwen2.5-1.5B-Instruct-q4f16_1-MLC`; `q4f32_1` on GPUs without `shader-f16`)                                                                                   |
| License       | Apache-2.0. The weights are not in this repository: the browser downloads them from the source                                                                                               |
| Download      | About 870 MB (828 MiB of weights in 30 shards plus a 5 MiB model library), from huggingface.co and raw.githubusercontent.com. It is cached in the browser for this site                      |
| Hardware      | A browser with WebGPU (recent desktop Chrome or Edge) on a secure page (https or localhost). The SDK lists about 1.6 GB of graphics memory for this model; the app uses a 2,048-token window |
| When it loads | Never on page load. **Enable local AI** runs a device check and shows the size, hosts and license; only **Download and start** downloads anything                                            |
| Removing it   | Your data → **Delete downloaded model** (Clear saved data does not remove the model files)                                                                                                   |

**Verification status (manual, not automated):**

- **2026-10-22:** download, load, ideas, invitation, explanation, stop and turn off were all tested with real inference. This was in the Claude desktop app's Chromium 152 on an Intel Gen12LP integrated GPU.
- **2026-10-26:** the production build with its Content-Security-Policy was checked again. The model loaded from cache in 9.7 s and an ideas answer took 40 s.
- **Quality:** answers were valid but sometimes generic. One explanation used a correct figure with a wrong description, which is why every answer carries a caution.
- **Not verified:** discrete GPUs, phones, Firefox and Safari, and the `q4f32` build.

Automated tests use a stand-in for the SDK and never download or run a model ([docs/TESTING.md](docs/TESTING.md)).

## Fictional vendors and costs

- **Rates:** every planning rate, estimate and idea cost band is a **fictional illustration**, not a market price or quote. An agreed quote always replaces an estimate.
- **Demonstrations:** the three demonstration events are fictional inputs, not recommended budgets.
- **Sample vendors:** the 17 vendors are fictional businesses with illustrative prices and capabilities. They have no ratings, contact details or known availability, and nothing is contacted or booked. "Booked" is only your own record.

## Data, privacy and limits

- **Storage:**
  - Plans are saved in this browser's `localStorage` under the key `celebration-planner:saved-state`. Nothing is sent to a server and there is no account.
  - The data is **not encrypted**: anyone using this browser profile can read it.
  - It does not move to other browsers or devices, and clearing site data removes it.
- **Saving problems:** if saved data is damaged, from a newer version, too large or blocked, saving pauses rather than overwriting it. The app explains how to download, export or clear it.
- **Assistant conversations** are kept in memory for the session only, never saved or exported unless you tick the box to include them in a plan file (they are not imported back).
- **Local AI:** event details stay on the device. Guest names, notes and contact details are never given to the model. The model hosts only see the file download.
- **Content-Security-Policy:** the production build limits scripts to the site itself and network requests to the site and the model hosts.
- **Limits:**
  - 10 events.
  - Per event: 30 categories, 200 budget lines, 200 tasks, 100 vendors, 1,000 guest records and 100 ideas.
  - 5,000 expected guests, and about 2 MB of saved data.
  - Two tabs editing the same data are not coordinated; the last save wins.

### Export, import and printing

- **Export:** "Export plan (JSON)" saves one event as `{ format: "celebration-planner/event", version: 1, ... }`.
  - It includes budget records, tasks, vendor choices, ideas and the running order.
  - Guests are optional; the assistant conversation is included only on request.
  - "Export all events" writes a full backup.
- **Import:**
  - Files over 1 MB are refused.
  - The file is parsed safely and rebuilt through the schemas: unknown fields are dropped, and money must be whole paise and dates real.
  - A preview comes first. "Import as a copy" always uses new ids; replacing an existing event needs a separate confirmation.
  - Invalid files change nothing.
- **Printing:** browser print or save as PDF, without a PDF library.
- **Not supported:** sharing links, email, cloud sync, calendar export, and other currencies (INR only).

## Tests and verification evidence

Commands and results from the latest run (Windows 11, Node 24.22.1); details are in [docs/BUILD_PROGRESS.md](docs/BUILD_PROGRESS.md):

| Command                | Result                                                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`        | Passed: typecheck, lint and format clean; 34 files, **570 tests**; build OK                                                        |
| Coverage               | Core planning logic (`src/domain/planning`) **86.5% branches** (the project's own 85% goal); whole app 79.6% branches, 91.0% lines |
| `npm run test:e2e`     | **27 Playwright tests** passed in Chromium: eight journeys, axe scans, keyboard-only use, reflow and reduced motion                |
| Clean copy with `CI=1` | `npm ci`, `check`, browser install and `test:e2e` all passed                                                                       |
| `npm audit`            | 0 vulnerabilities                                                                                                                  |

**Accessibility:** the aim is WCAG 2.2 AA.

- **Automated checks:** axe-core found no violations in the tested states. Keyboard-only, reflow (320 and 640 px) and reduced-motion checks pass in Chromium.
- **Not done:** a screen reader, real browser zoom, Firefox, Safari and phones.
- Automated checks do not prove full accessibility, and the app is not certified.

**Browsers:** developed and tested in desktop Chromium. Other current browsers may run the planner but have not been tested. Local AI needs WebGPU.

## Walkthrough: one of each event type

Each starts from **New event → Create demo**. The demo dates are set from today (+90, +14 and +30 days), and the figures below come from the planning engine.

1. **Wedding** (200 guests, ₹5,00,000, Pune, vegetarian, priorities food, venue and photography)
   - **Budget:** Create starting budget. The reserve is ₹50,000 and the forecast ₹4,39,000 (₹3,23,000 fixed plus ₹580 per guest), leaving ₹11,000 of headroom across 8 categories.
   - **What-if:** Preview budget cut shows the ₹14,000 shortfall; Preview more guests shows ₹23,200 more in per-guest costs.
   - **Vendors:** shortlist the sample venue "Lotus Courtyard Hall" and record an agreed quote with a deposit. The same budget line is updated, and recording it again does not count it twice.
   - **Timeline:** Create timeline from the plan (18 steps, all on schedule with 90 days to go).
2. **Birthday** (40 guests, ₹50,000, Nashik, adult age band)
   - **Budget:** the forecast is ₹37,000 with ₹8,000 headroom across 6 categories, including Return gifts.
   - **Timeline:** 11 steps with 14 days to go. Mark one done, edit the event, reload: it stays done.
   - **Ideas:** filters such as setting, diet and time left. Add one as a task and it appears once on the timeline.
3. **Outdoor community event** (150 guests, ₹2,00,000, Satara, wheelchair access)
   - **Budget:** an "Accessibility and comfort" category is funded as a floor. The forecast is ₹1,43,000 with ₹37,000 headroom.
   - **Timeline:** 16 steps, including permissions, volunteers and an outdoor backup plan.
   - **Vendors and Ideas:** venues are matched for step-free access; one idea is hidden with the reason that it suits wheelchair users poorly.
   - **Your data:** export the plan, import it as a copy, then open the printable plan.

## Limitations

- Fictional rates and vendors only; no live prices, availability or bookings.
- One currency (INR) and one language (English), with `en-IN` formatting.
- Data stays in one browser, unencrypted, with no sync.
- Local AI needs WebGPU and a large download, and writes drafts that can be wrong.
- The six evaluation criteria and the submission guide were not supplied with the brief, so neither is reflected here beyond what is stated.
