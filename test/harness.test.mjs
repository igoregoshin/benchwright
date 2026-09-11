import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HARNESSES, getHarness, resolveBinary } from '../lib/harness/index.mjs';
import { runCase } from '../lib/agent.mjs';
import { resolveModels } from '../lib/runner.mjs';
import { DEFAULTS } from '../lib/subjects.mjs';

// Trimmed real output of each CLI (paths and ids replaced by placeholders); see
// the fixture directory. Every adapter's parser is exercised on what its CLI
// actually printed, not on a hand-written idea of the format.
const FIXTURES = fileURLToPath(new URL('./fixtures/harness/', import.meta.url));
const sample = (name) => fs.readFileSync(path.join(FIXTURES, name, 'case.jsonl'), 'utf8');
const tools = (events) => events.filter((e) => e.type === 'tool');
const named = (events, name) => tools(events).filter((e) => e.name === name);

describe('harness registry', () => {
  it('knows the three CLIs and rejects anything else', () => {
    assert.deepEqual(HARNESSES, ['claude', 'opencode', 'codex']);
    for (const name of HARNESSES) assert.equal(getHarness(name).name, name);
    assert.equal(getHarness().name, 'claude');
    assert.equal(getHarness(null).name, 'claude');
    assert.equal(getHarness(getHarness('codex')).name, 'codex', 'an adapter object passes through');
    assert.throws(() => getHarness('nope'), /unknown harness "nope" \(expected one of claude, opencode, codex\)/);
  });

  it('every adapter exposes the same contract', () => {
    for (const name of HARNESSES) {
      const h = getHarness(name);
      assert.equal(typeof h.binary, 'string');
      assert.match(h.envVar, /^BENCHWRIGHT_[A-Z]+$/);
      assert.ok(['flag', 'prepend'].includes(h.systemPromptMode), name);
      assert.ok(h.skillsDir && !h.skillsDir.startsWith('/'), name);
      assert.ok(h.harnessPaths.length, name);
      assert.ok('model' in h.defaults && 'judgeModel' in h.defaults, name);
      for (const fn of ['caseCommand', 'promptCommand', 'promptText', 'parseEvents', 'writeMcpConfig']) assert.equal(typeof h[fn], 'function', `${name}.${fn}`);
    }
  });
});

describe('model defaults', () => {
  it('DEFAULTS carries no model: the harness decides, and a config value wins', () => {
    assert.equal(DEFAULTS.model, null);
    assert.equal(DEFAULTS.judgeModel, null);
    assert.equal(DEFAULTS.harness, 'claude');

    const none = resolveModels({ defaults: DEFAULTS });
    assert.equal(none.harness.name, 'claude');
    assert.equal(none.model, 'sonnet');
    assert.equal(none.judgeModel, 'haiku');

    const configured = resolveModels({ defaults: { ...DEFAULTS, model: 'cfg-model', judgeModel: 'cfg-judge' } });
    assert.equal(configured.model, 'cfg-model');
    assert.equal(configured.judgeModel, 'cfg-judge');

    const flagged = resolveModels({ args: { model: 'flag-model', harness: 'codex' }, defaults: { ...DEFAULTS, model: 'cfg-model' } });
    assert.equal(flagged.harness.name, 'codex');
    assert.equal(flagged.model, 'flag-model');
    assert.equal(flagged.judgeModel, null, 'codex has no default of its own');

    const perCase = resolveModels({ testCase: { model: 'case-model' }, defaults: DEFAULTS });
    assert.equal(perCase.model, 'case-model');
  });
});

