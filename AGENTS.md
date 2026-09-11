# AGENTS.md

Instructions for AI agents working in this repository.

## Before any task: context from docs/

`docs/` is the canonical source of project context for an agent. **Do not start on code until the relevant context has been collected from there.**

Workflow:

1. Open [`docs/AGENTS.md`](docs/AGENTS.md) — the map "task type → files to read".
2. Find your scenario in [`docs/change-scenarios/`](docs/change-scenarios/) (`new-feature`, `new-grader`, `new-category`, `bugfix`, `refactor`, `api-change`, …).
3. Read the files in that scenario's "Read first" section (usually `architecture/*`).
4. If the task edits files, always read [`docs/development/rules.md`](docs/development/rules.md) as well; scenarios do not repeat it. Adding or changing tests — also [`docs/development/testing.md`](docs/development/testing.md).
5. Only then write code.

If no scenario fits, the baseline is [`docs/architecture/overview.md`](docs/architecture/overview.md) + [`docs/development/rules.md`](docs/development/rules.md).

## Other entry points

- [`README.md`](README.md) — what the tool is, requirements, the config and case formats, every trap the runner was built around.
- [`docs/architecture/overview.md`](docs/architecture/overview.md) + [`layers.md`](docs/architecture/layers.md) — the pipeline (`cli → runner → fixtures / agent / graders → report`) and what may depend on what.
- [`docs/development/rules.md`](docs/development/rules.md) — hard requirements: vendor neutrality, no paid calls in tests, the case-format compatibility promise.

## Versioning: which part of the version a change bumps

SemVer, decided by the change's effect on a consumer's existing cases and config, not by the size of the diff:

- **major** — an existing consumer's cases could parse differently or *grade differently* after upgrading: a case / config / CLI / result-file contract changed, a grader's fields or semantics changed, a default that can flip a verdict moved, an environment variable was renamed, an export was removed. The full contract list is in [`docs/architecture/constraints.md`](docs/architecture/constraints.md).
- **minor** — something new that leaves every existing case and config behaving exactly as before: a grader type, a category, a flag, a config field, an export, a fixture option.
- **patch** — a fix with no contract change: the code now does what the README already said.

Rules of thumb: a bugfix that *changes verdicts* is major, not patch (say so in the release notes, consumers' historical numbers were wrong); an addition with a new *required* field is major; a change that can be expressed as "old behaviour still available via X" is minor. Before `1.0.0` a breaking change bumps minor and the release notes say so in the first line. The bump is applied in `package.json` in the same PR as the change; a GitHub release with tag `v<version>` is what publishes ([`docs/development/releases.md`](docs/development/releases.md)).

## Two rules that are easy to miss

- **This package is vendor-neutral.** No company, product or client name may appear in code, comments, tests or docs; `test/sources.test.mjs` fails the build on the ones it knows about. Project-specific conventions belong in the consumer's config, never here.
- **Behaviour changes are not refactors.** Anything that can flip a grader verdict — trimming, transcript rendering, what the judge sees, exclude rules — is a public contract for every consumer's cases. Change it deliberately, document it in the README's traps or an ADR, and cover it with a test.
