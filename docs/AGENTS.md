# docs/AGENTS.md

Documentation navigation for AI agents: "task → files to read". General rules are in the root [`../AGENTS.md`](../AGENTS.md).

## By task type

| Task | Read first |
|---|---|
| New feature / new CLI flag | [`change-scenarios/new-feature.md`](change-scenarios/new-feature.md) + [`architecture/overview.md`](architecture/overview.md) |
| New grader type | [`change-scenarios/new-grader.md`](change-scenarios/new-grader.md) + [`architecture/layers.md`](architecture/layers.md) |
| New fixture category | [`change-scenarios/new-category.md`](change-scenarios/new-category.md) + [`architecture/layers.md`](architecture/layers.md) |
| Bugfix | [`change-scenarios/bugfix.md`](change-scenarios/bugfix.md) + the module named in the report |
| Refactor | [`change-scenarios/refactor.md`](change-scenarios/refactor.md) + [`architecture/layers.md`](architecture/layers.md) |
| Public contract (config, case format, CLI, result files, API) | [`change-scenarios/api-change.md`](change-scenarios/api-change.md) + [`architecture/constraints.md`](architecture/constraints.md) |
| Defaults / environment variables | [`change-scenarios/config-change.md`](change-scenarios/config-change.md) + [`architecture/constraints.md`](architecture/constraints.md) |
| Dependency or Node upgrade | [`change-scenarios/dep-upgrade.md`](change-scenarios/dep-upgrade.md) + [`development/rules.md`](development/rules.md) |
| Performance / cost of a run | [`change-scenarios/perf-fix.md`](change-scenarios/perf-fix.md) + [`architecture/layers.md`](architecture/layers.md) |
| A run misled someone / postmortem | [`change-scenarios/incident-postmortem.md`](change-scenarios/incident-postmortem.md) + [`development/review.md`](development/review.md) |
| Code review | [`development/review.md`](development/review.md) + [`development/rules.md`](development/rules.md) |
| Release / publish | [`development/releases.md`](development/releases.md) |
| Planning | [`../README.md`](../README.md) (top) + [`architecture/overview.md`](architecture/overview.md) |

## Directory map

- `architecture/` — [overview](architecture/overview.md), [layers](architecture/layers.md), [dependencies](architecture/dependencies.md), [constraints](architecture/constraints.md)
- `development/` — [rules](development/rules.md), [testing](development/testing.md), [review](development/review.md), [releases](development/releases.md)
- `change-scenarios/` — playbooks for typical changes
- `adr/` — [architectural decision records](adr/README.md)
- [`glossary.md`](glossary.md) — the terms the runner and its reports use
