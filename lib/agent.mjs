/**
 * Agent invocation — one headless `claude -p` run, plus the LLM judge.
 *
 * Everything the benchmark knows about a run comes back through this module:
 * the transcript, the tools that fired, and the wall time.
 *
 * The runner never talks to an API itself. It shells out to the installed
 * Claude Code CLI, so a run uses whatever authorization that CLI already has —
 * no API key is read anywhere. `BENCHWRIGHT_CLAUDE` swaps the binary.
 */
import { spawn, execFileSync } from 'node:child_process';

export const CLAUDE = process.env.BENCHWRIGHT_CLAUDE ?? 'claude';

/**
 * Fail fast, before the first workspace is built, when the CLI is missing.
 * Without this every case "runs", every grader fails, and the report reads as a
 * subject at 0% instead of a machine without the harness on PATH.
 */
export function checkAgentBinary() {
  try {
    const out = execFileSync(CLAUDE, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000, windowsHide: true });
    return { ok: true, version: out.trim().split('\n')[0] };
  } catch (err) {
    return { ok: false, error: `${CLAUDE}: ${String(err.message).split('\n')[0]}` };
  }
}

function run(args, { cwd, input, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(CLAUDE, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: String(err), timedOut: false });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, code, stdout, stderr, timedOut });
    });

    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

/**
 * Run one case in a prepared workspace. Uses stream-json so we can see which
 * tools fired — that is how a `tool_used` grader knows the subject actually
 * loaded rather than the base model improvising the same answer.
 */
export async function runCase({ prompt, cwd, model, maxTurns, timeoutSeconds, allowedTools, systemPrompt }) {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', model,
    '--max-turns', String(maxTurns),
    '--permission-mode', 'bypassPermissions',
    // Only the workspace's own settings and skills. Without this, a same-named
    // skill under the user's ~/.claude/skills/ shadows the one the fixture
    // installed, and the run measures whatever stale copy lives on the machine.
    '--setting-sources', 'project,local',
  ];
  if (allowedTools?.length) args.push('--allowedTools', ...allowedTools);
  if (systemPrompt) args.push('--append-system-prompt', systemPrompt);

  const started = Date.now();
  const res = await run(args, { cwd, input: prompt, timeoutMs: timeoutSeconds * 1000 });
  const events = parseStreamJson(res.stdout);
  const tools = events.filter((e) => e.type === 'tool');

  return {
    ok: res.ok,
    timedOut: res.timedOut,
    stderr: res.stderr,
    durationMs: Date.now() - started,
    /** The agent's own words plus `[tool: X]` markers — what `output_matches` sees. */
    transcript: renderTranscript(events),
    /** Every tool call with a one-line summary of its input — what the judge sees. */
    toolCalls: tools.map((e) => ({ name: e.name, summary: summarizeInput(e.name, e.input) })),
    toolsUsed: [...new Set(tools.map((e) => e.name))],
    skillsUsed: [...new Set(tools.filter((e) => e.name === 'Skill').map((e) => e.input?.skill).filter(Boolean))],
    costUsd: events.find((e) => e.type === 'result')?.costUsd ?? null,
  };
}

function parseStreamJson(stdout) {
  const events = [];
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let msg;
    try {
      msg = JSON.parse(t);
    } catch {
      continue;
    }
    if (msg.type === 'result') {
      events.push({ type: 'result', text: msg.result ?? '', costUsd: msg.total_cost_usd ?? null });
      continue;
    }
    for (const block of msg.message?.content ?? []) {
      if (block.type === 'text') events.push({ type: 'text', text: block.text });
      else if (block.type === 'tool_use') events.push({ type: 'tool', name: block.name, input: block.input });
    }
  }
  return events;
}

/**
 * Tool inputs stay OUT of the transcript on purpose: `output_matches` graders
 * assert on what the agent said, and a file path the agent merely `Read` would
 * otherwise satisfy a "mentions src/api.ts" pattern. The judge gets the inputs
 * separately, via `toolCalls`.
 */
