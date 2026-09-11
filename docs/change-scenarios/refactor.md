# Scenario: refactor

## When to apply

Internal structure changes with no change in observable behaviour: a helper extracted, a module split, a rename inside `lib/`.

## Read first

- [`../architecture/layers.md`](../architecture/layers.md) — the boundaries the refactor must leave intact.
- [`../architecture/constraints.md`](../architecture/constraints.md) — the list of things that are *not* internal.

## Steps

1. `npm test` green before touching anything.
2. Refactor without changing verdicts, records, console output, file names in a results directory, or the public exports (`index.mjs`, `index.d.ts`).
3. Keep the refactor and any fix or feature in separate commits.
4. `npm test` green after; `--check` and `--list` against a consumer config produce identical output.

## Checklist

- [ ] Tests green before and after, unchanged unless they tested a moved internal.
- [ ] No contract from `constraints.md` touched; no default moved.
- [ ] Layer pyramid still holds after the move (no new upward import).

## Typical mistakes

- A behaviour change hiding inside a refactor: a regex flag "normalised", a trim added, an exclude broadened. Each of these flips verdicts for some consumer.
- Moving prompt text between modules and rewording it on the way — the judge prompt is part of what the numbers depend on.
- A rename of a record field without the read-side fallback (`subject` still reads `skill`).
