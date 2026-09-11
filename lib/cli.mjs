/**
 * benchwright CLI.
 *
 *   benchwright --list
 *   benchwright --check
 *   benchwright --layer trigger --all
 *   benchwright --subject tl-plan
 *   benchwright --category diff --layer functional
 *   benchwright --subject tl-commit --layer ablation
 *   benchwright --subject tl-commit --case conventional-feat
 *   benchwright --resume            # continue a run that was killed
 *
 * Three layers, cheapest first:
 *   trigger    — does the description route the right queries here? (no workspace, ~1 call/query)
 *   functional — does the subject produce the right artifact? (fixture + graders)
 *   ablation   — same cases with and without the subject, to see what it is actually buying
 *
 * Everything a finished unit of work produces is streamed to
 * `<out>/result.jsonl` immediately, and result.json / report.html are derived
 * from that stream — so a run killed halfway still leaves its results behind
 * and can be continued with `--resume`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { check, findConfig, loadConfig, resolveSubjects } from './config.mjs';
import { ALL_LAYERS, validateSubject } from './subjects.mjs';
import { buildWorkspace, snapshot } from './fixtures.mjs';
import { checkAgentBinary } from './agent.mjs';
import { gradeCase } from './graders.mjs';
import { runFunctionalLayer, runTriggerLayer } from './runner.mjs';
import * as report from './report.mjs';

export function parseArgs(argv) {
  const out = {
    config: null, subjects: [], categories: [], layers: [], tags: [], cases: [], all: false, runs: null, model: null, judgeModel: null,
    out: null, keep: false, threshold: null, list: false, check: false, buildOnly: false, gradeOnly: null, concurrency: null, resume: false, resumeDir: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--config') out.config = next();
    else if (a === '--subject' || a === '--skill') out.subjects.push(next());
    else if (a === '--category') out.categories.push(next());
    else if (a === '--layer') out.layers.push(next());
    else if (a === '--tag') out.tags.push(next());
    else if (a === '--case') out.cases.push(next());
    else if (a === '--all') out.all = true;
    else if (a === '--runs') out.runs = Number(next());
    else if (a === '--model') out.model = next();
    else if (a === '--judge-model') out.judgeModel = next();
    else if (a === '--out') out.out = next();
    else if (a === '--concurrency') out.concurrency = Number(next());
    else if (a === '--threshold') out.threshold = Number(next());
    else if (a === '--keep') out.keep = true;
    else if (a === '--list') out.list = true;
    else if (a === '--check') out.check = true;
    else if (a === '--build-only') out.buildOnly = true;
    else if (a === '--grade-only') out.gradeOnly = next();
    else if (a === '--resume') {
      // `--resume` alone continues the newest run; `--resume <dir>` names one.
      out.resume = true;
      if (argv[i + 1] && !argv[i + 1].startsWith('--')) out.resumeDir = next();
    } else if (a === '-h' || a === '--help') out.help = true;
    else throw new UsageError(`unknown argument: ${a}`);
  }
  return out;
}

class UsageError extends Error {}

export const HELP = `benchwright — benchmark what you hand an agent, with and without it

  --config <file>           Config to use (default: discovered, see README)
  --list                    Show every subject, its category, layers, case count and case ids
  --check                   Validate the config, the registry and every case file; no paid calls. Exit 1 on problems.
  --subject <id>            Benchmark this subject (repeatable; --skill is an alias)
  --category <name>         Benchmark every subject in this category (repeatable)
  --case <id>               Only this case id (repeatable; combines with the filters above)
  --all                     Benchmark every non-exempt subject
  --layer <trigger|functional|ablation>   Which layer to run (repeatable; default: trigger + functional)
  --tag <tag>               Only cases carrying this tag
  --runs <n>                Runs per case AND per trigger query (default: case.runs, else config default)
                            Anything below ${report.RELIABLE_RUNS} is reported as a thin sample, not a measurement.
  --model <model>           Model under test (default: config default)
  --judge-model <model>     LLM-judge model (default: config default)
  --concurrency <n>         Parallel cases (default: config default, 2). Use 1 on a loaded machine.
  --threshold <0..1>        Exit 1 if any benchmarked subject scores below this
                            NOTE: piping (\`| tail -40\`) returns the PIPE's exit code, not this one.
  --out <dir>               Results dir (default: <root>/bench-results/<timestamp>/)
  --resume [dir]            Continue a killed run: skip everything already in <dir>/result.jsonl
                            (default: the newest directory under bench-results/)
  --keep                    Keep the temp workspaces for debugging

Grader authoring (no agent, no cost):
  --build-only              Build the selected cases' workspaces (with-arm) under --out and stop
  --grade-only <workdir>    Run one case's deterministic graders against an existing directory
                            (needs exactly one --subject and one --case)

Output (written as the run goes, not at the end):
  <out>/result.jsonl        append-only stream — one line per finished trigger call / case
  <out>/result.json         derived from the stream
  <out>/report.html         derived from the stream
`;

function selectSubjects(subjects, args) {
  const active = subjects.filter((s) => !s.exempt);
  if (args.all) return active;
  return active.filter((s) => args.subjects.includes(s.id) || args.categories.includes(s.category));
}

/** Newest bench-results/<timestamp>/ directory, for a bare `--resume`. */
function latestResultsDir(base) {
  if (!fs.existsSync(base)) return null;
  const dirs = fs
    .readdirSync(base)
    .map((d) => path.join(base, d))
    .filter((d) => fs.existsSync(path.join(d, 'result.jsonl')))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return dirs[0] ?? null;
}

