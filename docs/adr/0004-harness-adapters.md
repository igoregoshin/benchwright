# ADR-0004: One adapter module per agent CLI, one canonical event contract

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

Until 1.1 the runner drove exactly one CLI. Everything about it — the command
line, the stream it printed, where a project skill lives, how a mock MCP server
is declared and approved — sat in `lib/agent.mjs` and `lib/fixtures.mjs`, and
the graders were written against that CLI's tool names (`Bash`, `Write`,
`Skill`, `mcp__<server>__<tool>`).

Two more CLIs were wanted, and a real run of each showed how differently they
behave in exactly the places the runner touches:

- **Output.** One prints assistant messages with typed content blocks and a
  `result` line carrying dollars; one prints `tool_use` parts with lower-case
  tool names and a per-step `cost`; one prints `item.completed` records whose
  type is `command_execution` / `file_change` / `mcp_tool_call` and reports
  tokens only.
- **Tool identity.** A file write is a `Write` block, a `write` part with
  `filePath`, or a `file_change` with `kind: "add"`. An MCP call is
  `mcp__bench__ping`, `bench_ping` (one underscore — ambiguous when a server
  name contains one), or `{ server, tool }`. A skill load is a `Skill` tool, a
  `skill` tool with `name`, or nothing at all — the model simply reads
  `SKILL.md` with a shell command.
- **Workspace conventions.** Skills are read from `.claude/skills`,
  `.opencode/skills` or `.agents/skills`; mocks are declared in `.mcp.json`
  plus a settings approval, in `opencode.json`, or in `.codex/config.toml` —
  which the CLI loads but disables while the directory is untrusted, and the
  trust table lives in the user config the run has to ignore.
- **Isolation and the system prompt.** One CLI has `--setting-sources` and
  `--append-system-prompt`; one has neither and is isolated by pointing its
  config-directory variable at an empty directory; one has `--ignore-user-config`
  (which does not cover plugins) and a `developer_instructions` config key.
- **Spawning.** On Windows two of the three are npm `.cmd` shims that
  `child_process.spawn` cannot run without a shell.

Teaching the runner, the fixture builder and the graders about all of that
would have put three CLIs' worth of `if (harness === …)` into every stage.

## Decision

Everything that knows a CLI lives in **one adapter module per CLI** under
`lib/harness/`, and everything above it consumes **one canonical event
contract**:

```
{ type: 'text',   text }
{ type: 'tool',   name, input }    Bash { command } · Write / Edit / Read { file_path } ·
                                   Skill { skill } · mcp__<server>__<tool> { …arguments }
{ type: 'result', text, costUsd }  costUsd null when the CLI reports no money
```

An adapter exports the same shape (`caseCommand`, `promptCommand`,
`promptText`, `parseEvents`, `writeMcpConfig`, `skillsDir`, `harnessPaths`,
`systemPromptMode`, `defaults`). `lib/agent.mjs` spawns what the adapter says
and hands its stdout back to the adapter; `lib/fixtures.mjs` asks the adapter
where mocks go and which paths to hide; `lib/skills.mjs` asks it where a skill
goes. The graders, the runner, the report and the case format do not change.

Three consequences of the contract are deliberate:

- **Tool names are normalized at the adapter, never at the grader.** A
  `tool_used: Write` grader means the same thing on every harness, and a case
  written for one CLI runs unchanged on another.
- **What a CLI cannot report is reported as absent, not as zero.** `costUsd`
  is `null` for a tokens-only CLI and the report prints "not reported by the
  harness" instead of `$0.00`. A skill load the CLI does not announce is
  *inferred* from the shell read of `<skillsDir>/<name>/SKILL.md` and the
  README says so; where there is no evidence at all, `skillsUsed` stays empty.
- **The harness's own defaults are the adapter's, not the package's.**
  `DEFAULTS.model` / `judgeModel` are `null`; each adapter carries the model
  aliases its CLI understands; a config value still wins.

Judge and classifier calls run in an empty directory rather than the
consumer's project, because a CLI loads the instructions, skills and MCP
servers of wherever it starts — one of the new CLIs would have booted the
project's real MCP servers for every criterion.

## Consequences

- Gains: adding a CLI is one file and one README row; the graders and every
  consumer's cases are harness-agnostic; a harness that cannot report
  something says so in the report instead of hiding it in a number.
- Costs: the canonical contract is now a public surface (see
  [constraints](../architecture/constraints.md)); each adapter re-reads its own
  workspace file where its CLI cannot pass the information any other way
  (Codex re-asserts MCP servers as `-c` overrides, OpenCode resolves
  `<server>_<tool>` against its `opencode.json`); three fixture samples have to
  be kept honest when a CLI changes its format.
- A pull request that inspects a CLI's raw output outside `lib/harness/`, or
  branches on a harness name in a grader, reverses this decision.

## Alternatives considered

- **Branch on the harness inside `agent.mjs` and `fixtures.mjs`.** Rejected:
  every stage would carry three CLIs' details and the fourth CLI would touch
  all of them.
- **Normalize at grading time (map `write` → `Write` in `tool_used`).**
  Rejected: the transcript, `toolCalls` for the judge, `skillsUsed` and
  `no_writes` all read tool names; one mapping in one place beats four.
- **Run the judge with a fixed CLI regardless of `--harness`.** Rejected: a run
  should need one authorized CLI, not two; a consumer without the fixed CLI
  installed could never grade `llm` criteria.
- **Prepend the autopilot text on every harness for uniformity.** Rejected:
  where a real system-prompt channel exists it keeps the user prompt what the
  case says it is; the fallback stays for the CLI without one.
