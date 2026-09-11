#!/usr/bin/env node
/**
 * benchwright MCP mock — a stdio MCP server that replays recorded tool responses.
 *
 *   node mcp-mock.mjs --fixture <mocks/<case>.json> --server <name> --log <calls.jsonl>
 *
 * It exists so the `mcp` benchmark category can run skills that talk to GitLab /
 * Bitbucket without a live instance. The tool names it exposes are exactly the
 * ones the skill's `allowed-tools` names — a harness turns `<server>` + `<tool>`
 * into `mcp__<server>__<tool>`, so the server NAME in `.mcp.json` is part of the
 * contract, not decoration. Get it wrong and the skill simply never sees a tool.
 *
 * ── Fixture format ───────────────────────────────────────────────────────────
 *
 * The fixture is one JSON file per case, living in the owning skill's
 * `evals/mocks/`. Its `mcp` section is a map of server name → tool name → tool:
 *
 *   {
 *     "mcp": {
 *       "gitlab": {                                  // → mcp__gitlab__<tool>
 *         "list_merge_requests": {
 *           "description": "List merge requests",    // shown to the model
 *           "params": {                              // → inputSchema properties
 *             "project_id": "string",
 *             "source_branch": "string",
 *             "state": "string"
 *           },
 *           "required": ["project_id"],              // optional
 *           "responses": [
 *             { "when": { "state": "opened" }, "result": [ { "iid": 7 } ] },
 *             { "result": [] }                       // no `when` → catch-all
 *           ]
 *         },
 *         "create_merge_request": { "result": { "iid": 42, "web_url": "…" } }
 *       }
 *     }
 *   }
 *
 * Response selection — ONE rule, which covers both matching and sequencing:
 *
 *   the first `responses` entry whose `when` matches AND that has not been used
 *   yet; when every matching entry is used up, the last matching one repeats.
 *
 * `when` is a shallow equality check over the call's arguments, compared as
 * strings, so `{ "merge_request_iid": 7 }` matches both `7` and `"7"`. Keys the
 * `when` does not name are ignored.
 *
 * Shorthands: `"result": <json>` is `"responses": [{ "result": <json> }]`;
 * `"error": "text"` makes the tool return an MCP error result.
 *
 * A tool may also leave a file behind, for skills whose next step reads back what
 * a real server would have written — a screenshot on disk:
 *
 *   "browser_take_screenshot": {
 *     "writesFileFromArg": "filename",      // the call's `filename` → a placeholder PNG
 *     "result": "Screenshot saved"
 *   }
 *
 * The placeholder is one fixed 1×1 PNG, written only when the named argument is a
 * non-empty string; a relative path resolves against the mock's cwd (the workspace).
 * Without it a skill that checks the file exists (rightly) downgrades every verdict,
 * and the run grades the mock instead of the skill.
 *
 * ── Determinism ──────────────────────────────────────────────────────────────
 *
 * Nothing here reaches the network, and the only side effect is the placeholder
 * file above — the same bytes every time. A call with no matching response returns
 * an MCP **error** naming the tool and the arguments — never an empty success,
 * which would let a case go green for the wrong reason. Every call (matched or
 * not) is appended to the log, so graders assert on what was really called; see
 * mocks/calls.mjs for the query helper.
 */
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
if (!args.fixture || !args.server) {
  process.stderr.write('usage: mcp-mock.mjs --fixture <file> --server <name> [--log <file>]\n');
  process.exit(2);
}

const fixture = JSON.parse(fs.readFileSync(args.fixture, 'utf8'));
const tools = (fixture.mcp ?? {})[args.server];
if (!tools) {
  process.stderr.write(`mcp-mock: fixture ${args.fixture} declares no mcp server "${args.server}"\n`);
  process.exit(2);
}

/** How many times each `responses` entry has already been handed out. */
const used = new Map();

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (line) handleLine(line);
  }
});
process.stdin.on('end', () => process.exit(0));

function handleLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return; // not our problem: a malformed frame is dropped, never answered
  }
  // Notifications carry no id and expect no reply.
  if (msg.id === undefined || msg.id === null) return;
  const res = dispatch(msg);
  if (res) send({ jsonrpc: '2.0', id: msg.id, ...res });
}