/** A typo in `--case` should cost nothing; catch it before the first paid call. */
function validateCaseFilter(subjects, args) {
  if (!args.cases.length) return;
  const available = new Set();
  for (const s of subjects) {
    for (const c of s.trigger) available.add(c.id);
    for (const c of s.cases) available.add(c.id);
  }
  const unknown = args.cases.filter((id) => !available.has(id));
  if (!unknown.length) return;
  throw new UsageError(
    `unknown --case id(s): ${unknown.join(', ')}\navailable in the selected subject(s): ${[...available].sort().join(', ') || '(none)'}`,
  );
}

function printProblems(problems, configPath) {
  console.error(`\nProblems (${configPath}):`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('');
}

/**
 * A benchmark run is one more agent session per case, each with its own MCP
 * servers, and two of them at once by default. On a loaded workstation that
 * has killed the runner twice before a single case finished. Say so up front.
 */
function warnIfLowMemory(concurrency) {
  const freeGb = os.freemem() / 1024 ** 3;
  if (concurrency > 1 && freeGb < 2) {
    console.warn(`\n!! ${freeGb.toFixed(1)} GB free memory with --concurrency ${concurrency}. Each case is a full agent session;`);
    console.warn('   on a loaded machine the OS kills the runner. Consider --concurrency 1. A killed run resumes with --resume.');
  }
}

export async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (args.help) {
    console.log(HELP);
    return;
  }

  const configPath = args.config ? path.resolve(args.config) : findConfig();
  if (!configPath) {
    console.error('No config found. Pass --config <file>, set BENCHWRIGHT_CONFIG, add { "benchwright": { "config": "…" } } to package.json, or create benchwright.config.mjs.');
    process.exit(2);
  }
  const config = await loadConfig(configPath);
  const defaults = config.defaults;

  if (args.check) {
    const { subjects, problems } = await check(config);
    if (problems.length) {
      printProblems(problems, configPath);
      process.exit(1);
    }
    const cases = subjects.reduce((n, s) => n + s.cases.length, 0);
    const trig = subjects.reduce((n, s) => n + s.trigger.length, 0);
    console.log(`ok: ${subjects.length} subject(s), ${cases} functional case(s), ${trig} trigger query(ies) — ${configPath}`);
    return;
  }

  const { subjects, problems } = await resolveSubjects(config);
  if (problems.length) {
    printProblems(problems, configPath);
    process.exit(2);
  }

  if (args.list) {
    printList(subjects, config);
    return;
  }

  const selected = selectSubjects(subjects, args);
  if (!selected.length) {
    console.error('No subjects selected. Use --subject, --category or --all (see --list).');
    process.exit(2);
  }
  try {
    validateCaseFilter(selected, args);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }

  // Cases are validated for the selection only, but before anything is paid for.
  const caseProblems = selected.flatMap((s) => validateSubject(s));
  if (caseProblems.length) {
    printProblems(caseProblems, configPath);
    process.exit(2);
  }

  const layers = args.layers.length ? args.layers : ['trigger', 'functional'];
  for (const l of layers) {
    if (!ALL_LAYERS.includes(l)) {
      console.error(`unknown layer "${l}" (expected: ${ALL_LAYERS.join(', ')})`);
      process.exit(2);
    }
  }

  if (args.gradeOnly) return gradeOnly(selected, args, defaults);
  if (args.buildOnly) return buildOnly(selected, args, defaults, config);

  const preflight = checkAgentBinary();
  if (!preflight.ok) {
    console.error(`agent CLI not available: ${preflight.error}\nInstall Claude Code or point BENCHWRIGHT_CLAUDE at the binary.`);
    process.exit(2);
  }

  const startedAt = new Date().toISOString();
  const stamp = startedAt.replace(/[:.]/g, '-');
  let outDir;
  if (args.resume) {
    outDir = args.resumeDir ? path.resolve(args.resumeDir) : args.out ? path.resolve(args.out) : latestResultsDir(config.resultsDir);
    if (!outDir) {
      console.error(`--resume: no previous run found under ${config.resultsDir}. Pass a directory: --resume <dir>`);
      process.exit(2);
    }
  } else {
    outDir = args.out ? path.resolve(args.out) : path.join(config.resultsDir, stamp);
  }
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'benchwright-'));

  const stream = report.openRun(outDir, {
    title: config.title,
    startedAt,
    layers,
    model: args.model ?? defaults.model,
    judgeModel: args.judgeModel ?? defaults.judgeModel,
    subjects: selected.map((s) => s.id),
    filters: { subjects: args.subjects, categories: args.categories, tags: args.tags, cases: args.cases, all: args.all },
    runs: args.runs ?? null,
  });

  console.log(`\n${config.title}  ${selected.length} subject(s) - layers: ${layers.join(', ')}  (${preflight.version})`);
  console.log(`results:    ${outDir}${stream.resumedRecords ? `  (resuming: ${stream.resumedRecords} unit(s) already done)` : ''}`);
  console.log(`workspaces: ${tmpRoot}${args.keep ? ' (kept)' : ''}`);
  if (layers.includes('functional') || layers.includes('ablation')) warnIfLowMemory(args.concurrency ?? defaults.concurrency ?? 2);

  // A killed run used to lose everything it had computed. Now the stream is
  // already on disk; this only rebuilds the derived files before leaving.
  let stopping = false;
  const onSignal = (sig) => {
    if (stopping) process.exit(130);
    stopping = true;
    console.log(`\n${sig} - stopping. Rebuilding the report from what finished...`);
    try {
      stream.finalize(false);
      console.log(`\npartial report: ${stream.htmlPath}\njson:           ${stream.jsonPath}\nstream:         ${stream.jsonlPath}`);
      console.log(`continue with:  benchwright ... --resume ${outDir}\n`);
    } catch (err) {
      console.error(`could not finalize: ${err.message}`);
    }
    process.exit(130);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  process.on('SIGBREAK', onSignal);

  try {
    // Subjects whose layers are restricted (interactive ones) opt out here, not at the call site.
    const forLayer = (layer) => selected.filter((s) => s.layers.includes(layer));

    if (layers.includes('trigger')) {
      await runTriggerLayer(forLayer('trigger'), args, defaults, stream);
    }
    if (layers.includes('functional') || layers.includes('ablation')) {
      const wantAblation = layers.includes('ablation');
      const sections = [];
      if (layers.includes('functional')) sections.push('functional');
      if (wantAblation) sections.push('ablation');
      await runFunctionalLayer(forLayer(wantAblation ? 'ablation' : 'functional'), args, defaults, tmpRoot, { sections }, stream);
    }
  } finally {
    if (!args.keep) fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  const result = stream.finalize(true);

  if (layers.includes('trigger')) report.printTriggerSummary(result.trigger ?? []);
  if (layers.includes('functional')) report.printFunctionalSummary(result.functional ?? []);
  if (layers.includes('ablation')) report.printAblationSummary(result.ablation ?? []);
  report.printTotals(result.totals);
  report.printReliabilityBanner(result);
  const faults = report.printHarnessFaults(stream.records);

  console.log(`\nreport: ${stream.htmlPath}\njson:   ${stream.jsonPath}\nstream: ${stream.jsonlPath}\n`);

  if (args.threshold !== null) {
    const failing = (result.functional ?? []).filter((f) => f.score < args.threshold);
    const failingTrigger = (result.trigger ?? []).filter((t) => t.accuracy < args.threshold);
    if (failing.length || failingTrigger.length || faults) {
      for (const f of failing) console.error(`below threshold: ${f.subject} functional ${report.pct(f.score)} < ${report.pct(args.threshold)}`);
      for (const t of failingTrigger) console.error(`below threshold: ${t.subject} trigger ${report.pct(t.accuracy)} < ${report.pct(args.threshold)}`);
      if (faults) console.error(`harness faults: ${faults} — this run is not a result`);
      process.exit(1);
    }
  }
}

/**
 * `--build-only`: the fixture, exactly as the runner builds it, with nothing
 * run in it. The first step of checking a grader by hand — do the work the
 * subject should do in one copy, leave a realistic failure in another, then
 * `--grade-only` each.
 */
function buildOnly(selected, args, defaults, config) {
  const base = args.out ? path.resolve(args.out) : path.join(config.resultsDir, `workspaces-${Date.now()}`);
  const built = [];
  for (const subject of selected) {
    let cases = subject.cases;
    if (args.cases.length) cases = cases.filter((c) => args.cases.includes(c.id));
    if (args.tags.length) cases = cases.filter((c) => c.tags.some((t) => args.tags.includes(t)));
    for (const testCase of cases) {
      const workdir = path.join(base, `${subject.id}__${testCase.id}`);
      buildWorkspace({ subject, testCase, workdir, arm: 'with', defaults });
      built.push({ subject: subject.id, id: testCase.id, workdir });
    }
  }
  if (!built.length) {
    console.error('nothing to build: no functional cases matched');
    process.exit(2);
  }
  console.log(`\nbuilt ${built.length} workspace(s):`);
  for (const b of built) console.log(`  ${b.subject} / ${b.id}\n    ${b.workdir}`);
  console.log(`\ngrade one with:  benchwright --subject <id> --case <id> --grade-only <workdir>\n`);
  // Mock HTTP servers started for `mcp` fixtures are reaped on exit; a
  // built-only workspace is for hand inspection, not for talking to mocks.
}

/**
 * `--grade-only <dir>`: run a case's rule graders against a directory. Graders
 * that need a run record (llm, output_matches, tool_used, no_writes) are listed
 * as needing one — they cannot be checked without an agent.
 */
async function gradeOnly(selected, args, defaults) {
  if (selected.length !== 1 || args.cases.length !== 1) {
    console.error('--grade-only needs exactly one --subject and one --case');
    process.exit(2);
  }
  const subject = selected[0];
  const testCase = subject.cases.find((c) => c.id === args.cases[0]);
  if (!testCase) {
    console.error(`${subject.id}: no functional case "${args.cases[0]}"`);
    process.exit(2);
  }
  const workdir = path.resolve(args.gradeOnly);
  if (!fs.existsSync(workdir)) {
    console.error(`workdir does not exist: ${workdir}`);
    process.exit(2);
  }

  const needsRun = new Set(['llm', 'output_matches', 'tool_used', 'no_writes']);
  const graders = testCase.graders.filter((g) => !needsRun.has(g.type));
  const skipped = testCase.graders.filter((g) => needsRun.has(g.type));
  const run = { transcript: '', toolCalls: [], toolsUsed: [], skillsUsed: [], costUsd: null, durationMs: 0 };
  const files = snapshot(workdir);
  const graded = await gradeCase({ graders, run, workdir, files, prompt: testCase.prompt, judgeModel: defaults.judgeModel });

  console.log(`\n${subject.id} / ${testCase.id}  against ${workdir}`);
  for (const gr of graded.graders) {
    console.log(`  ${gr.pass ? 'v' : 'x'} [${gr.type}] ${String(gr.label).slice(0, 90)}`);
    if (gr.why) console.log(`      ${gr.why.slice(0, 120)}`);
  }
  for (const g of skipped) console.log(`  - [${g.type}] ${String(g.criterion ?? g.pattern ?? g.tool ?? g.type).slice(0, 90)}  (needs an agent run)`);
  console.log(`\n  rule graders: ${graded.graders.filter((g) => g.pass).length}/${graded.graders.length} pass\n`);
  if (graded.graders.some((g) => !g.pass)) process.exit(1);
}

function printList(subjects, config) {
  const byCat = new Map();
  for (const s of subjects) {
    const key = s.exempt ? 'exempt' : (s.category ?? 'uncategorised');
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key).push(s);
  }
  for (const [cat, items] of byCat) {
    const def = config.categories[cat];
    const note = def?.fixture ? `  -- ${def.fixture}` : cat === 'exempt' ? '  -- not benchmarked' : cat === 'uncategorised' ? '  -- trigger only: no category, no workspace' : '';
    console.log(`
${cat}${note}`);
    for (const s of items.sort((a, b) => a.id.localeCompare(b.id))) {
      if (s.exempt) {
        console.log(`  ${s.id.padEnd(30)} ${s.exemptReason ?? ''}`);
        continue;
      }
      const layers = s.layers.length === ALL_LAYERS.length ? 'all' : s.layers.join('+') || 'none';
      const desc = s.description ? '' : '  (no description: trigger skipped)';
      console.log(`  ${s.id.padEnd(30)} trigger:${String(s.trigger.length).padStart(2)}  functional:${String(s.cases.length).padStart(2)}  layers:${layers}${desc}`);
      // The ids `--case` takes, so you never have to open the case file to find one.
      if (s.cases.length) console.log(`  ${' '.repeat(30)} --case ${s.cases.map((c) => c.id).join(' | ')}`);
    }
  }
  console.log('');
}
