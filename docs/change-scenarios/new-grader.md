# Scenario: new grader type

## When to apply

A criterion that no existing grader can express as a rule and that should not be a judgement call. Before adding one, check that `command` cannot express it: a shell command over the workspace covers most "trace on disk" checks.

## Read first

- [`../architecture/layers.md`](../architecture/layers.md) — graders are pure functions in `lib/graders.mjs`.
- [`../architecture/constraints.md`](../architecture/constraints.md) — grader fields and semantics are a consumer contract.

## Steps

1. Add the function to `DETERMINISTIC` in `lib/graders.mjs`: input `{ g, run, workdir, files }`, output `{ pass, why }` (`error: true` only for a harness fault). `KNOWN_GRADERS` is derived from the table, so `--check` and `validateSubject` learn the name automatically.
2. Add its required fields to `validateSubject` in `lib/subjects.mjs`, so a case missing them fails `--check` instead of a paid run.
3. If it needs data the run record does not carry yet, add it in `lib/agent.mjs` (`runCase`) and to `RunResult` in `index.d.ts`.
4. Tests in `test/graders.test.mjs`: pass path, fail path, and the realistic failure the grader exists to catch. Add the field check to `test/subjects.test.mjs`.
5. README: a row in the graders table; and if `--grade-only` cannot run it without an agent, add its type to the `needsRun` set in `lib/cli.mjs`.

## Checklist

- [ ] Pure: no agent call, no network, no writes outside `workdir`.
- [ ] `why` names the concrete reason (the file, the pattern, the exit code), never just "failed".
- [ ] Required fields validated for free.
- [ ] The grader has one failure it catches, and a test for exactly that.
- [ ] README table and `index.d.ts` updated.

## Typical mistakes

- A grader that passes on an empty workspace and on a correct one alike (a "nothing left" check that is trivially true when nothing happened). Prove it in two states with `--build-only` / `--grade-only`.
- Matching against the transcript when the criterion is about *what the agent did*: the transcript carries no tool inputs by design (ADR-0002); use a disk trace via `command`.
- Default regex flags that differ from the neighbours without a stated reason.
