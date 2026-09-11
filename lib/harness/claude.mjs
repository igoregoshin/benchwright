/**
 * Claude Code adapter — `claude -p`.
 *
 *   case run     claude -p --output-format stream-json --verbose --permission-mode bypassPermissions
 *                --setting-sources project,local [--model m] [--max-turns n] [--append-system-prompt s]
 *   prompt call  claude -p [--model m]            (judge, trigger classifier; plain text back)
 *   skills       .claude/skills/<name>/SKILL.md   (project scope; user skills excluded by --setting-sources)
 *   MCP          .mcp.json + .claude/settings.json { enableAllProjectMcpServers: true }
 *   events       stream-json: assistant `text` / `tool_use` blocks, a final `result` with total_cost_usd
 *
 * The tool names in the stream are already the canonical ones (Bash, Write,
 * Edit, Read, Skill, mcp__<server>__<tool>), so no mapping happens here.
 */
import path from 'node:path';
import { jsonLines, readJsonObject, writeJsonFile } from './shared.mjs';

const claude = {
  name: 'claude',
  title: 'Claude Code',
  envVar: 'BENCHWRIGHT_CLAUDE',
  binary: process.env.BENCHWRIGHT_CLAUDE ?? 'claude',
  /** Model aliases the CLI resolves itself; a config value wins over these. */
  defaults: { model: 'sonnet', judgeModel: 'haiku' },
  /** `--append-system-prompt` is a real system-prompt channel. */
  systemPromptMode: 'flag',
  skillsDir: '.claude/skills',
  harnessPaths: ['.claude/', '.mcp.json'],
  /** `Skill` tool calls are reported natively, so `tool_used: Skill` graders work. */
  reportsSkills: true,
  /** `total_cost_usd` on the result event. */
  reportsCost: true,

  caseCommand({ prompt, model, maxTurns, systemPrompt, allowedTools }) {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'bypassPermissions'];
    if (model) args.push('--model', model);
    if (maxTurns) args.push('--max-turns', String(maxTurns));
    // Only the workspace's own settings and skills. Without this, a same-named
    // skill under the user's ~/.claude/skills/ shadows the one the fixture
    // installed, and the run measures whatever stale copy lives on the machine.
    args.push('--setting-sources', 'project,local');
    if (allowedTools?.length) args.push('--allowedTools', ...allowedTools);
    if (systemPrompt) args.push('--append-system-prompt', systemPrompt);
    return { args, input: prompt };
  },

  promptCommand({ model, prompt }) {
    const args = ['-p'];
    if (model) args.push('--model', model);
    return { args, input: prompt };
  },

  /** A plain `-p` call prints the answer and nothing else. */
  promptText(stdout) {
    return String(stdout ?? '');
  },

  parseEvents(stdout) {
    const events = [];
    for (const msg of jsonLines(stdout)) {
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
  },

  writeMcpConfig(workdir, servers) {
    const mcpFile = path.join(workdir, '.mcp.json');
    const mcp = readJsonObject(mcpFile);
    mcp.mcpServers = { ...(mcp.mcpServers ?? {}) };
    for (const [name, { command, args }] of Object.entries(servers)) mcp.mcpServers[name] = { command, args };
    writeJsonFile(mcpFile, mcp);

    // A project-scoped .mcp.json is inert until the project approves it, and
    // headless there is nobody to approve. Granting it in project settings is what
    // makes the mock tools visible at all — without this the run looks like a
    // subject failure ("the tool was never called") with no error anywhere.
    const settingsFile = path.join(workdir, '.claude', 'settings.json');
    writeJsonFile(settingsFile, { ...readJsonObject(settingsFile), enableAllProjectMcpServers: true });
    return ['.mcp.json', '.claude/settings.json'];
  },
};

export default claude;
