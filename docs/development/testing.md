# Testing

## Tools

`node:test` with `node:assert/strict`, nothing else. Run everything with:

```bash
npm test                      # node --test test/*.test.mjs
node --test test/graders.test.mjs
```

The suite needs `git` and, on Windows, Git Bash (command graders). It never needs the agent CLI: nothing in `test/` spends a token.

## Where tests live

One file per module, named after it: `test/<module>.test.mjs` for `lib/<module>.mjs`; `test/mocks.test.mjs` covers all three mock scripts; `test/cli.test.mjs` drives the real binary through `spawnSync`. `test/sources.test.mjs` holds repository-wide invariants (no NUL bytes, no vendor names).

## What is tested, by layer

| Layer | What the tests prove |
|---|---|
| Graders | Each rule grader's pass and fail paths; the scoring rule (`with_only` excluded, weights); the traps that bit real cases — trailing-newline trimming, `%` surviving the shell, unknown types being errors. |
| Definitions | Normalization defaults, every `validateSubject` problem, config discovery order, both config forms, the `skills` preset with a registry and every registry disagreement. |
| Fixtures | Real git repositories: baseline commit, staged vs working-tree change, branches, the local push remote, `install` running only in the with-arm, excludes reaching both `.git/info/exclude` and `snapshot()`. |
| Report | Stream keys and resume, truncated last line, majority vote and instability, grouping, legacy `skill` records, harness-fault counting, HTML markers. |
| Mocks | HTTP: matching, sequencing, `501` on unmatched, logging; MCP: handshake, schemas, `when` selection, error results, `writesFileFromArg`; `calls.mjs` selectors and exit codes. |
| CLI | Exit codes for every user mistake, `--check` on good and bad configs, `--list`, `--build-only` producing a gradable workspace, `--grade-only` failing then passing, fail-fast on a missing agent binary. |

| Harness adapters | `test/harness.test.mjs`: every adapter's `parseEvents` on a trimmed real sample of its CLI's output (`test/fixtures/harness/<name>/case.jsonl` — paths and ids replaced by placeholders; keep them real, never hand-written), the flags `caseCommand` / `promptCommand` emit, `writeMcpConfig` parsed back, the registry, the model-default precedence, the `.cmd` shim resolver, and `runCase` plumbing through a fake adapter whose "CLI" is Node echoing stdin. |

The agent module's spawn path is otherwise exercised only by a paid run. `npm run test:live` (`test/live/*.live.test.mjs`) is that run: skipped unless `BENCHWRIGHT_LIVE=1`, one tiny case per installed harness through the real `runCase`, asserting the file, a canonical tool event and a transcript. Run it after touching an adapter; it is never part of `npm test` or CI.

## Writing a test

- Build inputs by hand (a `run` record, a `files` map, a subject literal) rather than through the CLI, unless the CLI is the thing under test.
- A test that proves a trap is fixed states the trap in a comment: the next reader must not "simplify" it away.
- `mkdtempSync` + `rmSync` in `before` / `after`. Tests share nothing on disk.
- Assert on problem *messages* with a regex, not on their order.

## Coverage

There is no coverage gate. The bar is behavioural: a change to anything under "Contracts a consumer depends on" ([constraints](../architecture/constraints.md)) without a test that would have failed before the change is not mergeable.
