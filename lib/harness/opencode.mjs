/**
 * OpenCode adapter — `opencode run`.
 *
 *   case run     opencode run --format json --dangerously-skip-permissions [-m provider/model]   (prompt on stdin)
 *   prompt call  opencode run --format json [-m provider/model]                                   (judge, classifier)
 *   skills       .opencode/skills/<name>/SKILL.md   (project scope)
 *   MCP          opencode.json { mcp: { <server>: { type: "local", command: [...] } } }
 *   events       --format json: `text`, `tool_use` (part.tool + part.state.input), `step_finish` (cost)
 *
 * Isolation: the CLI has no `--setting-sources`; the equivalent is pointing
 * `OPENCODE_CONFIG_DIR` at an empty directory, which drops the user's global
 * config (MCP servers, plugins, skills) while auth — kept in the data
 * directory — still applies. On the machine this was built on, two global MCP
 * servers stalled a case for over five minutes before this was added.
 * `BENCHWRIGHT_OPENCODE_CONFIG_DIR` names a directory to use instead (a trimmed
 * config with just a `provider` block, for a provider that needs one).
 *
 * The CLI has no system-prompt flag, so autopilot text is prepended to the
 * prompt (`systemPromptMode: 'prepend'`), and no turn limit, so `maxTurns` is
 * ignored; the timeout still applies.
 *
 * MCP tools are reported as `<server>_<tool>` — one underscore, ambiguous when
 * either name contains one — so `parseEvents` resolves them against the server
 * names in the workspace's own opencode.json.
 *
 * The working directory is passed explicitly, twice. The CLI takes its project
 * directory from the inherited `PWD` variable when one is set, not from the
 * process cwd: spawned from a shell that sat in another directory, a run
 * reported "Wrote file successfully" and left the file in that other
 * directory, with the workspace empty. `--dir` names the workspace and `PWD`
 * is overridden to match, so neither the CLI nor the model can be misled.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jsonLines, readJsonObject, writeJsonFile } from './shared.mjs';

const TOOLS = {
  bash: 'Bash',
  write: 'Write',
  edit: 'Edit',
  multiedit: 'Edit',
  patch: 'Edit',
  read: 'Read',
  glob: 'Glob',
  grep: 'Grep',
  list: 'LS',
  webfetch: 'WebFetch',
  websearch: 'WebSearch',
  todowrite: 'TodoWrite',
  todoread: 'TodoRead',
  task: 'Task',
  skill: 'Skill',
  question: 'AskUserQuestion',
};

function configDir() {
  const dir = process.env.BENCHWRIGHT_OPENCODE_CONFIG_DIR ?? path.join(os.tmpdir(), 'benchwright-opencode-config');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const dirArgs = (cwd) => (cwd ? ['--dir', cwd] : []);
const envFor = (cwd) => ({ OPENCODE_CONFIG_DIR: configDir(), ...(cwd ? { PWD: cwd } : {}) });

function readMcpServers(workdir) {
  if (!workdir) return [];
  return Object.keys(readJsonObject(path.join(workdir, 'opencode.json')).mcp ?? {});
}

function canonical(tool, input, servers) {
  const src = input && typeof input === 'object' ? input : {};
  const out = { ...src };
  if (src.filePath !== undefined) {
    out.file_path = src.filePath;
    delete out.filePath;
  }
  if (tool === 'skill' && src.name) out.skill = src.name;
  if (TOOLS[tool]) return { name: TOOLS[tool], input: out };
  // Longest server name first: `my_server_list_issues` must resolve to server
  // `my_server`, not to a server called `my`.
  const server = servers.filter((s) => tool.startsWith(`${s}_`)).sort((a, b) => b.length - a.length)[0];
  if (server) return { name: `mcp__${server}__${tool.slice(server.length + 1)}`, input: out };
  return { name: tool, input: out };
}

const opencode = {
  name: 'opencode',
  title: 'OpenCode',
  envVar: 'BENCHWRIGHT_OPENCODE',
  binary: process.env.BENCHWRIGHT_OPENCODE ?? 'opencode',
  /** `null` = whatever the CLI resolves on its own; a config value wins. */
  defaults: { model: null, judgeModel: null },
  systemPromptMode: 'prepend',
  skillsDir: '.opencode/skills',
  harnessPaths: ['.opencode/', 'opencode.json'],
  reportsSkills: true,
  /** Per-step `cost` in the event stream; a free model reports 0. */
  reportsCost: true,

  caseCommand({ prompt, model, cwd }) {
    const args = ['run', '--format', 'json', '--dangerously-skip-permissions', ...dirArgs(cwd)];
    if (model) args.push('-m', model);
    return { args, input: prompt, env: envFor(cwd) };
  },

  promptCommand({ model, prompt, cwd }) {
    const args = ['run', '--format', 'json', ...dirArgs(cwd)];
    if (model) args.push('-m', model);
    return { args, input: prompt, env: envFor(cwd) };
  },

  promptText(stdout) {
    return jsonLines(stdout)
      .filter((m) => m.type === 'text' && typeof m.part?.text === 'string')
      .map((m) => m.part.text)
      .join('\n');
  },

  parseEvents(stdout, { cwd } = {}) {
    const servers = readMcpServers(cwd);
    const events = [];
    let cost = null;
    for (const msg of jsonLines(stdout)) {
      const part = msg.part ?? {};
      if (msg.type === 'text' && typeof part.text === 'string') events.push({ type: 'text', text: part.text });
      else if (msg.type === 'tool_use' && part.tool) {
        const { name, input } = canonical(part.tool, part.state?.input, servers);
        events.push({ type: 'tool', name, input });
      } else if (msg.type === 'step_finish') cost = (cost ?? 0) + (Number(part.cost) || 0);
    }
    if (cost !== null) events.push({ type: 'result', text: '', costUsd: cost });
    return events;
  },

  writeMcpConfig(workdir, servers) {
    const file = path.join(workdir, 'opencode.json');
    const config = readJsonObject(file);
    config.$schema ??= 'https://opencode.ai/config.json';
    config.mcp = { ...(config.mcp ?? {}) };
    for (const [name, { command, args }] of Object.entries(servers)) {
      config.mcp[name] = { type: 'local', command: [command, ...args], enabled: true };
    }
    writeJsonFile(file, config);
    return ['opencode.json'];
  },
};

export default opencode;
