/**
 * benchwright — public API.
 *
 * The CLI (`bin/benchwright.mjs`) is a thin wrapper over `main`. Everything else
 * is exported so a project can validate its config in its own test suite,
 * build subjects its own way, or drive the layers programmatically.
 */
export { main, parseArgs, HELP } from './lib/cli.mjs';
export { CONFIG_NAMES, findConfig, loadConfig, resolveSubjects, check } from './lib/config.mjs';
export { ALL_LAYERS, CATEGORIES, DEFAULTS, normalizeSubject, normalizeCase, validateSubject, copyPath } from './lib/subjects.mjs';
export { skillSubjects, installSkill, skillDescription, readFrontmatter } from './lib/skills.mjs';
export { buildWorkspace, snapshot, HARNESS_PATHS } from './lib/fixtures.mjs';
export { gradeCase, matchPaths, KNOWN_GRADERS } from './lib/graders.mjs';
export { runCase, judge, classifyTrigger, checkAgentBinary, renderTranscript, summarizeInput, CLAUDE } from './lib/agent.mjs';
export { runTriggerLayer, runFunctionalLayer, runOneArm, autopilotPrompt, mapLimit } from './lib/runner.mjs';
export { openRun, readRecords, assemble, keyOf, reading, renderHtml, writeJson, writeHtml, RELIABLE_RUNS, pct } from './lib/report.mjs';
