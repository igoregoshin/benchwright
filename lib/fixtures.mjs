/**
 * Fixture builder — turns a case's `fixture` block into a real workspace.
 *
 * The category decides what has to exist before the agent starts; everything
 * else about running a subject is identical, which is why category is the only
 * axis a subject has to declare.
 *
 *   repo / chain  → git repo, committed files
 *   diff          → git repo, committed baseline, then `changed` applied (staged or working tree)
 *   doc           → plain directory, no git
 *   mcp           → repo + the case's mock services, wired up so the subject's own
 *                   transport reaches them (see startMockServices below)
 *   none          → empty directory
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyPath } from './subjects.mjs';
import { HARNESSES, getHarness } from './harness/index.mjs';

const MOCKS_DIR = fileURLToPath(new URL('../mocks/', import.meta.url));

/**
 * Scaffolding a workspace may carry, across every harness, never part of the
 * fixture: `.bench/` is the runner's own (mock logs, the local push remote), the
 * rest is what each agent CLI reads or writes in a project. `buildWorkspace`
 * excludes only the current harness's paths; this union is the default for
 * `snapshot()` when the harness is unknown (`--grade-only`).
 */
export const HARNESS_PATHS = ['.bench/', ...new Set(HARNESSES.flatMap((name) => getHarness(name).harnessPaths))];

