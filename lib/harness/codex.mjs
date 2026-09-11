/**
 * Codex CLI adapter — `codex exec`.
 *
 *   case run     codex exec --json --ignore-user-config --disable plugins --ephemeral --skip-git-repo-check
 *                --dangerously-bypass-approvals-and-sandbox [-m model] [-c developer_instructions="…"]
 *                [-c mcp_servers.<s>.command=… -c mcp_servers.<s>.args=[…]] -          (prompt on stdin)
 *   prompt call  codex exec --json … -s read-only [-m model] -                          (judge, classifier)
 *   skills       .agents/skills/<name>/SKILL.md   (repo scope; the CLI walks up to the git root)
 *   MCP          .codex/config.toml [mcp_servers.<server>] command / args
 *   events       --json JSONL: item.completed with agent_message / command_execution / file_change /
 *                mcp_tool_call / web_search; turn.completed with token usage only
 *
 * Isolation: `--ignore-user-config` drops the user's config.toml (model, MCP
 * servers, hooks, trust table) and `--disable plugins` drops installed plugins,
 * whose skills survive the first flag and hijacked a run before this was added.
 *
 * Trust is the catch: the project's .codex/config.toml is loaded but disabled
 * while the directory is untrusted, and the trust table lives in the user
 * config the run ignores. So the mock servers are written to the project file
 * (honoured whenever the directory IS trusted, and there for a human to read)
 * and re-asserted on the command line as `-c mcp_servers.*` overrides, which
 * apply regardless of trust.
 *
 * Skill loads are not reported as such: the model reads SKILL.md with a shell
 * command. A command that reads `<skillsDir>/<name>/SKILL.md` is therefore
 * reported as a `Skill` event as well as the `Bash` it was, so `tool_used: Skill`
 * graders can fire. Cost is not reported (tokens only), and there is no turn
 * limit, so `maxTurns` is ignored; the timeout still applies.
 */
import fs from 'node:fs';
import path from 'node:path';
import { jsonLines } from './shared.mjs';

const CONFIG_FILE = '.codex/config.toml';

/** A TOML basic string. JSON escaping is a subset of TOML's; DEL (U+007F) must be escaped too. */
const DEL = new RegExp(String.fromCharCode(0x7f), 'g');
function tomlString(s) {
  return JSON.stringify(String(s)).replace(DEL, '\\u007F');
}

function tomlKey(name) {
  return /^[A-Za-z0-9_-]+$/.test(name) ? name : tomlString(name);
}

/**
 * The servers this adapter wrote to .codex/config.toml. Only the shape written
 * by `writeMcpConfig` is understood: a `[mcp_servers.<name>]` table followed by
 * `command = "…"` and `args = […]` on single lines, strings in JSON-compatible
 * TOML basic-string syntax.
 */
