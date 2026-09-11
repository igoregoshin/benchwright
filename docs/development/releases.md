# Releases

## Versioning

SemVer, decided by the change's effect on a consumer's existing cases and config — not by the size of the diff. The public surface is the list under "Contracts a consumer depends on" in [`../architecture/constraints.md`](../architecture/constraints.md).

| Bump | When |
|---|---|
| **major** | An existing consumer's cases could parse differently or *grade differently* after upgrading: a case / config / CLI / result-file contract changed, a grader's fields or semantics changed, a default that can flip a verdict moved, an environment variable was renamed, an export was removed, a config field became required. |
| **minor** | Something new that leaves every existing case and config behaving exactly as before: a grader type, a category, a flag, a config field with a default, an export, a fixture option. "Old behaviour still available via X" is minor. |
| **patch** | A fix with no contract change: the code now does what the README already said. |

Two rules of thumb: a bugfix that *changes verdicts* is major, not patch — say so in the release notes, because consumers' historical numbers were wrong; and before `1.0.0` a breaking change bumps the minor version, with the release notes saying so in the first line. The bump lands in `package.json` in the same PR as the change.

## Process

Publishing is done by GitHub Actions (`.github/workflows/npm-publish.yml`), never from a developer machine.

1. Bump `version` in `package.json` in the same PR as the change that requires it; `npm test` is green in CI (`.github/workflows/ci.yml`, Node 20 / 22 / 24).
2. Merge to `main`. Write the release notes from the merged PRs, contract changes first.
3. Create a GitHub release with tag `v<version>` (the `v` prefix is required) and publish it — a draft does not trigger anything until it is published. The workflow runs the tests again, **fails if the tag does not match `package.json`**, then runs `npm publish --provenance --access public`.
4. Smoke the published package from a scratch project: `npx benchwright@<version> --help`, then `--check` against a minimal config.

One-time setup: an npm automation token stored as the repository secret `NPM_TOKEN`. The package ships the working copy, so the checkout must be LF — `.gitattributes` enforces it and the bin's shebang survives.

## What ships

`files` in `package.json` decides: `bin/`, `lib/`, `mocks/`, `index.mjs`, `index.d.ts`, `README.md` (`LICENSE` is added by npm). `docs/`, `test/` and `bench-results/` never ship.

## Channels

One channel, `main` → npm `latest`. No prerelease channel until there is a consumer who needs one.
