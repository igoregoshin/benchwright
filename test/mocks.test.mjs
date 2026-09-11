import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MOCKS = fileURLToPath(new URL('../mocks/', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('http-mock', () => {
  let dir;
  let child;
  let base;
  const log = () => path.join(dir, 'calls.jsonl');

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchwright-http-'));
    const fixture = path.join(dir, 'f.json');
    fs.writeFileSync(fixture, JSON.stringify({
      http: {
        routes: [
          { method: 'GET', path: '/rest/api/2/issue/TLX-1', query: { fields: 'summary' }, json: { key: 'TLX-1' } },
          { method: 'GET', path: '/rest/api/2/search*', json: { total: 0 } },
          { method: 'POST', path: '/rest/api/2/issue', responses: [{ status: 201, json: { key: 'A' } }, { status: 201, json: { key: 'B' } }] },
          { method: 'GET', path: '/raw', body: 'plain', headers: { 'x-test': '1' } },
        ],
      },
    }));
    const portFile = path.join(dir, 'port');
    child = spawn(process.execPath, [path.join(MOCKS, 'http-mock.mjs'), '--fixture', fixture, '--log', log(), '--port-file', portFile, '--ttl', '60'], { stdio: 'ignore' });
    for (let i = 0; i < 200 && !fs.existsSync(portFile); i += 1) await sleep(25);
    base = `http://127.0.0.1:${fs.readFileSync(portFile, 'utf8').trim()}`;
  });
  after(() => {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('answers a matching route and logs the call', async () => {
    const res = await fetch(`${base}/rest/api/2/issue/TLX-1?fields=summary,status`, { headers: { authorization: 'Bearer x' } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { key: 'TLX-1' });
    const last = fs.readFileSync(log(), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).pop();
    assert.equal(last.t, 'http');
    assert.equal(last.matched, true);
    assert.equal(last.auth, true);
  });

  it('a route with a query constraint does not match without it; a prefix route matches', async () => {
    assert.equal((await fetch(`${base}/rest/api/2/issue/TLX-1`)).status, 501);
    assert.equal((await fetch(`${base}/rest/api/2/search?jql=x`)).status, 200);
  });

  it('responses are consumed in order and the last one repeats', async () => {
    const keys = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await fetch(`${base}/rest/api/2/issue`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ n: i }) });
      assert.equal(res.status, 201);
      keys.push((await res.json()).key);
    }
    assert.deepEqual(keys, ['A', 'B', 'B']);
  });

  it('unmatched requests get 501 with a message and are logged as unmatched', async () => {
    const res = await fetch(`${base}/nowhere`);
    assert.equal(res.status, 501);
    assert.match((await res.json()).errorMessages[0], /no recorded response for GET \/nowhere/);
    const entries = fs.readFileSync(log(), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(entries.some((e) => e.path === '/nowhere' && e.matched === false));
  });

  it('raw bodies and headers pass through', async () => {
    const res = await fetch(`${base}/raw`);
    assert.equal(res.headers.get('x-test'), '1');
    assert.equal(await res.text(), 'plain');
  });

  it('calls.mjs queries the log', () => {
    const run = (...args) => spawnSync(process.execPath, [path.join(MOCKS, 'calls.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, BENCHWRIGHT_CALL_LOG: log() } });
    assert.equal(run('count', 'http:POST:/rest/api/2/issue').stdout.trim(), '3');
    assert.equal(run('count', 'http:GET:/rest/api/2/issue/*:200').stdout.trim(), '1');
    assert.equal(run('arg', 'http:POST:/rest/api/2/issue', 'n').stdout.trim(), '2');
    const unmatched = run('unmatched');
    assert.equal(unmatched.status, 1);
    assert.match(unmatched.stdout, /\/nowhere/);
    assert.equal(run('arg', 'http:GET:/none').status, 1);
    assert.equal(run('count', 'bogus:x').status, 2);
    assert.equal(run().status, 2);
  });
});

describe('mcp-mock', () => {
  let dir;
  let fixture;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchwright-mcp-'));
    fixture = path.join(dir, 'f.json');
    fs.writeFileSync(fixture, JSON.stringify({
      mcp: {
        gitlab: {
          list_merge_requests: {
            description: 'List MRs',
            params: { project_id: 'string', state: 'string' },
            required: ['project_id'],
            responses: [{ when: { state: 'opened' }, result: [{ iid: 7 }] }, { result: [] }],
          },
          create_merge_request: { error: 'must not be called' },
          browser_take_screenshot: { writesFileFromArg: 'filename', result: 'Screenshot saved' },
        },
      },
    }));
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  function rpc(messages) {
    const input = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
    const r = spawnSync(process.execPath, [path.join(MOCKS, 'mcp-mock.mjs'), '--fixture', fixture, '--server', 'gitlab', '--log', path.join(dir, 'calls.jsonl')], { cwd: dir, input, encoding: 'utf8' });
    return r.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }

  it('speaks the handshake, lists tools with schemas and answers calls by `when`', () => {
    const out = rpc([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-01-01' } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_merge_requests', arguments: { project_id: 'g/p', state: 'opened' } } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_merge_requests', arguments: { project_id: 'g/p', state: 'closed' } } },
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'create_merge_request', arguments: {} } },
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'nope', arguments: {} } },
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'browser_take_screenshot', arguments: { filename: 'shots/a.png' } } },
      { jsonrpc: '2.0', id: 8, method: 'unknown/method' },
    ]);
    assert.equal(out[0].result.protocolVersion, '2025-01-01');
    assert.equal(out[0].result.serverInfo.name, 'benchwright-mock-gitlab');
    const tools = out[1].result.tools;
    assert.deepEqual(tools.map((t) => t.name), ['list_merge_requests', 'create_merge_request', 'browser_take_screenshot']);
    assert.deepEqual(tools[0].inputSchema.required, ['project_id']);
    assert.equal(tools[0].inputSchema.properties.state.type, 'string');
    assert.deepEqual(JSON.parse(out[2].result.content[0].text), [{ iid: 7 }]);
    assert.deepEqual(JSON.parse(out[3].result.content[0].text), []);
    assert.equal(out[4].result.isError, true);
    assert.match(out[4].result.content[0].text, /must not be called/);
    assert.equal(out[5].result.isError, true);
    assert.match(out[5].result.content[0].text, /has no tool "nope"/);
    assert.equal(out[6].result.content[0].text, 'Screenshot saved');
    assert.ok(fs.existsSync(path.join(dir, 'shots', 'a.png')), 'writesFileFromArg leaves the file');
    assert.equal(out[7].error.code, -32601);

    const calls = fs.readFileSync(path.join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(calls.filter((c) => c.tool === 'list_merge_requests').length, 2);
    assert.ok(calls.some((c) => c.tool === 'nope' && c.matched === false));
  });
});
