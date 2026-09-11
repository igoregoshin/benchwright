/**
 * Reporting — the incremental result stream, the console summary, the JSON
 * result file and a self-contained HTML report.
 *
 * A run costs real money and real time, and runs DO get killed halfway (a long
 * ablation, a background job, resource pressure). The first version wrote the
 * report exactly once, at the end, so a kill threw away every case that had
 * already been paid for.
 *
 * So the stream is the source of truth: every finished unit of work is
 * appended to `result.jsonl` the moment it is known, and `result.json` /
 * `report.html` are DERIVED from it — while the run is going (throttled), at
 * the end, and again when a killed run is resumed. A run that dies halfway
 * leaves behind a complete, readable record of everything it computed.
 */
import fs from 'node:fs';
import path from 'node:path';

const ESC = '[';
const g = (s) => `${ESC}32m${s}${ESC}0m`;
const r = (s) => `${ESC}31m${s}${ESC}0m`;
const y = (s) => `${ESC}33m${s}${ESC}0m`;
const dim = (s) => `${ESC}2m${s}${ESC}0m`;

/**
 * Below this many runs a score is an indication, not a measurement.
 *
 * Measured on an unchanged subject: three consecutive single-run trigger sweeps
 * scored 92%, 83% and 100%, missing different queries each time; three runs per
 * query scored a stable 100%. A ±8..17 point swing is wide enough to report a
 * regression that does not exist, so anything under this is labelled.
 */
export const RELIABLE_RUNS = 3;

/** Score at or above which an arm counts as "passing" in the ablation truth table. */
const PASS = 0.8;

export function pct(n) {
  return `${Math.round(n * 100)}%`;
}

function tint(score) {
  if (score >= 0.8) return g(pct(score));
  if (score >= 0.5) return y(pct(score));
  return r(pct(score));
}

function money(n) {
  return `$${n.toFixed(n >= 1 ? 2 : 4)}`;
}

function dur(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return 'n/a';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** `runs 1` is not a measurement — say so everywhere the number is shown. */
function runsTag(runs) {
  if (!runs) return dim('runs ?');
  return runs >= RELIABLE_RUNS ? dim(`runs ${runs}`) : y(`runs ${runs} !`);
}

/** Records written by the pre-`subject` runner carried `skill`; keep reading them. */
const subjectOf = (rec) => rec.subject ?? rec.skill ?? null;

// ---------------------------------------------------------------------------
// The incremental stream
// ---------------------------------------------------------------------------

/**
 * A record is keyed by the work it represents, so a resumed run can skip what
 * is already on disk. `meta` / `end` records carry no work and no key.
 */
export function keyOf(record) {
  if (record.kind === 'trigger') return `trigger|${subjectOf(record)}|${record.queryId}|${record.run}`;
  if (record.kind === 'case') {
    return `case|${subjectOf(record)}|${record.id}|${(record.sections ?? []).includes('ablation') ? 'ab' : 'fn'}`;
  }
  return null;
}

/** Tolerant read — a kill can truncate the final line mid-write. */
export function readRecords(outDir) {
  const p = path.join(outDir, 'result.jsonl');
  if (!fs.existsSync(p)) return [];
  const out = [];
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      /* truncated tail from a killed run — everything before it still counts */
    }
  }
  return out;
}

/**
 * Open (or reopen) a results directory. Existing records are loaded so the
 * caller can skip finished work, and every `append` lands on disk immediately.
 */
export function openRun(outDir, meta) {
  fs.mkdirSync(outDir, { recursive: true });
  const jsonlPath = path.join(outDir, 'result.jsonl');
  const records = readRecords(outDir);
  const done = new Set(records.map(keyOf).filter(Boolean));
  let lastFlush = 0;

  const stream = {
    dir: outDir,
    jsonlPath,
    jsonPath: path.join(outDir, 'result.json'),
    htmlPath: path.join(outDir, 'report.html'),
    records,
    /** How many finished units were already on disk when this run opened. */
    resumedRecords: done.size,
    has(key) {
      return done.has(key);
    },
    append(record) {
      records.push(record);
      const k = keyOf(record);
      if (k) done.add(k);
      fs.appendFileSync(jsonlPath, `${JSON.stringify(record)}\n`, 'utf8');
      // The derived files are cheap to rebuild; rebuild them often enough that
      // a SIGKILL leaves at most a second of staleness behind.
      if (Date.now() - lastFlush >= 1000) stream.flush();
    },
    /** Rebuild result.json + report.html from everything recorded so far. */
    flush() {
      lastFlush = Date.now();
      const result = assemble(records);
      writeJson(outDir, result);
      writeHtml(outDir, result);
      return result;
    },
    finalize(complete) {
      const end = { kind: 'end', finishedAt: new Date().toISOString(), complete: Boolean(complete) };
      records.push(end);
      fs.appendFileSync(jsonlPath, `${JSON.stringify(end)}\n`, 'utf8');
      return stream.flush();
    },
  };

  stream.append({ kind: 'meta', ...meta });
  return stream;
}

