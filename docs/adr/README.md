# Architectural Decision Records

Lightweight Markdown ADRs. One file per decision that shaped the runner and that a future change might be tempted to undo.

| ADR | Decision |
|---|---|
| [0001](0001-subjects-not-skills.md) | The runner measures *subjects*, not skills |
| [0002](0002-judge-sees-tool-calls-transcript-does-not.md) | The judge sees tool calls and autopilot; the transcript does not carry tool inputs |
| [0003](0003-result-stream-is-the-source-of-truth.md) | `result.jsonl` is the source of truth; every other output is derived |

## Adding an ADR

1. Create `NNNN-<kebab-title>.md` with the next number.
2. Fill the template below. Keep it to what a reader needs to *not* reverse the decision by accident.
3. Link it from the page it constrains (`architecture/*`, `development/*`) and from the table above.

## Template

```markdown
# ADR-NNNN: <Title>

- **Status:** Proposed | Accepted | Deprecated | Superseded by ADR-XXXX
- **Date:** YYYY-MM-DD

## Context

What forced the decision. Which forces pull in which direction.

## Decision

What was decided. Concretely.

## Consequences

- Gains: …
- Costs / trade-offs: …
- What it means for the code and for consumers.

## Alternatives considered

- <option 1> — why it was rejected.
- <option 2> — why it was rejected.
```
