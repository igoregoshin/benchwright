/**
 * Subjects — the unit benchwright measures.
 *
 * A subject is anything an agent can be given before it starts working: a
 * skill, a rules file, a system-prompt fragment, an MCP wiring. The runner
 * needs to know five things about it, and nothing else:
 *
 *   id           the name in reports and in `--subject`
 *   category     which workspace the fixture builder has to prepare
 *   description  the text a harness routes on (trigger layer; null = skip it)
 *   cases        functional cases with fixtures and graders
 *   install      how to put the subject into a workspace (the `with` arm)
 *
 * Everything skill-specific lives in `skills.mjs`, which produces subjects of
 * this shape from a directory of Agent Skills. A config can produce them any
 * other way it likes.
 */
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { KNOWN_GRADERS } from './graders.mjs';

export const ALL_LAYERS = ['trigger', 'functional', 'ablation'];

/** Workspace shapes the fixture builder knows how to prepare (see fixtures.mjs). */
export const CATEGORIES = ['diff', 'repo', 'doc', 'mcp', 'chain', 'none'];

export const DEFAULTS = {
  runs: 1,
  triggerRuns: 3,
  /** Which agent CLI runs the cases: 'claude' | 'opencode' | 'codex' (see lib/harness/). */
  harness: 'claude',
  /** null = the harness's own default model (each CLI resolves its aliases); a config value wins. */
  model: null,
  judgeModel: null,
  maxTurns: 30,
  timeoutSeconds: 300,
  concurrency: 2,
  /** Where an `http` mock fixture writes its `secrets` (relative to the workspace). */
  secretsFile: '.env',
  autopilotPreamble:
    'You are running inside an unattended benchmark. There is no human available to answer. ' +
    'When you are instructed to ask the user a question, do NOT stop and wait: treat the following ' +
    'as the answers already given, and continue the workflow to completion.',
};

/**
 * Bring a raw subject (from a config or a discovery helper) to the canonical
 * shape. Paths resolve against `root`. Problems are collected, not thrown, so
 * `--check` can list every one of them at once.
 */
export function normalizeSubject(raw, { root, defaults, problems }) {
  const id = String(raw.id ?? raw.name ?? '').trim();
  if (!id) {
    problems.push(`a subject has no id: ${JSON.stringify(raw).slice(0, 120)}`);
    return null;
  }
  const where = (p) => (p && !path.isAbsolute(p) ? path.resolve(root, p) : p ?? null);

  const exempt = Boolean(raw.exempt);
  const exemptReason = raw.exempt === true ? null : raw.exempt ? String(raw.exempt) : (raw.exemptReason ?? null);

  let doc = {};
  const casesFile = where(raw.casesFile);
  if (casesFile) {
    if (!fs.existsSync(casesFile)) {
      problems.push(`${id}: casesFile does not exist: ${casesFile}`);
    } else {
      try {
        doc = yaml.load(fs.readFileSync(casesFile, 'utf8')) ?? {};
      } catch (err) {
        problems.push(`${id}: ${path.basename(casesFile)} does not parse: ${err.message.split('\n')[0]}`);
        doc = {};
      }
    }
  }

  const declared = doc.subject ?? doc.skill;
  if (declared !== undefined && String(declared) !== id) {
    problems.push(`${id}: ${path.basename(casesFile)} declares "${declared}" but is attached to subject "${id}"`);
  }

  const category = raw.category ?? doc.category ?? null;
  const rawCases = Array.isArray(raw.cases) ? raw.cases : (doc.cases ?? []);
  // A category says which workspace to build, so only functional cases need one;
  // a trigger-only subject (a description and queries) runs without a workspace.
  if (!exempt && !category && rawCases.length) problems.push(`${id}: no category (expected one of ${CATEGORIES.join(', ')})`);
  if (category && !CATEGORIES.includes(category)) {
    problems.push(`${id}: unknown category "${category}" (expected one of ${CATEGORIES.join(', ')})`);
  }
  if (raw.category && doc.category && raw.category !== doc.category) {
    problems.push(`${id}: registered as "${raw.category}" but ${path.basename(casesFile)} says category "${doc.category}"`);
  }

  const layers = exempt ? [] : [...(raw.layers ?? ALL_LAYERS)];
  for (const l of layers) {
    if (!ALL_LAYERS.includes(l)) problems.push(`${id}: unknown layer "${l}" (expected one of ${ALL_LAYERS.join(', ')})`);
  }

  const description = typeof raw.description === 'string' ? collapse(raw.description) : null;

  const triggerFile = where(raw.triggerFile);
  let trigger = [];
  if (Array.isArray(raw.trigger)) trigger = raw.trigger;
  else if (triggerFile && fs.existsSync(triggerFile)) {
    try {
      trigger = JSON.parse(fs.readFileSync(triggerFile, 'utf8'));
    } catch (err) {
      problems.push(`${id}: ${path.basename(triggerFile)} does not parse: ${err.message.split('\n')[0]}`);
    }
  } else if (Array.isArray(doc.trigger)) trigger = doc.trigger;

  const source = Array.isArray(raw.cases) ? 'config' : casesFile ? path.basename(casesFile) : 'config';

  return {
    id,
    category,
    exempt,
    exemptReason,
    layers,
    layerReason: raw.layerReason ?? null,
    description,
    trigger: normalizeTrigger(trigger),
    cases: rawCases.map((c, i) => normalizeCase(c, i, defaults, source)),
    casesFile,
    mocksDir: where(raw.mocksDir),
    install: normalizeInstall(raw.install, root),
    meta: raw.meta ?? {},
  };
}