describe('claude adapter', () => {
  const h = getHarness('claude');

  it('parseEvents: text, tools with canonical inputs, mcp tools, the skill, the result with cost', () => {
    const events = h.parseEvents(sample('claude'));
    assert.ok(events.some((e) => e.type === 'text' && /bench-marker/.test(e.text)));
    assert.equal(named(events, 'Bash')[0].input.command, 'git status --short');
    assert.deepEqual(named(events, 'Skill')[0].input, { skill: 'bench-marker' });
    assert.match(named(events, 'Write')[0].input.file_path, /MARKER\.txt$/);
    assert.match(named(events, 'Edit')[0].input.file_path, /README\.md$/);
    assert.match(named(events, 'Read')[0].input.file_path, /README\.md$/);
    assert.deepEqual(named(events, 'mcp__bench__ping')[0].input, { value: 'x' });
    const result = events.find((e) => e.type === 'result');
    assert.equal(result.costUsd, 0.108433);
    assert.match(result.text, /ping/);
  });

  it('caseCommand keeps the flags a run depends on; promptCommand is a bare -p', () => {
    const { args, input } = h.caseCommand({ prompt: 'do it', model: 'sonnet', maxTurns: 7, systemPrompt: 'answers', allowedTools: ['Bash'] });
    assert.equal(input, 'do it');
    assert.equal(args[0], '-p');
    for (const pair of [['--output-format', 'stream-json'], ['--model', 'sonnet'], ['--max-turns', '7'], ['--permission-mode', 'bypassPermissions'], ['--setting-sources', 'project,local'], ['--append-system-prompt', 'answers'], ['--allowedTools', 'Bash']]) {
      const i = args.indexOf(pair[0]);
      assert.ok(i >= 0 && args[i + 1] === pair[1], pair.join(' '));
    }
    assert.ok(args.includes('--verbose'));
    assert.deepEqual(h.promptCommand({ model: 'haiku', prompt: 'q' }), { args: ['-p', '--model', 'haiku'], input: 'q' });
    assert.deepEqual(h.promptCommand({ model: null, prompt: 'q' }).args, ['-p']);
    assert.equal(h.promptText('PASS\n'), 'PASS\n');
  });

  it('writeMcpConfig: .mcp.json plus the project approval, both reported', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchwright-hc-'));
    try {
      fs.mkdirSync(path.join(dir, '.claude'));
      fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{"permissions":{"allow":["Bash"]}}');
      const wrote = h.writeMcpConfig(dir, { bench: { command: 'node', args: ['mock.mjs', '--server', 'bench'] } });
      assert.deepEqual(wrote, ['.mcp.json', '.claude/settings.json']);
      const mcp = JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8'));
      assert.deepEqual(mcp.mcpServers.bench, { command: 'node', args: ['mock.mjs', '--server', 'bench'] });
      const settings = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
      assert.equal(settings.enableAllProjectMcpServers, true);
      assert.deepEqual(settings.permissions, { allow: ['Bash'] }, 'an existing settings file is merged, not replaced');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('opencode adapter', () => {
  const h = getHarness('opencode');
  let dir;
  before(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchwright-ho-'))));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('parseEvents: lower-case tools become canonical names, filePath becomes file_path, cost is summed', () => {
    const events = h.parseEvents(sample('opencode'));
    assert.ok(events.some((e) => e.type === 'text' && /done/i.test(e.text)));
    assert.equal(named(events, 'Bash')[0].input.command, 'git status --short');
    assert.match(named(events, 'Read')[0].input.file_path, /README\.md$/);
    const edit = named(events, 'Edit')[0].input;
    assert.match(edit.file_path, /README\.md$/);
    assert.equal(edit.filePath, undefined);
    assert.match(named(events, 'Write')[0].input.file_path, /MARKER\.txt$/);
    assert.deepEqual(named(events, 'Skill')[0].input.skill, 'bench-marker');
    const result = events.find((e) => e.type === 'result');
    assert.equal(typeof result.costUsd, 'number', 'per-step cost is reported (0 on a free model)');
  });

  it('parseEvents: an MCP tool is `<server>_<tool>` and resolves against the workspace config, longest server first', () => {
    // Without a workspace the name cannot be split safely, so it stays raw.
    assert.equal(named(h.parseEvents(sample('opencode')), 'bench_ping').length, 1);
    fs.writeFileSync(path.join(dir, 'opencode.json'), JSON.stringify({ mcp: { bench: {}, my: {}, my_server: {} } }));
    const events = h.parseEvents(sample('opencode'), { cwd: dir });
    assert.deepEqual(named(events, 'mcp__bench__ping')[0].input, { value: 'x' });
    const ambiguous = h.parseEvents('{"type":"tool_use","part":{"tool":"my_server_list_issues","state":{"input":{"q":1}}}}\n', { cwd: dir });
    assert.equal(ambiguous[0].name, 'mcp__my_server__list_issues');
  });

  it('caseCommand isolates the run from the user config and pins the directory; promptText reads text parts', () => {
    const { args, input, env } = h.caseCommand({ prompt: 'do it', model: 'p/m', cwd: dir });
    assert.deepEqual(args, ['run', '--format', 'json', '--dangerously-skip-permissions', '--dir', dir, '-m', 'p/m']);
    assert.equal(input, 'do it');
    assert.ok(fs.statSync(env.OPENCODE_CONFIG_DIR).isDirectory(), 'the config dir exists, so the CLI finds nothing of the user there');
    // The CLI reads its project directory from PWD when the variable is inherited from a shell;
    // a run once wrote its file into the shell's directory instead of the workspace.
    assert.equal(env.PWD, dir);
    assert.deepEqual(h.caseCommand({ prompt: 'x', model: null }).args, ['run', '--format', 'json', '--dangerously-skip-permissions']);
    assert.deepEqual(h.promptCommand({ model: null, prompt: 'q', cwd: dir }).args, ['run', '--format', 'json', '--dir', dir]);
    assert.equal(h.systemPromptMode, 'prepend');
    assert.equal(h.promptText('{"type":"step_start"}\n{"type":"text","part":{"text":"STDINWORKS"}}\n'), 'STDINWORKS');
  });

  it('writeMcpConfig: opencode.json with a local server as a command array', () => {
    const ws = path.join(dir, 'ws');
    fs.mkdirSync(ws);
    const wrote = h.writeMcpConfig(ws, { bench: { command: 'node', args: ['mock.mjs', '--server', 'bench'] } });
    assert.deepEqual(wrote, ['opencode.json']);
    const config = JSON.parse(fs.readFileSync(path.join(ws, 'opencode.json'), 'utf8'));
    assert.deepEqual(config.mcp.bench, { type: 'local', command: ['node', 'mock.mjs', '--server', 'bench'], enabled: true });
  });
});

describe('codex adapter', () => {
  const h = getHarness('codex');
  let dir;
  before(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchwright-hx-'))));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('parseEvents: items become canonical tools, a SKILL.md read is also a Skill, cost is null', () => {
    const events = h.parseEvents(sample('codex'));
    assert.ok(events.some((e) => e.type === 'text' && /MARKER\.txt/.test(e.text)));
    // The CLI reports no skill loads; the shell read of .agents/skills/<name>/SKILL.md is the evidence.
    assert.deepEqual(named(events, 'Skill').map((e) => e.input.skill), ['bench-marker']);
    assert.ok(named(events, 'Bash').some((e) => /SKILL\.md/.test(e.input.command)));
    assert.match(named(events, 'Write')[0].input.file_path, /MARKER\.txt$/);
    assert.match(named(events, 'Edit')[0].input.file_path, /README\.md$/);
    assert.deepEqual(named(events, 'mcp__bench__ping')[0].input, { value: 'x' });
    assert.equal(events.find((e) => e.type === 'result').costUsd, null);
    // Only completed items count: an in-progress line for the same command must not double it.
    assert.equal(named(events, 'Write').length, 1);
  });

  it('caseCommand: isolation flags, the system prompt as developer_instructions, servers re-asserted as -c overrides', () => {
    const { args, input } = h.caseCommand({ prompt: 'do it', model: 'm', systemPrompt: 'line "one"\nline two', cwd: dir });
    assert.equal(input, 'do it');
    assert.deepEqual(args.slice(0, 8), ['exec', '--json', '--ignore-user-config', '--disable', 'plugins', '--ephemeral', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox']);
    assert.ok(args.includes('-m') && args[args.indexOf('-m') + 1] === 'm');
    assert.ok(args.includes('developer_instructions="line \\"one\\"\\nline two"'), args.join(' '));
    assert.equal(args[args.length - 1], '-', 'the prompt comes from stdin');
    assert.ok(!args.some((a) => a.startsWith('mcp_servers.')), 'no config, no overrides');

    h.writeMcpConfig(dir, { bench: { command: 'C:\\node.exe', args: ['mock.mjs', '--server', 'bench'] } });
    const withMcp = h.caseCommand({ prompt: 'x', model: null, cwd: dir }).args;
    assert.ok(withMcp.includes('mcp_servers.bench.command="C:\\\\node.exe"'), withMcp.join(' '));
    assert.ok(withMcp.includes('mcp_servers.bench.args=["mock.mjs", "--server", "bench"]'), withMcp.join(' '));

    const prompt = h.promptCommand({ model: 'm', prompt: 'q' });
    assert.deepEqual(prompt.args, ['exec', '--json', '--ignore-user-config', '--disable', 'plugins', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '-m', 'm', '-']);
    assert.equal(prompt.input, 'q');
    assert.equal(h.promptText('{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Hello! PINEAPPLE"}}\n{"type":"turn.completed","usage":{}}\n'), 'Hello! PINEAPPLE');
    assert.equal(h.systemPromptMode, 'flag');
  });

  it('writeMcpConfig: a TOML table per server that parses back', () => {
    const ws = path.join(dir, 'ws');
    fs.mkdirSync(ws);
    const wrote = h.writeMcpConfig(ws, { bench: { command: 'node', args: ['C:\\mocks\\mcp-mock.mjs', '--server', 'bench'] } });
    assert.deepEqual(wrote, ['.codex/config.toml']);
    const text = fs.readFileSync(path.join(ws, '.codex', 'config.toml'), 'utf8');
    // Minimal TOML check: one table header, and both values are JSON-compatible basic strings.
    assert.match(text, /^\[mcp_servers\.bench\]$/m);
    const command = text.match(/^command = (.+)$/m)[1];
    const args = text.match(/^args = (.+)$/m)[1];
    assert.equal(JSON.parse(command), 'node');
    assert.deepEqual(JSON.parse(args), ['C:\\mocks\\mcp-mock.mjs', '--server', 'bench']);
  });
});

describe('runCase through an adapter', () => {
  // A fake harness whose "CLI" is this very Node: it echoes stdin, so what the
  // adapter was handed as the prompt is exactly what comes back as text.
  const echo = (mode) => ({
    name: 'echo',
    binary: process.execPath,
    defaults: { model: 'echo-default', judgeModel: null },
    systemPromptMode: mode,
    skillsDir: '.x/skills',
    harnessPaths: ['.x/'],
    seen: null,
    caseCommand(opts) {
      this.seen = opts;
      return { args: ['-e', 'process.stdin.pipe(process.stdout)'], input: opts.prompt };
    },
    promptCommand: () => ({ args: [] }),
    promptText: (s) => s,
    parseEvents: (stdout) => [{ type: 'text', text: stdout }, { type: 'tool', name: 'Bash', input: { command: 'x' } }, { type: 'result', text: '', costUsd: null }],
    writeMcpConfig: () => [],
  });

  it("prepends the autopilot text when the harness has no system-prompt channel, and passes it as a flag when it has", async () => {
    const prepend = echo('prepend');
    const run = await runCase({ harness: prepend, prompt: 'the task', cwd: os.tmpdir(), systemPrompt: 'the answers', timeoutSeconds: 60 });
    assert.equal(run.ok, true);
    assert.equal(prepend.seen.systemPrompt, undefined);
    assert.equal(prepend.seen.model, 'echo-default', 'the harness default applies when no model is given');
    assert.match(run.transcript, /^the answers\n\nthe task/);
    assert.deepEqual(run.toolsUsed, ['Bash']);
    assert.equal(run.costUsd, null);

    const flag = echo('flag');
    const run2 = await runCase({ harness: flag, prompt: 'the task', cwd: os.tmpdir(), model: 'given', systemPrompt: 'the answers', timeoutSeconds: 60 });
    assert.equal(flag.seen.systemPrompt, 'the answers');
    assert.equal(flag.seen.model, 'given');
    assert.match(run2.transcript, /^the task/);
  });
});

describe('resolveBinary', () => {
  it('leaves a name alone off Windows and resolves npm shims on it', () => {
    if (process.platform !== 'win32') {
      assert.deepEqual(resolveBinary('some-cli'), { file: 'some-cli', prefix: [] });
      return;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchwright-bin-'));
    const savedPath = process.env.PATH;
    try {
      fs.mkdirSync(path.join(dir, 'node_modules', 'pkg', 'bin'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'node_modules', 'pkg', 'bin', 'cli.js'), '');
      fs.writeFileSync(path.join(dir, 'node_modules', 'pkg', 'bin', 'cli.exe'), '');
      // The two shim shapes npm writes: a JS entry run by node, and a native binary.
      fs.writeFileSync(path.join(dir, 'jscli.cmd'), '@ECHO off\r\nSETLOCAL\r\n"%_prog%"  "%dp0%\\node_modules\\pkg\\bin\\cli.js" %*\r\n');
      fs.writeFileSync(path.join(dir, 'execli.cmd'), '@ECHO off\r\n"%dp0%\\node_modules\\pkg\\bin\\cli.exe"   %*\r\n');
      fs.writeFileSync(path.join(dir, 'odd.cmd'), '@ECHO off\r\necho nothing here\r\n');
      process.env.PATH = `${dir}${path.delimiter}${savedPath}`;
      assert.deepEqual(resolveBinary('jscli'), { file: process.execPath, prefix: [path.join(dir, 'node_modules', 'pkg', 'bin', 'cli.js')] });
      assert.deepEqual(resolveBinary('execli'), { file: path.join(dir, 'node_modules', 'pkg', 'bin', 'cli.exe'), prefix: [] });
      assert.match(resolveBinary('odd').unresolved, /shim benchwright cannot read/);
      assert.deepEqual(resolveBinary('definitely-not-installed-xyz'), { file: 'definitely-not-installed-xyz', prefix: [] });
      assert.deepEqual(resolveBinary('C:\\tools\\agent.exe'), { file: 'C:\\tools\\agent.exe', prefix: [] });
    } finally {
      process.env.PATH = savedPath;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
