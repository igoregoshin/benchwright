# Architecture overview

## Context

benchwright answers one question a test suite cannot: **does the thing you hand an agent make the agent better at the job, and is it still doing so after you edited it?** The "thing" is a *subject* — a skill, a rules file, a prompt fragment, an MCP wiring — and the answer comes from running a real agent session in a prepared workspace, with the subject installed and without it, and grading what came out.

Upstream, a consumer project supplies a config that declares its subjects and their cases. Downstream, the runner produces a results directory (`result.jsonl`, `result.json`, `report.html`) and a console summary. The only external system is an agent CLI on `PATH` — Claude Code, OpenCode or Codex CLI, chosen per run — driven through a harness adapter: the runner never talks to a model API itself, so it inherits whatever authorization the CLI already has.

## Top-level components

| Component | Responsibility |
|---|---|
| `bin/` + `lib/cli.mjs` | Argument parsing, config discovery, subject selection, the free modes (`--check`, `--list`, `--build-only`, `--grade-only`), preflight, signal handling, the final summary. |
| `lib/config.mjs`, `lib/subjects.mjs`, `lib/skills.mjs` | The definition layer: load a config, turn whatever it declares into normalized subjects, validate every case before anything is paid for. `skills.mjs` is the built-in discovery for Agent Skills directories. |
| `lib/runner.mjs` | The three layers — trigger, functional, ablation — as loops over subjects and cases that stream every finished unit to the result stream. |
| `lib/fixtures.mjs` | Builds the workspace a case needs (git repo, files, diff, branch, remote, mock services) and installs the subject for the *with* arm. |
| `lib/agent.mjs` | The only place that spawns the agent CLI: one case run, the LLM judge, the trigger classifier — through whichever adapter the run selected. |
| `lib/harness/` | One adapter per agent CLI (Claude Code, OpenCode, Codex CLI): the command line, the parser that turns the CLI's output into canonical events, where skills and mock configs go in a workspace. |
| `lib/graders.mjs` | Rule graders and the bridge to the judge; the score of a case. |
| `lib/report.mjs` | The append-only result stream, aggregation, console printing, `result.json`, `report.html`. |
| `mocks/` | Standalone processes the fixture builder spawns or wires in: an MCP server over stdio, an HTTP server, and the call-log query helper copied into every mocked workspace. |

## Key flows

**A functional case.** `cli` resolves the harness and selects the subject → `runner` asks `fixtures` for a workspace (with-arm: subject installed where that harness reads skills) → `agent` runs the harness's CLI in it and the adapter parses the output into canonical events → `fixtures.snapshot` reads back the files → `graders` score them, calling `agent.judge` for `llm` criteria → the record is appended to the stream → `report` rebuilds the derived files. Ablation repeats the case with the without-arm and compares graders pairwise.

**A trigger query.** No workspace at all: `runner` hands the subject's `description` and one query to `agent.classifyTrigger`; several runs per query are aggregated by majority in `report`.

**Resume.** `report.openRun` reloads `result.jsonl`, and both runner loops skip any unit whose key is already on disk. That is why every record is keyed by the work it represents, not by when it happened.

## Technology decisions

- **Plain ESM JavaScript, no build.** Node ≥ 20.11, one runtime dependency (`js-yaml`). TypeScript consumers get `index.d.ts`.
- **The agent CLI is the model API.** Spawning the CLI keeps the runner free of API keys and billing plumbing; see [constraints](constraints.md). Each CLI is confined to one adapter and the rest of the runner sees one event contract — [ADR-0004](../adr/0004-harness-adapters.md).
- **Files are the interface between stages.** Workspaces on disk, mocks logging to a JSONL file, results as an append-only stream — every stage can be inspected or resumed without the runner.

## See also

- [layers.md](layers.md) — the dependency pyramid and where new code goes.
- [dependencies.md](dependencies.md) — allowed and forbidden directions, external dependencies.
- [constraints.md](constraints.md) — what a change must not break.
- [../adr/README.md](../adr/README.md) — the decisions behind the shape.
