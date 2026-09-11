import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildWorkspace, snapshot, HARNESS_PATHS } from '../lib/fixtures.mjs';
import { DEFAULTS, normalizeCase } from '../lib/subjects.mjs';
import { getHarness } from '../lib/harness/index.mjs';

const gitRaw = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' });
const git = (args, cwd) => gitRaw(args, cwd).trim();
const subject = (category, install = null) => ({ id: 'subj', category, install, mocksDir: null });
const testCase = (fixture) => normalizeCase({ id: 'c', prompt: 'p', fixture, graders: [] }, 0, DEFAULTS, 't');

describe('buildWorkspace', () => {
  let base;
  let n = 0;
  const fresh = () => path.join(base, `ws${n++}`);
  before(() => (base = fs.mkdtempSync(path.join(os.tmpdir(), 'benchwright-fx-'))));
  after(() => fs.rmSync(base, { recursive: true, force: true }));

  it('repo: git repo with a baseline commit and the harness paths excluded', () => {
    const workdir = fresh();
    const { excludes } = buildWorkspace({ subject: subject('repo'), testCase: testCase({ files: [{ path: 'src/a.ts', content: 'a' }] }), workdir, arm: 'without', defaults: DEFAULTS });
    assert.equal(git(['log', '--oneline'], workdir).split('\n').length, 1);
    assert.equal(git(['status', '--porcelain'], workdir), '');
    assert.equal(git(['branch', '--show-current'], workdir), 'main');
    const exclude = fs.readFileSync(path.join(workdir, '.git', 'info', 'exclude'), 'utf8');
    // Only the current harness's paths (the default is Claude Code) plus the runner's own .bench/.
    const expected = [...getHarness('claude').harnessPaths, '.bench/'];
    for (const p of expected) assert.ok(exclude.includes(p), `exclude lacks ${p}`);
    assert.ok(exclude.includes(DEFAULTS.secretsFile));
    assert.deepEqual(excludes, [...expected, DEFAULTS.secretsFile]);
    for (const p of expected) assert.ok(HARNESS_PATHS.includes(p), `HARNESS_PATHS (the union) lacks ${p}`);
    assert.ok(HARNESS_PATHS.includes('.codex/') && HARNESS_PATHS.includes('opencode.json'));
  });

  it('a harness picks its own excludes and reaches the install hook', () => {
    let seen;
    const install = (workdir, ctx) => {
      seen = ctx.harness;
    };
    const workdir = fresh();
    const { excludes } = buildWorkspace({ subject: subject('repo', install), testCase: testCase({}), workdir, arm: 'with', defaults: DEFAULTS, harness: 'codex' });
    assert.equal(seen.name, 'codex');
    assert.deepEqual(excludes, ['.codex/', '.agents/', '.bench/', DEFAULTS.secretsFile]);
    // defaults.harness is the config's choice; an explicit argument wins over it.
    const viaDefaults = buildWorkspace({ subject: subject('none'), testCase: testCase({}), workdir: fresh(), arm: 'without', defaults: { ...DEFAULTS, harness: 'opencode' } });
    assert.deepEqual(viaDefaults.excludes, ['.opencode/', 'opencode.json', '.bench/', DEFAULTS.secretsFile]);
  });

  it('mcp category: the mock servers land in the file each harness reads, and that file is excluded', () => {
    const mocksDir = path.join(base, 'mocks');
    fs.mkdirSync(mocksDir, { recursive: true });
    fs.writeFileSync(path.join(mocksDir, 'm.json'), JSON.stringify({ mcp: { bench: { ping: { result: { pong: true } } } } }));
    const mcpSubject = { ...subject('mcp'), mocksDir };

    const claude = fresh();
    const c = buildWorkspace({ subject: mcpSubject, testCase: testCase({ mocks: 'm.json' }), workdir: claude, arm: 'without', defaults: DEFAULTS });
    assert.ok(JSON.parse(fs.readFileSync(path.join(claude, '.mcp.json'), 'utf8')).mcpServers.bench.args.includes('bench'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(claude, '.claude', 'settings.json'), 'utf8')).enableAllProjectMcpServers, true);
    assert.ok(c.excludes.includes('.mcp.json'));

    const opencode = fresh();
    const o = buildWorkspace({ subject: mcpSubject, testCase: testCase({ mocks: 'm.json' }), workdir: opencode, arm: 'without', defaults: DEFAULTS, harness: 'opencode' });
    assert.equal(JSON.parse(fs.readFileSync(path.join(opencode, 'opencode.json'), 'utf8')).mcp.bench.type, 'local');
    assert.ok(o.excludes.includes('opencode.json'));
    assert.ok(!fs.existsSync(path.join(opencode, '.mcp.json')));

    const codex = fresh();
    const x = buildWorkspace({ subject: mcpSubject, testCase: testCase({ mocks: 'm.json' }), workdir: codex, arm: 'without', defaults: DEFAULTS, harness: 'codex' });
    assert.match(fs.readFileSync(path.join(codex, '.codex', 'config.toml'), 'utf8'), /^\[mcp_servers\.bench\]$/m);
    assert.ok(x.excludes.includes('.codex/'));
    // The written config is invisible to git in every case.
    assert.equal(git(['status', '--porcelain'], codex), '');
    assert.deepEqual([...snapshot(codex, x.excludes).keys()], []);
  });

  it('diff: the change is staged by default, in the working tree with staged: false', () => {
    const staged = fresh();
    buildWorkspace({ subject: subject('diff'), testCase: testCase({ files: [{ path: 'a.txt', content: '1' }], changed: [{ path: 'a.txt', content: '2' }, { path: 'b.txt', content: 'new' }] }), workdir: staged, arm: 'without', defaults: DEFAULTS });
    assert.equal(git(['status', '--porcelain'], staged), 'M  a.txt\nA  b.txt');

    const unstaged = fresh();
    buildWorkspace({ subject: subject('diff'), testCase: testCase({ files: [{ path: 'a.txt', content: '1' }], changed: [{ path: 'a.txt', content: '2' }, { path: 'gone.txt', deleted: true }], staged: false }), workdir: unstaged, arm: 'without', defaults: DEFAULTS });
    assert.equal(gitRaw(['status', '--porcelain'], unstaged), ' M a.txt\n');
  });

  it('commits[].branch puts commits on a branch; fixture.branch checks out at the end', () => {
    const workdir = fresh();
    buildWorkspace({
      subject: subject('repo'),
      testCase: testCase({
        files: [{ path: 'README.md', content: 'base' }],
        commits: [{ branch: 'feature/x', message: 'feat: x', files: [{ path: 'x.txt', content: 'x' }] }, { message: 'feat: y', files: [{ path: 'y.txt', content: 'y' }] }],
      }),
      workdir,
      arm: 'without',
      defaults: DEFAULTS,
    });
    assert.equal(git(['branch', '--show-current'], workdir), 'feature/x');
    assert.equal(git(['log', '--pretty=%s', 'main..HEAD'], workdir), 'feat: y\nfeat: x');

    const other = fresh();
    buildWorkspace({ subject: subject('repo'), testCase: testCase({ branch: 'fix/z' }), workdir: other, arm: 'without', defaults: DEFAULTS });
    assert.equal(git(['branch', '--show-current'], other), 'fix/z');
  });

  it('remote: origin reads back as the declared URL but pushes land in a local bare repo', () => {
    const workdir = fresh();
    buildWorkspace({ subject: subject('repo'), testCase: testCase({ files: [{ path: 'a', content: 'a' }], remote: 'git@example.com:group/project.git', branch: 'feature/r' }), workdir, arm: 'without', defaults: DEFAULTS });
    assert.equal(git(['remote', 'get-url', 'origin'], workdir), 'git@example.com:group/project.git');
    execFileSync('git', ['push', '-q', '-u', 'origin', 'feature/r'], { cwd: workdir, stdio: 'ignore' });
    assert.equal(git(['--git-dir', path.join(workdir, '.bench', 'origin.git'), 'branch', '--list', 'feature/r'], workdir).trim().replace(/^\*?\s*/, ''), 'feature/r');
  });

  it('doc / none: no git at all', () => {
    for (const category of ['doc', 'none']) {
      const workdir = fresh();
      buildWorkspace({ subject: subject(category), testCase: testCase({ files: [{ path: 'in.md', content: 'text' }] }), workdir, arm: 'without', defaults: DEFAULTS });
      assert.ok(!fs.existsSync(path.join(workdir, '.git')));
      assert.equal(fs.existsSync(path.join(workdir, 'in.md')), category === 'doc' || category === 'none');
    }
  });

  it('install runs for the with-arm only, after the baseline, and what it wrote is hidden from git and from snapshot', () => {
    const calls = [];
    const install = (workdir, ctx) => {
      calls.push(ctx.arm);
      fs.writeFileSync(path.join(workdir, 'AGENTS.md'), 'rules');
      fs.mkdirSync(path.join(workdir, '.claude', 'skills', 's'), { recursive: true });
      fs.writeFileSync(path.join(workdir, '.claude', 'skills', 's', 'SKILL.md'), 'skill');
      return ['AGENTS.md', '.claude/'];
    };
    const without = fresh();
    buildWorkspace({ subject: subject('diff', install), testCase: testCase({ files: [{ path: 'a', content: 'a' }] }), workdir: without, arm: 'without', defaults: DEFAULTS });
    assert.deepEqual(calls, []);

    const withDir = fresh();
    const { excludes } = buildWorkspace({ subject: subject('diff', install), testCase: testCase({ files: [{ path: 'a', content: 'a' }], changed: [{ path: 'a', content: 'b' }] }), workdir: withDir, arm: 'with', defaults: DEFAULTS });
    assert.deepEqual(calls, ['with']);
    // The installed subject is untracked yet invisible: a diff-reading subject sees only the change.
    assert.equal(git(['status', '--porcelain'], withDir), 'M  a');
    assert.ok(excludes.includes('AGENTS.md'));
    const files = snapshot(withDir, excludes);
    assert.deepEqual([...files.keys()], ['a']);
    // Without the excludes the installed rules file would leak into the graders' view.
    assert.ok(snapshot(withDir).has('AGENTS.md'));
  });

  it('install context carries the variant from the fixture', () => {
    let seen;
    const install = (workdir, ctx) => {
      seen = ctx.variant;
    };
    buildWorkspace({ subject: subject('none', install), testCase: testCase({ variant: 'bitbucket' }), workdir: fresh(), arm: 'with', defaults: DEFAULTS });
    assert.equal(seen, 'bitbucket');
  });

  it('mcp category: fixture.mocks that does not exist fails loudly', () => {
    assert.throws(
      () => buildWorkspace({ subject: { ...subject('mcp'), mocksDir: base }, testCase: testCase({ mocks: 'nope.json' }), workdir: fresh(), arm: 'without', defaults: DEFAULTS }),
      /fixture.mocks names nope.json/,
    );
  });
});

describe('snapshot', () => {
  it('skips .git, the harness paths and any extra exclude, and normalizes separators', () => {
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchwright-snap-'));
    try {
      for (const rel of ['.git/HEAD', '.claude/settings.json', '.bench/x', '.mcp.json', 'docs/a.md', 'secrets.env', 'keep.txt']) {
        fs.mkdirSync(path.dirname(path.join(workdir, rel)), { recursive: true });
        fs.writeFileSync(path.join(workdir, rel), rel);
      }
      const files = snapshot(workdir, [...HARNESS_PATHS, 'secrets.env']);
      assert.deepEqual([...files.keys()].sort(), ['docs/a.md', 'keep.txt']);
      assert.equal(files.get('docs/a.md'), 'docs/a.md');
    } finally {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  });
});
