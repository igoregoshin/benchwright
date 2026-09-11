import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { skillSubjects, skillDescription, readFrontmatter, installSkill } from '../lib/skills.mjs';
import { ALL_LAYERS } from '../lib/subjects.mjs';
import { getHarness } from '../lib/harness/index.mjs';

function makeSkill(dir, name, { description = `${name} does things`, crlf = false, evals = true, extra = {} } = {}) {
  const skillDir = path.join(dir, name);
  fs.mkdirSync(path.join(skillDir, 'references'), { recursive: true });
  const nl = crlf ? '\r\n' : '\n';
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), ['---', `name: ${name}`, `description: >-`, `  ${description}`, `  second line`, '---', '# body'].join(nl));
  fs.writeFileSync(path.join(skillDir, 'references', 'FORMAT.md'), 'format');
  if (evals) {
    fs.mkdirSync(path.join(skillDir, 'evals', 'mocks'), { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'evals', 'bench.yaml'), `skill: ${name}\ncategory: repo\ncases:\n  - id: c1\n    prompt: p\n    graders:\n      - type: no_writes\n`);
    fs.writeFileSync(path.join(skillDir, 'evals', 'trigger-eval.json'), JSON.stringify([{ query: 'q', should_trigger: true }]));
  }
  for (const [rel, content] of Object.entries(extra)) fs.writeFileSync(path.join(skillDir, rel), content);
  return skillDir;
}

describe('frontmatter', () => {
  let dir;
  before(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchwright-fm-'))));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('parses CRLF files and collapses the description', () => {
    const s = makeSkill(dir, 'crlf', { crlf: true, description: 'Routes   here' });
    assert.equal(skillDescription(s), 'Routes here second line');
    assert.equal(readFrontmatter(path.join(s, 'SKILL.md')).name, 'crlf');
  });
  it('returns null when there is no frontmatter or no file', () => {
    fs.writeFileSync(path.join(dir, 'plain.md'), '# no frontmatter');
    assert.equal(readFrontmatter(path.join(dir, 'plain.md')), null);
    assert.equal(readFrontmatter(path.join(dir, 'missing.md')), null);
    assert.equal(skillDescription(path.join(dir, 'nowhere')), null);
  });
});