function git(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function writeFile(dir, rel, content) {
  const target = path.join(dir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content ?? '', 'utf8');
}

function appendExclude(workdir, paths) {
  const excludePath = path.join(workdir, '.git', 'info', 'exclude');
  if (!fs.existsSync(path.dirname(excludePath))) return;
  fs.appendFileSync(excludePath, `${paths.join('\n')}\n`, 'utf8');
}

/**
 * Build the workspace for one case+arm. `arm` is 'with' or 'without' — the
 * only difference is whether the subject is installed, which is what makes the
 * ablation delta attributable to the subject and nothing else.
 *
 * Returns `{ workdir, excludes }`; pass `excludes` to `snapshot()` so graders
 * never see the harness's own files.
 */
export function buildWorkspace({ subject, testCase, workdir, arm, defaults = {}, harness }) {
  fs.mkdirSync(workdir, { recursive: true });
  const h = getHarness(harness ?? defaults.harness);
  const { category } = subject;
  const fx = testCase.fixture ?? {};
  const needsGit = category !== 'doc' && category !== 'none';
  const secretsFile = defaults.secretsFile ?? '.env';
  const excludes = [...h.harnessPaths, '.bench/', secretsFile];

  if (needsGit) {
    git(['init', '-q', '-b', 'main'], workdir);
    git(['config', 'user.email', 'bench@benchwright.local'], workdir);
    git(['config', 'user.name', 'benchwright'], workdir);
    git(['config', 'commit.gpgsign', 'false'], workdir);

    // The harness's own scaffolding must be invisible to git, for two reasons:
    //
    //   1. `diff`-category subjects read the staged diff. Without this, a commit
    //      or review skill is handed several hundred lines of its own SKILL.md
    //      on top of the change it is supposed to look at — a review skill ends
    //      up reviewing its own text.
    //   2. It would break ablation isolation: the `with` arm would carry the
    //      installed subject in its git state and the `without` arm would not,
    //      so the two arms would differ by more than "is the subject loaded".
    //
    // .git/info/exclude rather than a .gitignore file: a tracked .gitignore is
    // itself a fixture difference the agent can see, and could be committed.
    fs.writeFileSync(
      path.join(workdir, '.git', 'info', 'exclude'),
      `# benchwright harness scaffolding — not part of the fixture\n${excludes.join('\n')}\n`,
      'utf8',
    );
  }

  for (const f of fx.files ?? []) writeFile(workdir, f.path, f.content);

  if (needsGit) {
    git(['add', '-A'], workdir);
    execFileSync('git', ['commit', '-q', '-m', 'baseline', '--allow-empty'], { cwd: workdir, stdio: 'ignore' });
    // `commits[].branch` puts a commit ON a branch rather than on the baseline.
    // `fixture.branch` alone cannot: it checks out after every commit is already
    // made, so `git log <target>..HEAD` is empty — and a subject that describes
    // the work on a branch sees nothing to describe.
    let onBranch = null;
    for (const extra of fx.commits ?? []) {
      if (extra.branch && extra.branch !== onBranch) {
        git(['checkout', '-q', '-b', extra.branch], workdir);
        onBranch = extra.branch;
      }
      for (const f of extra.files ?? []) writeFile(workdir, f.path, f.content);
      git(['add', '-A'], workdir);
      execFileSync('git', ['commit', '-q', '-m', extra.message ?? 'change', '--allow-empty'], { cwd: workdir, stdio: 'ignore' });
    }
    if (fx.branch) git(['checkout', '-q', '-b', fx.branch], workdir);

    // A subject that pushes before opening an MR needs both a remote that
    // accepts the push and a URL that still reads as `group/project`, because
    // the next step usually parses the project path out of
    // `git remote get-url origin`.
    //
    // `pushInsteadOf`, NOT `insteadOf`: plain `insteadOf` is applied by
    // `git remote get-url` as well, so the subject would read back the local
    // file:/// path and have no project path to parse. `pushInsteadOf` rewrites
    // only the transfer, which lands in a bare repo under .bench/ and never
    // leaves the machine.
    if (fx.remote) {
      const bare = path.join(workdir, '.bench', 'origin.git');
      fs.mkdirSync(path.dirname(bare), { recursive: true });
      git(['init', '-q', '--bare', bare], workdir);
      const local = `file:///${bare.split(path.sep).join('/').replace(/^\//, '')}`;
      git(['remote', 'add', 'origin', fx.remote], workdir);
      git(['config', `url.${local}.pushInsteadOf`, fx.remote], workdir);
    }
  }

  // The pending change a `diff`-category subject is supposed to look at.
  if (fx.changed?.length) {
    for (const f of fx.changed) {
      if (f.deleted) fs.rmSync(path.join(workdir, f.path), { force: true });
      else writeFile(workdir, f.path, f.content);
    }
    if (needsGit && fx.staged !== false) git(['add', '-A'], workdir);
  }

  // Skip paths already covered by an existing exclude (`.claude/skills/` under `.claude/`).
  const addExcludes = (paths) => {
    const covered = (p) => excludes.some((e) => p === e || (e.endsWith('/') && p.startsWith(e)));
    const fresh = (Array.isArray(paths) ? paths : []).map((p) => String(p).split(path.sep).join('/')).filter((p) => !covered(p));
    if (!fresh.length) return;
    excludes.push(...fresh);
    if (needsGit) appendExclude(workdir, fresh);
  };

  // Mock services are part of the FIXTURE, not of the subject: both ablation
  // arms get the identical wiring, so a delta can only come from the subject.
  if (category === 'mcp') addExcludes(startMockServices({ subject, testCase, workdir, secretsFile, harness: h }));

  if (arm === 'with' && subject.install) {
    addExcludes(subject.install(workdir, { subject, testCase, arm, variant: fx.variant ?? null, harness: h }));
  }

  return { workdir, excludes };
}

// ── Mock services (category `mcp`) ───────────────────────────────────────────
//
// "MCP category" is a shorthand: what these subjects have in common is an
// external service, not a transport. Two transports are in play and a case
// picks whichever its subject really uses — building the wrong one proves
// nothing:
//
//   MCP over stdio — the subject calls `mcp__<server>__<tool>`. The harness's
//     project-level MCP config (`.mcp.json`, `opencode.json`, `.codex/config.toml`
//     — the adapter knows which) points those server names at mocks/mcp-mock.mjs,
//     which the agent CLI spawns.
//   HTTP — the subject's own scripts `fetch` a REST base URL taken from an env
//     file. mocks/http-mock.mjs listens on localhost and the env file
//     (`defaults.secretsFile`, or the fixture's `http.secretsFile`) points at it.
//
// Both write every call to `.bench/mock-calls.jsonl`; `.bench/calls.mjs` is the
// query helper `command` graders use. Fixture format: see the two mock servers.

/** HTTP mocks outlive buildWorkspace, so they are reaped when the runner exits. */
const runningMocks = [];
process.on('exit', () => {
  for (const child of runningMocks) {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }
});

/** Returns the workspace-relative config paths the harness wrote for the mocks. */
function startMockServices({ subject, testCase, workdir, secretsFile, harness }) {
  const mocksDir = subject.mocksDir;
  const name = testCase.fixture?.mocks;
  if (!name) {
    // No `fixture.mocks` named: stage the subject's recordings and leave it there.
    if (mocksDir && fs.existsSync(mocksDir)) {
      const dest = path.join(workdir, '.bench/mocks');
      copyPath(mocksDir, dest);
    }
    return [];
  }

  const fixturePath = mocksDir ? path.join(mocksDir, name) : null;
  if (!fixturePath || !fs.existsSync(fixturePath)) {
    throw new Error(`${subject.id}/${testCase.id}: fixture.mocks names ${name}, which does not exist in ${mocksDir ?? '(no mocksDir)'}`);
  }
  const spec = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  const benchDir = path.join(workdir, '.bench');
  fs.mkdirSync(benchDir, { recursive: true });
  const logPath = path.join(benchDir, 'mock-calls.jsonl');
  fs.copyFileSync(path.join(MOCKS_DIR, 'calls.mjs'), path.join(benchDir, 'calls.mjs'));

  const wrote = spec.mcp ? writeMcpConfig({ workdir, spec, fixturePath, logPath, harness }) : [];
  if (spec.http) startHttpMock({ workdir, spec, fixturePath, logPath, testCase, secretsFile: spec.http.secretsFile ?? secretsFile });
  return wrote;
}

/**
 * The same mock server for every harness; the adapter writes it into the file
 * (and the approval, where its CLI needs one) that CLI actually reads, and
 * returns the workspace-relative paths so they are hidden from git and graders.
 */
function writeMcpConfig({ workdir, spec, fixturePath, logPath, harness }) {
  const servers = {};
  for (const server of Object.keys(spec.mcp)) {
    servers[server] = {
      command: process.execPath,
      args: [path.join(MOCKS_DIR, 'mcp-mock.mjs'), '--fixture', fixturePath, '--server', server, '--log', logPath],
    };
  }
  return harness.writeMcpConfig(workdir, servers);
}

function startHttpMock({ workdir, spec, fixturePath, logPath, testCase, secretsFile }) {
  const portFile = path.join(workdir, '.bench', 'http-port');
  // The listener must not outlive the case by much: a stray one would answer the
  // next case's requests. The run itself is capped by timeoutSeconds.
  const ttl = (testCase.timeoutSeconds ?? 300) + 60;
  const child = spawn(
    process.execPath,
    [
      path.join(MOCKS_DIR, 'http-mock.mjs'),
      '--fixture', fixturePath,
      '--log', logPath,
      '--port-file', portFile,
      '--ttl', String(ttl),
    ],
    { cwd: workdir, stdio: 'ignore', windowsHide: true },
  );
  // Without unref() the live child keeps the runner's event loop referenced, so
  // the benchmark would sit there after its last case until every mock's TTL
  // expired. The exit hook above still kills them on the way out.
  child.unref();
  runningMocks.push(child);

  const baseUrl = `http://127.0.0.1:${waitForPort(portFile, 15000)}`;
  const secrets = Object.entries(spec.http.secrets ?? {}).map(
    ([key, value]) => `${key}=${String(value).split('{{baseUrl}}').join(baseUrl)}`,
  );
  if (secrets.length) writeFile(workdir, secretsFile, `${secrets.join('\n')}\n`);

  // The developer's shell almost certainly holds REAL credentials for these
  // services, subject scripts usually prefer process.env over an env file, and
  // the agent inherits this process's environment. Without this line the mock
  // is written, ignored, and the benchmark talks to the live service with a
  // real token — it did, the first time this was wired up; a writer skill would
  // have posted a real comment. Dropping the keys the fixture mocks makes the
  // fixture authoritative.
  for (const key of Object.keys(spec.http.secrets ?? {})) delete process.env[key];
}

/**
 * buildWorkspace is synchronous and the caller needs the port before it returns,
 * so this blocks on the port file rather than restructuring the runner.
 */
function waitForPort(portFile, timeoutMs) {
  const idle = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(portFile)) {
      const raw = fs.readFileSync(portFile, 'utf8').trim();
      if (raw) return Number(raw);
    }
    Atomics.wait(idle, 0, 0, 25);
  }
  throw new Error(`http mock never reported a port at ${portFile}`);
}

/**
 * Snapshot of every file, so graders can tell what the run actually wrote.
 * `excludes` are workspace-relative paths (a trailing slash marks a directory).
 */
export function snapshot(workdir, excludes = HARNESS_PATHS) {
  const skip = ['.git', ...excludes].map((p) => String(p).split(path.sep).join('/').replace(/\/$/, ''));
  const files = new Map();
  (function walk(dir) {
    for (const e of fs.readdirSync(dir)) {
      const full = path.join(dir, e);
      const rel = path.relative(workdir, full).split(path.sep).join('/');
      if (skip.some((s) => rel === s || rel.startsWith(`${s}/`))) continue;
      if (fs.statSync(full).isDirectory()) walk(full);
      else files.set(rel, fs.readFileSync(full, 'utf8'));
    }
  })(workdir);
  return files;
}
