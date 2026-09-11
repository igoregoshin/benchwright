# Scenario: bugfix

## When to apply

Observed behaviour disagrees with the README or with a test's intent: a verdict that is wrong, a run that hangs or loses data, a problem that surfaces as a stack trace, a mock that answers what it should not.

## Read first

- The module the report or stack trace names, then its row in [`../architecture/layers.md`](../architecture/layers.md).
- [`../architecture/constraints.md`](../architecture/constraints.md) — to tell a bug from a contract you are about to change.

## Steps

1. Reproduce in a test first. For grader and fixture bugs, build the failing state by hand (`--build-only` gives you the exact workspace the runner would build).
2. Fix in the owning module only.
3. If the bug flipped verdicts for consumers, say so in the commit body and in the README's traps section: they need to know their previous numbers were wrong.
4. Run `npm test`; if the fix is in `agent.mjs` or the judge prompt, also run one real case against a consumer config.

## Checklist

- [ ] A test fails before the fix and passes after; its comment names the trap.
- [ ] No unrelated behaviour changed in the same commit.
- [ ] README updated when a documented behaviour was wrong, not just the code.
- [ ] Grader errors still reach the report as harness faults, not as silent fails.

## Typical mistakes

- Fixing a symptom in `cli` when the cause is in a stage (e.g. patching printed output instead of the record).
- "Fixing" a grader by loosening its regex until it passes — check the realistic-failure state still fails.
- A regression in a Windows-only path (`os.tmpdir()` short names, `cmd.exe` eating `%`, CRLF frontmatter) tested only on POSIX.
