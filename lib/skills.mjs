/**
 * Skills — subjects discovered from a directory of Agent Skills.
 *
 * The convention this implements is the agentskills.io layout: one directory
 * per skill, `SKILL.md` with YAML frontmatter (`name`, `description`), anything
 * else alongside. Evals live under `<skill>/evals/`:
 *
 *   evals/bench.yaml           functional cases (and optionally `trigger:`)
 *   evals/trigger-eval.json    [{ query, should_trigger }]
 *   evals/mocks/<case>.json    recorded services for the `mcp` category
 *
 * A project whose skills carry extra conventions (variant templates, shared
 * references, a manifest the description lives in) passes `describe` and
 * `install` hooks; the discovery, the registry checks and the case loading
 * stay here.
 */
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { ALL_LAYERS, collapse, copyPath } from './subjects.mjs';

/** Parsed YAML frontmatter of a Markdown file, or null when it has none. */
export function readFrontmatter(file) {
  if (!fs.existsSync(file)) return null;
  // Checkouts are often CRLF; `^---\n` never matches `---\r\n`, and every
  // description then silently parses as empty.
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return null;
  try {
    return yaml.load(fm[1]) ?? {};
  } catch {
    return null;
  }
}

/** The `description:` a harness routes on — `SKILL.md` frontmatter, whitespace collapsed. */
export function skillDescription(skillDir) {
  return collapse(readFrontmatter(path.join(skillDir, 'SKILL.md'))?.description);
}

/**
 * Copy a skill directory into a workspace so the agent actually loads it.
 * `evals/` never ships; `filter(name, fullPath)` narrows further.
 */
export function installSkill(src, dest, { filter } = {}) {
  copyPath(src, dest, (name, full) => name !== 'evals' && (!filter || filter(name, full)));
  return dest;
}

/**
 * One subject per skill directory.
 *
 * `registry` is optional. Without it every skill is benchmarked on all layers
 * and its category comes from `bench.yaml`. With it, the registry is the
 * decision record: every skill must be in a category or exempt with a reason,
 * and `problems` says where the registry and the disk disagree — a consumer's
 * test suite turns that into a build failure, so a skill added later can never
 * be silently un-benchmarked.
 *
 *   registry = {
 *     categories: { diff: { skills: ['a', 'b'] }, ... },
 *     exempt:     { 'c': 'why it is not benchmarked (≥ 20 chars)' },
 *     overrides:  { 'd': { layers: ['trigger'], reason: '...' } },   // or `skillOverrides`
 *   }
 */
export function skillSubjects({
  dir,
  registry = null,
  evalsDir = 'evals',
  casesFile = 'bench.yaml',
  triggerFile = 'trigger-eval.json',
  mocksDir = 'mocks',
  skillsRoot = '.claude/skills',
  include = (name) => !name.startsWith('_') && !name.startsWith('.'),
  describe = (skillDir) => skillDescription(skillDir),
  install = null,
  filter = null,
}) {
  const problems = [];
  if (!fs.existsSync(dir)) return { subjects: [], problems: [`skills dir does not exist: ${dir}`] };

  const disk = fs
    .readdirSync(dir)
    .filter((s) => include(s) && fs.statSync(path.join(dir, s)).isDirectory())
    .sort();

  const categoryOf = new Map();
  const exempt = registry?.exempt ?? {};
  const overrides = registry?.overrides ?? registry?.skillOverrides ?? {};
  if (registry) {
    for (const [cat, def] of Object.entries(registry.categories ?? {})) {
      for (const s of def.skills ?? []) {
        if (categoryOf.has(s)) problems.push(`${s}: listed in two categories (${categoryOf.get(s)}, ${cat})`);
        categoryOf.set(s, cat);
      }
    }
    for (const [s, reason] of Object.entries(exempt)) {
      if (!reason || String(reason).trim().length < 20) problems.push(`${s}: exemptions need a real reason, not a placeholder`);
    }
    for (const [s, o] of Object.entries(overrides)) {
      if (!disk.includes(s)) problems.push(`${s}: overrides name a skill that does not exist in ${dir}`);
      if (!o?.reason || String(o.reason).trim().length < 20) problems.push(`${s}: overrides need a reason explaining why the other layers do not apply`);
    }
    for (const s of [...categoryOf.keys(), ...Object.keys(exempt)]) {
      if (!disk.includes(s)) problems.push(`${s}: registered but no such directory in ${dir}`);
    }
  }

  const subjects = [];
  for (const name of disk) {
    const skillDir = path.join(dir, name);
    const evals = path.join(skillDir, evalsDir);
    const exemptReason = exempt[name] ?? null;
    const category = categoryOf.get(name) ?? null;

    if (registry) {
      if (exemptReason && category) problems.push(`${name}: both exempt and in category "${category}" — pick one`);
      if (!exemptReason && !category) {
        problems.push(`${name}: not benchmarked and not exempt. Add it to a category in the registry, or to "exempt" with a reason.`);
      }
    }

    const override = overrides[name];
    subjects.push({
      id: name,
      category: category ?? undefined,
      exempt: exemptReason ?? false,
      layers: exemptReason ? [] : (override?.layers ?? ALL_LAYERS),
      layerReason: override?.reason ?? null,
      description: describe(skillDir, name),
      casesFile: fs.existsSync(path.join(evals, casesFile)) ? path.join(evals, casesFile) : undefined,
      triggerFile: path.join(evals, triggerFile),
      mocksDir: fs.existsSync(path.join(evals, mocksDir)) ? path.join(evals, mocksDir) : undefined,
      install: (workdir, ctx) => {
        const dest = path.join(workdir, skillsRoot, name);
        if (install) install({ skillDir, name, dest, workdir, ...ctx });
        else installSkill(skillDir, dest, { filter });
        return [`${skillsRoot.split(path.sep).join('/').replace(/\/$/, '')}/`];
      },
      meta: { skillDir, evalsDir: evals },
    });
  }

  return { subjects, problems };
}
