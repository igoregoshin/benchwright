import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/benchwright.mjs', import.meta.url));

function benchwright(args, cwd) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, BENCHWRIGHT_CONFIG: '' , BENCHWRIGHT_CLAUDE: 'definitely-not-a-binary-benchwright' } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function project(root) {
  fs.mkdirSync(path.join(root, 'skills', 'alpha', 'evals'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: routes alpha\n---\n# alpha\n');
  fs.writeFileSync(path.join(root, 'skills', 'alpha', 'evals', 'bench.yaml'), [
    'skill: alpha',
    'category: diff',
    'cases:',
    '  - id: adds-note',
    '    prompt: add a note',
    '    fixture:',
    '      files:',
    '        - path: README.md',
    '          content: base',
    '      changed:',
    '        - path: README.md',
    '          content: changed',
    '    graders:',
    '      - type: file_exists',
    '        path: NOTE.md',
    '      - type: command',
    '        run: git status --porcelain',
    "        expect_match: '^M  README.md$'",
    '      - type: llm',
    '        criterion: the note is polite',
    '      - type: tool_used',
    '        tool: Skill',
    '        skill: alpha',
    '        with_only: true',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'skills', 'alpha', 'evals', 'trigger-eval.json'), JSON.stringify([{ query: 'hi', should_trigger: true }]));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'p', benchwright: { config: 'benchwright.config.json' } }));
  fs.writeFileSync(path.join(root, 'benchwright.config.json'), JSON.stringify({ title: 'proj', categories: { diff: { fixture: 'git repo + a diff' } }, skills: { dir: 'skills' } }));
}

describe('benchwright CLI', () => {
  let root;
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchwright-cli-'));
    project(root);
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  it('--help prints usage', () => {
    const r = benchwright(['--help'], root);
    assert.equal(r.code, 0);
    assert.match(r.out, /--grade-only <workdir>/);
  });

  it('an unknown argument exits 2', () => {
    const r = benchwright(['--bogus'], root);
    assert.equal(r.code, 2);
    assert.match(r.err, /unknown argument: --bogus/);
  });

  it('--check reports ok on a valid project and 1 on problems', () => {
    const ok = benchwright(['--check'], root);
    assert.equal(ok.code, 0, ok.err);
    assert.match(ok.out, /ok: 1 subject\(s\), 1 functional case\(s\), 1 trigger query\(ies\)/);

    const broken = path.join(root, 'broken.json');
    fs.writeFileSync(broken, JSON.stringify({ subjects: [{ id: 'x', category: 'none', cases: [{ id: 'c', prompt: '', graders: [] }] }] }));
    const bad = benchwright(['--check', '--config', broken], root);
    assert.equal(bad.code, 1);
    assert.match(bad.err, /x\/c: case needs a prompt/);
  });

  it('--list shows subjects grouped by category with case ids', () => {
    const r = benchwright(['--list'], root);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /diff\s+-- git repo \+ a diff/);
    assert.match(r.out, /alpha\s+trigger: 1\s+functional: 1\s+layers:all/);
    assert.match(r.out, /--case adds-note/);
  });

  it('no config → 2 with a hint; no selection → 2; unknown --case → 2 before any paid call', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'benchwright-nocfg-'));
    try {
      const r = benchwright(['--list', '--config', path.join(empty, 'nope.json')], empty);
      assert.equal(r.code, 2);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
    const none = benchwright([], root);
    assert.equal(none.code, 2);
    assert.match(none.err, /No subjects selected/);
    const typo = benchwright(['--subject', 'alpha', '--case', 'adds-not'], root);
    assert.equal(typo.code, 2);
    assert.match(typo.err, /unknown --case id\(s\): adds-not/);
    assert.match(typo.err, /available in the selected subject\(s\): adds-note, trigger-1/);
  });

  it('a missing agent binary fails fast, before any workspace is built', () => {
    const r = benchwright(['--subject', 'alpha', '--layer', 'trigger'], root);
    assert.equal(r.code, 2);
    assert.match(r.err, /agent CLI not available/);
    assert.ok(!fs.existsSync(path.join(root, 'bench-results')));
  });

  it('--build-only builds the with-arm workspace and --grade-only grades a directory', () => {
    const out = path.join(root, 'ws');
    const built = benchwright(['--subject', 'alpha', '--build-only', '--out', out], root);
    assert.equal(built.code, 0, built.err);
    const workdir = path.join(out, 'alpha__adds-note');
    assert.ok(fs.existsSync(path.join(workdir, '.claude', 'skills', 'alpha', 'SKILL.md')), 'skill installed');
    assert.equal(fs.readFileSync(path.join(workdir, 'README.md'), 'utf8'), 'changed');

    // Realistic failure: the subject never wrote the note.
    const fail = benchwright(['--subject', 'alpha', '--case', 'adds-note', '--grade-only', workdir], root);
    assert.equal(fail.code, 1);
    assert.match(fail.out, /x \[file_exists\] NOTE.md/);
    assert.match(fail.out, /v \[command\] git status --porcelain/);
    assert.match(fail.out, /- \[llm\] the note is polite\s+\(needs an agent run\)/);
    assert.match(fail.out, /rule graders: 1\/2 pass/);

    // The work the subject should do.
    fs.writeFileSync(path.join(workdir, 'NOTE.md'), 'thanks');
    const pass = benchwright(['--subject', 'alpha', '--case', 'adds-note', '--grade-only', workdir], root);
    assert.equal(pass.code, 0, pass.out);
    assert.match(pass.out, /rule graders: 2\/2 pass/);
  });
});
