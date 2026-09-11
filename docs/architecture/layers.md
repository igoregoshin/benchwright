# Layers and modules

## Dependency pyramid

Top to bottom; a module may import only from the layers below it.

1. **CLI** — `bin/benchwright.mjs`, `lib/cli.mjs`. Parses arguments, discovers the config, selects subjects, runs the free modes, prints. Knows every layer below; nothing below knows it.
2. **Runner** — `lib/runner.mjs`. The three layers as loops. Knows fixtures, agent, graders and the result stream; knows nothing about configs or the CLI.
3. **Stages** — `lib/fixtures.mjs`, `lib/agent.mjs`, `lib/graders.mjs`. Each does one thing for one case and returns plain data. `graders` may call `agent.judge`; `fixtures` may spawn `mocks/*`.
4. **Definitions** — `lib/config.mjs`, `lib/subjects.mjs`, `lib/skills.mjs`. Turn a config into normalized subjects and validate them. `config` knows `subjects` and `skills`; `skills` knows `subjects`; `subjects` knows only `graders` (for the list of known types).
5. **Report** — `lib/report.mjs`. Records in, files and console out. Depends on nothing in the package.
6. **Mocks** — `mocks/*.mjs`. Separate processes with their own `argv` contract; they import nothing from `lib/` and `lib/` imports nothing from them.

`index.mjs` re-exports the public surface; `index.d.ts` types it.

## Modules

| Area | Path | Responsibility |
|---|---|---|
| Entry point | `bin/` | The executable; delegates to `lib/cli.mjs`. |
| Runner and stages | `lib/` | Everything that happens between "a subject is selected" and "a record is on disk". |
| Mock services | `mocks/` | Replay recorded MCP tool responses and HTTP routes; log every call; `calls.mjs` is the grader-side query helper. |
| Tests | `test/` | One file per module plus `sources.test.mjs` (repo-wide invariants). |

## Placement rules

- **Anything that spawns the agent CLI goes in `lib/agent.mjs`** — the prompt templates for the judge and the classifier included. No other module builds `claude` argument lists.
- **Anything that touches the workspace before the agent runs goes in `lib/fixtures.mjs`**; anything that reads it back after the run goes through `snapshot()` and the graders. The runner never reads workspace files itself.
- **A rule grader is a pure function of `{ g, run, workdir, files }`** in `lib/graders.mjs`. It never calls the agent; only the `llm` type does, through `judge`.
- **Subject-kind knowledge stays in the definition layer.** `runner`, `fixtures`, `graders` and `report` see only the normalized subject shape; the word "skill" belongs in `lib/skills.mjs` and in the consumer's config.
- **Console output lives in `lib/report.mjs` (summaries) and `lib/cli.mjs` (usage, problems).** Stages return data and never print.
- **Mocks stay standalone.** They are spawned by path, configured by `argv`, and must keep working when copied out of the package — `calls.mjs` literally is.

## Anti-patterns

- Rendering tool inputs into the transcript "so the judge can see them": the transcript is what `output_matches` reads, and a file path the agent merely opened would satisfy a "mentions X" pattern. The judge has its own `toolCalls` channel — see [ADR-0002](../adr/0002-judge-sees-tool-calls-transcript-does-not.md).
- Hiding harness scaffolding with a `.gitignore` inside the workspace: a tracked ignore file is itself a fixture difference the agent can see and commit. `.git/info/exclude` is the place.
- Writing the report once at the end. A killed run must leave everything it computed; append to the stream first, derive the files second — see [ADR-0003](../adr/0003-result-stream-is-the-source-of-truth.md).
- A "cheap" default that changes a verdict (a regex flag, a trim, an exclude) added without a test and a README note. Every consumer's cases inherit it.
