/**
 * Live suite — spends real tokens, so it never runs under `npm test`.
 *
 *   BENCHWRIGHT_LIVE=1 npm run test:live
 *
 * For every harness whose CLI answers `--version`, one tiny case goes through
 * the real `runCase` in a temp directory. A harness that is not installed is
 * skipped, not failed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HARNESSES, getHarness } from '../../lib/harness/index.mjs';
import { checkAgentBinary, runCase } from '../../lib/agent.mjs';

const LIVE = process.env.BENCHWRIGHT_LIVE === '1';
const CANONICAL = ['Bash', 'Write', 'Edit', 'Read', 'Skill'];

describe('live: one case per installed harness', { skip: LIVE ? false : 'set BENCHWRIGHT_LIVE=1 to run against the real CLIs' }, () => {
  for (const name of HARNESSES) {
    const harness = getHarness(name);
    const preflight = LIVE ? checkAgentBinary(harness) : { ok: false };
    it(`${name}: creates hello.txt and reports canonical tool events`, { skip: preflight.ok ? false : `not installed: ${preflight.error ?? ''}`, timeout: 400000 }, async () => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `benchwright-live-${name}-`));
      try {
        const run = await runCase({
          harness,
          prompt: 'create a file named hello.txt containing exactly: hi',
          cwd,
          maxTurns: 10,
          timeoutSeconds: 300,
        });
        const file = path.join(cwd, 'hello.txt');
        assert.ok(fs.existsSync(file), `${name}: hello.txt missing; stderr: ${run.stderr.slice(0, 400)}`);
        assert.match(fs.readFileSync(file, 'utf8').trim(), /^hi$/);
        assert.ok(run.toolsUsed.some((t) => CANONICAL.includes(t) || t.startsWith('mcp__')), `${name}: no canonical tool among ${run.toolsUsed.join(', ') || '(none)'}`);
        assert.ok(run.transcript.trim().length > 0, `${name}: empty transcript`);
        console.log(`  ${name} (${preflight.version}): ${run.durationMs} ms, tools ${run.toolsUsed.join(', ')}, cost ${run.costUsd ?? 'not reported'}`);
      } finally {
        fs.rmSync(cwd, { recursive: true, force: true });
      }
    });
  }
});
