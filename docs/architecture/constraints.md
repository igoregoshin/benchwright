# Constraints

What a change must not break. Each of these is a promise a consumer's cases rely on.

## Non-functional

- **A run must survive being killed.** Every finished unit of work is on disk before the next one starts, and `--resume` continues at the granularity of one model call. A change that buffers records, or derives a file that cannot be rebuilt from `result.jsonl`, breaks this.
- **Nothing is paid for that a check could have caught.** Config problems, unknown `--case` ids, malformed graders and a missing agent binary all fail before the first workspace is built. New validation belongs in `validateSubject` / `check()`, not in a run.
- **Nothing reaches the network except the agent CLI.** Mocks bind `127.0.0.1`; fixtures rewrite pushes into a local bare repo; HTTP mock secrets are also removed from the runner's environment so a real token can never win over a fixture.
- **The mocks are deterministic and never invent.** An unrecorded request is an explicit error (HTTP `501`, MCP `isError`), never an empty success.
- **A number below three runs is labelled as not a measurement** everywhere it is shown. The label is part of the output contract.

## Technological

- Node ≥ 20.11, ESM only, no build step: the package ships exactly the files in the repository.
- LF line endings in the working copy (`.gitattributes`): `npm publish` ships the working copy and the bin carries a shebang.
- Windows is a first-class platform: paths go through `path`, temp dirs through `os.tmpdir()` (which returns 8.3 short names — convert `import.meta.url` with `fileURLToPath`, never by string surgery), `command` graders run under bash when one exists.
- One YAML parser (`js-yaml`), no test framework beyond `node:test`.

## Contracts a consumer depends on

- **The case format** (`prompt`, `graders`, `runs`, `tags`, `with_only`, `autopilot`, `fixture.*`) and the grader types with their fields. It is deliberately shaped like Claude Code's native plugin eval format; extensions must keep it that way.
- **The config discovery order** and the config shape (`title`, `defaults` — including `defaults.harness`, default `claude`, and `defaults.model` / `judgeModel`, default `null` = the harness's own — `categories`, `subjects` | `skills`, `root`, `resultsDir`), including what a `subjects()` function receives.
- **The normalized subject shape** handed to `install(workdir, ctx)` — `ctx` carries `subject`, `testCase`, `arm`, `variant` and the `harness` adapter — and the meaning of the array it may return.
- **The result files.** `result.jsonl` records (`meta` — with `harness` — `trigger`, `case`, `end`) and their keys; `result.json` shape, including `harness` and `totals.costReported`; records from before the `subject` field still resolve through `skill`, records from before `costReported` read as reported.
- **The canonical event contract** every adapter produces and every grader consumes: `{ type: 'text', text }`, `{ type: 'tool', name, input }` with the canonical names `Bash` (`command`), `Write` / `Edit` / `Read` (`file_path`), `Skill` (`skill`), `mcp__<server>__<tool>` (the arguments), and `{ type: 'result', text, costUsd }` with `costUsd: null` when the CLI reports no money. A case's `tool_used` grader is written against these names, never against a CLI's own.
- **The harness adapter shape** (`lib/harness/index.mjs` header, `Harness` in `index.d.ts`): `--harness` accepts exactly `HARNESSES`; `getHarness` throws on anything else.
- **Where the judge and the classifier run:** an empty directory, never the consumer's project or the workspace.
- **Environment variables:** `BENCHWRIGHT_CLAUDE`, `BENCHWRIGHT_OPENCODE`, `BENCHWRIGHT_CODEX` (the binary of each harness — an executable, or a `.cmd` shim the runner resolves), `BENCHWRIGHT_OPENCODE_CONFIG_DIR` (the config directory an OpenCode run sees instead of an empty one), `BENCHWRIGHT_SHELL`, `BENCHWRIGHT_CONFIG`, `BENCHWRIGHT_CALL_LOG`, and `BENCHWRIGHT_LIVE=1` for the paid live suite.
- **Grader semantics that flip verdicts:** `output_matches` sees the transcript without tool inputs; `command` output is trailing-trimmed; `**` spans one or more segments; default flags `m` (files, commands) and `im` (transcript); `with_only` graders never score.

Changing any of these is an [api-change](../change-scenarios/api-change.md), not a refactor.

## Vendor neutrality

The package carries no company, product or client name and no project-specific convention; `test/sources.test.mjs` enforces the known ones. Conventions of a particular consumer (template rendering, shared reference files, where its secrets file lives) are expressed through the config hooks — `describe`, `install`, `filter`, `defaults.secretsFile` — on the consumer's side.
