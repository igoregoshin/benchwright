#!/usr/bin/env node
/**
 * benchwright mock call log — query helper for `command` graders.
 *
 * The fixture builder copies this file into the workspace as `.bench/calls.mjs`
 * next to the log the mocks append to, so a grader reads like a sentence:
 *
 *   run: node .bench/calls.mjs count mcp:create_merge_request
 *   expect_match: '^1$'
 *
 *   run: node .bench/calls.mjs arg mcp:create_merge_request description | grep -c '^- '
 *   expect_match: '^[1-3]$'
 *
 *   run: node .bench/calls.mjs count http:POST:/rest/api/2/issue/TLX-101/comment
 *   expect_match: '^1$'
 *
 *   run: node .bench/calls.mjs unmatched          # exits 1 if anything went unanswered
 *
 * Commands:
 *   list                       every call, one per line, in order
 *   count <selector>           how many calls match
 *   arg <selector> <path>      the dot-path value of the LAST matching call's
 *                              arguments (MCP) or request body (HTTP), printed
 *                              raw when it is a string so `grep` works on it
 *   unmatched                  print calls no fixture answered; exit 1 if any
 *
 * Selectors:
 *   mcp:<tool>                 any server
 *   mcp:<server>:<tool>
 *   http:<METHOD>:<path>       path is exact, or a "*" suffix for a prefix match
 *   http:<METHOD>:<path>:<n>   … additionally requiring response status <n>
 *
 * Exit codes: 0 on success, 1 when a selector matches nothing (`arg`) or an
 * unmatched call exists, 2 on usage / missing log.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not a hand-rolled strip of the leading slash: the workspace
// path runs through os.tmpdir(), which on Windows hands back the 8.3 short name
// (`C:\Users\IGOR~1.EGO\…`), and `import.meta.url` percent-encodes the `~`. The
// naive version looked for `mock-calls.jsonl` under `IGOR%7E1.EGO` and reported
// "the mocks were never called" for a run in which every call had landed.
const LOG =
  process.env.BENCHWRIGHT_CALL_LOG ??
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'mock-calls.jsonl');

const [command, ...rest] = process.argv.slice(2);
if (!command) {
  process.stderr.write('usage: calls.mjs <list|count|arg|unmatched> [selector] [path]\n');
  process.exit(2);
}

const calls = load();

switch (command) {
  case 'list':
    for (const c of calls) process.stdout.write(`${describe(c)}\n`);
    break;
  case 'count':
    process.stdout.write(`${select(calls, rest[0]).length}\n`);
    break;
  case 'arg': {
    const hits = select(calls, rest[0]);
    if (!hits.length) {
      process.stderr.write(`no call matches ${rest[0]}\n`);
      process.exit(1);
    }
    const source = hits[hits.length - 1].args ?? hits[hits.length - 1].body ?? {};
    const value = dig(source, rest[1]);
    if (value === undefined) {
      process.stderr.write(`no value at "${rest[1]}"\n`);
      process.exit(1);
    }
    process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`);
    break;
  }
  case 'unmatched': {
    const bad = calls.filter((c) => c.matched === false);
    for (const c of bad) process.stdout.write(`${describe(c)}  ${c.why ?? ''}\n`);
    process.exit(bad.length ? 1 : 0);
    break;
  }
  default:
    process.stderr.write(`unknown command: ${command}\n`);
    process.exit(2);
}

function load() {
  if (!fs.existsSync(LOG)) {
    process.stderr.write(`no mock call log at ${LOG} — the mocks were never called\n`);
    process.exit(2);
  }
  return fs
    .readFileSync(LOG, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

function describe(c) {
  const mark = c.matched === false ? 'UNMATCHED' : 'ok';
  return c.t === 'mcp'
    ? `mcp  ${c.server}  ${c.tool}  ${mark}`
    : `http ${c.method} ${c.path}  ${c.status}  ${mark}`;
}

function select(list, selector) {
  if (!selector) {
    process.stderr.write('a selector is required\n');
    process.exit(2);
  }
  const [kind, ...parts] = selector.split(':');
  if (kind === 'mcp') {
    const [a, b] = parts;
    const server = b ? a : null;
    const tool = b ?? a;
    return list.filter((c) => c.t === 'mcp' && c.tool === tool && (!server || c.server === server));
  }
  if (kind === 'http') {
    const [method, route, status] = parts;
    return list.filter(
      (c) =>
        c.t === 'http' &&
        c.method.toUpperCase() === method.toUpperCase() &&
        (route.endsWith('*') ? c.path.startsWith(route.slice(0, -1)) : c.path === route) &&
        (status === undefined || String(c.status) === status),
    );
  }
  process.stderr.write(`selector must start with "mcp:" or "http:": ${selector}\n`);
  process.exit(2);
  return [];
}

function dig(obj, dotted) {
  if (!dotted) return obj;
  let cur = obj;
  for (const key of dotted.split('.')) {
    if (cur == null) return undefined;
    cur = cur[key];
  }
  return cur;
}
