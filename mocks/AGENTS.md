# mocks/ — agent navigation

Standalone processes the fixture builder spawns or wires into a workspace: an MCP server over stdio, an HTTP server, and the call-log query helper that `command` graders run.

## See also

| Topic | File |
|---|---|
| Fixture formats and the determinism rule | the header comment of each script, and [../README.md](../README.md) → Mock services |
| Where mocks sit in the pipeline | [../docs/architecture/layers.md](../docs/architecture/layers.md) |
| Rules and tests | [../docs/development/rules.md](../docs/development/rules.md), [../docs/development/testing.md](../docs/development/testing.md) |

## Boundaries

- These scripts import nothing from `lib/` and `lib/` imports nothing from them. `calls.mjs` is copied verbatim into every mocked workspace as `.bench/calls.mjs`; it must keep working there on its own.
- Never invent a response. An unrecorded request is an explicit error (HTTP `501`, MCP `isError: true`) so a missing fixture surfaces as a failure, not as a green case.
- Every call is logged, matched or not, to the `--log` file as one JSON line with `t: 'mcp' | 'http'`. Graders assert on that log; do not change its shape without the [api-change](../docs/change-scenarios/api-change.md) scenario.
- The MCP server *name* is part of the contract with the subject's tools (`mcp__<server>__<tool>`). It comes from the fixture, never from a default.
- Bind loopback only; hard TTL on the HTTP server so a crashed run cannot leave a listener behind.
