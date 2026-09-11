# Scenario: defaults and environment variables

## When to apply

A new or changed entry in `DEFAULTS` (`lib/subjects.mjs`), a new `BENCHWRIGHT_*` environment variable, a change to config discovery, or a new field a config may declare.

## Read first

- [`../architecture/constraints.md`](../architecture/constraints.md) — config shape, discovery order and environment variables are contracts.
- The README sections *Config* and *Requirements* — where each of these is documented for users.

## Steps

1. A default goes into `DEFAULTS`, is overridable from `defaults` in the config, and — if it is per-case — from the case (`normalizeCase`). Keep that precedence: case > config > `DEFAULTS`.
2. An environment variable is read in exactly one module, named `BENCHWRIGHT_<WHAT>`, and documented in the README *Requirements* section with what it overrides.
3. A config field is normalized in `loadConfig` (paths resolved against `root`) and typed in `index.d.ts` (`RawConfig` / `Config`).
4. A test in `test/config.test.mjs` or `test/subjects.test.mjs` for the precedence, and for the failure mode (unknown value, missing file).
5. Never a literal secret, host or token as a default; placeholders only.

## Checklist

- [ ] Precedence case > config > `DEFAULTS` holds and is tested.
- [ ] One reader per environment variable; README updated.
- [ ] `index.d.ts` updated for a config field.
- [ ] Existing consumers keep their behaviour with the new default (or it is an [api-change](api-change.md)).

## Typical mistakes

- Reading `process.env` inside a stage where the value should have arrived through `defaults` — it then cannot be overridden per consumer.
- A default that depends on the vendor's layout (a secrets path, a skills directory). Those belong in the consumer's config.
- Changing the discovery order: a consumer's config silently stops being found.
