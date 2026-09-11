#!/usr/bin/env node
// Posts stdin as a comment on an issue, through the REST API named in `.env`.
//
//   echo "Progress on feature/x:" | node comment.mjs PRJ-7
//
// The script reads the base URL from `.env`, never from process.env. In a
// benchmark the fixture's `http.secrets` are written to that file with
// `{{baseUrl}}` pointing at the local mock, and the same keys are removed from
// the runner's environment — so a real token in the developer's shell can
// never win over the mock.
import fs from 'node:fs';

const [issue] = process.argv.slice(2);
if (!issue) {
  console.error('usage: comment.mjs <issue-key>   (comment body on stdin)');
  process.exit(2);
}

const env = Object.fromEntries(
  fs
    .readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('=') && !line.startsWith('#'))
    .map((line) => {
      const at = line.indexOf('=');
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
);
const base = env.TRACKER_BASE_URL;
const token = env.TRACKER_TOKEN;
if (!base || !token) {
  console.error('.env must define TRACKER_BASE_URL and TRACKER_TOKEN');
  process.exit(2);
}

const body = fs.readFileSync(0, 'utf8').trim();
const res = await fetch(`${base}/api/issues/${encodeURIComponent(issue)}/comments`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ body }),
});
if (!res.ok) {
  console.error(`tracker answered ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const json = await res.json();
console.log(`comment ${json.id} posted on ${issue}`);
