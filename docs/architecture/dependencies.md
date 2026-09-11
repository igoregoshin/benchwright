# Dependencies

## Internal graph

```
bin/benchwright.mjs → lib/cli.mjs
lib/cli.mjs         → config, subjects, fixtures, agent, graders, runner, report
lib/runner.mjs      → fixtures, agent, graders            (report only through the stream it is handed)
lib/fixtures.mjs    → subjects (copyPath)                  spawns mocks/* by path
lib/graders.mjs     → agent (judge)
lib/config.mjs      → subjects, skills
lib/skills.mjs      → subjects
lib/subjects.mjs    → graders (KNOWN_GRADERS)
lib/agent.mjs       → (nothing in the package)
lib/report.mjs      → (nothing in the package)
mocks/*.mjs         → (nothing in the package)
```

## Forbidden directions

- Nothing under `lib/` imports from `lib/cli.mjs`; the CLI is a consumer of the API, not part of it.
- `lib/report.mjs` and `lib/agent.mjs` import nothing else from the package. They must stay usable from a consumer's own script.
- `mocks/*` never import from `lib/`, and `lib/` never imports a mock: the boundary is a process, and `calls.mjs` is copied into workspaces where `lib/` does not exist.
- `lib/runner.mjs` never touches a config or the file system of a workspace directly — that is what `fixtures` and `snapshot()` are for.

## External dependencies

| Dependency | Purpose | Criticality |
|---|---|---|
| `js-yaml` | Parses case files (`bench.yaml`) and `SKILL.md` frontmatter. | The only runtime dependency. Replaceable, but keep exactly one YAML parser. |
| Claude Code CLI (`claude`) | Runs the agent, the judge and the trigger classifier. Not an npm dependency; must be on `PATH` or named by `BENCHWRIGHT_CLAUDE`. | Required for every paid layer. `--check`, `--list`, `--build-only`, `--grade-only` work without it. |
| `git` | Every `diff` / `repo` / `chain` / `mcp` fixture is a git repository. | Required for functional and ablation runs. |
| POSIX `sh` (Git Bash on Windows) | `command` graders run under it. | Required on Windows for graders whose commands carry `%` or shell syntax; `BENCHWRIGHT_SHELL` overrides. |
| `node:test` | Test runner. | Dev only; no test framework dependency. |

Adding a runtime dependency is a contract change for every consumer's install: see [`../change-scenarios/dep-upgrade.md`](../change-scenarios/dep-upgrade.md).
