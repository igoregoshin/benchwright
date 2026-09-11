/**
 * Helpers shared by the harness adapters. Nothing here knows a CLI.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Parse a JSONL stream tolerantly: non-JSON lines (banners, warnings) are skipped. */
export function jsonLines(stdout) {
  const out = [];
  for (const line of String(stdout ?? '').split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      /* a partial line from a killed run */
    }
  }
  return out;
}

/** A JSON file's object, or `{}` when it is missing or unparseable. */
export function readJsonObject(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writeJsonFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

/** Workspace-relative path with forward slashes, as the exclude lists expect. */
export function rel(workdir, file) {
  return path.relative(workdir, file).split(path.sep).join('/');
}
