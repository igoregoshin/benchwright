import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gradeCase, matchPaths, KNOWN_GRADERS } from '../lib/graders.mjs';

const run = (over = {}) => ({ transcript: '', toolCalls: [], toolsUsed: [], skillsUsed: [], ...over });
const grade = (g, ctx = {}) =>
  gradeCase({ graders: [{ id: 'g1', weight: 1, withOnly: false, ...g }], run: ctx.run ?? run(), workdir: ctx.workdir ?? os.tmpdir(), files: ctx.files ?? new Map(), prompt: 'p', judgeModel: 'haiku' })
    .then((r) => r.graders[0]);

describe('matchPaths', () => {
  const files = new Map([['docs/plans/a.md', ''], ['docs/x/y/z.md', ''], ['src/a.ts', ''], ['a.md', '']]);
  it('* stays inside one segment', () => {
    assert.deepEqual(matchPaths(files, 'docs/*/a.md'), ['docs/plans/a.md']);
    assert.deepEqual(matchPaths(files, '*.md'), ['a.md']);
  });
  it('** spans one or more directories (a root file does not match **/x)', () => {
    assert.deepEqual(matchPaths(files, 'docs/**/*.md').sort(), ['docs/plans/a.md', 'docs/x/y/z.md']);
    assert.deepEqual(matchPaths(files, '**/*.md').sort(), ['docs/plans/a.md', 'docs/x/y/z.md']);
  });
  it('escapes regex metacharacters in the pattern', () => {
    assert.deepEqual(matchPaths(new Map([['a+b.md', ''], ['aab.md', '']]), 'a+b.md'), ['a+b.md']);
  });
});

describe('KNOWN_GRADERS', () => {
  it('lists llm plus every deterministic grader', () => {
    assert.deepEqual(KNOWN_GRADERS, ['llm', 'file_exists', 'file_absent', 'file_matches', 'output_matches', 'tool_used', 'no_writes', 'command']);
  });
});

describe('deterministic graders', () => {
  const files = new Map([['docs/plan.md', '# Plan\n- [x] done\n'], ['src/a.ts', 'export const a = 1;\n']]);

  it('file_exists / file_absent', async () => {
    assert.equal((await grade({ type: 'file_exists', path: 'docs/*.md' }, { files })).pass, true);
    assert.equal((await grade({ type: 'file_exists', path: 'nope/*.md' }, { files })).pass, false);
    assert.equal((await grade({ type: 'file_absent', path: 'nope/*.md' }, { files })).pass, true);
    assert.equal((await grade({ type: 'file_absent', path: 'src/*.ts' }, { files })).pass, false);
  });

  it('file_matches honours flags', async () => {
    assert.equal((await grade({ type: 'file_matches', path: 'docs/*.md', pattern: '^- \\[x\\]' }, { files })).pass, true);
    assert.equal((await grade({ type: 'file_matches', path: 'docs/*.md', pattern: '^# plan', flags: 'im' }, { files })).pass, true);
    assert.equal((await grade({ type: 'file_matches', path: 'docs/*.md', pattern: '^# plan' }, { files })).pass, false);
    assert.equal((await grade({ type: 'file_matches', path: 'missing.md', pattern: '.' }, { files })).pass, false);
  });

  it('output_matches reads the transcript', async () => {
    const r = run({ transcript: 'Итог: ✅ всё хорошо\n[tool: Bash]' });
    assert.equal((await grade({ type: 'output_matches', pattern: '^Итог: .*✅' }, { run: r })).pass, true);
    assert.equal((await grade({ type: 'output_matches', pattern: 'nothing here' }, { run: r })).pass, false);
  });

  it('tool_used distinguishes Skill invocations', async () => {
    const r = run({ toolsUsed: ['Skill', 'Bash'], skillsUsed: ['tl-commit'] });
    assert.equal((await grade({ type: 'tool_used', tool: 'Bash' }, { run: r })).pass, true);
    assert.equal((await grade({ type: 'tool_used', tool: 'Write' }, { run: r })).pass, false);
    assert.equal((await grade({ type: 'tool_used', tool: 'Skill', skill: 'tl-commit' }, { run: r })).pass, true);
    assert.equal((await grade({ type: 'tool_used', tool: 'Skill', skill: 'tl-plan' }, { run: r })).pass, false);
  });

  it('no_writes', async () => {
    assert.equal((await grade({ type: 'no_writes' }, { run: run({ toolsUsed: ['Read', 'Bash'] }) })).pass, true);
    assert.equal((await grade({ type: 'no_writes' }, { run: run({ toolsUsed: ['Edit'] }) })).pass, false);
  });

  it('unknown grader type is an error, not a fail', async () => {
    const r = await grade({ type: 'telepathy' });
    assert.equal(r.pass, false);
    assert.equal(r.error, true);
    assert.match(r.why, /unknown grader type/);
  });
});

