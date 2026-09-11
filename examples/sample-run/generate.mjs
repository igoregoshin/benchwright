// Produces the files in this directory: what a finished run of the `changelog`
// example looks like, without spending a token.
//
//   node examples/sample-run/generate.mjs [out-dir]
//
// The RECORDS below are written by hand — they are illustrative, not measured.
// They were chosen to show every shape a real run can print: a missed trigger
// query, one that flips between runs, a grader failing in the with-arm, and
// the ablation cells with a deletion candidate. Everything else is real: the
// records go through the same `openRun` / `finalize` the runner uses, which
// writes result.jsonl, rebuilds result.json and report.html from it, and the
// console text is what the runner's own printers produce for that result.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRun, printAblationSummary, printFunctionalSummary, printHarnessFaults, printReliabilityBanner, printTotals, printTriggerSummary, writeHtml, writeJson } from '../../lib/report.mjs';

const outDir = path.resolve(process.argv[2] ?? path.dirname(fileURLToPath(import.meta.url)));
for (const f of ['result.jsonl', 'result.json', 'report.html', 'console.txt']) fs.rmSync(path.join(outDir, f), { force: true });

const startedAt = '2026-09-10T14:02:11.000Z';
const stream = openRun(outDir, {
  title: 'examples — a skill directory',
  startedAt,
  layers: ['trigger', 'functional', 'ablation'],
  harness: 'claude',
  model: null,
  judgeModel: null,
  subjects: ['changelog'],
  filters: { subjects: ['changelog'], categories: [], tags: [], cases: [], all: false },
  runs: 3,
});

// ── trigger: 6 queries × 3 runs ──────────────────────────────────────────────
// Query 2 is missed (two of three runs did not route here); query 3 flips but
// still carries the majority. Both are printed under the subject's line.
const queries = [
  ['update the changelog for the next release', true, [true, true, true]],
  ['write release notes from the commits since the last tag', true, [false, false, true]],
  ['add the recent fixes to CHANGELOG.md', true, [true, true, false]],
  ['commit these changes with a good message', false, [false, false, false]],
  ['bump the version in package.json', false, [false, false, false]],
  ['summarize this pull request for the reviewer', false, [false, false, false]],
];
queries.forEach(([query, shouldTrigger, actuals], qi) => {
  actuals.forEach((actual, run) => {
    stream.append({ kind: 'trigger', subject: 'changelog', category: 'repo', queryId: `trigger-${qi + 1}`, query, shouldTrigger, run, actual, error: null, durationMs: 2400 + run * 310 + qi * 47 });
  });
});

// ── functional + ablation: 2 cases × 3 runs per arm ─────────────────────────
const grader = (type, label, pass, why, extra = {}) => ({ id: extra.id ?? label, type, weight: 1, withOnly: false, label, pass, why, ...extra });

// Case 1: the skill passes everything; the base model already creates the file
// and never commits, so those two graders are deletion candidates — they do
// not tell the skill apart from nothing.
stream.append({
  kind: 'case',
  subject: 'changelog',
  category: 'repo',
  sections: ['functional', 'ablation'],
  id: 'unreleased-from-commits',
  source: 'bench.yaml',
  score: 1,
  graders: [
    grader('file_exists', 'CHANGELOG.md', true, 'found CHANGELOG.md', { id: 'g1' }),
    grader('file_matches', 'CHANGELOG.md', true, 'CHANGELOG.md matches', { id: 'g2' }),
    grader('file_matches', 'CHANGELOG.md', true, 'CHANGELOG.md matches', { id: 'g3' }),
    grader('file_matches', 'CHANGELOG.md', true, 'CHANGELOG.md matches', { id: 'g4' }),
    grader('command', "grep -c 'bump' CHANGELOG.md", true, 'output matches (exit 1)', { id: 'g5' }),
    grader('command', 'git rev-list --count HEAD', true, 'output matches', { id: 'g6' }),
    grader('llm', 'Every bullet under Unreleased describes one commit from the history in the imperative mood and carries no "feat:" / "fix:" prefix.', true, 'PASS: three bullets, each maps to a commit, no type prefixes', { id: 'g7' }),
    grader('tool_used', 'Skill', true, 'Skill changelog invoked', { id: 'g8', withOnly: true }),
  ],
  runs: 3,
  agentRuns: 6,
  costUsd: 0.4173,
  durationMs: 214_800,
  withScore: 1,
  withoutScore: 0.5714,
  delta: 0.4286,
  deletionCandidates: ['CHANGELOG.md', 'git rev-list --count HEAD'],
});

// Case 2: the with-arm put Unreleased BELOW the released section in one run,
// so one grader fails and the case scores below 1; the base model did that
// in every run and also dropped the released section.
stream.append({
  kind: 'case',
  subject: 'changelog',
  category: 'repo',
  sections: ['functional', 'ablation'],
  id: 'keeps-released-sections',
  source: 'bench.yaml',
  score: 0.8889,
  graders: [
    grader('file_matches', 'CHANGELOG.md', true, 'CHANGELOG.md matches', { id: 'g1' }),
    grader('file_matches', 'CHANGELOG.md', true, 'CHANGELOG.md matches', { id: 'g2' }),
    grader('command', "grep -m1 '^## ' CHANGELOG.md", false, 'output does not match /Unreleased/: ## [1.1.0] - 2026-08-20', { id: 'g3' }),
    grader('command', "grep -c 'chunk size' CHANGELOG.md", true, 'output matches (exit 1)', { id: 'g4' }),
    grader('command', 'git rev-list --count HEAD', true, 'output matches', { id: 'g5' }),
    grader('llm', 'The bullet about the empty file is under Unreleased, and the 1.1.0 section is unchanged.', true, 'PASS: the 1.1.0 section is byte-identical; the new bullet sits under Unreleased', { id: 'g6' }),
    grader('tool_used', 'Skill', true, 'Skill changelog invoked', { id: 'g7', withOnly: true }),
  ],
  runs: 3,
  agentRuns: 6,
  costUsd: 0.3921,
  durationMs: 198_400,
  withScore: 0.8889,
  withoutScore: 0.3333,
  delta: 0.5556,
  deletionCandidates: ['git rev-list --count HEAD'],
});

const result = stream.finalize(true);
// A fixed finish time, so the sample does not change every time it is regenerated.
result.finishedAt = '2026-09-10T14:11:48.000Z';
result.totals.wallDurationMs = Date.parse(result.finishedAt) - Date.parse(startedAt);
writeJson(outDir, result);
writeHtml(outDir, result);

// The console summary, captured without colour codes.
const lines = [];
const original = console.log;
console.log = (...args) => lines.push(args.join(' ').replace(/\x1b\[[0-9;]*m/g, ''));
try {
  printTriggerSummary(result.trigger ?? []);
  printFunctionalSummary(result.functional ?? []);
  printAblationSummary(result.ablation ?? []);
  printTotals(result.totals);
  printReliabilityBanner(result);
  printHarnessFaults(stream.records);
} finally {
  console.log = original;
}
fs.writeFileSync(path.join(outDir, 'console.txt'), `${lines.join('\n').trim()}\n`);
console.log(`wrote result.jsonl, result.json, report.html and console.txt to ${outDir}`);
