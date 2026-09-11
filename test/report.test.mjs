import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openRun, readRecords, assemble, keyOf, reading, renderHtml, printHarnessFaults, RELIABLE_RUNS } from '../lib/report.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'benchwright-rep-'));
const trigger = (over) => ({ kind: 'trigger', subject: 's', queryId: 'trigger-1', query: 'q', shouldTrigger: true, run: 0, actual: true, error: null, durationMs: 10, ...over });
const caseRec = (over) => ({ kind: 'case', subject: 's', category: 'repo', sections: ['functional'], id: 'c', score: 1, graders: [{ id: 'g', type: 'no_writes', pass: true, why: 'ok' }], runs: 1, agentRuns: 1, costUsd: 0.5, durationMs: 1000, ...over });

describe('keyOf', () => {
  it('keys trigger and case records, and reads legacy `skill` records', () => {
    assert.equal(keyOf(trigger({})), 'trigger|s|trigger-1|0');
    assert.equal(keyOf(caseRec({})), 'case|s|c|fn');
    assert.equal(keyOf(caseRec({ sections: ['functional', 'ablation'] })), 'case|s|c|ab');
    assert.equal(keyOf({ kind: 'case', skill: 'old', id: 'c', sections: ['functional'] }), 'case|old|c|fn');
    assert.equal(keyOf({ kind: 'meta' }), null);
  });
});

describe('openRun / readRecords', () => {
  it('streams every record to disk and lets a resumed run skip finished work', () => {
    const dir = tmp();
    try {
      const s1 = openRun(dir, { startedAt: '2026-01-01T00:00:00.000Z', layers: ['trigger'], subjects: ['s'] });
      s1.append(trigger({ run: 0 }));
      s1.append(trigger({ run: 1, actual: false }));
      const lines = fs.readFileSync(s1.jsonlPath, 'utf8').trim().split('\n');
      assert.equal(lines.length, 3);
      assert.ok(fs.existsSync(s1.jsonPath));
      assert.ok(fs.existsSync(s1.htmlPath));

      // A kill mid-write leaves a truncated last line; it must be tolerated.
      fs.appendFileSync(s1.jsonlPath, '{"kind":"trigger","subject":"s","qu');
      assert.equal(readRecords(dir).length, 3);

      const s2 = openRun(dir, { startedAt: '2026-01-01T01:00:00.000Z', layers: ['trigger'], subjects: ['s'] });
      assert.equal(s2.resumedRecords, 2);
      assert.equal(s2.has('trigger|s|trigger-1|0'), true);
      assert.equal(s2.has('trigger|s|trigger-1|2'), false);
      const result = s2.finalize(true);
      assert.equal(result.complete, true);
      assert.deepEqual(result.resumes, ['2026-01-01T01:00:00.000Z']);
      assert.equal(result.totals.resumes, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('assemble', () => {
  it('trigger: majority vote per query, ties count as not triggered and unstable', () => {
    const records = [
      { kind: 'meta', title: 'T', startedAt: '2026-01-01T00:00:00.000Z', layers: ['trigger'], subjects: ['s'], model: 'm', judgeModel: 'j' },
      trigger({ queryId: 'q1', run: 0, actual: true }),
      trigger({ queryId: 'q1', run: 1, actual: true }),
      trigger({ queryId: 'q1', run: 2, actual: false }),
      trigger({ queryId: 'q2', shouldTrigger: false, run: 0, actual: true }),
      trigger({ queryId: 'q2', shouldTrigger: false, run: 1, actual: false }),
      trigger({ queryId: 'q3', shouldTrigger: false, run: 0, actual: false }),
    ];
    const r = assemble(records);
    assert.equal(r.title, 'T');
    assert.deepEqual(r.subjects, ['s']);
    const t = r.trigger[0];
    assert.equal(t.subject, 's');
    assert.equal(t.total, 3);
    assert.equal(t.runs, 1);
    assert.equal(t.accuracy, 1);
    assert.equal(t.unstable.length, 2);
    assert.equal(t.misses.length, 0);
    assert.equal(t.calls, 6);
    assert.equal(r.totals.triggerCalls, 6);
  });

  it('functional and ablation group per subject with deletion candidates, and legacy `skill` records still count', () => {
    const records = [
      { kind: 'meta', startedAt: '2026-01-01T00:00:00.000Z', layers: ['functional', 'ablation'], skills: ['old'] },
      caseRec({ subject: undefined, skill: 'old', id: 'c1', score: 0.5, runs: 3 }),
      caseRec({ subject: 'old', id: 'c2', sections: ['functional', 'ablation'], score: 1, withScore: 1, withoutScore: 1, delta: 0, deletionCandidates: ['x'], agentRuns: 2, runs: 1 }),
      { kind: 'end', finishedAt: '2026-01-01T00:10:00.000Z', complete: true },
    ];
    const r = assemble(records);
    assert.deepEqual(r.subjects, ['old']);
    assert.equal(r.functional.length, 1);
    assert.equal(r.functional[0].subject, 'old');
    // An ablation record carries both sections, so it shows up in functional too.
    assert.equal(r.functional[0].cases.length, 2);
    assert.equal(r.functional[0].runs, 1);
    assert.equal(r.ablation[0].cases.length, 1);
    assert.equal(r.ablation[0].cases[0].deletionCandidates[0], 'x');
    assert.equal(r.totals.agentRuns, 3);
    assert.equal(r.totals.costUsd, 1);
    assert.equal(r.totals.wallDurationMs, 600000);
  });
});

describe('reading', () => {
  it('maps the four cells of the truth table', () => {
    assert.equal(reading(1, 1).code, 'pass/pass');
    assert.equal(reading(1, 0.5).code, 'pass/fail');
    assert.equal(reading(0.5, 1).code, 'fail/pass');
    assert.equal(reading(0, 0).code, 'fail/fail');
  });
});

describe('renderHtml', () => {
  it('uses the run title, marks thin samples and unfinished runs', () => {
    const html = renderHtml({ title: 'My <bench>', complete: false, functional: [{ subject: 's', category: 'repo', score: 1, runs: 1, cases: [{ id: 'c', score: 1, runs: 1, graders: [] }] }], totals: {} });
    assert.ok(html.includes('<title>My &lt;bench&gt;</title>'));
    assert.ok(html.includes('This run has not finished'));
    assert.ok(html.includes('Thin sample'));
    assert.ok(html.includes(`--runs ${RELIABLE_RUNS}`));
    assert.ok(html.includes('<th>Subject</th>'));
  });
});

describe('printHarnessFaults', () => {
  it('counts grader and classifier errors', () => {
    const log = console.log;
    const lines = [];
    console.log = (s) => lines.push(String(s));
    try {
      const n = printHarnessFaults([
        trigger({ error: 'unparseable: ...' }),
        caseRec({ graders: [{ type: 'command', pass: false, why: 'could not run: x', error: true }, { type: 'llm', pass: false, why: 'judge returned no verdict', error: true }] }),
        caseRec({ id: 'fine' }),
      ]);
      assert.equal(n, 3);
      assert.ok(lines.some((l) => /HARNESS FAULTS/.test(l)));
      assert.equal(printHarnessFaults([caseRec({})]), 0);
    } finally {
      console.log = log;
    }
  });
});
