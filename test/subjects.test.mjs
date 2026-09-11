import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULTS, normalizeCase, normalizeSubject, validateSubject, CATEGORIES, ALL_LAYERS } from '../lib/subjects.mjs';

const norm = (raw, root, problems = []) => ({ subject: normalizeSubject(raw, { root, defaults: DEFAULTS, problems }), problems });

describe('normalizeCase', () => {
  it('fills defaults and normalizes graders', () => {
    const c = normalizeCase({ prompt: 'do', graders: [{ type: 'no_writes' }, { type: 'llm', criterion: 'x', with_only: true, weight: 2 }] }, 0, DEFAULTS, 'bench.yaml');
    assert.equal(c.id, 'case-1');
    assert.equal(c.runs, DEFAULTS.runs);
    assert.equal(c.model, DEFAULTS.model);
    assert.equal(c.maxTurns, DEFAULTS.maxTurns);
    assert.equal(c.timeoutSeconds, DEFAULTS.timeoutSeconds);
    assert.deepEqual(c.graders.map((g) => g.id), ['g1', 'g2']);
    assert.equal(c.graders[1].withOnly, true);
    assert.equal(c.graders[1].weight, 2);
    assert.equal(c.source, 'bench.yaml');
  });
  it('accepts both snake_case and camelCase overrides', () => {
    const c = normalizeCase({ id: 'x', prompt: 'p', max_turns: 5, timeoutSeconds: 9 }, 0, DEFAULTS, 's');
    assert.equal(c.maxTurns, 5);
    assert.equal(c.timeoutSeconds, 9);
  });
});

