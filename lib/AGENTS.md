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
- `runner.mjs` never reads workspace files; it goes through `fixtures.snapshot()` and the graders.
- `report.mjs` and `agent.mjs` import nothing from the package. Keep it that way — consumers script against them directly.
- The word "skill" is allowed in `skills.mjs` only. Every other module sees a normalized *subject*.
- Do not put tool inputs into the transcript. `output_matches` reads it; the judge gets `toolCalls` separately (ADR-0002).
- A default that can flip a verdict (a regex flag, a trim, an exclude, a prompt wording) is a contract: test + README before changing it.