function dispatch(msg) {
  switch (msg.method) {
    case 'initialize':
      return {
        result: {
          // Echo the client's protocol version: the mock speaks the subset that
          // has not changed across revisions, so agreeing is safer than picking.
          protocolVersion: msg.params?.protocolVersion ?? '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: `benchwright-mock-${args.server}`, version: '1.0.0' },
        },
      };
    case 'ping':
      return { result: {} };
    case 'tools/list':
      return { result: { tools: Object.entries(tools).map(([name, def]) => toolSchema(name, def)) } };
    case 'resources/list':
      return { result: { resources: [] } };
    case 'resources/templates/list':
      return { result: { resourceTemplates: [] } };
    case 'prompts/list':
      return { result: { prompts: [] } };
    case 'tools/call':
      return { result: callTool(msg.params?.name, msg.params?.arguments ?? {}) };
    default:
      return { error: { code: -32601, message: `mcp-mock: method not supported: ${msg.method}` } };
  }
}

function toolSchema(name, def) {
  const properties = {};
  for (const [param, type] of Object.entries(def.params ?? {})) {
    properties[param] = typeof type === 'object' ? type : { type: String(type) };
  }
  return {
    name,
    description: def.description ?? `${name} (benchwright mock)`,
    inputSchema: {
      type: 'object',
      properties,
      ...(def.required?.length ? { required: def.required } : {}),
    },
  };
}

function callTool(name, callArgs) {
  const def = tools[name];
  if (!def) {
    log({ tool: name, args: callArgs, matched: false, why: 'no such tool in fixture' });
    return errorResult(
      `benchwright mock: server "${args.server}" has no tool "${name}". ` +
        `Known tools: ${Object.keys(tools).join(', ')}.`,
    );
  }

  const responses = def.responses ?? [{ result: def.result, error: def.error, status: def.status }];
  const candidates = responses
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => matches(r.when, callArgs));

  if (!candidates.length) {
    log({ tool: name, args: callArgs, matched: false, why: 'no response matched the arguments' });
    return errorResult(
      `benchwright mock: no recorded response for ${name} with arguments ` +
        `${JSON.stringify(callArgs)}. Add one to the fixture's mcp.${args.server}.${name}.responses.`,
    );
  }

  // First unused matching entry; once they are all used the last one repeats.
  const pick =
    candidates.find(({ i }) => !(used.get(`${name}#${i}`) > 0)) ?? candidates[candidates.length - 1];
  used.set(`${name}#${pick.i}`, (used.get(`${name}#${pick.i}`) ?? 0) + 1);

  log({ tool: name, args: callArgs, matched: true });
  if (pick.r.error) return errorResult(String(pick.r.error));
  leaveFile(def, callArgs);
  return { content: [{ type: 'text', text: render(pick.r.result) }] };
}

/** 1×1 transparent PNG — enough for `existsSync`, `stat` and an image viewer. */
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/**
 * `writesFileFromArg`: a skill that names a file and then reads it back must find
 * one. A screenshot tool whose file never appears makes the agent — correctly, per
 * its own rules — report every verdict as unverifiable, and the case then measures
 * the mock, not the skill.
 */
function leaveFile(def, callArgs) {
  const argName = def.writesFileFromArg;
  if (!argName) return;
  const target = callArgs?.[argName];
  if (typeof target !== 'string' || !target.trim()) return;
  try {
    const abs = path.resolve(process.cwd(), target);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, PLACEHOLDER_PNG);
  } catch {
    /* the call still answers; a missing file is the skill's to notice and report */
  }
}

function matches(when, callArgs) {
  if (!when) return true;
  return Object.entries(when).every(([k, v]) => String(callArgs?.[k] ?? '') === String(v));
}

function render(result) {
  if (result === undefined || result === null) return 'null';
  return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
}

function errorResult(text) {
  return { content: [{ type: 'text', text }], isError: true };
}

function send(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function log(entry) {
  if (!args.log) return;
  try {
    fs.mkdirSync(path.dirname(args.log), { recursive: true });
    fs.appendFileSync(args.log, `${JSON.stringify({ t: 'mcp', server: args.server, ...entry })}\n`, 'utf8');
  } catch {
    /* a benchmark must not die because its own log is unwritable */
  }
}

function parseArgs(argv) {
  const out = { fixture: null, server: null, log: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--fixture') out.fixture = argv[++i];
    else if (argv[i] === '--server') out.server = argv[++i];
    else if (argv[i] === '--log') out.log = argv[++i];
  }
  return out;
}
