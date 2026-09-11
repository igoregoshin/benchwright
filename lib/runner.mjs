/**
 * The three layers, cheapest first.
 *
 *   trigger    — does the description route the right queries here? (no workspace, ~1 call/query)
 *   functional — does the subject produce the right artifact? (fixture + graders)
 *   ablation   — same cases with and without the subject, to see what it is actually buying
 *
 * Every finished unit of work goes to the result stream immediately, so a run
 * killed halfway still leaves its results behind and can be continued with
 * `--resume` (see report.mjs).
 */
import path from 'node:path';
import { buildWorkspace, snapshot } from './fixtures.mjs';
import { classifyTrigger, runCase } from './agent.mjs';
import { gradeCase } from './graders.mjs';
import { getHarness } from './harness/index.mjs';

/**
 * Which harness drives a run and which models it uses. Precedence for a model:
 * the CLI flag, the case, the config default, then the harness's own default
 * (which may be null — "let the CLI decide"). `harness` may be a name or an
 * adapter; without one, `args.harness`, then `defaults.harness`, then Claude Code.
 */
export function resolveModels({ args = {}, testCase = null, defaults = {}, harness } = {}) {
  const h = getHarness(harness ?? args.harness ?? defaults.harness);
  return {
    harness: h,
    model: args.model ?? testCase?.model ?? defaults.model ?? h.defaults.model ?? null,
    judgeModel: args.judgeModel ?? defaults.judgeModel ?? h.defaults.judgeModel ?? null,
  };
}

export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        results[i] = await fn(items[i], i);
      }
    }),
  );
  return results;
}

/**
 * Trigger layer. One classification per (query, run); `--runs` applies here too,
 * because a single classification per query is noise: three consecutive
 * single-run sweeps over an unchanged subject scored 92%, 83% and 100%. With
 * several runs a query's verdict is the majority and a query that flips between
 * runs is reported as unstable instead of quietly becoming a "regression".
 */
export async function runTriggerLayer(subjects, args, defaults, stream, { harness } = {}) {
  const { harness: h, judgeModel } = resolveModels({ args, defaults, harness });
  // Trigger is the cheapest layer and the noisiest one, so it gets its own
  // default instead of inheriting `runs: 1` from functional/ablation, which cost
  // real agent runs and cannot be tripled as cheaply.
  const runs = Math.max(1, args.runs ?? defaults.triggerRuns ?? defaults.runs ?? 1);
  const jobs = [];
  for (const subject of subjects) {
    let cases = subject.trigger;
    if (args.cases.length) cases = cases.filter((c) => args.cases.includes(c.id));
    if (!cases.length) continue;
    // A subject with nothing to route on cannot be triggered; skipping it here
    // is the honest outcome, and --list shows `trigger:N` so it is not silent.
    if (!subject.description) continue;
    for (const c of cases) {
      for (let run = 0; run < runs; run += 1) {
        if (stream.has(`trigger|${subject.id}|${c.id}|${run}`)) continue;
        jobs.push({ subject, c, run });
      }
    }
  }

  await mapLimit(jobs, Math.max(4, (args.concurrency ?? defaults.concurrency ?? 2) * 2), async (job) => {
    const started = Date.now();
    const res = await classifyTrigger({
      harness: h,
      name: job.subject.id,
      description: job.subject.description,
      query: job.c.query,
      model: judgeModel,
    });
    stream.append({
      kind: 'trigger',
      subject: job.subject.id,
      category: job.subject.category,
      queryId: job.c.id,
      query: job.c.query,
      shouldTrigger: job.c.shouldTrigger,
      run: job.run,
      actual: res.triggered,
      error: res.error ?? null,
      durationMs: Date.now() - started,
    });
  });
}

/**
 * Many subjects deliberately stop and ask the user (a task-number gate, an
 * approval gate). Headless there is nobody to answer, so the run would stall
 * and every grader would fail for a reason that has nothing to do with quality.
 *
 * Autopilot supplies the answers up front. It is appended identically to BOTH
 * ablation arms, so it can never be the thing that produces a delta.
 */
