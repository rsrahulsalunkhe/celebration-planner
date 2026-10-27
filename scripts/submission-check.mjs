#!/usr/bin/env node
/**
 * Submission preflight for a public, single-branch GitHub repository.
 *
 * Read-only: it runs `git` queries (`ls-remote`, `ls-tree`, `status`,
 * `count-objects`, ...) and, for a GitHub remote, one unauthenticated (or
 * token-authenticated) GET to the GitHub REST API. It never fetches into this
 * repository, deletes or creates branches, rewrites history, changes
 * visibility or removes files. With --clean-clone it works in a new temporary
 * folder, which it deletes afterwards.
 *
 * Every result is PASS, WARN, FAIL or UNVERIFIED. A check that cannot be made
 * (no remote, no network, a shallow checkout) is UNVERIFIED, never PASS.
 *
 * Usage:
 *   npm run submission:check                  quick checks
 *   npm run submission:check -- --clean-clone also clone and run npm ci, check,
 *                                             browser install and browser tests
 *   ... --from-remote                         clone the remote instead of this folder
 *
 * Exit code: 1 if anything FAILs, 2 if nothing fails but something is WARN or
 * UNVERIFIED, 0 only when everything passes.
 *
 * The organizer's 10 MB limit does not say what is measured, so the tracked
 * files, the full history and GitHub's own figure are all compared with
 * 10,000,000 bytes, and anything above half of it is a warning.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LIMIT_BYTES = 10_000_000;
const COMFORTABLE_BYTES = LIMIT_BYTES / 2;
const LARGE_FILE_BYTES = 500_000;
const BRANCH = 'main';

const args = new Set(process.argv.slice(2));
const results = [];

function record(id, status, detail, action) {
  results.push({ id, status, detail, action });
}

function git(...gitArgs) {
  return execFileSync('git', gitArgs, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function tryGit(...gitArgs) {
  try {
    return { ok: true, out: git(...gitArgs) };
  } catch (error) {
    return {
      ok: false,
      out: String(error.stderr ?? error.message)
        .trim()
        .split('\n')[0],
    };
  }
}

const mb = (bytes) =>
  `${(bytes / 1_000_000).toFixed(3)} MB (${bytes.toLocaleString('en')} bytes)`;

function sizeStatus(bytes) {
  if (bytes >= LIMIT_BYTES) return 'FAIL';
  return bytes > COMFORTABLE_BYTES ? 'WARN' : 'PASS';
}

// --- Repository and branches -------------------------------------------------

const root = git('rev-parse', '--show-toplevel');
process.chdir(root);

const localBranches = git('for-each-ref', '--format=%(refname:short)', 'refs/heads')
  .split('\n')
  .filter(Boolean);
const current = tryGit('symbolic-ref', '--short', 'HEAD');
if (localBranches.length === 1 && localBranches[0] === BRANCH && current.out === BRANCH) {
  record(
    '1a. Local branches',
    'PASS',
    `Exactly one local branch, ${BRANCH}, checked out.`,
  );
} else {
  record(
    '1a. Local branches',
    'FAIL',
    `Local branches: ${localBranches.join(', ') || 'none'}; checked out: ${current.ok ? current.out : 'detached HEAD'}.`,
    `Keep only ${BRANCH}. Review and remove other branches yourself (this script never deletes them).`,
  );
}

const remotes = git('remote').split('\n').filter(Boolean);
const remoteName = remotes.includes('origin') ? 'origin' : remotes[0];
const remoteUrl = remoteName ? git('remote', 'get-url', remoteName) : null;
let remoteHeads = null;

if (!remoteName) {
  record(
    '1b. Remote branches',
    'UNVERIFIED',
    'No remote is configured, so nothing can be checked on GitHub.',
    'Create the public repository on GitHub, then: git remote add origin <url> && git push -u origin main',
  );
} else {
  const heads = tryGit('ls-remote', '--heads', remoteName);
  if (!heads.ok) {
    record(
      '1b. Remote branches',
      'UNVERIFIED',
      `Could not list ${remoteName}'s branches: ${heads.out}`,
      'Check the network and your access to the remote, then run again.',
    );
  } else {
    remoteHeads = new Map(
      heads.out
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [sha, ref] = line.split(/\s+/);
          return [ref.replace('refs/heads/', ''), sha];
        }),
    );
    const names = [...remoteHeads.keys()];
    if (names.length === 1 && names[0] === BRANCH) {
      record(
        '1b. Remote branches',
        'PASS',
        `${remoteName} has exactly one branch, ${BRANCH}.`,
      );
    } else {
      record(
        '1b. Remote branches',
        'FAIL',
        `${remoteName} branches: ${names.join(', ') || 'none'}.`,
        names.includes(BRANCH)
          ? `Remove the other branches on GitHub yourself after checking they hold nothing you need.`
          : `Push ${BRANCH}: git push -u ${remoteName} ${BRANCH}`,
      );
    }
  }
  if (remotes.length > 1) {
    record(
      '1c. Remotes',
      'WARN',
      `Several remotes are configured: ${remotes.join(', ')}. Only ${remoteName} was checked.`,
    );
  }
}

// --- Visibility and GitHub's size --------------------------------------------

const github = remoteUrl?.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/);
let githubRepo = null;
if (!remoteUrl) {
  record(
    '2. Public visibility',
    'UNVERIFIED',
    'No remote is configured.',
    'Add the GitHub remote and run again.',
  );
} else if (!github) {
  record(
    '2. Public visibility',
    'UNVERIFIED',
    `The remote is not on github.com (${remoteUrl}).`,
  );
} else {
  const [, owner, repo] = github;
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'celebration-planner-submission-check',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (response.ok) {
      githubRepo = await response.json();
      if (githubRepo.private === false && githubRepo.visibility !== 'internal') {
        record('2. Public visibility', 'PASS', `${owner}/${repo} is public.`);
      } else {
        record(
          '2. Public visibility',
          'FAIL',
          `${owner}/${repo} is ${githubRepo.visibility ?? 'private'}.`,
          'Make it public yourself in the repository settings (this script never changes visibility).',
        );
      }
    } else if (response.status === 404) {
      record(
        '2. Public visibility',
        token ? 'FAIL' : 'UNVERIFIED',
        token
          ? `${owner}/${repo} was not found with the supplied token.`
          : `${owner}/${repo} is not visible without signing in: it is private, or it does not exist yet.`,
        'Check the repository exists and is public. Set GITHUB_TOKEN to tell a private repository from a missing one.',
      );
    } else {
      record(
        '2. Public visibility',
        'UNVERIFIED',
        `GitHub answered ${response.status} ${response.statusText}.`,
        'Try again later (unauthenticated requests are rate-limited), or set GITHUB_TOKEN.',
      );
    }
  } catch (error) {
    record(
      '2. Public visibility',
      'UNVERIFIED',
      `GitHub could not be reached: ${error.message}.`,
    );
  }
}

// --- Working tree and push state ---------------------------------------------

// Not trimmed: each line starts with a two-letter status that may begin with a space.
const status = execFileSync(
  'git',
  ['status', '--porcelain=v1', '--untracked-files=all'],
  {
    encoding: 'utf8',
  },
).replace(/\n$/, '');
if (status === '') {
  record(
    '3a. Working tree',
    'PASS',
    'No uncommitted or untracked files (outside .gitignore).',
  );
} else {
  const lines = status.split('\n');
  record(
    '3a. Working tree',
    'FAIL',
    `${lines.length} uncommitted or untracked path(s), e.g. ${lines
      .slice(0, 5)
      .map((l) => l.slice(3))
      .join(', ')}.`,
    'Commit the work, or add generated files to .gitignore. Nothing is removed automatically.',
  );
}

const head = git('rev-parse', 'HEAD');
if (!remoteHeads) {
  record(
    '3b. Progress pushed',
    'UNVERIFIED',
    'The remote branch could not be read, so the push state is unknown.',
  );
} else if (!remoteHeads.has(BRANCH)) {
  record(
    '3b. Progress pushed',
    'FAIL',
    `${remoteName} has no ${BRANCH} branch.`,
    `git push -u ${remoteName} ${BRANCH}`,
  );
} else if (remoteHeads.get(BRANCH) === head) {
  record(
    '3b. Progress pushed',
    'PASS',
    `${remoteName}/${BRANCH} is at the local HEAD (${head.slice(0, 7)}).`,
  );
} else {
  const remoteSha = remoteHeads.get(BRANCH);
  const known = tryGit('cat-file', '-e', `${remoteSha}^{commit}`).ok;
  const behindLocal =
    known && tryGit('merge-base', '--is-ancestor', remoteSha, 'HEAD').ok;
  record(
    '3b. Progress pushed',
    'FAIL',
    behindLocal
      ? `${remoteName}/${BRANCH} (${remoteSha.slice(0, 7)}) is behind the local HEAD (${head.slice(0, 7)}).`
      : `${remoteName}/${BRANCH} (${remoteSha.slice(0, 7)}) has commits that are not in this repository.`,
    behindLocal
      ? `git push ${remoteName} ${BRANCH}`
      : 'Fetch and review the remote commits yourself before pushing; never force-push over them.',
  );
}

// --- Tracked content ---------------------------------------------------------

const tracked = git('ls-tree', '-r', '-l', '--full-tree', 'HEAD')
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [meta, path] = line.split('\t');
    const size = Number(meta.trim().split(/\s+/)[3]);
    return { path, size: Number.isFinite(size) ? size : 0 };
  });

const FORBIDDEN = [
  [/(^|\/)node_modules\//, 'dependencies (node_modules)'],
  [/^(dist|build)\//, 'build output'],
  [/^(coverage|playwright-report|test-results|traces|\.vitest)\//, 'test reports'],
  [/\.tsbuildinfo$/, 'TypeScript build info'],
  [/(^|\/)\.env(\..+)?$/, 'environment file'],
  [/\.(pem|key|p12|pfx|keystore)$/i, 'key or certificate'],
  [
    /\.(gguf|safetensors|onnx|bin|wasm|pt|pth|ckpt|params|npz|h5)$/i,
    'model weights or binary',
  ],
  [/\.(zip|tar|gz|tgz|7z|rar|exe|msi|dll|dmg|iso)$/i, 'archive or executable'],
];
const ALLOWED = [/(^|\/)\.env\.example$/];
const forbidden = tracked.flatMap(({ path }) => {
  if (ALLOWED.some((re) => re.test(path))) return [];
  const hit = FORBIDDEN.find(([re]) => re.test(path));
  return hit ? [`${path} (${hit[1]})`] : [];
});
const large = tracked
  .filter((f) => f.size > LARGE_FILE_BYTES)
  .map((f) => `${f.path} (${mb(f.size)})`);

const SECRET_PATTERNS = [
  [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
  [/gh[pousr]_[A-Za-z0-9]{36,}/, 'GitHub token'],
  [/github_pat_[A-Za-z0-9_]{22,}/, 'GitHub token'],
  [/xox[abprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/AIza[0-9A-Za-z_-]{35}/, 'Google API key'],
  [/sk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}/, 'API secret key'],
  [/hf_[A-Za-z0-9]{30,}/, 'Hugging Face token'],
  [/-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/, 'private key'],
];
const secrets = [];
for (const { path, size } of tracked) {
  if (size > 2_000_000) continue;
  let text;
  try {
    text = git('show', `HEAD:${path}`);
  } catch {
    continue;
  }
  if (text.includes('\u0000')) continue;
  for (const [re, label] of SECRET_PATTERNS) {
    if (re.test(text)) secrets.push(`${path} (${label})`);
  }
}

if (forbidden.length === 0 && large.length === 0 && secrets.length === 0) {
  record(
    '4. Tracked content',
    'PASS',
    `${tracked.length} tracked files: no dependencies, build output, reports, environment files, keys, model weights, archives, files over ${mb(LARGE_FILE_BYTES)}, or secret-like strings.`,
  );
} else {
  record(
    '4. Tracked content',
    'FAIL',
    [
      forbidden.length
        ? `Should not be tracked: ${forbidden.slice(0, 8).join(', ')}`
        : '',
      large.length ? `Large files: ${large.slice(0, 8).join(', ')}` : '',
      secrets.length ? `Possible secrets: ${secrets.slice(0, 8).join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('. '),
    'Untrack the files (git rm --cached) and add them to .gitignore; revoke any real secret. Removing them from history needs a deliberate rewrite, which this script never does.',
  );
}

// --- Sizes -------------------------------------------------------------------

const trackedBytes = tracked.reduce((sum, f) => sum + f.size, 0);
const largest = [...tracked].sort((a, b) => b.size - a.size).slice(0, 3);
record(
  '5. Tracked-file bytes (HEAD)',
  sizeStatus(trackedBytes),
  `${mb(trackedBytes)} in ${tracked.length} files. Largest: ${largest.map((f) => `${f.path} ${(f.size / 1000).toFixed(1)} kB`).join(', ')}.`,
);

function historySize(dir) {
  const counts = Object.fromEntries(
    execFileSync('git', ['count-objects', '-v'], { cwd: dir, encoding: 'utf8' })
      .trim()
      .split('\n')
      .map((line) => line.split(': ')),
  );
  const packed = Number(counts['size-pack']) * 1024 + Number(counts.size) * 1024;
  const objects = execFileSync('git', ['rev-list', '--objects', '--all'], {
    cwd: dir,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
    .trim()
    .split('\n')
    .map((l) => l.split(' ')[0])
    .join('\n');
  const sizes = execFileSync('git', ['cat-file', '--batch-check=%(objectsize)'], {
    cwd: dir,
    input: objects,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const uncompressed = sizes
    .trim()
    .split('\n')
    .reduce((sum, n) => sum + Number(n), 0);
  return {
    packed,
    uncompressed,
    commits: Number(
      execFileSync('git', ['rev-list', '--count', '--all'], {
        cwd: dir,
        encoding: 'utf8',
      }).trim(),
    ),
  };
}

const shallow = git('rev-parse', '--is-shallow-repository') === 'true';
if (shallow) {
  record(
    '6. Git history size',
    'UNVERIFIED',
    'This is a shallow checkout, so the full history is not here.',
    'Run in a full clone (git clone without --depth), or use --clean-clone.',
  );
} else {
  const h = historySize(root);
  record(
    '6. Git history size (this folder)',
    sizeStatus(Math.max(h.packed, h.uncompressed)),
    `${h.commits} commits. On disk: ${mb(h.packed)}. All objects uncompressed: ${mb(h.uncompressed)}. Loose objects make the on-disk figure larger than in a fresh clone; --clean-clone measures a full clone.`,
  );
}

if (githubRepo) {
  const reported = Number(githubRepo.size) * 1024;
  record(
    '7. GitHub-reported size',
    sizeStatus(reported),
    `GitHub reports ${githubRepo.size} KB (${mb(reported)}). GitHub updates this figure with a delay after a push.`,
  );
} else {
  record(
    '7. GitHub-reported size',
    'UNVERIFIED',
    'The repository could not be read from GitHub (see check 2).',
  );
}

const measured = results.filter(
  (r) => /^(5|6|7)\./.test(r.id) && r.status !== 'UNVERIFIED',
);
const worst = measured.some((r) => r.status === 'FAIL')
  ? 'FAIL'
  : measured.some((r) => r.status === 'WARN')
    ? 'WARN'
    : 'PASS';
record(
  '8. Margin below 10 MB',
  results.some((r) => /^(6|7)\./.test(r.id) && r.status === 'UNVERIFIED') &&
    worst === 'PASS'
    ? 'UNVERIFIED'
    : worst,
  `Every available measure is compared with ${mb(LIMIT_BYTES)}; above ${mb(COMFORTABLE_BYTES)} is a warning. The organizer did not define the metric, and a small ZIP download alone does not show compliance.`,
);

// --- Clean clone -------------------------------------------------------------

if (args.has('--clean-clone')) {
  const source = args.has('--from-remote') ? remoteUrl : root;
  if (!source) {
    record(
      '9. Clean clone',
      'UNVERIFIED',
      '--from-remote was given but no remote is configured.',
    );
  } else {
    const dir = mkdtempSync(join(tmpdir(), 'celebration-planner-clone-'));
    const clone = join(dir, 'repo');
    const steps = [];
    let failed = false;
    const run = (label, command) => {
      if (failed) return;
      const started = Date.now();
      process.stdout.write(`  … ${label}\n`);
      const result = spawnSync(command, {
        cwd: clone,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CI: 'true' },
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
      });
      const seconds = ((Date.now() - started) / 1000).toFixed(0);
      if (result.status === 0) {
        steps.push(`${label} (${seconds} s)`);
      } else {
        failed = true;
        const tail = `${result.stdout ?? ''}${result.stderr ?? ''}`
          .trim()
          .split('\n')
          .slice(-8)
          .join('\n    ');
        steps.push(`${label} FAILED after ${seconds} s:\n    ${tail}`);
      }
    };
    try {
      // A full clone (no --depth) of the committed history; uncommitted work is not included.
      execFileSync('git', ['clone', '--quiet', '--no-local', source, clone], {
        stdio: 'inherit',
      });
      const h = historySize(clone);
      record(
        '6b. Git history size (fresh full clone)',
        sizeStatus(h.packed),
        `${h.commits} commits, packed ${mb(h.packed)}; all objects uncompressed ${mb(h.uncompressed)}.`,
      );
      const installArgs =
        process.platform === 'linux' ? '--with-deps chromium' : 'chromium';
      run('npm ci', 'npm ci');
      run('npm run check', 'npm run check');
      run(
        `npx playwright install ${installArgs}`,
        `npx playwright install ${installArgs}`,
      );
      run('npm run test:e2e', 'npm run test:e2e');
      run('npm run build', 'npm run build');
      record(
        '9. Clean clone',
        failed ? 'FAIL' : 'PASS',
        `Cloned ${source === root ? 'this folder (committed HEAD only)' : source} into a temporary folder: ${steps.join('; ')}.`,
        failed ? 'Reproduce the failing step in a fresh clone and fix it.' : undefined,
      );
    } catch (error) {
      record('9. Clean clone', 'FAIL', `The clone could not be made: ${error.message}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
} else {
  record(
    '9. Clean clone',
    'UNVERIFIED',
    'Not run.',
    'Run: npm run submission:check -- --clean-clone (about 2 to 5 minutes; needs the network for npm and the browser download).',
  );
}

// --- Report ------------------------------------------------------------------

const order = (id) => Number.parseFloat(id);
results.sort((a, b) => order(a.id) - order(b.id) || a.id.localeCompare(b.id));
const width = Math.max(...results.map((r) => r.id.length));
console.log('\nCelebration Planner — submission preflight (read-only)\n');
for (const r of results) {
  console.log(`${r.status.padEnd(10)} ${r.id.padEnd(width)}  ${r.detail}`);
  if (r.action && r.status !== 'PASS')
    console.log(`${' '.repeat(12 + width)}→ ${r.action}`);
}
const count = (s) => results.filter((r) => r.status === s).length;
console.log(
  `\n${count('PASS')} pass, ${count('WARN')} warn, ${count('FAIL')} fail, ${count('UNVERIFIED')} unverified. Manual checks: docs/SUBMISSION.md.\n`,
);
process.exitCode =
  count('FAIL') > 0 ? 1 : count('WARN') + count('UNVERIFIED') > 0 ? 2 : 0;