// ---------------------------------------------------------------------------
// Aggregation — records in, report shape out
// ---------------------------------------------------------------------------

export function assemble(records) {
  const metas = records.filter((x) => x.kind === 'meta');
  const first = metas[0] ?? {};
  const last = metas[metas.length - 1] ?? {};
  const end = records.filter((x) => x.kind === 'end').pop();

  const result = {
    title: last.title ?? first.title ?? null,
    startedAt: first.startedAt ?? null,
    finishedAt: end?.finishedAt ?? null,
    complete: Boolean(end?.complete),
    layers: [...new Set(metas.flatMap((m) => m.layers ?? []))],
    harness: last.harness ?? first.harness ?? null,
    model: last.model ?? first.model ?? null,
    judgeModel: last.judgeModel ?? first.judgeModel ?? null,
    subjects: [...new Set(metas.flatMap((m) => m.subjects ?? m.skills ?? []))],
  };
  if (metas.length > 1) result.resumes = metas.slice(1).map((m) => m.startedAt);

  const trigger = aggregateTrigger(records.filter((x) => x.kind === 'trigger'));
  if (trigger.length) result.trigger = trigger;

  const functional = groupCases(records, 'functional');
  if (functional.length) result.functional = functional;

  const ablation = groupCases(records, 'ablation');
  if (ablation.length) result.ablation = ablation;

  result.totals = computeTotals(records, result);
  return result;
}

function aggregateTrigger(recs) {
  const bySubject = new Map();
  for (const rec of recs) {
    const subject = subjectOf(rec);
    if (!bySubject.has(subject)) {
      bySubject.set(subject, { subject, category: rec.category ?? null, queries: new Map(), calls: 0, classifierMs: 0 });
    }
    const s = bySubject.get(subject);
    s.calls += 1;
    s.classifierMs += rec.durationMs ?? 0;
    if (!s.queries.has(rec.queryId)) {
      s.queries.set(rec.queryId, { id: rec.queryId, query: rec.query, expected: rec.shouldTrigger, actuals: [] });
    }
    s.queries.get(rec.queryId).actuals.push(Boolean(rec.actual));
  }

  const rows = [];
  for (const s of bySubject.values()) {
    const queries = [...s.queries.values()].map((q) => {
      const n = q.actuals.length;
      const yes = q.actuals.filter(Boolean).length;
      // Strict majority; a tie is not a verdict, so it stays on the "did not
      // trigger" side and is reported as unstable.
      return { ...q, runs: n, actual: yes * 2 > n, unstable: yes !== 0 && yes !== n };
    });

    const tp = queries.filter((q) => q.expected && q.actual).length;
    const fp = queries.filter((q) => !q.expected && q.actual).length;
    const fn = queries.filter((q) => q.expected && !q.actual).length;
    const tn = queries.filter((q) => !q.expected && !q.actual).length;

    rows.push({
      subject: s.subject,
      category: s.category,
      total: queries.length,
      runs: queries.length ? Math.min(...queries.map((q) => q.runs)) : 0,
      accuracy: queries.length ? (tp + tn) / queries.length : 0,
      precision: tp + fp ? tp / (tp + fp) : 1,
      recall: tp + fn ? tp / (tp + fn) : 1,
      misses: queries.filter((q) => q.expected !== q.actual).map((q) => ({ query: q.query, expected: q.expected, actuals: q.actuals })),
      unstable: queries.filter((q) => q.unstable).map((q) => ({ query: q.query, actuals: q.actuals })),
      calls: s.calls,
      classifierMs: s.classifierMs,
    });
  }
  return rows;
}