describe('command grader', () => {
  let workdir;
  before(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchwright-gr-'));
    fs.writeFileSync(path.join(workdir, 'hello.txt'), 'hi\n');
  });
  after(() => fs.rmSync(workdir, { recursive: true, force: true }));

  it('passes on exit 0 by default and honours expect_exit', async () => {
    assert.equal((await grade({ type: 'command', run: 'true' }, { workdir })).pass, true);
    assert.equal((await grade({ type: 'command', run: 'false' }, { workdir })).pass, false);
    assert.equal((await grade({ type: 'command', run: 'exit 3', expect_exit: 3 }, { workdir })).pass, true);
  });

  it('matches output with expect_match and % survives the shell', async () => {
    const r = await grade({ type: 'command', run: 'printf "%s\\n" 42', expect_match: '^42$' }, { workdir });
    assert.equal(r.pass, true, r.why);
  });

  it('trailing newline does not let "^$" pass on non-empty output', async () => {
    // The trap: under the default `m` flag, `^$` matched the empty position
    // after the final newline, so a "nothing left" grader passed on everything.
    const dirty = await grade({ type: 'command', run: 'printf " M file\\n"', expect_match: '^$' }, { workdir });
    assert.equal(dirty.pass, false, 'non-empty output must not satisfy ^$');
    const clean = await grade({ type: 'command', run: 'printf ""', expect_match: '^$' }, { workdir });
    assert.equal(clean.pass, true);
    const ws = await grade({ type: 'command', run: 'printf "  x\\n"', expect_match: '^\\s*$' }, { workdir });
    assert.equal(ws.pass, false);
  });

  it('expect_match applies to the output of a non-zero exit too', async () => {
    const r = await grade({ type: 'command', run: 'echo boom; exit 1', expect_match: 'boom' }, { workdir });
    assert.equal(r.pass, true, r.why);
  });

  it('runs in the workdir', async () => {
    const r = await grade({ type: 'command', run: 'cat hello.txt', expect_match: '^hi$' }, { workdir });
    assert.equal(r.pass, true, r.why);
  });
});

describe('scoring', () => {
  it('excludes with_only graders from the score but reports them', async () => {
    const res = await gradeCase({
      graders: [
        { id: 'a', type: 'no_writes', weight: 1, withOnly: false },
        { id: 'b', type: 'tool_used', tool: 'Write', weight: 1, withOnly: false },
        { id: 'c', type: 'tool_used', tool: 'Skill', skill: 'x', weight: 5, withOnly: true },
      ],
      run: run({ toolsUsed: ['Read'] }),
      workdir: os.tmpdir(),
      files: new Map(),
      prompt: 'p',
      judgeModel: 'haiku',
    });
    assert.equal(res.graders.length, 3);
    assert.equal(res.score, 0.5);
  });

  it('weights count', async () => {
    const res = await gradeCase({
      graders: [
        { id: 'a', type: 'no_writes', weight: 3, withOnly: false },
        { id: 'b', type: 'tool_used', tool: 'Write', weight: 1, withOnly: false },
      ],
      run: run({ toolsUsed: ['Read'] }),
      workdir: os.tmpdir(),
      files: new Map(),
      prompt: 'p',
      judgeModel: 'haiku',
    });
    assert.equal(res.score, 0.75);
  });
});
