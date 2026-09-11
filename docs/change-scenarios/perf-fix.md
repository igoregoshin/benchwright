# Scenario: performance and cost of a run

## When to apply

A run takes longer or costs more than its cases justify: judge calls that could be rules, repeated workspace builds, idle waiting, memory pressure from concurrency, oversized judge prompts.

## Read first

- [`../architecture/layers.md`](../architecture/layers.md) — where each cost is paid (agent calls in `agent`, workspace builds in `fixtures`, aggregation in `report`).
- The README sections *Three layers* and *Before you read a number* — the cost model consumers plan around.

## Steps

1. Measure first, from the run's own `totals` (`agentRuns`, `costUsd`, `agentDurationMs`, `triggerCalls`) and the per-record `durationMs`. Name the number you intend to move.
2. Prefer removing paid work over speeding it up: a criterion expressible as a rule should not be an `llm` grader; a trigger query should not be re-run once its key is on disk.
3. Do not trade correctness for speed: the judge's truncation limits and the `--runs` semantics are contracts; concurrency defaults are bounded by memory on real machines.
4. Measure after, with the same cases and `--runs`; put both numbers in the commit body.
5. If the change alters what a consumer pays for (fewer calls, a different default concurrency), document it in the README.

## Checklist

- [ ] Before and after numbers from `result.json` in the commit body.
- [ ] No verdict changed for the cases used to measure.
- [ ] Resume keys still cover every unit of paid work.
- [ ] Memory warning threshold and concurrency default still match what a loaded workstation survives.

## Typical mistakes

- Parallelising the judge or cases beyond what memory allows: each case is a full agent session, and the OS killing the runner costs more than the time saved.
- Caching a workspace across arms or runs: the arms must be built identically and fresh.
- Reading a thin-sample number as the baseline for a performance claim.
