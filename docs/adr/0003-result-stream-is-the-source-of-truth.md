# ADR-0003: `result.jsonl` is the source of truth; every other output is derived

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

A run costs real money and real time, and runs do get killed: a long ablation, background pressure, an operating system reclaiming memory. The first runner wrote its report once, at the very end, so a kill threw away every case that had already been paid for — three times in a row before this was fixed.

## Decision

Every finished unit of work — one trigger classification, one graded case — is appended synchronously to `<out>/result.jsonl` the moment it is known, keyed by the work it represents (`trigger|subject|query|run`, `case|subject|id|fn|ab`). `result.json` and `report.html` are **derived** from that stream: rebuilt during the run (throttled), at the end, on `--resume`, and on a caught signal.

`--resume` reopens a results directory, reloads the stream, and both runner loops skip every key already present. A truncated final line (a kill mid-write) is tolerated and dropped.

## Consequences

- Gains: a killed run leaves a complete, readable record; resumption restarts at the granularity of one model call; the derived files can be regenerated for free at any time.
- Costs: records must be self-describing (they carry subject, category, sections, runs) because aggregation cannot consult the config; every new record kind needs a key or an explicit "no key".
- The runner never buffers a finished unit in memory. A change that holds records back "to write them nicely" reverses this decision.

## Alternatives considered

- **Write the report after each subject.** Still loses a whole subject's paid cases on a kill; the unit of loss must be one call.
- **A database or a lock file.** Nothing a JSONL append does not already give, and it would break "inspect any stage with a text editor".
