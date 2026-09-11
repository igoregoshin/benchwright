# Dependencies

## Internal graph

```
bin/benchwright.mjs → lib/cli.mjs
lib/cli.mjs         → config, subjects, fixtures, agent, graders, runner, report, harness
lib/runner.mjs      → fixtures, agent, graders, harness   (report only through the stream it is handed)
lib/fixtures.mjs    → subjects (copyPath), harness         spawns mocks/* by path
lib/graders.mjs     → agent (judge)
lib/config.mjs      → subjects, skills
lib/skills.mjs      → subjects, harness (default skills directory)
lib/subjects.mjs    → graders (KNOWN_GRADERS)
lib/agent.mjs       → harness
lib/harness/*.mjs   → (nothing in the package; adapters share lib/harness/shared.mjs)
lib/report.mjs      → (nothing in the package)
mocks/*.mjs         → (nothing in the package)
```

## Forbidden directions

- Nothing under `lib/` imports from `lib/cli.mjs`; the CLI is a consumer of the API, not part of it.
- `lib/report.mjs` imports nothing else from the package, and `lib/agent.mjs` imports only `lib/harness/`. Both must stay usable from a consumer's own script.
- Nothing outside `lib/harness/` knows a CLI: no argument list, no output parsing, no `.claude/` / `.opencode/` / `.codex/` path anywhere else ([ADR-0004](../adr/0004-harness-adapters.md)). Adapters import nothing from the rest of the package.
- `mocks/*` never import from `lib/`, and `lib/` never imports a mock: the boundary is a process, and `calls.mjs` is copied into workspaces where `lib/` does not exist.
- `lib/runner.mjs` never touches a config or the file system of a workspace directly — that is what `fixtures` and `snapshot()` are for.

## External dependencies

| Dependency | Purpose | Criticality |
|---|---|---|
| `js-yaml` | Parses case files (`bench.yaml`) and `SKILL.md` frontmatter. | The only runtime dependency. Replaceable, but keep exactly one YAML parser. |
| Claude Code CLI (`claude`) | The default harness: runs the agent, the judge and the trigger classifier. Not an npm dependency; on `PATH` or named by `BENCHWRIGHT_CLAUDE`. | Required for every paid layer when it is the selected harness. `--check`, `--list`, `--build-only`, `--grade-only` work without any CLI. |
| OpenCode CLI (`opencode`) | The `opencode` harness (`--harness opencode`). On `PATH` or named by `BENCHWRIGHT_OPENCODE`; the run points `OPENCODE_CONFIG_DIR` at an empty directory (or `BENCHWRIGHT_OPENCODE_CONFIG_DIR`). | Required only when selected. |
| Codex CLI (`codex`) | The `codex` harness (`--harness codex`). On `PATH` or named by `BENCHWRIGHT_CODEX`. | Required only when selected. |
| `git` | Every `diff` / `repo` / `chain` / `mcp` fixture is a git repository. | Required for functional and ablation runs. |
| POSIX `sh` (Git Bash on Windows) | `command` graders run under it. | Required on Windows for graders whose commands carry `%` or shell syntax; `BENCHWRIGHT_SHELL` overrides. |
| `node:test` | Test runner. | Dev only; no test framework dependency. |

Adding a runtime dependency is a contract change for every consumer's install: see [`../change-scenarios/dep-upgrade.md`](../change-scenarios/dep-upgrade.md).
