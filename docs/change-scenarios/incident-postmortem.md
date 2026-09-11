# Scenario: a run misled someone (postmortem)

## When to apply

A benchmark number led to a wrong conclusion: a regression reported that did not exist, a green run that measured nothing, a case that graded the harness instead of the subject, a real service touched by a run. The output of this scenario is a fix *and* a recorded trap, so the next person does not rediscover it.

## Read first

- [`../development/review.md`](../development/review.md) — the checklist the change must pass.
- The README *Traps* section — the existing list; the new entry joins it.

## Steps

1. Timeline: which command, which config, which results directory, what was read from the report and what was concluded.
2. Root cause, classified: thin sample (single run read as a measurement), dead grader (passes in both states), harness blindness (judge could not see something), fixture leak (arms differed by more than the subject), environment (real credentials, a shadowing user-level skill, memory).
3. Fix at the layer that owns it: a validation in the free path if the mistake was detectable before paying; a runner or grader change if the run itself was wrong; a README trap and, when the reasoning is not obvious, an ADR.
4. Add the test that would have caught it; name the trap in the test's comment.
5. If consumers' historical numbers are affected, say so in the release notes.

## Checklist

- [ ] Root cause named in one of the classes above, or a new class added here.
- [ ] Prevention is code (validation, banner, exclude, prompt) — not only advice.
- [ ] README *Traps* has the entry; ADR when a decision was made.
- [ ] Test with the trap in its comment.

## Typical mistakes

- Closing the incident with "run it with `--runs 3` next time" when the runner could have labelled the number itself.
- Fixing the one case that misled instead of the grader class it belongs to.
- Recording the story only in a chat or a commit message — a trap not in the README is not prevented.
