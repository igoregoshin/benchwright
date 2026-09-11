/**
 * The examples under examples/ are documentation that must keep working:
 * every config passes the free layer, the dry-run script proves its graders
 * catch something, and the sample-run generator still produces the report
 * files. None of this spawns an agent CLI.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, loadConfig } from '../index.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXAMPLES = path.join(ROOT, 'examples');
const BIN = path.join(ROOT, 'bin', 'benchwright.mjs');

function run(args, cwd) {
  const missing = 'definitely-not-a-binary-benchwright';
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: { ...process.env, BENCHWRIGHT_CONFIG: '', BENCHWRIGHT_CLAUDE: missing, BENCHWRIGHT_OPENCODE: missing, BENCHWRIGHT_CODEX: missing } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const CONFIGS = ['skill/benchwright.config.mjs', 'rules-file/benchwright.config.json', 'mock-services/benchwright.config.mjs'];

describe('examples', () => {
  for (const rel of CONFIGS) {
    it(`${rel}: passes --check and lists at least one case`, async () => {
      const { subjects, problems } = await check(await loadConfig(path.join(EXAMPLES, rel)));
      assert.deepEqual(problems, []);
      assert.ok(subjects.some((s) => s.cases.length > 0));
      const r = run([BIN, '--check'], path.dirname(path.join(EXAMPLES, rel)));
      assert.equal(r.code, 0, r.err);
      assert.match(r.out, /^ok: /);
    });
  }

  it('every example config sets root: the repository package.json must not become the root', async () => {
    for (const rel of CONFIGS) {
      const config = await loadConfig(path.join(EXAMPLES, rel));
      assert.equal(config.root, path.dirname(path.join(EXAMPLES, rel)));
    }
  });

  it('rules-file: the credentials case really stages .env (the secrets file was moved out of the way)', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'benchwright-examples-'));
    try {
      const r = run([BIN, '--subject', 'agents-md', '--case', 'keeps-credentials-out', '--build-only', '--out', out], path.join(EXAMPLES, 'rules-file'));
      assert.equal(r.code, 0, r.err);
      const ws = path.join(out, 'agents-md__keeps-credentials-out');
      const status = spawnSync('git', ['status', '--porcelain'], { cwd: ws, encoding: 'utf8' }).stdout;
      assert.match(status, /^A {2}\.env$/m);
      // Both rules-file copies are installed and hidden from git.
      assert.ok(fs.existsSync(path.join(ws, 'AGENTS.md')));
      assert.ok(fs.existsSync(path.join(ws, 'CLAUDE.md')));
      assert.doesNotMatch(status, /AGENTS\.md|CLAUDE\.md/);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  it('mock-services: the workspace carries the mock server config and the branch the case describes', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'benchwright-examples-'));
    try {
      const r = run([BIN, '--subject', 'issue-comment', '--case', 'comment-via-mcp', '--build-only', '--out', out], path.join(EXAMPLES, 'mock-services'));
      assert.equal(r.code, 0, r.err);
      const ws = path.join(out, 'issue-comment__comment-via-mcp');
      const mcp = JSON.parse(fs.readFileSync(path.join(ws, '.mcp.json'), 'utf8'));
      assert.ok(mcp.mcpServers.tracker, 'the `tracker` server the skill names is wired');
      const log = spawnSync('git', ['log', 'main..HEAD', '--pretty=%s'], { cwd: ws, encoding: 'utf8' }).stdout.trim().split('\n');
      assert.equal(log.length, 2);
      // Untouched workspace: every call-log grader fails, none errors.
      const g = run([BIN, '--subject', 'issue-comment', '--case', 'comment-via-mcp', '--grade-only', ws], path.join(EXAMPLES, 'mock-services'));
      assert.equal(g.code, 1);
      assert.doesNotMatch(g.out, /could not run/);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  it('programmatic: check.test.mjs passes and dry-run.mjs proves its graders fail before the work', () => {
    const t = run(['--test', path.join(EXAMPLES, 'programmatic', 'check.test.mjs')], ROOT);
    assert.equal(t.code, 0, t.out + t.err);
    const d = run([path.join(EXAMPLES, 'programmatic', 'dry-run.mjs')], ROOT);
    assert.equal(d.code, 0, d.err);
    assert.match(d.out, /untouched fixture: 1\/6/);
    assert.match(d.out, /after the work: 6\/6/);
  });

  it('sample-run: the generator reproduces the committed files from the real report code', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'benchwright-examples-'));
    try {
      const r = run([path.join(EXAMPLES, 'sample-run', 'generate.mjs'), out], ROOT);
      assert.equal(r.code, 0, r.err);
      for (const f of ['result.jsonl', 'result.json', 'report.html', 'console.txt']) assert.ok(fs.existsSync(path.join(out, f)), f);
      const fresh = fs.readFileSync(path.join(out, 'console.txt'), 'utf8');
      const committed = fs.readFileSync(path.join(EXAMPLES, 'sample-run', 'console.txt'), 'utf8');
      assert.equal(fresh, committed, 'examples/sample-run/console.txt is stale: run node examples/sample-run/generate.mjs');
      assert.match(fresh, /pass\/fail: what the subject is buying you/);
      assert.match(fresh, /passes without the subject too/);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });
});