function normalizeTrigger(list) {
  return (list ?? []).map((c, i) => ({
    id: String(c.id ?? `trigger-${i + 1}`),
    query: c.query,
    shouldTrigger: Boolean(c.shouldTrigger ?? c.should_trigger),
  }));
}

export function normalizeCase(c, i, defaults, source) {
  return {
    id: String(c.id ?? `case-${i + 1}`),
    prompt: c.prompt,
    tags: c.tags ?? [],
    runs: c.runs ?? defaults.runs,
    model: c.model ?? defaults.model,
    maxTurns: c.max_turns ?? c.maxTurns ?? defaults.maxTurns,
    timeoutSeconds: c.timeout_seconds ?? c.timeoutSeconds ?? defaults.timeoutSeconds,
    fixture: c.fixture ?? {},
    autopilot: c.autopilot ?? null,
    graders: (c.graders ?? []).map((g, gi) => ({ id: g.id ?? `g${gi + 1}`, weight: g.weight ?? 1, withOnly: g.with_only ?? g.withOnly ?? false, ...g })),
    source,
  };
}

/**
 * `install` is what the `with` arm gets and the `without` arm does not.
 *
 *   function (workdir, ctx) → void | string[]   the paths it wrote, to hide from git
 *   { copy: [{ from, to }] }                    declarative form for JSON configs
 *   undefined                                   nothing to install (prompt-only subjects)
 */
function normalizeInstall(install, root) {
  if (!install) return null;
  if (typeof install === 'function') return install;
  if (Array.isArray(install.copy)) {
    const entries = install.copy.map((e) => ({ from: path.resolve(root, e.from), to: e.to }));
    return (workdir) => {
      const wrote = [];
      for (const { from, to } of entries) {
        const dest = path.join(workdir, to);
        copyPath(from, dest);
        wrote.push(to);
      }
      return wrote;
    };
  }
  throw new Error(`install must be a function or { copy: [{ from, to }] }, got ${JSON.stringify(install)}`);
}

export function copyPath(src, dest, filter) {
  if (fs.statSync(src).isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const e of fs.readdirSync(src)) {
      if (filter && !filter(e, path.join(src, e))) continue;
      copyPath(path.join(src, e), path.join(dest, e), filter);
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

export function collapse(s) {
  return typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : null;
}

/**
 * Everything about a subject's cases that can be wrong before a single paid
 * call. This is the free layer: run it on every test, run it before every run.
 */
export function validateSubject(subject) {
  const problems = [];
  const at = `${subject.id}`;
  const ids = new Set();

  for (const c of subject.trigger) {
    if (typeof c.query !== 'string' || !c.query.trim()) problems.push(`${at}: trigger case ${c.id} has no query`);
  }

  for (const c of subject.cases) {
    if (!c.id) problems.push(`${at}: every case needs an id`);
    if (ids.has(c.id)) problems.push(`${at}: duplicate case id "${c.id}"`);
    ids.add(c.id);
    const here = `${at}/${c.id}`;

    if (typeof c.prompt !== 'string' || !c.prompt.trim()) problems.push(`${here}: case needs a prompt`);
    if (!c.graders.length) problems.push(`${here}: case needs at least one grader`);
    else if (!c.graders.some((g) => !g.withOnly)) problems.push(`${here}: every grader is with_only, so the case scores nothing`);
    if (c.fixture?.mocks && !subject.mocksDir) problems.push(`${here}: fixture.mocks is set but the subject has no mocksDir`);
    if (c.fixture?.mocks && subject.mocksDir && !fs.existsSync(path.join(subject.mocksDir, c.fixture.mocks))) {
      problems.push(`${here}: fixture.mocks names ${c.fixture.mocks}, which does not exist in ${subject.mocksDir}`);
    }

    for (const g of c.graders) {
      if (!KNOWN_GRADERS.includes(g.type)) {
        problems.push(`${here}: unknown grader type "${g.type}" (expected one of ${KNOWN_GRADERS.join(', ')})`);
        continue;
      }
      if (g.type === 'llm' && !g.criterion) problems.push(`${here}: an llm grader needs a criterion`);
      if (['file_exists', 'file_absent', 'file_matches'].includes(g.type) && !g.path) problems.push(`${here}: a ${g.type} grader needs a path`);
      if (['file_matches', 'output_matches'].includes(g.type) && typeof g.pattern !== 'string') problems.push(`${here}: a ${g.type} grader needs a pattern`);
      if (g.type === 'tool_used' && !g.tool) problems.push(`${here}: a tool_used grader needs a tool`);
      if (g.type === 'command' && !g.run) problems.push(`${here}: a command grader needs a run`);

      // Graders go through JavaScript RegExp, which has no inline (?m) / (?i)
      // syntax — that throws at run time, mid-benchmark. `flags:` is the field.
      for (const key of ['pattern', 'expect_match']) {
        const value = g[key];
        if (typeof value !== 'string') continue;
        if (/^\(\?[a-z]+\)/.test(value)) {
          problems.push(`${here}: ${key} uses inline flags "${value.slice(0, 8)}" — JavaScript regex does not support them. Move them to the grader's "flags" field.`);
          continue;
        }
        try {
          new RegExp(value, g.flags ?? 'm');
        } catch (err) {
          problems.push(`${here}: ${key} is not a valid JavaScript regex: ${value} (${err.message})`);
        }
      }
    }
  }
  return problems;
}
