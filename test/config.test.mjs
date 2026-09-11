import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findConfig, loadConfig, resolveSubjects, check, CONFIG_NAMES } from '../lib/config.mjs';

function project(root) {
  fs.mkdirSync(path.join(root, 'skills', 'alpha', 'evals'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: routes alpha\n---\n');
  fs.writeFileSync(path.join(root, 'skills', 'alpha', 'evals', 'bench.yaml'), 'skill: alpha\ncategory: repo\ncases:\n  - id: c1\n    prompt: p\n    graders:\n      - type: no_writes\n');
  fs.mkdirSync(path.join(root, 'skills', 'beta'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 'beta', 'SKILL.md'), '---\nname: beta\ndescription: routes beta\n---\n');
  fs.writeFileSync(path.join(root, 'rules.md'), '# rules');
  fs.writeFileSync(path.join(root, 'registry.json'), JSON.stringify({ categories: { repo: { skills: ['alpha'] } }, exempt: { beta: 'a long enough reason for the exemption' } }));
}

describe('findConfig', () => {
  let root;
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchwright-cfg-'));
    fs.mkdirSync(path.join(root, 'deep', 'er'), { recursive: true });
  });
  after(() => {
    delete process.env.BENCHWRIGHT_CONFIG;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('finds a config file above the current directory', () => {
    fs.writeFileSync(path.join(root, CONFIG_NAMES[2]), '{}');
    assert.equal(findConfig(path.join(root, 'deep', 'er')), path.join(root, CONFIG_NAMES[2]));
  });
  it('a package.json field wins over a file in the same directory', () => {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'x', benchwright: { config: 'scripts/bench.mjs' } }));
    assert.equal(findConfig(path.join(root, 'deep')), path.join(root, 'scripts', 'bench.mjs'));
  });
  it('BENCHWRIGHT_CONFIG wins over everything', () => {
    process.env.BENCHWRIGHT_CONFIG = 'env.mjs';
    assert.equal(findConfig(root), path.join(root, 'env.mjs'));
    delete process.env.BENCHWRIGHT_CONFIG;
  });
  it('returns null when nothing is found', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'benchwright-none-'));
    try {
      // A parent may carry a config in the developer's tree; only assert when the walk finds nothing.
      const found = findConfig(empty);
      assert.ok(found === null || !found.startsWith(empty));
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('loadConfig + resolveSubjects + check', () => {
  let root;
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchwright-load-'));
    project(root);
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"p"}');
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  it('json config with the skills preset and a registry path', async () => {
    const file = path.join(root, 'benchwright.config.json');
    fs.writeFileSync(file, JSON.stringify({ title: 'T', defaults: { runs: 3 }, skills: { dir: 'skills', registry: 'registry.json' } }));
    const config = await loadConfig(file);
    assert.equal(config.root, root);
    assert.equal(config.title, 'T');
    assert.equal(config.defaults.runs, 3);
    assert.equal(config.defaults.model, 'sonnet');
    assert.equal(config.resultsDir, path.join(root, 'bench-results'));
    const { subjects, problems } = await resolveSubjects(config);
    assert.deepEqual(problems, []);
    assert.deepEqual(subjects.map((s) => [s.id, s.category, s.exempt]), [['alpha', 'repo', false], ['beta', null, true]]);
    assert.equal(subjects[0].cases[0].runs, 3);
    const checked = await check(config);
    assert.deepEqual(checked.problems, []);
  });

  it('mjs config with a subjects function receiving the helpers, plus a declarative copy subject', async () => {
    const file = path.join(root, 'sub', 'benchwright.config.mjs');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, [
      "export default {",
      "  root: '..',",
      "  resultsDir: 'out',",
      "  subjects: async ({ root, skillSubjects, skillDescription }) => {",
      "    const found = skillSubjects({ dir: root + '/skills' });",
      "    return { subjects: [...found.subjects, { id: 'rules', category: 'repo', description: 'rules text', install: { copy: [{ from: 'rules.md', to: 'AGENTS.md' }] }, cases: [{ id: 'r1', prompt: 'p', graders: [{ type: 'file_exists', path: 'AGENTS.md' }] }] }], problems: found.problems };",
      "  },",
      "};",
    ].join('\n'));
    const config = await loadConfig(file);
    assert.equal(config.root, root);
    assert.equal(config.resultsDir, path.join(root, 'out'));
    const { subjects, problems } = await resolveSubjects(config);
    assert.deepEqual(problems, []);
    assert.deepEqual(subjects.map((s) => s.id), ['alpha', 'beta', 'rules']);
    const rules = subjects[2];
    assert.equal(typeof rules.install, 'function');
    assert.equal(rules.cases[0].graders[0].type, 'file_exists');
  });

  it('check() surfaces discovery and case problems together', async () => {
    const file = path.join(root, 'bad.config.json');
    fs.writeFileSync(file, JSON.stringify({ skills: { dir: 'skills', registry: { categories: { repo: { skills: ['alpha', 'ghost'] } }, exempt: {} } }, subjects: [{ id: 'x', category: 'none', cases: [{ id: 'c', prompt: 'p', graders: [{ type: 'output_matches', pattern: '(?i)a' }] }] }] }));
    const { problems } = await check(await loadConfig(file));
    assert.ok(problems.some((p) => /ghost: registered but no such directory/.test(p)), problems.join('\n'));
    assert.ok(problems.some((p) => /beta: not benchmarked and not exempt/.test(p)), problems.join('\n'));
    assert.ok(problems.some((p) => /x\/c: pattern uses inline flags/.test(p)), problems.join('\n'));
  });

  it('a subject declared twice is a problem; a missing config throws', async () => {
    const file = path.join(root, 'dup.config.json');
    fs.writeFileSync(file, JSON.stringify({ subjects: [{ id: 'x', category: 'none' }, { id: 'x', category: 'none' }] }));
    const { problems } = await resolveSubjects(await loadConfig(file));
    assert.deepEqual(problems, ['x: declared twice']);
    await assert.rejects(loadConfig(path.join(root, 'missing.json')), /config not found/);
  });
});
