# Celebration Planner

A static, local-first planner for weddings, birthdays and community events. Everything runs in the browser; no backend and no account.

Project scope and working rules: [docs/PROJECT_BRIEF.md](docs/PROJECT_BRIEF.md). Status: [docs/BUILD_PROGRESS.md](docs/BUILD_PROGRESS.md).

## Requirements

Node.js 24 LTS (see `.nvmrc`).

## Scripts

| Command                | What it does                            |
| ---------------------- | --------------------------------------- |
| `npm run dev`          | Start the Vite dev server               |
| `npm run build`        | Type-check, then build to `dist/`       |
| `npm run preview`      | Serve the production build locally      |
| `npm run typecheck`    | TypeScript strict check                 |
| `npm run lint`         | ESLint                                  |
| `npm run format:check` | Prettier check (`npm run format` fixes) |
| `npm test`             | Vitest in watch mode                    |
| `npm run test:run`     | Vitest, single run                      |
