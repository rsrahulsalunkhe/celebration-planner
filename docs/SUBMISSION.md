# Submission checks

The submission is the **public GitHub repository URL** with a single branch, `main`. The organizer's submission guide was not supplied, so nothing here assumes requirements beyond the brief: a public repository, one branch, and a repository under 10 MB. Nothing is submitted automatically.

## Automated preflight

```bash
npm run submission:check
```

```bash
npm run submission:check -- --clean-clone
```

`scripts/submission-check.mjs` is **read-only**.

- **What it runs:** Git queries (`ls-remote`, `ls-tree`, `status`, `count-objects`, `rev-list`, `cat-file`), plus one GET request to the GitHub REST API for a github.com remote.
- **What it never does:** fetch into the repository, create or delete branches, rewrite history, push, change visibility or remove files. When something needs fixing, it says what to do.
- **`--clean-clone`:** clones this folder's **committed** history (no `--depth`) into a temporary folder and runs `npm ci`, `npm run check`, `npx playwright install chromium` (`--with-deps` on Linux), `npm run test:e2e` and `npm run build`. It then deletes the folder.
- **`--from-remote`:** with `--clean-clone`, clones the GitHub repository instead.
- **Token:** set `GITHUB_TOKEN` (or `GH_TOKEN`) to read the repository while signed in. Without one, a private repository and a missing one look the same, so the result is UNVERIFIED. The token is sent only to api.github.com and never printed.

Each result is PASS, WARN, FAIL or **UNVERIFIED**. A check that cannot be made, for example with no remote, no network or a shallow checkout, is UNVERIFIED, never PASS. Exit code: 1 for any FAIL, 2 when nothing fails but something is WARN or UNVERIFIED, 0 only when everything passes.

These checks are deliberately **not** part of CI. A CI checkout may be detached or shallow, which would make branch and history results wrong.

| #   | Check                                   | How it is measured                                                                                                                                                                                                              |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | One local and one remote branch, `main` | `git for-each-ref refs/heads`, the checked-out branch, `git ls-remote --heads origin`                                                                                                                                           |
| 2   | Public visibility                       | GitHub REST API `GET /repos/{owner}/{repo}`: `private` and `visibility`                                                                                                                                                         |
| 3   | Clean tree, progress pushed             | `git status --porcelain --untracked-files=all`; the remote `main` commit compared with `HEAD`                                                                                                                                   |
| 4   | No unwanted tracked files               | Paths in `HEAD`: `node_modules`, build output, reports, `.env` files, keys, model weights, archives, executables, any file over 500 kB, and secret-like strings (cloud keys, GitHub, Hugging Face and API tokens, private keys) |
| 5   | Tracked-file bytes                      | Sum of blob sizes in `git ls-tree -r -l HEAD`                                                                                                                                                                                   |
| 6   | History size                            | `git count-objects -v` (packed and loose) and the uncompressed size of every object reachable from any ref; with `--clean-clone`, also in a fresh full clone                                                                    |
| 7   | GitHub-reported size                    | The API's `size` field (KiB). GitHub updates it with a delay after a push                                                                                                                                                       |
| 8   | Margin below 10 MB                      | Every available measure against 10,000,000 bytes; above 5,000,000 bytes is a warning                                                                                                                                            |
| 9   | Reproducible from a clean clone         | `--clean-clone` as above                                                                                                                                                                                                        |

**About the 10 MB limit:** the organizer did not say what is measured: the files in the latest commit, the whole Git history, GitHub's reported size, or a download. All are measured and compared with 10,000,000 bytes, the conservative reading of 10 MB. A small "Download ZIP" contains only the latest files, so on its own it does not show that the repository is within the limit.

## Manual checks before submitting

Do these by hand on GitHub. The script cannot see all of them, or cannot see them without a remote.

1. **Repository exists and is public.** On github.com, the repository page shows "Public". In a private window (signed out), the repository URL opens.
2. **One branch.** The branch selector shows only `main`, and so does `git ls-remote --heads origin`. No `gh-pages` branch: the optional demo deploys through Actions artifacts.
3. **Everything pushed.** `git status` is clean, and `git log origin/main -1` (after `git fetch`) matches `git log -1`. The latest commit on github.com matches.
4. **CI is green.** The Actions tab shows the latest "CI" run on `main` passing both jobs (`check` and `e2e`). Start it by hand with "Run workflow" if needed.
5. **Size.** Run `npm run submission:check` after pushing: check 7 then shows GitHub's own figure (it may take a little while to update). Compare all figures with the 10 MB limit and keep a wide margin.
6. **No secrets or generated files on GitHub.** Browse the file list: no `node_modules`, `dist`, `coverage`, `playwright-report`, `test-results`, `.env` or model files.
7. **Fresh clone works.** Run `npm run submission:check -- --clean-clone --from-remote` once the remote exists, or clone the public URL into a new folder and run the four commands in [TESTING.md](TESTING.md).
8. **README matches the app.** Open the README on github.com and follow the walkthrough on the app (locally or on the optional demo).
9. **Optional demo.** Only if wanted:
   - Set Settings → Pages → Source to "GitHub Actions".
   - Run "Pages demo (manual)" from the Actions tab.
   - Open the URL it reports.
   - Submit the repository URL, not the demo, unless the organizer asks for something else.

## Latest results (2026-10-27, before a remote existed)

`npm run submission:check -- --clean-clone`, run on Windows 11 with Node 24.22.1:

| Check                   | Result                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1a. Local branches      | PASS: only `main`                                                                                            |
| 1b. Remote branches     | UNVERIFIED: no remote is configured                                                                          |
| 2. Public visibility    | UNVERIFIED: no remote                                                                                        |
| 3a. Working tree        | FAIL at the time of the run: this change was not yet committed                                               |
| 3b. Progress pushed     | UNVERIFIED: no remote                                                                                        |
| 4. Tracked content      | PASS: 212 files, none unwanted, none over 500 kB, no secret-like strings                                     |
| 5. Tracked-file bytes   | PASS: 1,531,408 bytes (1.53 MB), 15% of 10 MB                                                                |
| 6. History              | PASS: 12 commits; packed 551,936 bytes in a fresh full clone; all objects uncompressed 3,688,559 bytes       |
| 7. GitHub-reported size | UNVERIFIED: no remote                                                                                        |
| 8. Margin               | UNVERIFIED overall: the local measures are well under 5 MB, but GitHub's figure is not available             |
| 9. Clean clone          | PASS: `npm ci` 13 s, `npm run check` 99 s, browser install 1 s, `npm run test:e2e` 29 s, `npm run build` 7 s |

The remote checks were also exercised against a real public repository (`mlc-ai/web-llm`) in a throwaway clone. Branch listing, visibility, push state and GitHub's size were all read correctly, and that repository's extra branches and 69 MB size were reported as FAIL.

**What remains for the user:**

1. Create the public repository.
2. Add it as `origin` and push `main`.
3. Run `npm run submission:check` again until it reports no FAIL or UNVERIFIED.
4. Confirm CI is green.
