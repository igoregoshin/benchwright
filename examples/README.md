# Examples

Small, complete, commented setups — one per way of using benchwright. Every file in here is real
input the runner accepts, checked by `npm test` (`test/examples.test.mjs`), so it cannot drift from
the code. Nothing here spends money unless you run a paid layer yourself.

| Directory | Shows | Config form | Category |
|---|---|---|---|
| [`skill/`](skill/) | A directory of Agent Skills discovered by `skillSubjects`, with a registry (one benchmarked skill, one exempt), trigger queries, two functional cases, every rule grader and an `llm` grader | `benchwright.config.mjs` | `repo` |
| [`rules-file/`](rules-file/) | A rules file (`AGENTS.md`) as the subject: declarative `install.copy`, a `diff` fixture with a staged change, `autopilot` answering a "which ticket?" gate, and a case whose realistic failure is "committed the credentials too" | `benchwright.config.json` | `diff` |
| [`mock-services/`](mock-services/) | A skill that talks to an issue tracker, run against recorded mocks over both transports — MCP over stdio and HTTP — with `.bench/calls.mjs` graders on what was really called | `benchwright.config.mjs` | `mcp` |
| [`programmatic/`](programmatic/) | The API instead of the CLI: `check()` as a unit test, and `buildWorkspace` → `snapshot` → `gradeCase` as a dry run that proves the graders catch something | — | — |
| [`sample-run/`](sample-run/) | What a finished run leaves behind: `result.jsonl`, `result.json`, `report.html` and the console summary, with a note on how to read each block | — | — |

## Try them without an agent CLI

From any example directory:

```bash
npx benchwright --list                    # what was discovered, with case ids
npx benchwright --check                   # every case and every grader regex validated; exit 1 on problems
```

Build a case's workspace exactly as the runner would, then grade it — first untouched, then after
doing the work by hand. A grader that gives the same verdict in both states measures nothing:

```bash
cd examples/skill
npx benchwright --subject changelog --case unreleased-from-commits --build-only --out /tmp/ws
npx benchwright --subject changelog --case unreleased-from-commits --grade-only /tmp/ws/changelog__unreleased-from-commits
# → every file grader fails (exit 1). Write CHANGELOG.md in that directory and grade again → they pass.
```

The same thing as three function calls: `node examples/programmatic/dry-run.mjs`.

## Run them for real

With `claude`, `opencode` or `codex` on PATH (pick one with `--harness`), from the example directory:

```bash
npx benchwright --subject changelog --layer trigger --runs 3        # ~18 cheap classifier calls
npx benchwright --subject changelog --layer functional --runs 3     # 6 agent runs + graders
npx benchwright --subject changelog --layer ablation --runs 3       # 12 agent runs: with vs without
```

Results land in `<example>/bench-results/<timestamp>/` (git-ignored). [`sample-run/`](sample-run/)
shows what to expect there and how to read it — in particular why the two ablation arms are printed
before the delta, and what a *deletion candidate* is.

## How the pieces fit

```
benchwright.config.*      what to benchmark (subjects) and the defaults
  └─ subject              id · category · description · install · cases
       ├─ description     → trigger layer: does a query route here?
       ├─ install         → the "with" arm gets it, the "without" arm does not
       └─ case
            ├─ prompt      what the agent is asked
            ├─ fixture     what exists before it starts (files, commits, a diff, mocks)
            ├─ autopilot   answers for the subject's "ask the user" gates
            └─ graders     rules first (file_*, command, tool_used, no_writes), llm last
```

Two things every example is careful about, because they decide whether a number means anything:

- **Autopilot states facts a user would say, never the convention under test.** It is given to
  both ablation arms; a convention written there teaches the baseline too, and the delta collapses.
- **Every grader has one failure it catches, and the examples say which.** "Nothing happened" is
  rarely the realistic failure; "did step one and not step two" usually is.

The README at the repository root is the reference for every field used here.
