/**
 * Config — where the subjects come from.
 *
 *   benchwright.config.mjs      export default { title, defaults, categories, subjects | skills }
 *   benchwright.config.json     same shape, subjects declared declaratively
 *
 * Discovery, in order: `--config`, `BENCHWRIGHT_CONFIG`, a `benchwright.config`
 * field in the nearest package.json (`{ "benchwright": { "config": "path" } }`),
 * then `benchwright.config.{mjs,js,json}` in the current directory or any parent.
 *
 * Relative paths inside the config resolve against `root`: the nearest
 * directory above the config that has a package.json, or the config's own
 * directory. Results land in `<root>/bench-results/` unless `resultsDir` says
 * otherwise.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULTS, normalizeSubject, validateSubject } from './subjects.mjs';
import { installSkill, skillDescription, skillSubjects, readFrontmatter } from './skills.mjs';

export const CONFIG_NAMES = ['benchwright.config.mjs', 'benchwright.config.js', 'benchwright.config.json'];

export function findConfig(fromDir = process.cwd()) {
  if (process.env.BENCHWRIGHT_CONFIG) return path.resolve(fromDir, process.env.BENCHWRIGHT_CONFIG);
  let dir = path.resolve(fromDir);
  for (;;) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const declared = JSON.parse(fs.readFileSync(pkg, 'utf8'))?.benchwright?.config;
        if (declared) return path.resolve(dir, declared);
      } catch {
        /* an unreadable package.json is not our problem here */
      }
    }
    for (const name of CONFIG_NAMES) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function nearestPackageRoot(fromDir) {
  let dir = fromDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export async function loadConfig(configPath) {
  const file = path.resolve(configPath);
  if (!fs.existsSync(file)) throw new Error(`config not found: ${file}`);
  let raw;
  if (file.endsWith('.json')) raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  else raw = (await import(pathToFileURL(file).href)).default;
  if (!raw || typeof raw !== 'object') throw new Error(`${file} must export a config object`);

  const configDir = path.dirname(file);
  const root = raw.root ? path.resolve(configDir, raw.root) : (nearestPackageRoot(configDir) ?? configDir);

  return {
    path: file,
    dir: configDir,
    root,
    title: raw.title ?? 'benchwright',
    defaults: { ...DEFAULTS, ...(raw.defaults ?? {}) },
    categories: raw.categories ?? {},
    resultsDir: path.resolve(root, raw.resultsDir ?? 'bench-results'),
    subjects: raw.subjects ?? null,
    skills: raw.skills ?? null,
  };
}

/** What a `subjects(ctx)` function receives — the helpers, so a config need not import the package. */
function context(config) {
  return {
    root: config.root,
    configDir: config.dir,
    defaults: config.defaults,
    skillSubjects,
    installSkill,
    skillDescription,
    readFrontmatter,
  };
}

/**
 * Turn whatever the config declares into normalized subjects.
 *
 * `subjects` may be an array, a `{ subjects, problems }` pair, or a (possibly
 * async) function returning either. `skills` is the built-in preset:
 * `{ dir, registry?, ... }` → `skillSubjects()`.
 */
export async function resolveSubjects(config) {
  const problems = [];
  let raw = [];

  if (config.subjects) {
    const value = typeof config.subjects === 'function' ? await config.subjects(context(config)) : config.subjects;
    if (Array.isArray(value)) raw = value;
    else if (value && Array.isArray(value.subjects)) {
      raw = value.subjects;
      problems.push(...(value.problems ?? []));
    } else throw new Error('config.subjects must resolve to an array or { subjects, problems }');
  }

  if (config.skills) {
    const opts = { ...config.skills };
    opts.dir = path.resolve(config.root, opts.dir ?? 'skills');
    if (typeof opts.registry === 'string') {
      opts.registry = JSON.parse(fs.readFileSync(path.resolve(config.root, opts.registry), 'utf8'));
    }
    const found = skillSubjects(opts);
    raw = [...raw, ...found.subjects];
    problems.push(...found.problems);
  }

  const seen = new Set();
  const subjects = [];
  for (const r of raw) {
    const s = normalizeSubject(r, { root: config.root, defaults: config.defaults, problems });
    if (!s) continue;
    if (seen.has(s.id)) problems.push(`${s.id}: declared twice`);
    seen.add(s.id);
    subjects.push(s);
  }
  return { subjects, problems };
}

/**
 * The free layer, in one call: discovery problems plus every case-level
 * problem of every subject. A consumer's test suite asserts this is empty.
 */
export async function check(config) {
  const { subjects, problems } = await resolveSubjects(config);
  for (const s of subjects) problems.push(...validateSubject(s));
  return { subjects, problems };
}
