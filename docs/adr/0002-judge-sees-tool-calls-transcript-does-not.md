# ADR-0002: The judge sees tool calls and autopilot; the transcript does not carry tool inputs

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

Two blind spots cost real runs before this decision:

- The judge received the agent's transcript with every tool call rendered as `[tool: Bash]` and its input dropped. A criterion such as "used the project script rather than `git` directly" or "did not pass `--force`" was undecidable and was honestly graded FAIL as unverifiable.
- Answers given on the user's behalf through `autopilot` went to the agent as a system prompt but never to the judge, which then graded "the file contains only what the user said" against the visible prompt and failed the autopilot answers as invented.

The obvious fix — render tool inputs into the transcript — breaks a different grader: `output_matches` reads the same transcript, and consumers legitimately use it to check that the agent *said* a path or a name. A file the agent merely `Read` would satisfy a "mentions `src/api.ts`" pattern.

## Decision

The run record carries two views:

- `transcript` — the agent's own text plus bare `[tool: <name>]` markers (`[tool: Skill <name>]` for skill invocations). This is what `output_matches` reads. It never contains tool inputs.
- `toolCalls` — one entry per call with a one-line summary of its input (the command, the file path, the skill name, or truncated JSON). This goes to the judge as a `<tool_calls>` block.

The judge prompt also carries the autopilot answers as `<answers_the_user_gave_when_asked>`.

## Consequences

- Gains: criteria about *how* the agent did something are decidable; autopilot answers are no longer "invented"; `output_matches` semantics are unchanged for every existing case.
- Costs: a longer judge prompt (capped by truncation); two renderings to keep in step.
- A pull request that adds inputs to `renderTranscript` reverses this decision and silently weakens every consumer's `output_matches` graders.

## Alternatives considered

- **Tool inputs in the transcript.** Rejected for the `output_matches` false positives above.
- **A separate `transcript_full` grader input.** Would have needed a new grader type and left `llm` criteria unchanged; the judge was the consumer that needed the data.
- **Telling case authors to restate autopilot answers in every criterion.** Works, but is a workaround for a harness gap that every author would rediscover.
