/**
 * Graders — deterministic first, LLM judge only where no rule can express it.
 *
 * A grader returns {pass, why}. Case score = passed weight / total weight,
 * excluding `with_only` graders (those are "the subject fired" indicators, not
 * quality signals — they would make every ablation look like a win).
 */
import { execFileSync } from 'node:child_process';
import { judge } from './agent.mjs';

/**
 * `command` graders run under POSIX sh, never cmd.exe.
 *
 * cmd.exe eats `%` sequences, so a perfectly good `git log --pretty=%B` silently
 * loses its format string and the grader reports a failure that never
 * happened. Git for Windows always ships bash, so prefer it and fall back to the
 * platform default only when there is none.
 */
const SHELL = (() => {
  if (process.env.BENCHWRIGHT_SHELL) return process.env.BENCHWRIGHT_SHELL;
  if (process.platform !== 'win32') return true;
  for (const candidate of ['bash', 'C:\\Program Files\\Git\\bin\\bash.exe']) {
    try {
      execFileSync(candidate, ['-c', 'exit 0'], { stdio: 'ignore' });
      return candidate;
    } catch {
      /* try the next one */
    }
  }
  return true;
})();

const DETERMINISTIC = {
  /** A file matching `path` exists. `*` = one segment, `**` = any depth. */
  file_exists: ({ g, files }) => {
    const hit = matchPaths(files, g.path);
    return { pass: hit.length > 0, why: hit.length ? `found ${hit[0]}` : `no file matching ${g.path}` };
  },

  /** Nothing matching `path` exists — for "must not write before approval" rules. */
  file_absent: ({ g, files }) => {
    const hit = matchPaths(files, g.path);
    return { pass: hit.length === 0, why: hit.length ? `unexpected ${hit[0]}` : `nothing matches ${g.path}` };
  },

  /** Content of a matching file matches `pattern`. */
  file_matches: ({ g, files }) => {
    const hit = matchPaths(files, g.path);
    if (!hit.length) return { pass: false, why: `no file matching ${g.path}` };
    const re = new RegExp(g.pattern, g.flags ?? 'm');
    const found = hit.find((p) => re.test(files.get(p)));
    return { pass: Boolean(found), why: found ? `${found} matches` : `${hit[0]} does not match /${g.pattern}/` };
  },

  /** The agent's own output matches `pattern`. */
  output_matches: ({ g, run }) => {
    const re = new RegExp(g.pattern, g.flags ?? 'im');
    const ok = re.test(run.transcript);
    return { pass: ok, why: ok ? 'transcript matches' : `transcript lacks /${g.pattern}/` };
  },

  /** A named tool fired. `tool: Skill` + `skill: <name>` proves a skill loaded. */
  tool_used: ({ g, run }) => {
    if (g.tool === 'Skill' && g.skill) {
      const used = run.skillsUsed.includes(g.skill);
      return { pass: used, why: used ? `Skill ${g.skill} invoked` : `Skill ${g.skill} never invoked (skills: ${run.skillsUsed.join(', ') || 'none'})` };
    }
    const used = run.toolsUsed.includes(g.tool);
    return { pass: used, why: used ? `${g.tool} used` : `${g.tool} never used` };
  },

  /** Nothing was written at all — the strict form of "ask before you act". */
  no_writes: ({ run }) => {
    const writers = run.toolsUsed.filter((t) => ['Write', 'Edit', 'NotebookEdit'].includes(t));
    return { pass: writers.length === 0, why: writers.length ? `wrote via ${writers.join(', ')}` : 'no writes' };
  },

  /** Run a shell command in the workspace; pass on `expect_exit` (default 0). */
  command: ({ g, workdir }) => {
    const expected = g.expect_exit ?? 0;
    try {
      // Trailing whitespace is dropped before matching. Under the default `m`
      // flag, `^$` / `^\s*$` on "  fix/x<newline>" matched the empty position after
      // the final newline, so a "nothing left" grader passed on everything.
      const out = trimEnd(execFileSync(g.run, { cwd: workdir, shell: SHELL, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] }));
      if (g.expect_match) {
        const ok = new RegExp(g.expect_match, g.flags ?? 'm').test(out);
        return { pass: ok, why: ok ? 'output matches' : `output does not match /${g.expect_match}/: ${out.trim().slice(0, 120)}` };
      }
      return { pass: expected === 0, why: expected === 0 ? 'exit 0' : `expected exit ${expected}, got 0` };
    } catch (err) {
      // A non-zero exit can be the expected outcome; a spawn failure never is,
      // so keep the two distinguishable instead of reporting both as "exit -1".
      if (err.status === undefined) {
        return { pass: false, why: `could not run: ${String(err.message).split('\n')[0].slice(0, 160)}`, error: true };
      }
      if (g.expect_match) {
        const out = trimEnd(String(err.stdout ?? ''));
        const ok = new RegExp(g.expect_match, g.flags ?? 'm').test(out);
        return { pass: ok, why: ok ? `output matches (exit ${err.status})` : `exit ${err.status}, output does not match /${g.expect_match}/` };
      }
      return { pass: err.status === expected, why: `exit ${err.status}` };
    }
  },
};

