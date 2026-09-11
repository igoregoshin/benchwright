# benchwright

Benchmark what you hand an agent — a skill, a rules file, a prompt fragment, an MCP wiring — **with it and without it**, through headless `claude -p` runs.

`npm test` proves the *text* of a skill survived an edit. benchwright proves the *behaviour* did: does the agent produce the right artifact, is it routed to for the right requests, and does the text earn its tokens over the base model.

```bash
npx benchwright --list                                              # what is registered, with case ids
npx benchwright --check                                             # free: validate config and every case
npx benchwright --subject my-skill --layer trigger --runs 3         # cheap: routing accuracy
npx benchwright --subject my-skill --layer functional --runs 3      # real runs + graders
npx benchwright --subject my-skill --layer ablation --runs 3        # with vs without
npx benchwright --subject my-skill --case one-case --keep           # one case, keep the workspace
npx benchwright --resume                                            # continue a killed run
```

---

## Requirements

- Node ≥ 20.11.
- **Claude Code CLI on PATH.** The runner never calls an API itself: it spawns `claude -p` for the agent, the judge and the trigger classifier, so a run uses whatever authorization your CLI already has. No API key is read anywhere. Swap the binary with `BENCHWRIGHT_CLAUDE=/path/to/claude`.
- `git` (fixtures are git repositories) and, on Windows, Git Bash (command graders run under POSIX `sh`; override with `BENCHWRIGHT_SHELL`).

Check `claude --version` before concluding a run is impossible — environment variables have nothing to do with it.

## Install

```bash
npm install --save-dev benchwright
```

Then a config (below) and, optionally, scripts:

```json
{
  "scripts": { "bench": "benchwright", "bench:list": "benchwright --list", "bench:check": "benchwright --check" },
  "benchwright": { "config": "bench/benchwright.config.mjs" }
}
```

---

## Config

benchwright looks for its config in this order: `--config <file>`, `BENCHWRIGHT_CONFIG`, the `benchwright.config` field of the nearest `package.json`, then `benchwright.config.{mjs,js,json}` in the current directory or any parent.

Relative paths in the config resolve against **root**: the nearest directory above the config with a `package.json` (override with `root`). Results land in `<root>/bench-results/<timestamp>/` (override with `resultsDir`).

```js
// benchwright.config.mjs
export default {
  title: 'my project — skill benchmark',        // report title
  defaults: {                                   // every key optional
    runs: 1, triggerRuns: 3,
    model: 'sonnet', judgeModel: 'haiku',
    maxTurns: 30, timeoutSeconds: 300, concurrency: 2,
    secretsFile: '.env',                        // where an http mock writes its secrets
    autopilotPreamble: '…',                     // see Autopilot
  },
  categories: { diff: { fixture: 'git repo + a staged diff' } },   // labels for --list only
  subjects: ({ root, skillSubjects }) => skillSubjects({ dir: `${root}/skills` }),
};
```

`subjects` is where you say what to benchmark. It may be an array, a `{ subjects, problems }` pair, or a (possibly async) function returning either. The function receives `{ root, configDir, defaults, skillSubjects, installSkill, skillDescription, readFrontmatter }`, so a config needs no import.

### Subjects

A subject is anything the agent can be given before it starts. The runner needs five things about it and nothing else:

| Field | Meaning |
|---|---|
| `id` | name in reports and in `--subject` |
| `category` | which workspace to build: `diff`, `repo`, `doc`, `mcp`, `chain`, `none` (only needed when the subject has functional cases) |
| `description` | the text a harness routes on — the trigger layer; `null` skips that layer |
| `trigger` / `triggerFile` | `[{ query, should_trigger }]`, inline or a JSON file; a `trigger:` list in the cases file works too |
| `cases` / `casesFile` | functional cases, inline or a YAML file (format below) |
| `install` | how to put the subject into a workspace — the **with** arm. A function `(workdir, ctx) => void \| string[]` (return the paths it wrote so they are hidden from git and from graders), or the declarative `{ copy: [{ from, to }] }` |
| `layers` | subset of `trigger`, `functional`, `ablation`; default all |
| `exempt` | a reason string: listed, never run |
| `mocksDir` | recordings for the `mcp` category |

