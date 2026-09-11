# Releases

## Versioning

SemVer. The public surface that decides the bump is the list under "Contracts a consumer depends on" in [`../architecture/constraints.md`](../architecture/constraints.md):

- **major** — a case, config, CLI, result-file or grader-semantics change that can make an existing consumer's cases parse differently or grade differently;
- **minor** — a new grader type, category, flag, config field or exported function that leaves existing behaviour intact;
- **patch** — a fix with no contract change.

Before `1.0.0` a breaking change still bumps the minor version, and the release notes say so in the first line.

## Process

1. `npm test` green on the machine that publishes (it must be a Windows or POSIX box with `git` and a shell; nothing else is required).
2. Bump `version` in `package.json`; write the release notes from the merged PRs, contract changes first.
3. Commit as `chore(release): vX.Y.Z`, tag `vX.Y.Z`, push the tag.
4. `npm publish`. The package ships the working copy: check that the working tree is clean and LF (`.gitattributes` enforces it) so the bin's shebang survives.
5. Smoke the published package from a scratch project: `npx benchwright --help`, then `--check` against a minimal config.

## What ships

`files` in `package.json` decides: `bin/`, `lib/`, `mocks/`, `index.mjs`, `index.d.ts`, `README.md` (`LICENSE` is added by npm). `docs/`, `test/` and `bench-results/` never ship.

## Channels

One channel, `main` → npm `latest`. No prerelease channel until there is a consumer who needs one.