function groupCases(records, section) {
  const cases = records.filter((x) => x.kind === 'case' && (x.sections ?? []).includes(section));
  const bySubject = new Map();
  for (const c of cases) {
    const subject = subjectOf(c);
    if (!bySubject.has(subject)) bySubject.set(subject, { subject, category: c.category ?? null, cases: [] });
    bySubject.get(subject).cases.push(c);
  }
  return [...bySubject.values()].map((row) => ({
    ...row,
    score: avg(row.cases.map((c) => c.score)),
    runs: row.cases.length ? Math.min(...row.cases.map((c) => c.runs ?? 0)) : 0,
  }));
}

function computeTotals(records, result) {
  const cases = records.filter((x) => x.kind === 'case');
  const trig = records.filter((x) => x.kind === 'trigger');
  const endAt = result.finishedAt ? Date.parse(result.finishedAt) : Date.now();
  return {
    costUsd: round(sum(cases.map((c) => c.costUsd ?? 0)), 4),
    // False when no case reported money (a harness whose CLI reports tokens
    // only), so "$0.00" is never printed as if it were a fact.
    costReported: cases.some((c) => typeof c.costUsd === 'number'),
    agentRuns: sum(cases.map((c) => c.agentRuns ?? c.runs ?? 0)),
    cases: cases.length,
    // Sums parallel work, so it exceeds wall clock at --concurrency > 1.
    agentDurationMs: sum(cases.map((c) => c.durationMs ?? 0)),
    triggerCalls: trig.length,
    triggerClassifierMs: sum(trig.map((t) => t.durationMs ?? 0)),
    // The trigger layer goes through a plain `-p` call, which reports no
    // per-call cost — so the dollar figure covers agent runs only.
    triggerCostReported: false,
    // Measured from the FIRST start, so on a resumed run it spans the dead time
    // between the kill and the restart. `resumes` says when to read it that way.
    wallDurationMs: result.startedAt ? endAt - Date.parse(result.startedAt) : null,
    resumes: (result.resumes ?? []).length,
  };
}

