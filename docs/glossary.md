# Glossary

Terms the runner, its config and its reports use. Each is defined once, here; other pages link rather than restate.

| Term | Meaning |
|---|---|
| **Subject** | The thing under test — anything an agent can be given before it starts: a skill, a rules file, a prompt fragment, an MCP wiring. Normalized to `{ id, category, description, trigger, cases, install }`. |
| **Arm** | One of the two sides of an ablation. The *with* arm has the subject installed; the *without* arm is the same workspace without it. Both get the same autopilot and the same mocks. |
| **Layer** | One of the three questions the runner can ask: *trigger* (routing), *functional* (artifact quality), *ablation* (with vs without). Cheapest first. |
| **Category** | The workspace shape a case needs before the agent starts: `diff`, `repo`, `doc`, `mcp`, `chain`, `none`. The only axis on which subjects differ to the fixture builder. |
| **Fixture** | The declared starting state of a case: files, a pending change, commits, a branch, a remote, mock recordings. Built fresh for every run and every arm. |
| **Grader** | One criterion of a case. Rule graders are pure functions over the run record and the files; the `llm` grader asks the judge. |
| **Judge** | A cheap model call that rules PASS / FAIL on one plain-language criterion, given the prompt, the autopilot answers, the transcript, the tool calls and the files after the run. |
| **Trigger classifier** | A model call that answers whether a description would route a given query to the subject. Aggregated by majority over runs. |
| **Autopilot** | Answers supplied up front for the questions a subject asks the user, appended as a system prompt to both arms so they can never produce a delta. |
| **Harness** | The agent CLI the runner drives — Claude Code, OpenCode or Codex CLI, selected with `--harness` or `defaults.harness` — plus the scaffolding it puts into a workspace (its own paths such as `.claude/` and `.mcp.json`, `.opencode/` and `opencode.json`, `.codex/` and `.agents/`; `.bench/`; the secrets file). Hidden from git and from graders. |
| **Harness adapter** | The one module per CLI under `lib/harness/` that builds its command line, parses its output into the canonical events, and knows its workspace conventions. Everything above it is harness-agnostic. |
| **Canonical event** | What every adapter produces and every grader reads: `text`, `tool` (with the canonical names `Bash`, `Write`, `Edit`, `Read`, `Skill`, `mcp__<server>__<tool>`) and `result` (with `costUsd`, `null` when the CLI reports no money). |
| **Harness fault** | A grader or classifier that errored rather than failed (`could not run`, unknown type, no verdict). Makes a run not a result; reported in its own banner and fails `--threshold`. |
| **Thin sample** | A number from fewer than three runs. Reported with a `runs N !` tag and a banner: an indication, not a measurement. |
| **Deletion candidate** | A criterion that passes in both arms of an ablation — the subject is not what produced that behaviour. |
| **Result stream** | `result.jsonl`, the append-only record of every finished unit; `result.json` and `report.html` are derived from it. The basis of `--resume`. |
| **Registry** | In the skills preset: the consumer's decision record mapping every skill to a category, an exemption or a layer override, so a new skill cannot be silently un-benchmarked. |
| **Problem** | A user-fixable finding collected as a string and printed together with the others (`--check`, exit code `2`) instead of thrown. |
