# Development rules

Hard requirements. Short on purpose; the reasoning behind each lives in [`../architecture/constraints.md`](../architecture/constraints.md) and the ADRs.

## Code

- Plain ESM, `node:` imports, no transpilation, no new runtime dependencies without a [dep-upgrade](../change-scenarios/dep-upgrade.md) pass.
- Stay within the layer pyramid in [`../architecture/layers.md`](../architecture/layers.md): stages return data, the CLI prints, the runner orchestrates, mocks stay standalone.
- Every path that can come from a user goes through `path.resolve` against `config.root` (definitions) or the workspace (fixtures). Never build a file path from `import.meta.url` by string manipulation.
- Errors that a user can fix are **problems** (strings collected and printed together, exit code `2`), not thrown exceptions. Exceptions are for bugs and for genuinely unusable state (a mock fixture that does not exist mid-run).
- A grader error (`error: true`) is a harness fault and stays distinguishable from a failed verdict all the way to the report.
- No vendor names anywhere in the package — see [`../architecture/constraints.md`](../architecture/constraints.md) → Vendor neutrality.
- Comments explain *why* — a trap, a rejected alternative, a measured number. Restating what the code does is noise.

## Behaviour changes

- Anything listed under "Contracts a consumer depends on" in [constraints](../architecture/constraints.md) changes only through the [api-change](../change-scenarios/api-change.md) scenario: a test, a README update, and an ADR when the reasoning is not obvious.
- A default that can flip a grader verdict is never changed "while at it".

## Tests

- Every module in `lib/` and `mocks/` has a test file; a new behaviour comes with a test that fails without it. Details in [`testing.md`](testing.md).
- Tests never call the agent CLI and never cost money. `BENCHWRIGHT_CLAUDE` is pointed at a non-existent binary in CLI tests on purpose.
- Every test that writes to disk uses `fs.mkdtempSync` and removes what it created.

## Commits

- Conventional Commits: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`; a `!` and a body when a contract changes.
- A commit builds and passes `npm test` on its own.

## Pull requests

- One concern per PR. A contract change and a refactor never share one.
- The description answers "what" and "why", names the affected contract when there is one, and links the ADR if one was added. Reviewer checklist: [`review.md`](review.md).

## Security

- Never log or persist a secret: the HTTP mock writes fixture secrets to the workspace file the config names, and deletes the same keys from `process.env` so a real one is never used by mistake. Keep both halves.
- Mocks bind loopback only. Fixture remotes push into a local bare repository, never over the network.
- Command graders execute fixture-authored shell; that is by design, in a throwaway workspace. Never run them against a directory the user did not name explicitly (`--grade-only`).