/** The ablation truth table, per case, from the two arms. */
export function reading(withScore, withoutScore) {
  const w = withScore >= PASS;
  const b = withoutScore >= PASS;
  if (w && b) return { code: 'pass/pass', note: 'deletion candidate — the base model already does this' };
  if (w && !b) return { code: 'pass/fail', note: 'what the subject is buying you — protect it with a free invariant' };
  if (!w && b) return { code: 'fail/pass', note: 'the subject is getting in the way' };
  return { code: 'fail/fail', note: 'a genuine gap — the subject never covered this' };
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const round = (n, d) => Number(n.toFixed(d));

// ---------------------------------------------------------------------------
// Console
// ---------------------------------------------------------------------------

export function printTriggerSummary(rows) {
  console.log(`\n${dim('-- trigger (routing) --')}`);
  if (!rows.length) {
    console.log(dim('  (no trigger queries matched the current filters)'));
    return;
  }
  for (const row of rows) {
    const { subject, precision, recall, accuracy, misses, unstable = [] } = row;
    console.log(`  ${subject.padEnd(30)} acc ${tint(accuracy)}  P ${pct(precision)}  R ${pct(recall)}  ${runsTag(row.runs)}`);
    for (const m of misses) {
      const spread = m.actuals && m.actuals.length > 1 ? dim(` [${m.actuals.map((a) => (a ? 'y' : 'n')).join('')}]`) : '';
      console.log(`      ${r('x')} ${dim(m.expected ? 'missed' : 'false-fire')} "${m.query}"${spread}`);
    }
    for (const u of unstable) {
      console.log(`      ${y('~')} ${dim('flipped between runs')} "${u.query}" ${dim(`[${u.actuals.map((a) => (a ? 'y' : 'n')).join('')}]`)}`);
    }
  }
}

export function printFunctionalSummary(rows) {
  console.log(`\n${dim('-- functional --')}`);
  if (!rows.length) {
    console.log(dim('  (no functional cases matched the current filters)'));
    return;
  }
  for (const row of rows) {
    console.log(`  ${row.subject.padEnd(30)} ${tint(row.score)}  ${dim(`${row.cases.length} case(s)`)}`);
    for (const c of row.cases) {
      console.log(`    ${c.score >= 0.999 ? g('v') : r('x')} ${c.id.padEnd(24)} ${tint(c.score)}  ${runsTag(c.runs)}`);
      for (const gr of (c.graders ?? []).filter((x) => !x.pass)) {
        console.log(`        ${r('x')} ${dim(`[${gr.type}]`)} ${String(gr.label).slice(0, 90)}`);
        if (gr.why) console.log(`          ${dim(gr.why.slice(0, 100))}`);
      }
    }
  }
}

/**
 * Ablation, printed so the delta cannot be read on its own.
 *
 * The delta moves for two completely different reasons: the WITH arm moved
 * (that is your edit) or the WITHOUT arm moved (that is the base model drifting,
 * and has nothing to do with your edit). Real example: one subject went from
 * 100/80 = +20 to 100/100 = ±0 across two runs. That reads as a regression and
 * is not one — the with-arm never budged. So both arms print as primary numbers
 * and the delta prints as what it is: derived.
 */
export function printAblationSummary(rows) {
  console.log(`\n${dim('-- ablation (with subject vs without) --')}`);
  console.log(`  ${dim('Read the two arms first; the delta is derived from them, not the other way round.')}`);
  console.log(`  ${dim('with    - the only arm your edit moves. Compare it with the same cell in the previous run.')}`);
  console.log(`  ${dim('without - the base model. It drifts on its own; when the delta changes, check WHICH arm')}`);
  console.log(`  ${dim('          moved before calling it a regression.')}`);
  console.log(`  ${dim('pass/pass = deletion candidate | pass/fail = what the subject buys you |')}`);
  console.log(`  ${dim('fail/pass = the subject is in the way | fail/fail = a genuine gap.')}`);
  if (!rows.length) {
    console.log(`\n  ${dim('(no ablation cases matched the current filters)')}`);
    return;
  }
  for (const row of rows) {
    for (const c of row.cases) {
      const d = c.withScore - c.withoutScore;
      const delta = d > 0.05 ? g(`+${pct(d)}`) : d < -0.05 ? r(pct(d)) : y('+-0%');
      const rd = reading(c.withScore, c.withoutScore);
      console.log(`\n  ${row.subject} / ${c.id}  ${runsTag(c.runs)}`);
      console.log(`      with     ${pad(tint(c.withScore), 6)}  ${dim('primary  - moves only when the subject changes')}`);
      console.log(`      without  ${pad(tint(c.withoutScore), 6)}  ${dim('baseline - drifts on its own between runs')}`);
      console.log(`      delta    ${pad(delta, 6)}  ${dim(`derived  - ${rd.code}: ${rd.note}`)}`);
      for (const gr of c.deletionCandidates ?? []) {
        console.log(`      ${y('!')} ${dim('passes without the subject too:')} ${String(gr).slice(0, 80)}`);
      }
    }
  }
}

/** Pad a colourised string to a visible width (the escape codes do not count). */
function pad(colored, width) {
  const visible = colored.replace(/\[[0-9;]*m/g, '').length;
  return colored + ' '.repeat(Math.max(0, width - visible));
}

/** One banner, printed once, when any number in the report came from too few runs. */
export function printReliabilityBanner(result) {
  const thin = [];
  for (const t of result.trigger ?? []) if (t.runs < RELIABLE_RUNS) thin.push(`trigger ${t.subject} (runs ${t.runs})`);
  for (const f of result.functional ?? []) for (const c of f.cases) if ((c.runs ?? 0) < RELIABLE_RUNS) thin.push(`${f.subject}/${c.id} (runs ${c.runs})`);
  for (const a of result.ablation ?? []) for (const c of a.cases) if ((c.runs ?? 0) < RELIABLE_RUNS) thin.push(`ablation ${a.subject}/${c.id} (runs ${c.runs})`);
  if (!thin.length) return;

  console.log(`\n${y('!! NOT A MEASUREMENT - thin sample')}`);
  console.log(dim(`   ${thin.length} result(s) above came from fewer than ${RELIABLE_RUNS} runs:`));
  console.log(dim(`   ${thin.slice(0, 6).join(', ')}${thin.length > 6 ? `, +${thin.length - 6} more` : ''}`));
  console.log(dim('   On an unchanged subject, single-run scores have been observed at 92%, 83% and 100%'));
  console.log(dim('   in a row, missing different queries each time. Re-run with --runs 3 before you'));
  console.log(dim('   report a regression, a win, or a deletion candidate.'));
}

/**
 * Grader errors are harness faults, not subject results. A run with any of
 * them must never be read as green: `could not run:`, `unknown grader type`,
 * `judge returned no verdict` all mean the harness failed to measure, and a
 * threshold treats them as failing. Returns the count.
 */
export function printHarnessFaults(records) {
  const faults = [];
  for (const rec of records) {
    if (rec.kind === 'trigger' && rec.error) faults.push(`trigger ${subjectOf(rec)}/${rec.queryId} run ${rec.run}: ${rec.error}`);
    if (rec.kind === 'case') {
      for (const gr of rec.graders ?? []) if (gr.error) faults.push(`${subjectOf(rec)}/${rec.id} [${gr.type}]: ${gr.why}`);
    }
  }
  if (!faults.length) return 0;
  console.log(`
${r('!! HARNESS FAULTS - this run is not a result')}`);
  console.log(dim(`   ${faults.length} grader/classifier error(s). Fix the harness or the case, then re-run:`));
  for (const f of faults.slice(0, 8)) console.log(dim(`   - ${f.slice(0, 140)}`));
  if (faults.length > 8) console.log(dim(`   … +${faults.length - 8} more`));
  return faults.length;
}

export function printTotals(totals) {
  console.log(`\n${dim('-- cost & time --')}`);
  if (totals.cases) {
    console.log(
      `  agent runs      ${String(totals.agentRuns).padStart(4)} run(s) over ${totals.cases} case(s)   ` +
        `${totals.costReported === false ? dim('cost not reported by the harness') : money(totals.costUsd)}   agent time ${dur(totals.agentDurationMs)} ${dim('(sums parallel work)')}`,
    );
  }
  if (totals.triggerCalls) {
    console.log(
      `  trigger calls   ${String(totals.triggerCalls).padStart(4)} classification call(s)   ` +
        `classifier time ${dur(totals.triggerClassifierMs)}   ${dim('cost not reported by the harness')}`,
    );
  }
  const spans = totals.resumes ? dim(` (spans ${totals.resumes} resume(s), so it includes the dead time)`) : '';
  console.log(`  wall clock      ${dur(totals.wallDurationMs)}${spans}`);
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export function writeJson(outDir, result) {
  fs.mkdirSync(outDir, { recursive: true });
  const p = path.join(outDir, 'result.json');
  fs.writeFileSync(p, JSON.stringify(result, null, 2), 'utf8');
  return p;
}

export function writeHtml(outDir, result) {
  fs.mkdirSync(outDir, { recursive: true });
  const p = path.join(outDir, 'report.html');
  fs.writeFileSync(p, renderHtml(result), 'utf8');
  return p;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function bar(score) {
  const hue = Math.round(score * 120);
  return `<div class="bar"><span style="width:${(score * 100).toFixed(0)}%;background:hsl(${hue} 65% 45%)"></span></div>`;
}

/** The same "this is not a measurement" mark the console prints, as a badge. */
function runsBadge(runs) {
  if (!runs) return '<span class="thin" title="unknown">runs ?</span>';
  return runs >= RELIABLE_RUNS
    ? `<span class="mut">runs ${runs}</span>`
    : `<span class="thin" title="Fewer than ${RELIABLE_RUNS} runs - indicative only, not a measurement.">runs ${runs} &#9888;</span>`;
}

export function renderHtml(result) {
  const title = result.title || 'benchwright';
  const fn = result.functional ?? [];
  const tr = result.trigger ?? [];
  const ab = result.ablation ?? [];
  const totals = result.totals ?? {};
  const thin = [...tr, ...fn.flatMap((f) => f.cases), ...ab.flatMap((a) => a.cases)].some((x) => (x.runs ?? 0) < RELIABLE_RUNS);

  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#111;--mut:#666;--line:#e5e5e5;--card:#fafafa}
@media(prefers-color-scheme:dark){:root{--bg:#111;--fg:#eee;--mut:#999;--line:#2a2a2a;--card:#1a1a1a}}
body{background:var(--bg);color:var(--fg);font:14px/1.55 ui-sans-serif,system-ui,sans-serif;margin:0;padding:2rem;max-width:60rem;margin-inline:auto}
h1{font-size:1.4rem;margin:0 0 .25rem}h2{font-size:1.05rem;margin:2rem 0 .75rem;padding-bottom:.3rem;border-bottom:1px solid var(--line)}
.meta,.mut{color:var(--mut);font-size:.85rem}
.meta{margin-bottom:1rem}
table{width:100%;border-collapse:collapse;font-size:.88rem}th,td{text-align:left;padding:.45rem .6rem;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--mut);font-weight:600;font-size:.78rem;text-transform:uppercase;letter-spacing:.04em}
.bar{background:var(--line);border-radius:3px;height:7px;width:90px;overflow:hidden;display:inline-block;vertical-align:middle}
.bar span{display:block;height:100%}
code{background:var(--card);padding:.1rem .3rem;border-radius:3px;font-size:.85em}
.fail{color:#c0392b}.ok{color:#1e8449}.warn{color:#b7791f}
.thin{color:#b7791f;font-size:.78rem;white-space:nowrap}
.banner{border-left:4px solid #b7791f;background:var(--card);padding:.7rem .9rem;margin:1rem 0;font-size:.86rem}
.banner.stop{border-left-color:#c0392b}
.banner b{display:block;margin-bottom:.2rem}
.legend{background:var(--card);padding:.7rem .9rem;margin:.6rem 0 1rem;font-size:.85rem;border-radius:4px}
.legend dt{font-weight:600;margin-top:.4rem}.legend dd{margin:0;color:var(--mut)}
.derived{color:var(--mut);font-weight:400}
details{margin:.3rem 0}summary{cursor:pointer;color:var(--mut)}
.g{font-size:.83rem;padding:.15rem 0 .15rem 1rem;border-left:2px solid var(--line);margin:.2rem 0}
</style>
<h1>${esc(title)}</h1>
<div class="meta">${esc(result.startedAt)} &middot; harness <code>${esc(result.harness ?? 'claude')}</code> &middot; model <code>${esc(result.model ?? 'harness default')}</code> &middot; judge <code>${esc(result.judgeModel ?? 'harness default')}</code> &middot; layers ${esc((result.layers ?? []).join(', '))}${result.resumes ? ` &middot; resumed ${result.resumes.length}&times;` : ''}</div>

${result.complete ? '' : `<div class="banner stop"><b>This run has not finished.</b>
Everything below is what completed before the run stopped (or is still in flight). Every finished case is already on disk in <code>result.jsonl</code>;
re-run the same command with <code>--resume &lt;this directory&gt;</code> to pick up where it stopped instead of paying for those cases again.</div>`}

${thin ? `<div class="banner"><b>Thin sample &mdash; parts of this report are not a measurement.</b>
Anything tagged <span class="thin">runs 1 &#9888;</span> or <span class="thin">runs 2 &#9888;</span> came from fewer than ${RELIABLE_RUNS} runs.
On an <em>unchanged</em> subject, three consecutive single-run trigger sweeps scored 92%, 83% and 100%, missing different queries each time; three runs per query scored a stable 100%.
Re-run with <code>--runs ${RELIABLE_RUNS}</code> before reporting a regression, a win, or a deletion candidate.</div>` : ''}

${tr.length ? `<h2>Trigger &mdash; routing accuracy</h2><table><tr><th>Subject</th><th>Runs</th><th>Accuracy</th><th>Precision</th><th>Recall</th><th>Misroutes</th></tr>
${tr.map((t) => `<tr><td><code>${esc(t.subject)}</code></td><td>${runsBadge(t.runs)}</td><td>${bar(t.accuracy)} ${pct(t.accuracy)}</td><td>${pct(t.precision)}</td><td>${pct(t.recall)}</td>
<td>${t.misses.length || (t.unstable ?? []).length
    ? [
        ...t.misses.map((m) => `<div class="g fail">${m.expected ? 'missed' : 'false-fire'}: ${esc(m.query)}${m.actuals && m.actuals.length > 1 ? ` <span class="mut">[${m.actuals.map((a) => (a ? 'y' : 'n')).join('')}]</span>` : ''}</div>`),
        ...(t.unstable ?? []).map((u) => `<div class="g warn">flipped between runs: ${esc(u.query)} <span class="mut">[${u.actuals.map((a) => (a ? 'y' : 'n')).join('')}]</span></div>`),
      ].join('')
    : '<span class="ok">none</span>'}</td></tr>`).join('')}
</table>` : ''}

${fn.length ? `<h2>Functional &mdash; artifact quality</h2><table><tr><th>Subject</th><th>Score</th><th>Cases</th></tr>
${fn.map((f) => `<tr><td><code>${esc(f.subject)}</code><div class="meta">${esc(f.category)}</div></td><td>${bar(f.score)} ${pct(f.score)}</td>
<td>${f.cases.map((c) => `<details${c.score < 1 ? ' open' : ''}><summary>${c.score >= 0.999 ? '<span class="ok">PASS</span>' : '<span class="fail">FAIL</span>'} ${esc(c.id)} &mdash; ${pct(c.score)} ${runsBadge(c.runs)}</summary>
${(c.graders ?? []).map((gr) => `<div class="g ${gr.pass ? 'ok' : 'fail'}">${gr.pass ? 'v' : 'x'} <code>${esc(gr.type)}</code> ${esc(gr.label)}${gr.why ? `<div class="meta">${esc(gr.why)}</div>` : ''}</div>`).join('')}
</details>`).join('')}</td></tr>`).join('')}
</table>` : ''}

${ab.length ? `<h2>Ablation &mdash; does the subject earn its tokens?</h2>
<div class="legend">
<b>How to read this table.</b> <em>With</em> and <em>without</em> are the primary numbers; the delta is <span class="derived">derived</span> from them and must never be read on its own.
<dl>
<dt>With &mdash; the only arm your edit moves.</dt><dd>Compare it against the same cell in your previous run. This is where a real change shows up.</dd>
<dt>Without &mdash; the base model, and it drifts.</dt><dd>It moves between runs for reasons that have nothing to do with your edit. A delta that changed sign usually means <em>this</em> arm moved: a subject going from 100/80 = +20% to 100/100 = &plusmn;0% while its with-arm never budged is not a regression.</dd>
<dt>Delta &mdash; derived, and ambiguous by construction.</dt><dd>Before calling a delta change a regression or a win, look at which arm actually moved.</dd>
</dl>
<b>Per-criterion truth table.</b> pass/pass = deletion candidate &middot; pass/fail = what the subject is buying you &middot; fail/pass = the subject is in the way &middot; fail/fail = a genuine gap.
</div>
<table><tr><th>Subject</th><th>Case</th><th>Runs</th><th>With<br><span class="mut">primary</span></th><th>Without<br><span class="mut">baseline, drifts</span></th><th>Delta<br><span class="derived">derived</span></th><th>Reading</th><th>Deletion candidates</th></tr>
${ab.flatMap((a) => a.cases.map((c) => { const d = c.withScore - c.withoutScore; const rd = reading(c.withScore, c.withoutScore);
return `<tr><td><code>${esc(a.subject)}</code></td><td>${esc(c.id)}</td><td>${runsBadge(c.runs)}</td><td>${bar(c.withScore)} <b>${pct(c.withScore)}</b></td><td>${bar(c.withoutScore)} ${pct(c.withoutScore)}</td>
<td class="${d > 0.05 ? 'ok' : d < -0.05 ? 'fail' : 'warn'}">${d >= 0 ? '+' : ''}${pct(d)}</td>
<td><code>${esc(rd.code)}</code><div class="meta">${esc(rd.note)}</div></td>
<td>${(c.deletionCandidates ?? []).length ? c.deletionCandidates.map((x) => `<div class="g warn">${esc(x)}</div>`).join('') : '<span class="ok">none</span>'}</td></tr>`; })).join('')}
</table>` : ''}

<h2>Cost &amp; time</h2>
<table><tr><th>What</th><th>Volume</th><th>Cost</th><th>Time</th></tr>
<tr><td>Agent runs <span class="mut">(functional / ablation)</span></td><td>${totals.agentRuns ?? 0} run(s) over ${totals.cases ?? 0} case(s)</td><td>${totals.costReported === false ? '<span class="mut">not reported by the harness</span>' : money(totals.costUsd ?? 0)}</td><td>${dur(totals.agentDurationMs)} <span class="mut">(sums parallel work)</span></td></tr>
<tr><td>Trigger classifications</td><td>${totals.triggerCalls ?? 0} call(s)</td><td><span class="mut">not reported by the harness</span></td><td>${dur(totals.triggerClassifierMs)}</td></tr>
<tr><td>Wall clock</td><td>${totals.resumes ? `<span class="mut">spans ${totals.resumes} resume(s)</span>` : ''}</td><td></td><td>${dur(totals.wallDurationMs)}</td></tr>
</table>
`;
}