A rules file benchmarked as a subject, in a JSON config:

```json
{
  "subjects": [
    {
      "id": "agents-md",
      "category": "repo",
      "description": "Project rules every agent must follow",
      "install": { "copy": [{ "from": "AGENTS.md", "to": "AGENTS.md" }] },
      "casesFile": "bench/agents-md.yaml"
    }
  ]
}
```

### Skills — the built-in discovery

`skillSubjects({ dir, registry?, … })` turns a directory of [Agent Skills](https://agentskills.io) into subjects: one per `<dir>/<name>/SKILL.md`, description from the frontmatter (CRLF-safe), cases from `<name>/evals/bench.yaml`, trigger queries from `<name>/evals/trigger-eval.json`, mocks from `<name>/evals/mocks/`. The default `install` copies the skill (minus `evals/`) to `.claude/skills/<name>/`. Directories starting with `_` or `.` are skipped.

The `skills` shorthand does the same from a JSON config: `"skills": { "dir": "skills", "registry": "bench/registry.json" }`.

**Registry — the decision record.** Without one, every skill is benchmarked on all layers and its category comes from `bench.yaml`. With one, every skill on disk must be in a category or exempt with a reason, and any disagreement is a `problem`:

```json
{
  "categories": { "diff": { "skills": ["commit", "review"] }, "repo": { "skills": ["plan"] } },
  "exempt": { "skill-creator": "authors and evaluates skills; benchmarking it with itself is circular" },
  "overrides": { "feedback": { "layers": ["trigger"], "reason": "its whole job is to stop and ask; headless there is nobody to answer" } }
}
```

Hooks for projects with their own conventions: `describe(skillDir, name)` to source the description elsewhere, `install({ skillDir, name, dest, workdir, variant })` to render templates or pull shared files, `filter(name, fullPath)` to narrow the copy.

Put `check()` in your test suite so a skill added later can never be silently un-benchmarked:

```ts
import { check, loadConfig } from 'benchwright';
const { problems } = await check(await loadConfig('bench/benchwright.config.mjs'));
assert.deepEqual(problems, []);
```

---

## Three layers, cheapest first

| Layer | Question | Cost per case | When |
|---|---|---|---|
| **0 · check** | Is the config, registry and every case well-formed? | free | every test run — `benchwright --check` |
| **1 · trigger** | Does the `description` route the right queries here, and *only* those? | ~1 cheap call per query | after any description change |
| **2 · functional** | Given a real fixture, does the subject produce the right artifact? | 1 agent run + graders | before releasing a change |
| **3 · ablation** | Does the subject beat the base model with nothing installed? | 2× functional | when cutting text, or when a subject feels like filler |

Run the cheapest layer that answers your question. `--all --layer functional` is every subject, real money.

### The interpretation rule that matters

> **A criterion that passes with *and* without the subject tells you nothing about the subject — it marks text you can delete.**

| with | without | reading |
|---|---|---|
| pass | pass | the subject is not what produced this — **deletion candidate** |
| pass | fail | **what the subject is actually buying you** — protect it with a free invariant |
| fail | pass | the subject is getting in the way |
| fail | fail | a genuine gap — the subject never covered this |

The runner computes this per criterion, prints the deletion candidates, and labels every ablation case with its cell.

### Never read the delta on its own

A delta is one number produced by two moving parts that mean opposite things: the **with** arm moved → that is your edit; the **without** arm moved → that is the base model drifting. A subject that went from `100 / 80 = +20%` to `100 / 100 = ±0%` did not regress — its with-arm never moved, the baseline came up. So the runner prints both arms as primary numbers and the delta as *derived*. Compare the *with* column against the *with* column of the previous run, case by case, at `--runs 3`.

---

## Before you read a number

**A single run is not a measurement.** Three consecutive single-run trigger sweeps over an *unchanged* subject scored 92%, 83% and 100%, missing different queries each time; three runs per query scored a stable 100%. `--runs` applies to trigger queries and functional cases alike; anything below 3 is tagged `runs 1 !` in the console and `runs 1 ⚠` in the HTML under a *"not a measurement"* banner. Trigger verdicts are majority votes and a query that flips between runs is reported as *unstable*, not as a regression.

**Harness faults are not results.** `could not run:`, `unknown grader type`, `judge returned no verdict` mean the harness failed to measure. The run prints a `HARNESS FAULTS` banner and `--threshold` returns 1. Fix, re-run.

**`--threshold` does not survive a pipe.** `benchwright … | tail -40` exits with `tail`'s status. Drop the pipe, use `set -o pipefail` / `${PIPESTATUS[0]}`, or write to a file.

---

## Categories — what a fixture builds

Subjects differ in exactly one way that matters to a benchmark: **what has to exist before the agent starts.**

| Category | Workspace |
|---|---|
| `diff` | git repo, committed baseline, then `changed` applied (staged unless `staged: false`) |
| `repo` / `chain` | git repo with committed files |
| `doc` | plain directory, no git |
| `mcp` | git repo + the case's mock services (below) |
| `none` | empty directory — the prompt is the whole input |

The fixture block of a case:

```yaml
fixture:
  files:                       # committed baseline
    - { path: src/a.ts, content: "…" }
  changed:                     # the pending change (diff category)
    - { path: src/a.ts, content: "…" }
    - { path: old.ts, deleted: true }
  staged: false                # leave the change in the working tree
  commits:                     # extra commits; `branch` puts them ON that branch
    - { branch: feature/x, message: "feat: x", files: [ … ] }
  branch: feature/x            # check out at the end
  remote: git@host:group/project.git   # origin that reads back as declared; pushes land in a local bare repo
  mocks: gitlab-create-mr.json # recordings from the subject's mocksDir (mcp category)
  variant: gitlab              # passed to install(ctx.variant)
```

Everything the harness adds to a workspace (`.claude/`, `.bench/`, `.mcp.json`, the secrets file, whatever `install` reports) is written to `.git/info/exclude` — not to a `.gitignore`, which would itself be a fixture difference — so a diff-reading subject sees only the change, and both ablation arms have identical git state.

### Mock services (`mcp`)

Two transports, because "external service" is not one transport:

- **MCP over stdio** — the subject calls `mcp__<server>__<tool>`. A `.mcp.json` points those server names at `mocks/mcp-mock.mjs`, which replays recorded tool responses. The server *name* is part of the contract: it must match the prefix the subject's tools use.
- **HTTP** — the subject's own scripts `fetch` a REST base URL from an env file. `mocks/http-mock.mjs` listens on localhost; the fixture's `http.secrets` are written to `defaults.secretsFile` (or the fixture's `http.secretsFile`) with `{{baseUrl}}` substituted, and the same keys are **removed from the runner's environment** so a real token in your shell can never win over the mock.

Both log every call to `.bench/mock-calls.jsonl`; `.bench/calls.mjs` is the query helper for `command` graders:

```yaml
- type: command
  run: node .bench/calls.mjs count mcp:create_merge_request
  expect_match: '^1$'
- type: command
  run: node .bench/calls.mjs unmatched      # exit 1 if anything went unanswered
```

Fixture formats are documented at the top of `mocks/mcp-mock.mjs` and `mocks/http-mock.mjs`. A tool that must leave a file behind (a screenshot the subject reads back) declares `writesFileFromArg`; otherwise the subject rightly reports "file not found" and the case grades the mock instead of the subject.

---

## Case format

```yaml
subject: my-skill            # optional; must match the subject id when present
category: diff

trigger:                     # optional; trigger-eval.json is the other place
  - { query: "commit these changes", should_trigger: true }
  - { query: "review this diff", should_trigger: false }

cases:
  - id: conventional-feat
    prompt: commit the changes
    tags: [core]
    runs: 3                  # 3 is the canon; 1 is an indication, not a measurement
    autopilot:               # answers for the subject's "ask the user" gates
      - "Task number for the footer: ABC-1950."
    fixture: { … }
    graders:
      - type: command
        run: git log -1 --pretty=%s
        expect_match: '^(feat|fix|chore)(\(.+\))?!?: .+'
      - type: llm
        criterion: The commit subject describes adding a discount calculation, not a generic message.
      - type: tool_used
        tool: Skill
        skill: my-skill
        with_only: true      # reported, but excluded from the score
```

### Graders

Deterministic first; the judge only where no rule can express it.

| Type | Passes when | Fields |
|---|---|---|
| `file_exists` | a matching file exists (`*` one segment, `**` one or more segments) | `path` |
| `file_absent` | nothing matches — "must not write before approval" | `path` |
| `file_matches` | a matching file's content matches | `path`, `pattern`, `flags` (default `m`) |
| `output_matches` | the agent's own text matches (tool inputs are **not** in it) | `pattern`, `flags` (default `im`) |
| `tool_used` | a tool fired; `tool: Skill` + `skill:` proves a skill loaded | `tool`, `skill` |
| `no_writes` | no Write / Edit / NotebookEdit at all | — |
| `command` | shell command exits `expect_exit` (default 0), or its output matches; trailing whitespace is trimmed, so `'^$'` means *no output* | `run`, `expect_exit`, `expect_match`, `flags` |
| `llm` | a judge model rules PASS on a plain-language criterion | `criterion` |

Common fields: `id`, `weight` (default 1), `with_only`. Score = passed weight ÷ total weight, excluding `with_only` graders.

**What the judge sees:** the criterion, the prompt, the answers given through `autopilot`, the agent's transcript, one line per tool call (the command, file or skill it named) and every file after the run. So "used the project script rather than `git` directly" is decidable, and an answer the "user" gave through autopilot is not graded as invented.

### Autopilot

Many subjects deliberately stop and ask (a task-number gate, an approval gate). Headless there is nobody to answer, so the run stalls and every grader fails for a reason unrelated to quality. `autopilot` supplies the answers as an appended system prompt — identically to **both** ablation arms, so it can never be what produces a delta.

Keep it to things *a user would say*. The moment it states a **convention** the subject is supposed to teach, the baseline arm learns it too and the delta collapses to zero: you have measured your own prompt.

### Check a grader before you pay for a run

`--check` proves a case parses. It does not prove a grader measures anything: a dead grader does not fail, it quietly paints the run green. Run every new `command` grader in two states, free:

```bash
benchwright --subject my-skill --case one --build-only --out /tmp/ws     # the fixture, exactly as the runner builds it
# in one copy do the work the subject should do; in another leave a realistic failure
benchwright --subject my-skill --case one --grade-only /tmp/ws/my-skill__one
```

A good grader passes in the first copy and fails in the second. Same verdict in both — rewrite it. And a *realistic* failure is not "nothing happened": for a two-step case ("create, then remove") the empty state trivially passes "nothing left"; the real failure is "did step one and not step two".

Every grader should have one failure it catches. Write down which, and test exactly that.

---

## Traps — every one of these was hit

1. **Autopilot contaminates the baseline** — see above.
2. **JavaScript regex, no inline flags.** `(?m)^X$` throws mid-run. Use `flags:`. `--check` rejects inline flags and invalid patterns before you pay.
3. **`%` and cmd.exe.** `git log --pretty=%s` through cmd.exe silently loses its format string. Command graders run under bash when one is present.
4. **Harness scaffolding visible to git.** The installed subject would land in the fixture's `git status`; review skills reviewed their own text and ablation arms differed by more than the subject. Handled via `.git/info/exclude` — and whatever your `install` returns is added.
5. **CRLF frontmatter.** `^---\n` never matches `---\r\n`; every description parsed as empty and the trigger layer reported nothing. Line endings are normalized.
6. **Memory.** Each case is a full agent session with its own MCP servers, and two run at once by default. On a loaded workstation the OS killed the runner twice before a single case finished. The runner warns when free memory is under 2 GB; use `--concurrency 1`. A killed run resumes.
7. **`'^\s*$'` on a trailing newline.** Under the default `m` flag it matched the empty position after `"  fix/x\n"`, so a "nothing left" grader passed on everything. Command output is now trimmed; expressing emptiness through the exit code (`test -z "$(…)"`) is still the robust form.
8. **A judge that could not see the commands** graded "used the script, not git" as unverifiable. It now gets the tool calls. `output_matches` deliberately still does not: a path the agent merely `Read` must not satisfy "mentions src/api.ts".
9. **A judge that could not see autopilot** graded the user's own answers as invented. It now gets them.
10. **A mock that leaves no file grades the mock.** `writesFileFromArg`.
11. **A user-level skill shadows the one under test.** `claude -p` resolved a same-named skill from `~/.claude/skills/` first; twelve green runs measured a stale copy. The runner passes `--setting-sources project,local`.
12. **Registration is not a check.** `--check` knows the registry is well-formed. Only a run shows the subject works.

---

## Output — written as the run goes

```
bench-results/<timestamp>/result.jsonl   append-only stream: one line per finished trigger call / case
bench-results/<timestamp>/result.json    derived from the stream
bench-results/<timestamp>/report.html    derived from the stream
```

`result.jsonl` is the source of truth. Every finished unit is appended synchronously the moment it is known; `result.json` and `report.html` are rebuilt from it during the run (throttled to once a second), at the end, and on `--resume`. A run killed halfway leaves everything it computed, and the HTML says so at the top.

`--resume` reopens the newest results directory (or the one you name) and skips every unit already recorded — per trigger `(query, run)`, per case — so it restarts at the granularity of a single model call. Repeat the original filters. Ctrl+C is caught and the report rebuilt before exit `130`; a SIGKILL is covered by the stream on disk; a truncated last line is dropped.

The run ends with cost and time (`totals` in `result.json`). Agent time sums parallel work; the trigger layer goes through a plain `-p` call that reports no cost, so dollars cover functional/ablation only.

Other flags: `--case <id>` (repeatable; ids are printed by `--list`, trigger queries are `trigger-1…N`; an unknown id exits 2 before any paid call), `--tag`, `--threshold 0.8` for CI, `--keep` to inspect workspaces, `--model` / `--judge-model`.

---

## Programmatic use

Everything the CLI does is exported from `benchwright`: `loadConfig`, `resolveSubjects`, `check`, `skillSubjects`, `installSkill`, `buildWorkspace`, `snapshot`, `gradeCase`, `runCase`, `judge`, `classifyTrigger`, `runTriggerLayer`, `runFunctionalLayer`, `openRun`, `assemble`, `renderHtml`, plus the constants `CATEGORIES`, `ALL_LAYERS`, `KNOWN_GRADERS`, `RELIABLE_RUNS`. Types ship in `index.d.ts`.

## Relation to `claude plugin eval`

Claude Code ships a native `claude plugin eval` (cases, graders, judge, with/without ablation, MCP mocks, HTML report), gated behind early access at the time of writing. The case format here is deliberately shaped like it — `prompt`, `graders`, `runs`, `tags`, `with_only`, the same ablation semantics — so a migration is mostly renaming files. Keep it that way when extending the format.