const trimEnd = (s) => s.replace(/\s+$/, '');

/** Every grader `type` a case may name. `llm` is the judge; the rest are rules. */
export const KNOWN_GRADERS = ['llm', ...Object.keys(DETERMINISTIC)];

export async function gradeCase({ graders, run, workdir, files, prompt, autopilot, judgeModel, harness }) {
  const results = [];
  for (const g of graders) {
    let r;
    if (g.type === 'llm') {
      r = await judge({
        harness,
        criterion: g.criterion,
        prompt,
        transcript: run.transcript,
        toolCalls: run.toolCalls ?? [],
        autopilot: autopilot ? (Array.isArray(autopilot) ? autopilot : [autopilot]) : [],
        files: renderFiles(files),
        model: judgeModel,
      });
    } else if (DETERMINISTIC[g.type]) {
      try {
        r = DETERMINISTIC[g.type]({ g, run, workdir, files });
      } catch (err) {
        r = { pass: false, why: `grader error: ${err.message}`, error: true };
      }
    } else {
      r = { pass: false, why: `unknown grader type "${g.type}"`, error: true };
    }
    results.push({
      id: g.id,
      type: g.type,
      weight: g.weight,
      withOnly: g.withOnly,
      label: g.criterion ?? g.path ?? g.tool ?? g.run ?? g.pattern ?? g.type,
      ...r,
    });
  }

  const scored = results.filter((x) => !x.withOnly);
  const total = scored.reduce((a, x) => a + x.weight, 0);
  const got = scored.reduce((a, x) => a + (x.pass ? x.weight : 0), 0);
  return { graders: results, score: total ? got / total : 0 };
}

/**
 * Glob-ish path match over the snapshot keys: `**` spans directories, `*` stays
 * inside one segment.
 *
 * Both wildcards expand in a SINGLE pass. Expanding `**` first and `*` second
 * needs somewhere to park the intermediate result, and every placeholder is a
 * character some real pattern could contain — the first version parked it in a
 * literal NUL, which quietly made git store this whole source file as binary.
 */
export function matchPaths(files, pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, (ch) => `\\${ch}`)
    .replace(/\*\*|\*/g, (wildcard) => (wildcard === '**' ? '.*' : '[^/]*'));
  const re = new RegExp(`^${escaped}$`);
  return [...files.keys()].filter((p) => re.test(p));
}

function renderFiles(files) {
  if (!files.size) return '(no files)';
  return [...files.entries()]
    .map(([p, c]) => `--- ${p}\n${c.length > 4000 ? `${c.slice(0, 4000)}\n...[truncated]` : c}`)
    .join('\n\n');
}
