import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'bench-results') return [];
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return /\.(mjs|js|json|md|ts)$/.test(e.name) ? [full] : [];
  });
}

describe('package sources', () => {
  const files = sources(ROOT);

  it('finds the package', () => {
    assert.ok(files.length > 10);
  });

  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    it(`${rel}: no NUL bytes, so git never treats it as binary`, () => {
      // It happened once: a `**` expansion parked its intermediate result in a
      // literal NUL and the whole grader module was committed as `Bin`.
      assert.equal(fs.readFileSync(file).indexOf(0), -1);
    });
    it(`${rel}: carries no vendor binding`, () => {
      const text = fs.readFileSync(file, 'utf8');
      // Assembled at run time so this file does not trip its own check.
      for (const needle of [['tl', 'bench'].join('-'), ['TL', 'BENCH'].join('_'), ['tl', 'ai', 'kit'].join('-'), 'travel' + 'line', 'Travel' + 'Line']) {
        assert.ok(!text.includes(needle), `${rel} mentions ${needle}`);
      }
    });
  }
});
