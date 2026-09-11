# benchwright documentation

A short route map for people. AI agents start at [`AGENTS.md`](AGENTS.md).

## Tech stack

See the top of [`../README.md`](../README.md): plain ESM JavaScript on Node, no build step, one dependency, tests on the built-in `node:test` runner.

## Structure

- `architecture/` — the structural truth of the project: the pipeline, its layers, what may depend on what, the constraints a change must respect.
- `development/` — process: hard rules, how tests are organised and run, what a reviewer checks, how a release is cut.
- `change-scenarios/` — playbooks for typical changes (new grader, new category, bugfix, contract change, …).
- `adr/` — the decisions that shaped the runner, with the alternatives that were rejected.
- `glossary.md` — the terms the runner and its reports use (subject, arm, layer, thin sample, …).

## Where the user-facing knowledge lives

The **README** at the repository root is the reference for users: requirements, config discovery, the subject model, the case and fixture formats, the graders, every trap the runner was built around. [`../examples/`](../examples/) holds complete, commented setups and an annotated sample run; `test/examples.test.mjs` keeps them in step with the code. The documents here do not repeat either; they explain how the code is organised and how to change it safely.
