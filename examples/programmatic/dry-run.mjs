// Example 4b — the pipeline without an agent, through the public API.
//
// This is what `--build-only` and `--grade-only` do, as three function calls:
// build the workspace exactly as the runner would, take a snapshot, grade.
// No agent CLI is spawned and nothing is paid for, so it runs anywhere:
//
//   node examples/programmatic/dry-run.mjs
//
// It grades the `changelog / unreleased-from-commits` case twice: first on the
// untouched fixture (the graders must FAIL — a grader that passes on an empty
// workspace measures nothing), then after doing the skill's work by hand (they
// must PASS). Graders that need a transcript or a judge (`llm`, `tool_used`,
// `no_writes`, `output_matches`) are left out, the way `--grade-only` does.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorkspace, gradeCase, loadConfig, resolveSubjects, snapshot } from '../../index.mjs'; // in your project: from 'benchwright'

const config = await loadConfig(fileURLToPath(new URL('../skill/benchwright.config.mjs', import.meta.url)));
const { subjects, problems } = await resolveSubjects(config);
if (problems.length) throw new Error(problems.join('\n'));

const subject = subjects.find((s) => s.id === 'changelog');
const testCase = subject.cases.find((c) => c.id === 'unreleased-from-commits');

// Rule graders only; a stub run stands in for the transcript they never read.
const NEEDS_AGENT = new Set(['llm', 'tool_used', 'no_writes', 'output_matches']);
const graders = testCase.graders.filter((g) => !NEEDS_AGENT.has(g.type));
const run = { transcript: '', toolCalls: [], toolsUsed: [], skillsUsed: [], costUsd: null, durationMs: 0 };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'benchwright-example-'));
try {
  // `arm: 'with'` runs the subject's install (the skill lands in the harness's
  // skills directory); `excludes` are the paths the graders must not see.
  const { workdir, excludes } = buildWorkspace({ subject, testCase, workdir: path.join(tmp, 'ws'), arm: 'with', defaults: config.defaults });

  const grade = async (label) => {
    const files = snapshot(workdir, excludes);
    const { graders: results, score } = await gradeCase({ graders, run, workdir, files, prompt: testCase.prompt });
    console.log(`\n${label}: ${results.filter((g) => g.pass).length}/${results.length} rule graders pass (score ${score.toFixed(2)})`);
    for (const g of results) console.log(`  ${g.pass ? 'v' : 'x'} [${g.type}] ${g.label}  — ${g.why}`);
    return score;
  };

  const before = await grade('untouched fixture');

  // The work the skill is supposed to do, done by hand.
  fs.writeFileSync(
    path.join(workdir, 'CHANGELOG.md'),
    ['# Changelog', '', '## [Unreleased]', '', '### Added', '', '- Retry a failed upload three times', '', '### Fixed', '', '- Close the connection on timeout', ''].join('\n'),
  );

  const after = await grade('after the work');

  if (before >= after) throw new Error('a grader that scores the same before and after the work measures nothing');
  // One grader passed in both states: `git rev-list --count HEAD`. The empty
  // workspace trivially satisfies "did not commit", so the failure it catches
  // is a different one — the skill committing — and that is what to try when
  // you check it by hand. Every grader should have one failure it catches;
  // write down which.
  console.log('\nok: the file graders fail on the untouched fixture and pass after the work');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