function readMcpServers(workdir) {
  const file = workdir ? path.join(workdir, CONFIG_FILE) : null;
  if (!file || !fs.existsSync(file)) return {};
  const servers = {};
  let current = null;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    const header = line.match(/^\[mcp_servers\.(.+)\]$/);
    if (header) {
      const key = header[1];
      current = key.startsWith('"') ? safeJson(key) : key;
      if (current) servers[current] = { command: null, args: [] };
      continue;
    }
    if (line.startsWith('[')) {
      current = null;
      continue;
    }
    if (!current) continue;
    const kv = line.match(/^(command|args)\s*=\s*(.+)$/);
    if (!kv) continue;
    const value = safeJson(kv[2]);
    if (kv[1] === 'command' && typeof value === 'string') servers[current].command = value;
    if (kv[1] === 'args' && Array.isArray(value)) servers[current].args = value.map(String);
  }
  return servers;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** `.agents/skills/<name>/SKILL.md` in a shell command, with `/`, `\` or the `\\` of a quoted Windows path. */
function skillReadPattern(skillsDir) {
  const seg = skillsDir.split('/').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\\\/]+');
  return new RegExp(`${seg}[\\\\/]+([^\\\\/'"\\s]+)[\\\\/]+SKILL\\.md`, 'i');
}

const BASE = ['exec', '--json', '--ignore-user-config', '--disable', 'plugins', '--ephemeral', '--skip-git-repo-check'];

const codex = {
  name: 'codex',
  title: 'Codex CLI',
  envVar: 'BENCHWRIGHT_CODEX',
  binary: process.env.BENCHWRIGHT_CODEX ?? 'codex',
  /** `null` = the CLI's own default model; a config value wins. */
  defaults: { model: null, judgeModel: null },
  /** `-c developer_instructions="…"` is a real system-prompt channel. */
  systemPromptMode: 'flag',
  skillsDir: '.agents/skills',
  harnessPaths: ['.codex/', '.agents/'],
  /** Inferred from a shell read of SKILL.md, not reported by the CLI. */
  reportsSkills: 'inferred',
  reportsCost: false,

  caseCommand({ prompt, model, systemPrompt, cwd }) {
    const args = [...BASE, '--dangerously-bypass-approvals-and-sandbox'];
    if (model) args.push('-m', model);
    if (systemPrompt) args.push('-c', `developer_instructions=${tomlString(systemPrompt)}`);
    for (const [name, { command, args: serverArgs }] of Object.entries(readMcpServers(cwd))) {
      if (!command) continue;
      args.push('-c', `mcp_servers.${tomlKey(name)}.command=${tomlString(command)}`);
      args.push('-c', `mcp_servers.${tomlKey(name)}.args=[${serverArgs.map(tomlString).join(', ')}]`);
    }
    args.push('-');
    return { args, input: prompt };
  },

  promptCommand({ model, prompt }) {
    const args = [...BASE, '-s', 'read-only'];
    if (model) args.push('-m', model);
    args.push('-');
    return { args, input: prompt };
  },

  promptText(stdout) {
    return jsonLines(stdout)
      .filter((m) => m.type === 'item.completed' && m.item?.type === 'agent_message' && typeof m.item.text === 'string')
      .map((m) => m.item.text)
      .join('\n');
  },

  parseEvents(stdout) {
    const skillRead = skillReadPattern(codex.skillsDir);
    const events = [];
    for (const msg of jsonLines(stdout)) {
      if (msg.type === 'turn.completed' || msg.type === 'turn.failed') {
        events.push({ type: 'result', text: '', costUsd: null });
        continue;
      }
      if (msg.type !== 'item.completed' || !msg.item) continue;
      const item = msg.item;
      if (item.type === 'agent_message' && typeof item.text === 'string') events.push({ type: 'text', text: item.text });
      else if (item.type === 'command_execution') {
        const command = String(item.command ?? '');
        events.push({ type: 'tool', name: 'Bash', input: { command } });
        const skill = command.match(skillRead);
        if (skill) events.push({ type: 'tool', name: 'Skill', input: { skill: skill[1] } });
      } else if (item.type === 'file_change') {
        for (const change of item.changes ?? []) {
          events.push({ type: 'tool', name: change.kind === 'add' ? 'Write' : 'Edit', input: { file_path: change.path, kind: change.kind } });
        }
      } else if (item.type === 'mcp_tool_call') {
        events.push({ type: 'tool', name: `mcp__${item.server}__${item.tool}`, input: item.arguments ?? {} });
      } else if (item.type === 'web_search') events.push({ type: 'tool', name: 'WebSearch', input: { query: item.query } });
    }
    return events;
  },

  writeMcpConfig(workdir, servers) {
    const file = path.join(workdir, CONFIG_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tables = Object.entries(servers).map(
      ([name, { command, args }]) => `[mcp_servers.${tomlKey(name)}]\ncommand = ${tomlString(command)}\nargs = [${args.map(tomlString).join(', ')}]\n`,
    );
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\s*$/, '\n\n') : '';
    fs.writeFileSync(file, `${existing}# benchwright — mock MCP servers for this workspace\n${tables.join('\n')}`, 'utf8');
    return [CONFIG_FILE];
  },
};

export default codex;
