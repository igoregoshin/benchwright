# Code review

## Reviewer checklist

- [ ] Tests cover the happy path and the failure the change is about; a fixed trap has a test that names it.
- [ ] `npm test` passes on Windows and on a POSIX shell (line endings, path handling, `sh` vs `cmd.exe`).
- [ ] The layer pyramid holds ([`../architecture/layers.md`](../architecture/layers.md)): no stage prints, no module imports the CLI, mocks import nothing from `lib/`.
- [ ] If a contract from [`../architecture/constraints.md`](../architecture/constraints.md) changed: the README documents it, a test pins it, and — when the reasoning is not obvious — an ADR records it. A silent change to a default that can flip a verdict is a blocker.
- [ ] Nothing can spend money in a test or in a free mode (`--check`, `--list`, `--build-only`, `--grade-only`).
- [ ] No vendor or product names; no real secrets, hosts or tokens in fixtures or docs.
- [ ] Problems a user can fix are reported as problems (collected, exit `2`), not as stack traces.
- [ ] Anything the mocks answer is recorded, never invented; an unmatched call is still an error.
- [ ] The result stream stays append-only and every derived file can be rebuilt from it.
- [ ] Docs touched when the change touched a documented rule; `docs/` and the README do not repeat each other.

## Author checklist

- [ ] Self-review done against the list above.
- [ ] The PR description says what changed, why, and which contract (if any) it touches.
- [ ] One concern per PR; a refactor and a behaviour change are separate.
- [ ] Commit messages follow Conventional Commits; a contract change carries `!` and a body.
