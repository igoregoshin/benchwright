# Scenario: dependency or runtime upgrade

## When to apply

Bumping `js-yaml`, raising the Node floor in `engines`, adding a runtime dependency, or adapting to a new release of one of the agent CLIs (flags, output shape, settings sources) — that change lives in the CLI's adapter under `lib/harness/` and follows [new-harness](new-harness.md).

## Read first

- [`../architecture/dependencies.md`](../architecture/dependencies.md) — what each dependency is for and how critical it is.
- [`../development/rules.md`](../development/rules.md) — no new runtime dependency without this pass.

## Steps

1. Read the dependency's changelog for breaking changes and security advisories; note the versions in the commit body.
2. For the agent CLI: check every argument `lib/agent.mjs` passes (`--output-format stream-json`, `--setting-sources`, `--permission-mode`, `--append-system-prompt`) and the event shapes `parseStreamJson` reads (`tool_use` blocks, `result.total_cost_usd`). A change there is invisible to the unit tests — run one real case.
3. For Node: keep the floor at what the code needs (`Atomics.wait`, `fetch` in tests, `fs.mkdtempSync`); do not raise it for convenience.
4. Adding a runtime dependency: state in the PR why the standard library cannot do it, and keep the count to what a consumer would accept in a dev tool.
5. `npm test`; then `--check` and one paid case against a consumer config.

## Checklist

- [ ] Changelog read; breaking changes listed in the commit body.
- [ ] `engines.node` reflects the real floor.
- [ ] Agent CLI flags and event parsing verified with a real run when the CLI changed.
- [ ] `package-lock.json` updated in the same commit.

## Typical mistakes

- Trusting green unit tests after a CLI upgrade: the tests never spawn it.
- A dependency that pulls in a build step or native code — the package ships as plain files.
- Raising the Node floor and breaking a consumer's CI image.
