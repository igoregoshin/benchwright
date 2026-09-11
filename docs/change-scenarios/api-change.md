# Scenario: public contract change

## When to apply

Anything under "Contracts a consumer depends on" in [`../architecture/constraints.md`](../architecture/constraints.md): the case or config format, a grader's fields or semantics, a CLI flag's meaning, the shape of `result.jsonl` / `result.json`, the mock fixture formats or the call-log lines, an exported function's signature, an environment variable.

## Read first

- [`../architecture/constraints.md`](../architecture/constraints.md) — the full list, and the compatibility promise with the native plugin-eval case format.
- [`../development/releases.md`](../development/releases.md) — which version bump it forces.

## Steps

1. Write the change as a one-line contract statement first ("`command` output is trailing-trimmed before `expect_match`"). If you cannot state it in one line, it is more than one change.
2. Prefer additive over breaking: a new field with a default, a read-side fallback for an old name (`subject ?? skill`), a new flag rather than a repurposed one.
3. Implement with a test that pins the new contract *and* one that pins what must not have changed next to it.
4. Update the README (the section where the contract is documented, and the traps section if the change exists because of one), `index.d.ts`, and — when the reasoning is not obvious from the diff — an ADR.
5. Commit with `!` and a body stating the old and new behaviour; release notes lead with it.

## Checklist

- [ ] One contract per change; stated in one line in the commit body.
- [ ] Backward path decided explicitly: fallback, deprecation, or a breaking bump.
- [ ] Test for the new behaviour, test for the unchanged neighbours.
- [ ] README, `index.d.ts`, ADR (when needed), release notes.
- [ ] Case format still maps onto the native plugin-eval shape.

## Typical mistakes

- Changing a default (a regex flag, a truncation limit, a judge prompt line) as a "fix" without noticing it is a contract.
- Renaming a record field and breaking `--resume` on every existing results directory.
- Adding a required config field: every consumer's `--check` goes red on upgrade.