describe('installSkill', () => {
  it('copies everything except evals/, honouring a filter', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchwright-is-'));
    try {
      const s = makeSkill(dir, 'x', { extra: { 'gitlab.md.hbs': 'tpl' } });
      const dest = path.join(dir, 'out', 'x');
      installSkill(s, dest, { filter: (name) => !name.endsWith('.hbs') });
      assert.ok(fs.existsSync(path.join(dest, 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(dest, 'references', 'FORMAT.md')));
      assert.ok(!fs.existsSync(path.join(dest, 'evals')));
      assert.ok(!fs.existsSync(path.join(dest, 'gitlab.md.hbs')));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('skillSubjects', () => {
  let dir;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchwright-sk-'));
    makeSkill(dir, 'alpha');
    makeSkill(dir, 'beta', { evals: false });
    makeSkill(dir, 'gamma');
    makeSkill(dir, '_shared', { evals: false });
    fs.writeFileSync(path.join(dir, 'README.md'), 'not a skill');
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('without a registry: every skill, all layers, category from bench.yaml', () => {
    const { subjects, problems } = skillSubjects({ dir });
    assert.deepEqual(problems, []);
    assert.deepEqual(subjects.map((s) => s.id), ['alpha', 'beta', 'gamma']);
    const a = subjects[0];
    assert.equal(a.description, 'alpha does things second line');
    assert.deepEqual(a.layers, ALL_LAYERS);
    assert.ok(a.casesFile.endsWith(path.join('alpha', 'evals', 'bench.yaml')));
    assert.ok(a.mocksDir.endsWith(path.join('alpha', 'evals', 'mocks')));
    assert.equal(subjects[1].casesFile, undefined);
    assert.equal(subjects[1].mocksDir, undefined);
  });

  it('with a registry: applies categories, exemptions, overrides and reports every disagreement', () => {
    const registry = {
      categories: { repo: { skills: ['alpha', 'ghost'] }, doc: { skills: ['alpha'] } },
      exempt: { gamma: 'short', beta: 'a real reason that is long enough to count' },
      skillOverrides: { alpha: { layers: ['trigger'], reason: 'interactive end to end, only routing is observable' }, nobody: { layers: ['trigger'], reason: 'x' } },
    };
    const { subjects, problems } = skillSubjects({ dir, registry });
    const has = (re) => assert.ok(problems.some((p) => re.test(p)), `expected ${re}\n${problems.join('\n')}`);
    has(/alpha: listed in two categories/);
    has(/gamma: exemptions need a real reason/);
    has(/nobody: overrides name a skill that does not exist/);
    has(/nobody: overrides need a reason/);
    has(/ghost: registered but no such directory/);
    const alpha = subjects.find((s) => s.id === 'alpha');
    assert.deepEqual(alpha.layers, ['trigger']);
    assert.match(alpha.layerReason, /interactive/);
    const beta = subjects.find((s) => s.id === 'beta');
    assert.equal(beta.exempt, 'a real reason that is long enough to count');
    assert.deepEqual(beta.layers, []);
  });

  it('with a registry: an unregistered skill is a problem, so a new skill cannot be silently un-benchmarked', () => {
    const registry = { categories: { repo: { skills: ['alpha', 'beta'] } }, exempt: {} };
    const { problems } = skillSubjects({ dir, registry });
    assert.deepEqual(problems, ['gamma: not benchmarked and not exempt. Add it to a category in the registry, or to "exempt" with a reason.']);
  });

  it('a skill that is both exempt and categorised is a problem', () => {
    const registry = { categories: { repo: { skills: ['alpha', 'beta', 'gamma'] } }, exempt: { alpha: 'this reason is definitely long enough' } };
    const { problems } = skillSubjects({ dir, registry });
    assert.ok(problems.some((p) => /alpha: both exempt and in category "repo"/.test(p)), problems.join('\n'));
  });

  it('install copies the skill into .claude/skills and reports the path to hide', () => {
    const { subjects } = skillSubjects({ dir });
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchwright-ws-'));
    try {
      const wrote = subjects[0].install(workdir, { variant: null });
      assert.deepEqual(wrote, ['.claude/skills/']);
      assert.ok(fs.existsSync(path.join(workdir, '.claude', 'skills', 'alpha', 'SKILL.md')));
      assert.ok(!fs.existsSync(path.join(workdir, '.claude', 'skills', 'alpha', 'evals')));
    } finally {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('install follows the harness in the context, unless skillsRoot pins a directory', () => {
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchwright-ws-'));
    try {
      const { subjects } = skillSubjects({ dir });
      assert.deepEqual(subjects[0].install(workdir, { variant: null, harness: getHarness('codex') }), ['.agents/skills/']);
      assert.ok(fs.existsSync(path.join(workdir, '.agents', 'skills', 'alpha', 'SKILL.md')));
      assert.deepEqual(subjects[0].install(workdir, { variant: null, harness: getHarness('opencode') }), ['.opencode/skills/']);
      assert.ok(fs.existsSync(path.join(workdir, '.opencode', 'skills', 'alpha', 'SKILL.md')));

      const pinned = skillSubjects({ dir, skillsRoot: 'custom/skills' }).subjects[0];
      assert.deepEqual(pinned.install(workdir, { variant: null, harness: getHarness('codex') }), ['custom/skills/']);
      assert.ok(fs.existsSync(path.join(workdir, 'custom', 'skills', 'alpha', 'SKILL.md')));
    } finally {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('custom describe and install hooks replace the defaults', () => {
    const seen = [];
    const { subjects } = skillSubjects({
      dir,
      describe: (skillDir, name) => `custom ${name}`,
      install: ({ name, dest, variant }) => {
        seen.push([name, variant]);
        fs.mkdirSync(dest, { recursive: true });
        fs.writeFileSync(path.join(dest, 'SKILL.md'), 'rendered');
      },
    });
    assert.equal(subjects[0].description, 'custom alpha');
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchwright-ws-'));
    try {
      subjects[0].install(workdir, { variant: 'gitlab' });
      assert.deepEqual(seen, [['alpha', 'gitlab']]);
      assert.equal(fs.readFileSync(path.join(workdir, '.claude', 'skills', 'alpha', 'SKILL.md'), 'utf8'), 'rendered');
    } finally {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('a missing skills dir is a problem', () => {
    const { subjects, problems } = skillSubjects({ dir: path.join(dir, 'nope') });
    assert.deepEqual(subjects, []);
    assert.match(problems[0], /skills dir does not exist/);
  });
});
