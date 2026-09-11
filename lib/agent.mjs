/**
 * Agent invocation — one headless case run, the LLM judge and the trigger
 * classifier, each through a harness adapter (see lib/harness/).
 *
 * Everything the benchmark knows about a run comes back through this module:
 * the transcript, the tools that fired, and the wall time. The adapter says
 * which binary to spawn, with which arguments, and how to read its output back
 * into the canonical events; nothing here knows a CLI's flags or its format.
 *
 * The runner never talks to an API itself. It shells out to the installed
 * agent CLI, so a run uses whatever authorization that CLI already has — no
 * API key is read anywhere. `BENCHWRIGHT_CLAUDE` / `BENCHWRIGHT_OPENCODE` /
 * `BENCHWRIGHT_CODEX` swap the binaries.
 */
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getHarness, resolveBinary } from './harness/index.mjs';

/** The Claude Code binary, kept for consumers that read it; adapters carry their own `binary`. */
export const CLAUDE = getHarness('claude').binary;

/**
 * Fail fast, before the first workspace is built, when the CLI is missing.
 * Without this every case "runs", every grader fails, and the report reads as a
 * subject at 0% instead of a machine without the harness on PATH.
 */
export function checkAgentBinary(harness) {
  const h = getHarness(harness);
  const { file, prefix, unresolved } = resolveBinary(h.binary);
  if (unresolved) return { ok: false, error: unresolved };
  try {
    const out = execFileSync(file, [...prefix, '--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000, windowsHide: true });
    return { ok: true, version: out.trim().split('\n')[0] };
  } catch (err) {
    return { ok: false, error: `${h.binary}: ${String(err.message).split('\n')[0]}` };
  }
}

/**
 * A timed-out CLI must take its children with it: a Node launcher's native
 * binary, the MCP servers a session spawned. `child.kill` alone leaves those
 * running — still spending tokens — on Windows, where there is no process group.
 */
function killTree(child) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
  } else {
    child.kill('SIGKILL');
  }
}

function run(harness, { args, input, env }, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const { file, prefix } = resolveBinary(harness.binary);
    const child = spawn(file, [...prefix, ...args], {
      cwd,
      env: { ...process.env, ...(env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
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
 * Judge and classifier calls run in an empty directory of their own, never in
 * the consumer's project: a CLI loads the instructions, skills and MCP servers
 * of whatever directory it starts in, and a judge that has just booted the
 * project's own MCP servers and read its rules file is grading with inputs the
 * case never declared.
 */
let promptDir = null;
function promptCwd() {
  if (!promptDir) {
    promptDir = path.join(os.tmpdir(), 'benchwright-prompt');
    fs.mkdirSync(promptDir, { recursive: true });
  }
  return promptDir;
}

/**
 * Run one case in a prepared workspace. The adapter's event stream says which
 * tools fired — that is how a `tool_used` grader knows the subject actually
 * loaded rather than the base model improvising the same answer.
 *
 * `systemPrompt` (the autopilot text) goes through the harness's system-prompt
 * channel when it has one; otherwise it is prepended to the prompt. Either way
 * both ablation arms receive it identically.
 */
export async function runCase({ harness, prompt, cwd, model, maxTurns, timeoutSeconds = 300, allowedTools, systemPrompt }) {
  const h = getHarness(harness);
  const prepend = h.systemPromptMode === 'prepend' && Boolean(systemPrompt);
  const command = h.caseCommand({
    prompt: prepend ? `${systemPrompt}\n\n${prompt}` : prompt,
    model: model ?? h.defaults.model ?? null,
    maxTurns,
    systemPrompt: prepend ? undefined : systemPrompt,
    allowedTools,
    cwd,
  });

  const started = Date.now();
  const res = await run(h, command, { cwd, timeoutMs: timeoutSeconds * 1000 });
  const events = h.parseEvents(res.stdout, { cwd });
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
export async function judge({ harness, criterion, prompt, transcript, toolCalls, autopilot, files, model, timeoutSeconds = 120 }) {
  const h = getHarness(harness);
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

  const cwd = promptCwd();
  const command = h.promptCommand({ model: model ?? h.defaults.judgeModel ?? null, prompt: body, cwd });
  const res = await run(h, command, { cwd, timeoutMs: timeoutSeconds * 1000 });
  const text = h.promptText(res.stdout);
  const match = text.match(/\{[\s\S]*"verdict"[\s\S]*?\}/);
  if (!match) return { pass: false, why: `judge returned no verdict: ${(text || res.stdout).slice(0, 120)}`, error: true };
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

export async function classifyTrigger({ harness, name, description, query, model, timeoutSeconds = 120 }) {
  const h = getHarness(harness);
  const body = TRIGGER_PROMPT.replace('{name}', name).replace('{description}', description).replace('{query}', query);
  const cwd = promptCwd();
  const command = h.promptCommand({ model: model ?? h.defaults.judgeModel ?? null, prompt: body, cwd });
  const res = await run(h, command, { cwd, timeoutMs: timeoutSeconds * 1000 });
  const text = h.promptText(res.stdout).toUpperCase();
  if (/\bYES\b/.test(text)) return { triggered: true };
  if (/\bNO\b/.test(text)) return { triggered: false };
  return { triggered: false, error: `unparseable: ${(text || res.stdout).slice(0, 80)}` };
}

function truncate(s, n) {
  return s.length <= n ? s : `${s.slice(0, n)}\n…[truncated]`;
}
