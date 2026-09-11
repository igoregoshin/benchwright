# Scenario: new harness adapter, or a CLI that changed

## When to apply

Adding support for another agent CLI, or adapting an existing adapter because its CLI changed a flag, its output format, its skills directory or its config file. Everything CLI-specific lives in one file under `lib/harness/`; nothing above it should need to change.

## Read first

- [`../adr/0004-harness-adapters.md`](../adr/0004-harness-adapters.md) — the canonical event contract and why normalization happens in the adapter.
- [`../architecture/constraints.md`](../architecture/constraints.md) — the event contract, the adapter shape and the environment variables are public.
- The header comment of `lib/harness/index.mjs` — the adapter fields and what each must return.

## Steps

1. **Research before coding, with the real CLI.** Run its `--help`, then a headless case in a temp directory with its JSON/JSONL output: a shell command, a file write, a file edit, a project skill, a mock MCP server (`mocks/mcp-mock.mjs` with `--log`; the log is the proof the CLI reached it). Do not infer a format from a doc page — three of the four facts that shaped the existing adapters came from a run, not from a manual.
2. **Find its isolation knob.** User-level skills, plugins, MCP servers and instructions must not enter a run: a flag (`--setting-sources`, `--ignore-user-config`), an environment variable pointing at an empty config directory, or a documented gap. If a knob leaves something in (Codex plugins survive `--ignore-user-config`), find the second knob. Write down what could not be isolated in the README table.
3. **Write the adapter** — `lib/harness/<name>.mjs`, registered in `lib/harness/index.mjs`. Map every tool name to the canonical set; report money as `null` when the CLI has none; report skill loads only on evidence (native event, or an inferred read of `<skillsDir>/<name>/SKILL.md`), and say which in `reportsSkills`. Prompt on stdin unless the CLI cannot; `systemPromptMode: 'prepend'` only when there is no system-prompt channel.
4. **Record a sample.** Trim the real output to `test/fixtures/harness/<name>/case.jsonl`, replacing home paths, workspace paths, session ids and anything account-related with placeholders. The sanitizer must fail loudly if a personal string survives.
5. **Tests** in `test/harness.test.mjs`: `parseEvents` on the sample yields text, `Bash` with `command`, `Write`/`Edit` with `file_path`, an `mcp__` tool, a result; the flags of `caseCommand` / `promptCommand`; `writeMcpConfig` parsed back. Then `BENCHWRIGHT_LIVE=1 npm run test:live` — it must create the file through the real `runCase`.
6. **Docs:** a row in the README *Harness* table with the real facts (binary variable, skills dir, MCP config, autopilot channel, cost, skill detection), every trap you hit in the README *Traps* list, `docs/architecture/dependencies.md` (external dependency), `index.d.ts` if the contract grew.

## Checklist

- [ ] No CLI-specific code, path or name outside `lib/harness/<name>.mjs`.
- [ ] Sample fixture is real, trimmed and scrubbed; the unit test reads it.
- [ ] Live suite green for the new harness; end-to-end run of a `file_matches` + `tool_used` case shows no `HARNESS FAULTS`.
- [ ] README table row and traps; `dependencies.md`; version bump (minor: a new harness is additive).

## Typical mistakes

- Trusting the process cwd: one CLI took its project directory from the inherited `PWD` variable and wrote the file next to the shell instead of into the workspace.
- Mapping tool names in a grader "just for this harness" — every other grader and the judge's `toolCalls` then disagree with it.
- Printing `$0.00` for a CLI that reports tokens only. Absent is `null`, and the report says "not reported".
- Spawning a `.cmd` shim on Windows through a shell and re-quoting JSON/TOML arguments through cmd.exe; resolve the shim instead (`resolveBinary`).
