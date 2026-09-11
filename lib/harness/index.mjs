/**
 * Harness adapters — one module per agent CLI, one canonical contract.
 *
 * Everything the rest of the runner needs from a CLI goes through an adapter:
 *
 *   name, title, envVar, binary          identity; `BENCHWRIGHT_<NAME>` overrides the binary
 *   defaults { model, judgeModel }       the harness's own defaults; null = "the CLI decides"
 *   systemPromptMode                     'flag' (a system-prompt channel) | 'prepend' (into the prompt)
 *   skillsDir                            where a project-level skill is read from (workspace-relative)
 *   harnessPaths                         what the harness itself puts into a workspace (hidden from git and graders)
 *   caseCommand({ prompt, model, maxTurns, systemPrompt, allowedTools, cwd }) → { args, input, env? }
 *   promptCommand({ model, prompt, cwd }) → { args, input, env? }  a plain prompt→text call
 *   promptText(stdout)                   the text answer of a prompt call
 *   parseEvents(stdout, { cwd })         → canonical events (below)
 *   writeMcpConfig(workdir, servers)     → workspace-relative paths written
 *
 * Canonical events, the contract every grader is written against:
 *
 *   { type: 'text',   text }
 *   { type: 'tool',   name, input }      Bash { command } · Write / Edit / Read { file_path } ·
 *                                        Skill { skill } · mcp__<server>__<tool> { …arguments }
 *   { type: 'result', text, costUsd }    costUsd is null when the CLI reports no money
 *
 * `lib/agent.mjs` spawns whatever the adapter says and never looks at a CLI's
 * output itself. Adding a CLI is one file here plus a row in the README table.
 */
import fs from 'node:fs';
import path from 'node:path';
import claude from './claude.mjs';
import opencode from './opencode.mjs';
import codex from './codex.mjs';

const ADAPTERS = { claude, opencode, codex };

export const HARNESSES = Object.keys(ADAPTERS);

/** The adapter for a name; an adapter object passes through; nothing means Claude Code. */
export function getHarness(name) {
  if (name === undefined || name === null || name === '') return claude;
  if (typeof name === 'object' && typeof name.caseCommand === 'function') return name;
  const adapter = ADAPTERS[String(name)];
  if (!adapter) throw new Error(`unknown harness "${name}" (expected one of ${HARNESSES.join(', ')})`);
  return adapter;
}

/**
 * What to spawn for a binary name.
 *
 * On Windows an npm-installed CLI is a `.cmd` shim, which `spawn` cannot run
 * without a shell — and a shell would have to re-quote JSON and TOML arguments
 * through cmd.exe. So the shim is read instead: npm writes either
 * `"%dp0%\…\bin.js" %*` (run it under this Node) or `"%dp0%\…\x.exe" %*` (run
 * the executable). A native `.exe` on PATH is used as is.
 */
const resolved = new Map();
export function resolveBinary(binary) {
  if (!resolved.has(binary)) resolved.set(binary, resolveOnce(binary));
  return resolved.get(binary);
}

function resolveOnce(binary) {
  if (process.platform !== 'win32') return { file: binary, prefix: [] };
  let file = binary;
  if (!path.extname(binary) && !/[\\/]/.test(binary)) {
    const found = findOnPath(binary);
    if (!found) return { file: binary, prefix: [] };
    file = found;
  }
  if (!/\.(cmd|bat)$/i.test(file)) return { file, prefix: [] };
  const shim = fs.readFileSync(file, 'utf8');
  const target = shim.match(/"%dp0%\\([^"]+)"\s+%\*/);
  if (!target) return { file, prefix: [], unresolved: `${file} is a shim benchwright cannot read; point ${binary} at the executable` };
  const entry = path.join(path.dirname(file), target[1]);
  if (/\.(mjs|cjs|js)$/i.test(entry)) return { file: process.execPath, prefix: [entry] };
  return { file: entry, prefix: [] };
}

function findOnPath(name) {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of ['.exe', '.cmd', '.bat']) {
      const candidate = path.join(dir, name + ext);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}
