# Scenario: new feature

## When to apply

A new CLI flag, a new free mode, a new config field, a new fixture option, a new report section — anything that adds behaviour without changing an existing contract. A new grader type or a new category has its own playbook ([new-grader](new-grader.md), [new-category](new-category.md)).

## Read first

- [`../architecture/layers.md`](../architecture/layers.md) — which module owns the behaviour.
- [`../architecture/constraints.md`](../architecture/constraints.md) — whether the addition touches a contract (then it is an [api-change](api-change.md)).

## Steps

1. Decide the layer before writing: parsing and printing in `cli`, orchestration in `runner`, workspace work in `fixtures`, data rules in `subjects` / `config`.
2. If the feature reads user input (a flag, a field), validate it in the free path — `parseArgs`, `normalizeSubject`, `validateSubject` — so a mistake costs nothing.
3. Write the test first for the failure the feature prevents; then the feature.
4. Document it: the `HELP` string for a flag, the README section for a field or a format option, `index.d.ts` for anything exported.
5. Run `npm test`, then `--check` and `--list` against a real consumer config if one is at hand.

## Checklist

- [ ] Placed in the module the pyramid says; no stage prints, no module imports the CLI.
- [ ] Validated in a free path; a user mistake is a *problem*, not a stack trace.
- [ ] Test, `HELP` / README, `index.d.ts` updated together.
- [ ] Existing defaults and verdicts unchanged.

## Typical mistakes

- A flag that only exists at run time: an unknown value discovered after the first paid call (this is why `--case` ids are validated up front).
- Adding a default that quietly changes an existing grader's verdict "while at it" — that is a contract change.
- Printing from a stage module; the summary belongs to `report`, usage and problems to `cli`.
