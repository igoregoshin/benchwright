# Releases

## Versioning

SemVer. The public surface that decides the bump is the list under "Contracts a consumer depends on" in [`../architecture/constraints.md`](../architecture/constraints.md):

- **major** — a case, config, CLI, result-file or grader-semantics change that can make an existing consumer's cases parse differently or grade differently;
- **minor** — a new grader type, category, flag, config field or exported function that leaves existing behaviour intact;
- **patch** — a fix with no contract change.

Before `1.0.0` a breaking change still bumps the minor version, and the release notes say so in the first line.

The bump rule an agent applies to every change is in the root [`AGENTS.md`](../../AGENTS.md) → Versioning; this page is the mechanics.

## Process

Publishing is done by GitHub Actions (`.github/workflows/npm-publish.yml`), never from a developer machine.

1. Bump `version` in `package.json` in the same PR as the change that requires it; `npm test` is green in CI (`.github/workflows/ci.yml`, Node 20 / 22 / 24).
2. Merge to `main`. Write the release notes from the merged PRs, contract changes first.
3. Create a GitHub release with tag `v<version>` (the `v` prefix is required). The workflow runs the tests again, **fails if the tag does not match `package.json`**, then runs `npm publish --provenance --access public`.
4. Smoke the published package from a scratch project: `npx benchwright@<version> --help`, then `--check` against a minimal config.

One-time setup: an npm automation token stored as the repository secret `NPM_TOKEN`. The package ships the working copy, so the checkout must be LF — `.gitattributes` enforces it and the bin's shebang survives.

## What ships

`files` in `package.json` decides: `bin/`, `lib/`, `mocks/`, `index.mjs`, `index.d.ts`, `README.md` (`LICENSE` is added by npm). `docs/`, `test/` and `bench-results/` never ship.

## Channels

One channel, `main` → npm `latest`. No prerelease channel until there is a consumer who needs one.