export function renderTranscript(events) {
  return events
    .map((e) => {
      if (e.type === 'text') return e.text;
      if (e.type === 'tool') return `[tool: ${e.name}${e.name === 'Skill' ? ` ${e.input?.skill ?? ''}` : ''}]`;
      if (e.type === 'result') return e.text;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

/** One line per call: the command, the file, the skill — whatever identifies it. */
export function summarizeInput(name, input) {
  if (!input || typeof input !== 'object') return '';
  const pick = input.command ?? input.file_path ?? input.skill ?? input.pattern ?? input.url ?? null;
  const text = pick !== null ? String(pick) : JSON.stringify(input);
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

const JUDGE_PROMPT = `You are grading one criterion against the record of an agent run. Be strict and literal: judge only what the record shows, never what the agent probably meant or could have done.

<criterion>
{criterion}
</criterion>

<task_given_to_agent>
{prompt}
</task_given_to_agent>
{answers}
<agent_transcript>
{transcript}
</agent_transcript>

<tool_calls>
{tools}
</tool_calls>

<files_after_run>
{files}
</files_after_run>

Reply with a single line of JSON and nothing else:
{"verdict":"PASS"|"FAIL","why":"<one short sentence>"}`;

/**
 * LLM-as-judge for one criterion. Cheap model, single criterion per call.
 *
 * The judge sees three things the agent's plain output does not carry:
 *   - `toolCalls`: which commands and files the agent touched, so a criterion
 *     like "used the project script, not git directly" is decidable;
 *   - `autopilot`: the answers the harness gave on the user's behalf, so what
 *     the "user" said through autopilot is not graded as invented;
 *   - the files after the run.
 */
export async function judge({ criterion, prompt, transcript, toolCalls, autopilot, files, model, timeoutSeconds = 120 }) {
  const answers = autopilot && autopilot.length
    ? `\n<answers_the_user_gave_when_asked>\n${autopilot.map((a) => `- ${a}`).join('\n')}\n</answers_the_user_gave_when_asked>\n`
    : '';
  const tools = (toolCalls ?? []).length
    ? truncate((toolCalls ?? []).map((t) => `${t.name}: ${t.summary}`).join('\n'), 8000)
    : '(none recorded)';
  const body = JUDGE_PROMPT.replace('{criterion}', criterion)
    .replace('{prompt}', prompt ?? '')
    .replace('{answers}', answers)
    .replace('{transcript}', truncate(transcript ?? '', 24000))
    .replace('{tools}', tools)
    .replace('{files}', truncate(files ?? '(no files)', 24000));

  const res = await run(['-p', '--model', model], { input: body, timeoutMs: timeoutSeconds * 1000 });
  const match = res.stdout.match(/\{[\s\S]*"verdict"[\s\S]*?\}/);
  if (!match) return { pass: false, why: `judge returned no verdict: ${res.stdout.slice(0, 120)}`, error: true };
  try {
    const parsed = JSON.parse(match[0]);
    return { pass: parsed.verdict === 'PASS', why: parsed.why ?? '' };
  } catch {
    return { pass: false, why: 'judge returned unparseable JSON', error: true };
  }
}

/** Trigger classification: would this description route this query here? */
const TRIGGER_PROMPT = `A coding agent has this capability available:

name: {name}
description: {description}

The user says: "{query}"

Would the agent invoke THIS capability for that message? Judge only whether the message matches its stated purpose.

Reply with exactly one word: YES or NO`;

export async function classifyTrigger({ name, description, query, model, timeoutSeconds = 120 }) {
  const body = TRIGGER_PROMPT.replace('{name}', name).replace('{description}', description).replace('{query}', query);
  const res = await run(['-p', '--model', model], { input: body, timeoutMs: timeoutSeconds * 1000 });
  const text = res.stdout.toUpperCase();
  if (/\bYES\b/.test(text)) return { triggered: true };
  if (/\bNO\b/.test(text)) return { triggered: false };
  return { triggered: false, error: `unparseable: ${res.stdout.slice(0, 80)}` };
}

function truncate(s, n) {
  return s.length <= n ? s : `${s.slice(0, n)}\n…[truncated]`;
}
