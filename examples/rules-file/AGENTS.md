# Project rules

These rules apply to every agent working in this repository.

## Commits

- Commit messages follow Conventional Commits: `type(scope): subject`. The subject is in the
  imperative mood, lower-case, at most 72 characters. Allowed types: `feat`, `fix`, `refactor`,
  `perf`, `chore`, `docs`, `test`.
- Every commit body ends with a line `Refs: <ticket>` naming the ticket the change belongs to.
  If the request does not name a ticket, ask the user for it before committing.
- Never commit files that hold credentials: `.env`, `*.pem`, `*secrets*`. Unstage them and say so.

## Code

- Keep exports named; no default exports.
