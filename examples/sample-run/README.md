# A finished run, annotated

What `benchwright --subject changelog --layer trigger --layer functional --layer ablation --runs 3`
leaves behind for the [`skill/`](../skill/) example, and how to read it.

**The numbers are illustrative, not measured.** The records in [`generate.mjs`](generate.mjs) were
written by hand to show every shape a run can print — a missed trigger query, one that flips
between runs, a grader failing in the with-arm, deletion candidates. Everything derived from them is
real: the records went through the runner's own `openRun` / `finalize`, which wrote
[`result.jsonl`](result.jsonl) and rebuilt [`result.json`](result.json) and [`report.html`](report.html)
from it, and [`console.txt`](console.txt) is what the runner's printers produced for that result.
`npm test` regenerates the console text and fails if this directory is stale.

## The files

| File | What it is |
|---|---|
| `result.jsonl` | The source of truth. One line per finished unit, appended the moment it is known: a `meta` line, one `trigger` line per (query, run), one `case` line per case, an `end` line. A killed run keeps everything up to the kill; `--resume` skips what is already here. |
| `result.json` | Derived from the stream: trigger rows with majority votes, functional and ablation rows per subject, totals. |
| `report.html` | The same, as a page: bars per case, a *"not a measurement"* banner when any number came from fewer than 3 runs, the ablation cells. |
| `console.txt` | The end-of-run summary. Reproduced below with notes. |

## The console summary, block by block

```
-- trigger (routing) --
  changelog                      acc 83%  P 100%  R 67%  runs 3
      x missed "write release notes from the commits since the last tag" [nny]
      ~ flipped between runs "write release notes from the commits since the last tag" [nny]
      ~ flipped between runs "add the recent fixes to CHANGELOG.md" [yyn]
```

Each query was classified 3 times; the verdict is the majority. `[nny]` is the per-run spread. The
first query is a **miss**: two of three runs did not route to the skill, so its description does
not carry that phrasing. The second only **flipped** — the majority still got it right — which is
reported as instability, not as a regression. Precision 100% means no false fires: none of the
three "should not trigger" queries routed here.

```
-- functional --
  changelog                      94%  2 case(s)
    v unreleased-from-commits  100%  runs 3
    x keeps-released-sections  89%  runs 3
        x [command] grep -m1 '^## ' CHANGELOG.md
          output does not match /Unreleased/: ## [1.1.0] - 2026-08-20
```

Score = passed weight ÷ total weight, `with_only` graders excluded. Only failing graders are
listed, with the grader's own reason: here the first `## ` heading in the file was the released
section, so Unreleased went below it.

```
-- ablation (with subject vs without) --
  changelog / unreleased-from-commits  runs 3
      with     100%    primary  - moves only when the subject changes
      without  57%     baseline - drifts on its own between runs
      delta    +43%    derived  - pass/fail: what the subject is buying you — protect it with a free invariant
      ! passes without the subject too: CHANGELOG.md
      ! passes without the subject too: git rev-list --count HEAD
```

Read the two arms before the delta. **with** is the only number your edit to the skill can move;
**without** is the base model and drifts on its own. A delta that shrinks because *without* rose is
not a regression. `pass/fail` is the cell of the four-way reading (both arms ≥ 80% = `pass/pass`,
and so on).

The `!` lines are **deletion candidates**: graders that passed in both arms. The base model also
creates `CHANGELOG.md` and also does not commit — so those two graders say nothing about the
skill. They still belong in the case (they catch a broken run), but they are not evidence the
skill's text earns its tokens; the graders that failed *without* are.

```
-- cost & time --
  agent runs        12 run(s) over 2 case(s)   $0.8094   agent time 6m 53s (sums parallel work)
  trigger calls     18 classification call(s)   classifier time 51s   cost not reported by the harness
  wall clock      9m 37s
```

12 = 2 cases × 3 runs × 2 arms. The trigger layer goes through a plain prompt call that reports no
cost, so the dollar figure covers agent runs only; on a harness that reports tokens but no money
(Codex CLI) the line says *not reported* instead of `$0`.

## What is not in this sample

- The **thin-sample banner** (`!! NOT A MEASUREMENT`): every number here came from 3 runs. Run
  with `--runs 1` and it appears at the bottom, and the HTML marks every such row.
- The **harness-faults banner**: no grader errored. A `could not run:` or `judge returned no verdict`
  would print it and make `--threshold` exit 1, because a harness that failed to measure is not a result.
