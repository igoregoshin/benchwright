// Example 1 — a directory of Agent Skills, discovered by the built-in helper.
//
// Every command below is free: no agent CLI is spawned.
//
//   npx benchwright --list      what was discovered, per category, with case ids
//   npx benchwright --check     the registry, every case and every grader regex validated
//
// With an agent CLI on PATH (claude, opencode or codex), cheapest first:
//
//   npx benchwright --subject changelog --layer trigger --runs 3      routing only
//   npx benchwright --subject changelog --layer functional --runs 3   real runs + graders
//   npx benchwright --subject changelog --layer ablation --runs 3     with vs without the skill
//
// See ../README.md for what each of those prints and how to read it.
import fs from 'node:fs';

export default {
  title: 'examples — a skill directory',

  // The examples live inside the benchwright repository, whose own package.json
  // would otherwise be picked as the root. A consumer normally leaves `root`
  // out: it defaults to the nearest directory above the config that has a
  // package.json, and every relative path in the config resolves against it.
  root: '.',

  defaults: {
    runs: 3, // 3 is the canon; a single run is tagged "not a measurement"
    triggerRuns: 3,
    harness: 'claude', // claude | opencode | codex — `--harness` overrides
    concurrency: 1, // one agent session at a time; two is the default
  },

  // Labels for `--list` only. What a category BUILDS is fixed by the runner:
  // `repo` is a git repository with the fixture's files committed.
  categories: {
    repo: { fixture: 'git repository with a few commits on main' },
  },

  // `subjects` receives the helpers, so this file imports nothing from the
  // package. `skillSubjects` makes one subject per `skills/<name>/SKILL.md`:
  // description from the frontmatter, cases from `evals/bench.yaml`, trigger
  // queries from `evals/trigger-eval.json`, and an `install` that copies the
  // skill (minus `evals/`) into the harness's skills directory of the workspace.
  //
  // The registry is the decision record: every skill on disk must be in a
  // category or exempt with a reason, and `--check` reports any disagreement.
  // The JSON shorthand `"skills": { "dir": "skills", "registry": "bench/registry.json" }`
  // does exactly the same.
  subjects: ({ root, skillSubjects }) =>
    skillSubjects({
      dir: `${root}/skills`,
      registry: JSON.parse(fs.readFileSync(`${root}/bench/registry.json`, 'utf8')),
    }),
};
