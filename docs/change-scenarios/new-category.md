# Scenario: new fixture category

## When to apply

A subject needs a starting state none of the existing categories builds — a workspace shape, not a bigger fixture. Before adding one, check whether a fixture option (`files`, `changed`, `commits`, `remote`, `mocks`) already expresses it; categories differ only in *what must exist before the agent starts*.

## Read first

- [`../architecture/layers.md`](../architecture/layers.md) — the fixture builder owns categories.
- [`../architecture/constraints.md`](../architecture/constraints.md) — the category list is a contract (`--check` rejects unknown ones).

## Steps

1. Add the name to `CATEGORIES` in `lib/subjects.mjs` — that is what `--check` validates against.
2. Teach `buildWorkspace` in `lib/fixtures.mjs` to prepare it. Decide explicitly whether it is a git repository (`needsGit`) — that decision controls the exclude file, the baseline commit and the branch/remote options.
3. Keep both ablation arms identical except for `install`: mocks and every fixture option apply to both.
4. Tests in `test/fixtures.test.mjs`: the workspace has exactly what the category promises, `snapshot()` sees only fixture files, `install` runs only in the with-arm.
5. README: a row in the categories table; `index.d.ts`: the `Category` union.

## Checklist

- [ ] `CATEGORIES`, `buildWorkspace`, README, `index.d.ts` updated together.
- [ ] Harness paths hidden from git and from `snapshot()` when the category has a repository.
- [ ] Both arms get the same workspace before `install`.
- [ ] A test builds the workspace and inspects it with `git` and the file system.

## Typical mistakes

- A category that prepares something only the with-arm gets — the ablation delta then measures the fixture, not the subject.
- Forgetting `.git/info/exclude`: a diff-reading subject then reviews the harness's own files.
- Starting a mock service without a TTL or without `unref()`: the runner hangs after its last case.
