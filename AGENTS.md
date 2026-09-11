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

## Two rules that are easy to miss

- **This package is vendor-neutral.** No company, product or client name may appear in code, comments, tests or docs; `test/sources.test.mjs` fails the build on the ones it knows about. Project-specific conventions belong in the consumer's config, never here.
- **Behaviour changes are not refactors.** Anything that can flip a grader verdict — trimming, transcript rendering, what the judge sees, exclude rules — is a public contract for every consumer's cases. Change it deliberately, document it in the README's traps or an ADR, and cover it with a test.
