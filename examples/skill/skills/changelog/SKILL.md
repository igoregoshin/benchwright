---
name: changelog
description: Update CHANGELOG.md from the git history in Keep a Changelog format. Use when asked to write, update or generate a changelog or release notes.
---

# changelog

1. Find the last release tag (`git describe --tags --abbrev=0`). If there is none, take the whole history.
2. List the commits since then: `git log <tag>..HEAD --pretty=%s`.
3. Group them by Conventional Commits type: `feat` → **Added**, `fix` → **Fixed**, `perf` and `refactor` → **Changed**.
   Skip `chore`, `ci`, `docs`, `test` and any commit whose subject has no `type:` prefix.
4. Write the groups under `## [Unreleased]` at the top of `CHANGELOG.md`. Create the file with the
   Keep a Changelog header if it does not exist; keep every released section that is already there.
5. One bullet per commit, imperative mood, without the type prefix and without the scope.
6. Do not commit. Show the new section in your answer.