export function autopilotPrompt(testCase, defaults) {
  const answers = testCase.autopilot;
  if (!answers) return undefined;
  const list = Array.isArray(answers) ? answers : [answers];
  return [
    defaults.autopilotPreamble,
    ...list.map((a) => `- ${a}`),
    'If a question is not covered above, choose the most reasonable default, state the assumption, and keep going. Never stop to wait for input.',
  ].join('\n');
}

export async function runOneArm({ subject, testCase, args, defaults, arm, tmpRoot, harness }) {
  const { harness: h, model, judgeModel } = resolveModels({ args, testCase, defaults, harness });
  const workdir = path.join(tmpRoot, `${subject.id}__${testCase.id}__${arm}`);
  const { excludes } = buildWorkspace({ subject, testCase, workdir, arm, defaults, harness: h });

  const run = await runCase({
    harness: h,
    prompt: testCase.prompt,
    cwd: workdir,
    model,
    maxTurns: testCase.maxTurns,
    timeoutSeconds: testCase.timeoutSeconds,
    systemPrompt: autopilotPrompt(testCase, defaults),
  });

  const files = snapshot(workdir, excludes);
  const graded = await gradeCase({
    graders: testCase.graders,
    run,
    workdir,
    files,
    prompt: testCase.prompt,
    autopilot: testCase.autopilot,
    judgeModel,
    harness: h,
  });

  return { workdir, run, ...graded };
}

/** Sum of the arms that reported money; null when none did, so a tokens-only harness never reads as "$0". */
function costOf(arms) {
  const reported = arms.map((a) => a.run.costUsd).filter((c) => typeof c === 'number');
  return reported.length ? sum(reported) : null;
}

export async function runFunctionalLayer(subjects, args, defaults, tmpRoot, { sections, harness }, stream) {
  const ablation = sections.includes('ablation');
  for (const subject of subjects) {
    let cases = subject.cases;
    if (args.tags.length) cases = cases.filter((c) => c.tags.some((t) => args.tags.includes(t)));
    if (args.cases.length) cases = cases.filter((c) => args.cases.includes(c.id));
    cases = cases.filter((c) => !stream.has(`case|${subject.id}|${c.id}|${ablation ? 'ab' : 'fn'}`));
    if (!cases.length) continue;

    await mapLimit(cases, args.concurrency ?? defaults.concurrency ?? 2, async (testCase) => {
      const runs = args.runs ?? testCase.runs;
      const withArms = [];
      for (let i = 0; i < runs; i += 1) {
        withArms.push(await runOneArm({ subject, testCase, args, defaults, arm: 'with', tmpRoot: path.join(tmpRoot, `r${i}`), harness }));
      }
      const withScore = avg(withArms.map((a) => a.score));
      const record = {
        kind: 'case',
        subject: subject.id,
        category: subject.category,
        sections,
        id: testCase.id,
        source: testCase.source,
        score: withScore,
        graders: withArms[0].graders,
        runs,
        agentRuns: runs,
        costUsd: costOf(withArms),
        durationMs: sum(withArms.map((a) => a.run.durationMs)),
      };

      if (ablation) {
        const withoutArms = [];
        for (let i = 0; i < runs; i += 1) {
          withoutArms.push(await runOneArm({ subject, testCase, args, defaults, arm: 'without', tmpRoot: path.join(tmpRoot, `r${i}`), harness }));
        }
        const withoutScore = avg(withoutArms.map((a) => a.score));

        // A grader that passes in BOTH arms is not evidence the subject works.
        record.withScore = withScore;
        record.withoutScore = withoutScore;
        record.delta = withScore - withoutScore;
        record.deletionCandidates = withArms[0].graders
          .filter((gr, i) => !gr.withOnly && gr.pass && withoutArms[0].graders[i]?.pass)
          .map((gr) => gr.label);
        record.agentRuns = runs * 2;
        const withoutCost = costOf(withoutArms);
        record.costUsd = record.costUsd === null && withoutCost === null ? null : (record.costUsd ?? 0) + (withoutCost ?? 0);
        record.durationMs += sum(withoutArms.map((a) => a.run.durationMs));
      }

      // On disk the moment it is known — a kill after this point costs nothing.
      stream.append(record);
    });
  }
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
