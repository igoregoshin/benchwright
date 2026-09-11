#!/usr/bin/env node
/**
 * benchwright HTTP mock — a localhost REST server that replays recorded responses.
 *
 *   node http-mock.mjs --fixture <mocks/<case>.json> --log <calls.jsonl> \
 *                      --port-file <.bench/http-port> [--ttl <seconds>]
 *
 * Why an HTTP mock and not only an MCP one: many subjects in the `mcp` category
 * do not speak MCP at all. A Jira or Confluence skill typically drives its own
 * Node scripts, which call the REST API with `fetch` and read the base URL from
 * an env file in the workspace. Pointing that base URL at this server is the
 * only mock those subjects can see.
 *
 * The server binds 127.0.0.1 on an OS-assigned port, writes the port to
 * `--port-file` when ready, and hard-exits after `--ttl` seconds so a crashed
 * benchmark can never leave a listener behind.
 *
 * ── Fixture format ───────────────────────────────────────────────────────────
 *
 *   {
 *     "http": {
 *       "secretsFile": ".env",                    // optional; default: defaults.secretsFile
 *       "secrets": {                              // written to that file
 *         "JIRA_TOKEN": "bench-token",
 *         "JIRA_BASE_URL": "{{baseUrl}}"          // {{baseUrl}} → http://127.0.0.1:<port>
 *       },
 *       "routes": [
 *         {
 *           "method": "GET",
 *           "path": "/rest/api/2/issue/TLX-101",  // exact, or a trailing "*" prefix
 *           "query": { "fields": "summary" },     // optional: substring per param
 *           "status": 200,                        // default 200
 *           "json": { "key": "TLX-101" }          // or "body": "raw", or "base64": "…"
 *         },
 *         {
 *           "method": "POST",
 *           "path": "/rest/api/2/issue",
 *           "responses": [                        // consumed in order
 *             { "status": 201, "json": { "key": "TLX-201" } },
 *             { "status": 201, "json": { "key": "TLX-202" } }
 *           ]
 *         }
 *       ]
 *     }
 *   }
 *
 * Selection — the same single rule the MCP mock uses: the first `responses`
 * entry not yet handed out; when they are all used the last one repeats. A
 * route with no `responses` is a constant response.
 *
 * ── Determinism ──────────────────────────────────────────────────────────────
 *
 * Nothing is proxied and nothing is invented. A request no route matches gets
 * **501** with a message naming the method and path — the skill scripts turn a
 * non-2xx into a visible error, so a missing fixture surfaces as a failure
 * instead of a silently green case. Every request is appended to the log
 * (matched or not); see mocks/calls.mjs for the query helper.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
if (!args.fixture) {
  process.stderr.write('usage: http-mock.mjs --fixture <file> [--log <file>] [--port-file <file>] [--ttl <s>]\n');
  process.exit(2);
}

const fixture = JSON.parse(fs.readFileSync(args.fixture, 'utf8'));
const routes = fixture.http?.routes ?? [];
if (!routes.length) {
  process.stderr.write(`http-mock: fixture ${args.fixture} declares no http.routes\n`);
  process.exit(2);
}

/** How many times each route's `responses` entry has already been handed out. */
const used = new Map();

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => respond(req, res, Buffer.concat(chunks)));
});

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  if (args.portFile) {
    fs.mkdirSync(path.dirname(args.portFile), { recursive: true });
    fs.writeFileSync(args.portFile, String(port), 'utf8');
  }
  process.stderr.write(`http-mock listening on 127.0.0.1:${port}\n`);
});

// Hard lifetime cap. The benchmark kills this process on exit, but a SIGKILL'd
// or crashed run cannot — and a stray listener would poison the next case.
setTimeout(() => process.exit(0), (args.ttl ?? 900) * 1000);

function respond(req, res, rawBody) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const query = Object.fromEntries(url.searchParams.entries());
  const body = parseBody(req.headers['content-type'], rawBody);

  const route = routes.find((r) => routeMatches(r, req.method, url.pathname, query));
  if (!route) {
    const message =
      `benchwright mock: no recorded response for ${req.method} ${url.pathname}. ` +
      `Add a route to the fixture's http.routes.`;
    log({ method: req.method, path: url.pathname, query, body, status: 501, matched: false, why: message });
    res.writeHead(501, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ errorMessages: [message], errors: {} }));
    return;
  }

  const picked = pickResponse(route);
  const status = picked.status ?? 200;
  const { payload, headers } = renderBody(picked);

  log({
    method: req.method,
    path: url.pathname,
    query,
    body,
    status,
    matched: true,
    auth: Boolean(req.headers.authorization),
  });

  res.writeHead(status, headers);
  res.end(payload);
}

function routeMatches(route, method, pathname, query) {
  if (route.method && route.method.toUpperCase() !== method.toUpperCase()) return false;
  const p = route.path ?? '*';
  const pathOk = p.endsWith('*') ? pathname.startsWith(p.slice(0, -1)) : pathname === p;
  if (!pathOk) return false;
  for (const [k, v] of Object.entries(route.query ?? {})) {
    if (!String(query[k] ?? '').includes(String(v))) return false;
  }
  return true;
}

function pickResponse(route) {
  const responses = route.responses ?? [route];
  const key = `${route.method} ${route.path}`;
  const idx = used.get(key) ?? 0;
  used.set(key, idx + 1);
  return responses[Math.min(idx, responses.length - 1)];
}

function renderBody(spec) {
  const headers = { ...(spec.headers ?? {}) };
  if (spec.base64 != null) {
    headers['content-type'] = headers['content-type'] ?? 'application/octet-stream';
    return { payload: Buffer.from(spec.base64, 'base64'), headers };
  }
  if (spec.body != null) {
    headers['content-type'] = headers['content-type'] ?? 'text/plain; charset=utf-8';
    return { payload: Buffer.from(String(spec.body), 'utf8'), headers };
  }
  if (spec.json === undefined) return { payload: Buffer.alloc(0), headers };
  headers['content-type'] = headers['content-type'] ?? 'application/json; charset=utf-8';
  return { payload: Buffer.from(JSON.stringify(spec.json), 'utf8'), headers };
}

function parseBody(contentType, raw) {
  if (!raw.length) return null;
  const text = raw.toString('utf8');
  if (String(contentType ?? '').includes('json')) {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(0, 4000);
    }
  }
  return text.slice(0, 4000);
}

function log(entry) {
  if (!args.log) return;
  try {
    fs.mkdirSync(path.dirname(args.log), { recursive: true });
    fs.appendFileSync(args.log, `${JSON.stringify({ t: 'http', ...entry })}\n`, 'utf8');
  } catch {
    /* a benchmark must not die because its own log is unwritable */
  }
}

function parseArgs(argv) {
  const out = { fixture: null, log: null, portFile: null, ttl: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--fixture') out.fixture = argv[++i];
    else if (argv[i] === '--log') out.log = argv[++i];
    else if (argv[i] === '--port-file') out.portFile = argv[++i];
    else if (argv[i] === '--ttl') out.ttl = Number(argv[++i]);
  }
  return out;
}