describe('normalizeSubject', () => {
  let root;
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchwright-subj-'));
    fs.mkdirSync(path.join(root, 'a'), { recursive: true });
    fs.writeFileSync(path.join(root, 'a', 'bench.yaml'), [
      'subject: a',
      'category: repo',
      'trigger:',
      '  - { query: "do a", should_trigger: true }',
      'cases:',
      '  - id: one',
      '    prompt: hello',
      '    graders:',
      '      - type: no_writes',
    ].join('\n'));
    fs.writeFileSync(path.join(root, 'a', 'trigger.json'), JSON.stringify([{ query: 'from file', should_trigger: false }]));
    fs.writeFileSync(path.join(root, 'a', 'RULES.md'), '# rules');
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  it('reads category, trigger and cases from the cases file', () => {
    const { subject, problems } = norm({ id: 'a', casesFile: 'a/bench.yaml', description: '  routes\n  here ' }, root);
    assert.deepEqual(problems, []);
    assert.equal(subject.category, 'repo');
    assert.equal(subject.description, 'routes here');
    assert.deepEqual(subject.trigger, [{ id: 'trigger-1', query: 'do a', shouldTrigger: true }]);
    assert.equal(subject.cases.length, 1);
    assert.equal(subject.cases[0].id, 'one');
    assert.deepEqual(subject.layers, ALL_LAYERS);
    assert.equal(subject.install, null);
  });

  it('a trigger file wins over the cases file trigger list', () => {
    const { subject } = norm({ id: 'a', casesFile: 'a/bench.yaml', triggerFile: 'a/trigger.json' }, root);
    assert.deepEqual(subject.trigger, [{ id: 'trigger-1', query: 'from file', shouldTrigger: false }]);
  });

  it('reports a category disagreement and an id mismatch', () => {
    const { problems } = norm({ id: 'a', category: 'diff', casesFile: 'a/bench.yaml' }, root);
    assert.ok(problems.some((p) => /registered as "diff" but bench.yaml says category "repo"/.test(p)), problems.join('\n'));
    const { problems: p2 } = norm({ id: 'b', casesFile: 'a/bench.yaml' }, root);
    assert.ok(p2.some((p) => /declares "a" but is attached to subject "b"/.test(p)), p2.join('\n'));
  });

  it('flags a missing id, a missing category, an unknown category and an unknown layer', () => {
    const problems = [];
    assert.equal(normalizeSubject({ description: 'x' }, { root, defaults: DEFAULTS, problems }), null);
    assert.match(problems[0], /no id/);
    const { problems: p1 } = norm({ id: 'noc', cases: [{ id: 'c', prompt: 'p', graders: [{ type: 'no_writes' }] }] }, root);
    assert.match(p1[0], new RegExp(`no category \\(expected one of ${CATEGORIES.join(', ')}\\)`));
    // Trigger-only subjects need no workspace, so no category either.
    assert.deepEqual(norm({ id: 'tr', description: 'd', trigger: [{ query: 'q', should_trigger: true }] }, root).problems, []);
    const { problems: p2 } = norm({ id: 'bad', category: 'weird' }, root);
    assert.match(p2[0], /unknown category "weird"/);
    const { problems: p3 } = norm({ id: 'l', category: 'none', layers: ['trigger', 'magic'] }, root);
    assert.match(p3[0], /unknown layer "magic"/);
  });

  it('exempt subjects carry a reason and no layers', () => {
    const { subject, problems } = norm({ id: 'ex', exempt: 'circular, benchmarking itself proves nothing' }, root);
    assert.deepEqual(problems, []);
    assert.equal(subject.exempt, true);
    assert.equal(subject.exemptReason, 'circular, benchmarking itself proves nothing');
    assert.deepEqual(subject.layers, []);
  });

  it('install: { copy } becomes a function that copies and reports what it wrote', () => {
    const { subject } = norm({ id: 'rules', category: 'repo', install: { copy: [{ from: 'a/RULES.md', to: 'AGENTS.md' }] } }, root);
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchwright-inst-'));
    try {
      const wrote = subject.install(workdir, {});
      assert.deepEqual(wrote, ['AGENTS.md']);
      assert.equal(fs.readFileSync(path.join(workdir, 'AGENTS.md'), 'utf8'), '# rules');
    } finally {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('a missing or unparseable cases file is a problem, not a crash', () => {
    const { problems } = norm({ id: 'm', category: 'none', casesFile: 'a/missing.yaml' }, root);
    assert.match(problems[0], /casesFile does not exist/);
    fs.writeFileSync(path.join(root, 'a', 'broken.yaml'), 'cases: [\n  - :: not yaml');
    const { problems: p2 } = norm({ id: 'm', category: 'none', casesFile: 'a/broken.yaml' }, root);
    assert.match(p2[0], /does not parse/);
  });
});

describe('validateSubject', () => {
  const build = (cases, extra = {}) => {
    const problems = [];
    const subject = normalizeSubject({ id: 's', category: 'repo', cases, ...extra }, { root: os.tmpdir(), defaults: DEFAULTS, problems });
    return validateSubject(subject);
  };

  it('accepts a well-formed case', () => {
    assert.deepEqual(build([{ id: 'ok', prompt: 'p', graders: [{ type: 'file_exists', path: 'x' }, { type: 'command', run: 'true', expect_match: '^ok$' }] }]), []);
  });

  it('catches the classic authoring mistakes', () => {
    const problems = build([
      { id: 'dup', prompt: 'p', graders: [{ type: 'no_writes' }] },
      { id: 'dup', prompt: '', graders: [] },
      { id: 'wo', prompt: 'p', graders: [{ type: 'no_writes', with_only: true }] },
      { id: 'unk', prompt: 'p', graders: [{ type: 'telepathy' }] },
      { id: 'llm', prompt: 'p', graders: [{ type: 'llm' }] },
      { id: 'flags', prompt: 'p', graders: [{ type: 'output_matches', pattern: '(?m)^x$' }] },
      { id: 'regex', prompt: 'p', graders: [{ type: 'file_matches', path: 'a', pattern: '[' }] },
      { id: 'fields', prompt: 'p', graders: [{ type: 'file_exists' }, { type: 'tool_used' }, { type: 'command' }] },
      { id: 'mock', prompt: 'p', fixture: { mocks: 'x.json' }, graders: [{ type: 'no_writes' }] },
    ]);
    const has = (re) => assert.ok(problems.some((p) => re.test(p)), `expected ${re}\n${problems.join('\n')}`);
    has(/duplicate case id "dup"/);
    has(/s\/dup: case needs a prompt/);
    has(/s\/dup: case needs at least one grader/);
    has(/every grader is with_only/);
    has(/unknown grader type "telepathy"/);
    has(/an llm grader needs a criterion/);
    has(/uses inline flags/);
    has(/not a valid JavaScript regex/);
    has(/a file_exists grader needs a path/);
    has(/a tool_used grader needs a tool/);
    has(/a command grader needs a run/);
    has(/fixture.mocks is set but the subject has no mocksDir/);
  });

  it('flags a trigger case without a query', () => {
    const problems = build([], { trigger: [{ should_trigger: true }] });
    assert.match(problems[0], /trigger case trigger-1 has no query/);
  });
});
