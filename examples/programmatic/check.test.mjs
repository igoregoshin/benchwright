// Example 4a — the free layer as a test.
//
// `check()` is `benchwright --check` as a function. Put it in your own test
// suite so a subject added later can never be silently un-benchmarked: a skill
// missing from the registry, a case without graders, a regex with inline flags
// all come back as `problems`, and the assertion below turns them into a
// failing build — before anyone pays for a run.
//
//   node --test examples/programmatic/check.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { check, loadConfig } from '../../index.mjs'; // in your project: from 'benchwright'

const CONFIGS = ['../skill/benchwright.config.mjs', '../rules-file/benchwright.config.json', '../mock-services/benchwright.config.mjs'];

for (const rel of CONFIGS) {
  test(`${rel}: every subject and every case is well-formed`, async () => {
    const config = await loadConfig(fileURLToPath(new URL(rel, import.meta.url)));
    const { subjects, problems } = await check(config);
    assert.deepEqual(problems, []);
    assert.ok(subjects.length > 0, 'the config declares at least one subject');
  });
}
