# ADR-0001: The runner measures subjects, not skills

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

The runner began life inside a skills kit as a benchmark for that kit's skills: discovery read a fixed `components/skills/<name>` layout, the description came from `SKILL.md` frontmatter with a fallback into the kit's own manifest, installation rendered the kit's variant templates and shared references, and every record and report column was named `skill`.

The same mechanics — build a workspace, run an agent with and without the thing, grade the artifact — answer the question for anything an agent is handed: a rules file, a system-prompt fragment, an MCP wiring, a hook. Keeping "skill" as the unit would have meant either forking the runner per kind of thing or teaching the core about every kind.

## Decision

The unit of measurement is a **subject**: `{ id, category, description, trigger, cases, install(workdir, ctx) }`. The runner, the fixture builder, the graders and the report see only this shape.

Skills are one *source* of subjects: `skillSubjects()` in `lib/skills.mjs` implements the Agent Skills directory convention (frontmatter description, `evals/` layout, install into `.claude/skills/`) and exposes hooks — `describe`, `install`, `filter` — for a consumer's own conventions. Anything specific to one consumer (template rendering, shared reference files, where its secrets file lives) lives in that consumer's config, not in the package.

A subject with no functional cases needs no category: a description plus queries is enough for the trigger layer alone.

## Consequences

- Gains: the core is vendor- and kind-agnostic; a JSON config can benchmark a rules file with `install: { copy: […] }` and no code; the same registry ratchet works for any consumer.
- Costs: consumers with rich conventions carry a small glue config; records changed from `skill` to `subject` (old records are still read through a fallback).
- The word "skill" is confined to `lib/skills.mjs`. A pull request that introduces it elsewhere in `lib/` is reintroducing the coupling this ADR removed.

## Alternatives considered

- **Keep skills as the unit, add "kinds".** Every new kind would have touched fixtures, graders and report. Rejected: the kinds differ only in how they are installed, which one hook covers.
- **A plugin system for subject sources.** More machinery than the problem needs; a `subjects()` function in the config already is the plugin point.
