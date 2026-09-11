# lib/ — agent navigation

The runner: everything between "a subject is selected" and "a record is on disk", one module per stage.

## See also

| Topic | File |
|---|---|
| Layer pyramid and placement rules | [../docs/architecture/layers.md](../docs/architecture/layers.md) |
| Overall pipeline | [../docs/architecture/overview.md](../docs/architecture/overview.md) |
| Contracts a change must not break | [../docs/architecture/constraints.md](../docs/architecture/constraints.md) |
| Code rules | [../docs/development/rules.md](../docs/development/rules.md) |
| Tests | [../docs/development/testing.md](../docs/development/testing.md) |
| Adding a grader / a category | [../docs/change-scenarios/new-grader.md](../docs/change-scenarios/new-grader.md), [new-category.md](../docs/change-scenarios/new-category.md) |

## Boundaries

- Only `agent.mjs` spawns the agent CLI. Prompt templates for the judge and the classifier live there and nowhere else.
- Only `harness/<name>.mjs` knows a CLI: its flags, its output format, its skills directory, its mock-config file, its isolation quirks. `agent.mjs`, `fixtures.mjs` and `skills.mjs` ask the adapter; graders and the runner see canonical events (`Bash` / `Write` / `Edit` / `Read` / `Skill` / `mcp__<server>__<tool>`). Adding a CLI is one adapter file, a fixture sample under `test/fixtures/harness/`, a row in the README table — nothing else changes ([ADR-0004](../docs/adr/0004-harness-adapters.md)).
- `runner.mjs` never reads workspace files; it goes through `fixtures.snapshot()` and the graders.
- `report.mjs` imports nothing from the package and `agent.mjs` imports only `harness/`. Keep it that way — consumers script against them directly.
- The word "skill" is allowed in `skills.mjs` only. Every other module sees a normalized *subject*.
- Do not put tool inputs into the transcript. `output_matches` reads it; the judge gets `toolCalls` separately (ADR-0002).
- A default that can flip a verdict (a regex flag, a trim, an exclude, a prompt wording) is a contract: test + README before changing it.
