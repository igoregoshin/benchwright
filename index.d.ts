// Type surface of benchwright. Runtime is plain ESM JavaScript; these types exist
// so a TypeScript test suite can call `check()` without `any`.

export type Layer = 'trigger' | 'functional' | 'ablation';
export type Category = 'diff' | 'repo' | 'doc' | 'mcp' | 'chain' | 'none';
export type Arm = 'with' | 'without';
export type HarnessName = 'claude' | 'opencode' | 'codex';

export const ALL_LAYERS: Layer[];
export const CATEGORIES: Category[];
export const KNOWN_GRADERS: string[];
export const RELIABLE_RUNS: number;
export const CONFIG_NAMES: string[];
export const HARNESS_PATHS: string[];
export const HARNESSES: HarnessName[];
export const CLAUDE: string;
export const HELP: string;

/**
 * The canonical events every adapter produces and every grader is written
 * against. Tool names are the canonical ones: `Bash` (`input.command`),
 * `Write` / `Edit` / `Read` (`input.file_path`), `Skill` (`input.skill`),
 * `mcp__<server>__<tool>` (the call's arguments).
 */
export type CanonicalEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; input: Record<string, unknown> }
  | { type: 'result'; text: string; costUsd: number | null };

export interface HarnessCommand {
  args: string[];
  input?: string;
  env?: Record<string, string>;
}

/** One adapter per agent CLI (`lib/harness/<name>.mjs`). */
export interface Harness {
  name: HarnessName | string;
  title: string;
  /** The environment variable that overrides `binary`. */
  envVar: string;
  binary: string;
  /** The harness's own defaults; `null` means the CLI decides. A config value wins. */
  defaults: { model: string | null; judgeModel: string | null };
  /** 'flag': the CLI has a system-prompt channel; 'prepend': autopilot text is prepended to the prompt. */
  systemPromptMode: 'flag' | 'prepend';
  /** Workspace-relative directory the CLI reads project skills from. */
  skillsDir: string;
  /** Workspace-relative paths the harness itself creates; hidden from git and from `snapshot()`. */
  harnessPaths: string[];
  /** Whether `Skill` events are reported: natively, inferred from a file read, or not at all. */
  reportsSkills: boolean | 'inferred';
  reportsCost: boolean;
  caseCommand(args: { prompt: string; model: string | null; maxTurns?: number; systemPrompt?: string; allowedTools?: string[]; cwd?: string }): HarnessCommand;
  promptCommand(args: { model: string | null; prompt: string; cwd?: string }): HarnessCommand;
  promptText(stdout: string): string;
  parseEvents(stdout: string, opts?: { cwd?: string }): CanonicalEvent[];
  writeMcpConfig(workdir: string, servers: Record<string, { command: string; args: string[] }>): string[];
}

export function getHarness(name?: HarnessName | string | Harness | null): Harness;
export function resolveBinary(binary: string): { file: string; prefix: string[]; unresolved?: string };

export interface Defaults {
  runs: number;
  triggerRuns: number;
  /** Which agent CLI runs the cases. */
  harness: HarnessName | string;
  /** `null` = the harness's own default model. */
  model: string | null;
  judgeModel: string | null;
  maxTurns: number;
  timeoutSeconds: number;
  concurrency: number;
  secretsFile: string;
  autopilotPreamble: string;
  [key: string]: unknown;
}
export const DEFAULTS: Defaults;

export interface Grader {
  id: string;
  type: string;
  weight: number;
  withOnly: boolean;
  [key: string]: unknown;
}

export interface FixtureFile {
  path: string;
  content?: string;
  deleted?: boolean;
}

export interface Fixture {
  files?: FixtureFile[];
  changed?: FixtureFile[];
  staged?: boolean;
  commits?: Array<{ branch?: string; message?: string; files?: FixtureFile[] }>;
  branch?: string;
  remote?: string;
  mocks?: string;
  variant?: string;
  [key: string]: unknown;
}

export interface Case {
  id: string;
  prompt: string;
  tags: string[];
  runs: number;
  model: string | null;
  maxTurns: number;
  timeoutSeconds: number;
  fixture: Fixture;
  autopilot: string | string[] | null;
  graders: Grader[];
  source: string;
}

export interface TriggerCase {
  id: string;
  query: string;
  shouldTrigger: boolean;
}

export interface InstallContext {
  subject: Subject;
  testCase: Case;
  arm: Arm;
  variant: string | null;
  /** The harness the workspace is built for; its `skillsDir` is where a skill goes. */
  harness: Harness;
}

export type InstallFn = (workdir: string, ctx: InstallContext) => void | string[];

/** What a config declares (or a discovery helper returns). */
export interface RawSubject {
  id: string;
  category?: Category;
  layers?: Layer[];
  exempt?: boolean | string;
  exemptReason?: string;
  layerReason?: string;
  description?: string | null;
  trigger?: Array<{ id?: string; query: string; should_trigger?: boolean; shouldTrigger?: boolean }>;
  triggerFile?: string;
  cases?: Array<Record<string, unknown>>;
  casesFile?: string;
  mocksDir?: string;
  install?: InstallFn | { copy: Array<{ from: string; to: string }> };
  meta?: Record<string, unknown>;
}

/** The normalized shape the runner works with. */
export interface Subject {
  id: string;
  category: Category | null;
  exempt: boolean;
  exemptReason: string | null;
  layers: Layer[];
  layerReason: string | null;
  description: string | null;
  trigger: TriggerCase[];
  cases: Case[];
  casesFile: string | null;
  mocksDir: string | null;
  install: InstallFn | null;
  meta: Record<string, unknown>;
}

export interface SkillRegistry {
  categories?: Record<string, { title?: string; fixture?: string; skills: string[] }>;
  exempt?: Record<string, string>;
  overrides?: Record<string, { layers: Layer[]; reason: string }>;
  /** Alias of `overrides`. */
  skillOverrides?: Record<string, { layers: Layer[]; reason: string }>;
}

export interface SkillInstallArgs extends InstallContext {
  skillDir: string;
  name: string;
  dest: string;
  workdir: string;
}

export interface SkillSubjectsOptions {
  dir: string;
  registry?: SkillRegistry | null;
  evalsDir?: string;
  casesFile?: string;
  triggerFile?: string;
  mocksDir?: string;
  /** Pins the install directory; by default the harness's `skillsDir` is used. */
  skillsRoot?: string | null;
  include?: (name: string) => boolean;
  describe?: (skillDir: string, name: string) => string | null;
  install?: ((args: SkillInstallArgs) => void) | null;
  filter?: ((name: string, fullPath: string) => boolean) | null;
}

export interface SubjectsResult {
  subjects: RawSubject[];
  problems: string[];
}

export interface ConfigContext {
  root: string;
  configDir: string;
  defaults: Defaults;
  skillSubjects: typeof skillSubjects;
  installSkill: typeof installSkill;
  skillDescription: typeof skillDescription;
  readFrontmatter: typeof readFrontmatter;
}

export type SubjectsDeclaration =
  | RawSubject[]
  | SubjectsResult
  | ((ctx: ConfigContext) => RawSubject[] | SubjectsResult | Promise<RawSubject[] | SubjectsResult>);

export interface RawConfig {
  title?: string;
  root?: string;
  resultsDir?: string;
  defaults?: Partial<Defaults>;
  categories?: Record<string, { title?: string; fixture?: string; [key: string]: unknown }>;
  subjects?: SubjectsDeclaration;
  skills?: Omit<SkillSubjectsOptions, 'registry'> & { registry?: SkillRegistry | string };
}

export interface Config {
  path: string;
  dir: string;
  root: string;
  title: string;
  defaults: Defaults;
  categories: Record<string, { title?: string; fixture?: string; [key: string]: unknown }>;
  resultsDir: string;
  subjects: SubjectsDeclaration | null;
  skills: RawConfig['skills'] | null;
}

export function findConfig(fromDir?: string): string | null;
export function loadConfig(configPath: string): Promise<Config>;
export function resolveSubjects(config: Config): Promise<{ subjects: Subject[]; problems: string[] }>;
export function check(config: Config): Promise<{ subjects: Subject[]; problems: string[] }>;

export function normalizeSubject(raw: RawSubject, opts: { root: string; defaults: Defaults; problems: string[] }): Subject | null;
export function normalizeCase(raw: Record<string, unknown>, index: number, defaults: Defaults, source: string): Case;
export function validateSubject(subject: Subject): string[];
export function copyPath(src: string, dest: string, filter?: (name: string, fullPath: string) => boolean): void;

export function skillSubjects(options: SkillSubjectsOptions): SubjectsResult;
export function installSkill(src: string, dest: string, opts?: { filter?: ((name: string, fullPath: string) => boolean) | null }): string;
export function skillDescription(skillDir: string): string | null;
export function readFrontmatter(file: string): Record<string, unknown> | null;

export function buildWorkspace(args: { subject: Subject; testCase: Case; workdir: string; arm: Arm; defaults?: Partial<Defaults>; harness?: Harness | HarnessName | string }): { workdir: string; excludes: string[] };
export function snapshot(workdir: string, excludes?: string[]): Map<string, string>;

export interface RunResult {
  ok: boolean;
  timedOut: boolean;
  stderr: string;
  durationMs: number;
  transcript: string;
  toolCalls: Array<{ name: string; summary: string }>;
  toolsUsed: string[];
  skillsUsed: string[];
  costUsd: number | null;
}
export interface GraderResult extends Grader {
  label: string;
  pass: boolean;
  why: string;
  error?: boolean;
}
export function gradeCase(args: {
  graders: Grader[];
  run: Pick<RunResult, 'transcript' | 'toolsUsed' | 'skillsUsed'> & Partial<RunResult>;
  workdir: string;
  files: Map<string, string>;
  prompt: string;
  autopilot?: string | string[] | null;
  judgeModel: string | null;
  harness?: Harness | HarnessName | string;
}): Promise<{ graders: GraderResult[]; score: number }>;
export function matchPaths(files: Map<string, string>, pattern: string): string[];

export function runCase(args: {
  harness?: Harness | HarnessName | string;
  prompt: string;
  cwd: string;
  model?: string | null;
  maxTurns?: number;
  timeoutSeconds?: number;
  allowedTools?: string[];
  systemPrompt?: string;
}): Promise<RunResult>;
export function judge(args: {
  harness?: Harness | HarnessName | string;
  criterion: string;
  prompt?: string;
  transcript?: string;
  toolCalls?: Array<{ name: string; summary: string }>;
  autopilot?: string[];
  files?: string;
  model?: string | null;
  timeoutSeconds?: number;
}): Promise<{ pass: boolean; why: string; error?: boolean }>;
export function classifyTrigger(args: {
  harness?: Harness | HarnessName | string;
  name: string;
  description: string;
  query: string;
  model?: string | null;
  timeoutSeconds?: number;
}): Promise<{ triggered: boolean; error?: string }>;
export function checkAgentBinary(harness?: Harness | HarnessName | string): { ok: true; version: string } | { ok: false; error: string };
export function renderTranscript(events: Array<Record<string, unknown>>): string;
export function summarizeInput(name: string, input: unknown): string;

export function resolveModels(args?: { args?: Record<string, unknown>; testCase?: Case | null; defaults?: Partial<Defaults>; harness?: Harness | HarnessName | string }): { harness: Harness; model: string | null; judgeModel: string | null };
export function runTriggerLayer(subjects: Subject[], args: Record<string, unknown>, defaults: Defaults, stream: RunStream, opts?: { harness?: Harness | HarnessName | string }): Promise<void>;
export function runFunctionalLayer(subjects: Subject[], args: Record<string, unknown>, defaults: Defaults, tmpRoot: string, opts: { sections: string[]; harness?: Harness | HarnessName | string }, stream: RunStream): Promise<void>;
export function runOneArm(args: { subject: Subject; testCase: Case; args: Record<string, unknown>; defaults: Defaults; arm: Arm; tmpRoot: string; harness?: Harness | HarnessName | string }): Promise<{ workdir: string; run: RunResult; graders: GraderResult[]; score: number }>;
export function autopilotPrompt(testCase: Case, defaults: Defaults): string | undefined;
export function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]>;

export interface RunStream {
  dir: string;
  jsonlPath: string;
  jsonPath: string;
  htmlPath: string;
  records: Array<Record<string, unknown>>;
  resumedRecords: number;
  has(key: string): boolean;
  append(record: Record<string, unknown>): void;
  flush(): Record<string, unknown>;
  finalize(complete: boolean): Record<string, unknown>;
}
export function openRun(outDir: string, meta: Record<string, unknown>): RunStream;
export function readRecords(outDir: string): Array<Record<string, unknown>>;
export function assemble(records: Array<Record<string, unknown>>): Record<string, unknown>;
export function keyOf(record: Record<string, unknown>): string | null;
export function reading(withScore: number, withoutScore: number): { code: string; note: string };
export function renderHtml(result: Record<string, unknown>): string;
export function writeJson(outDir: string, result: Record<string, unknown>): string;
export function writeHtml(outDir: string, result: Record<string, unknown>): string;
export function pct(n: number): string;

export function parseArgs(argv: string[]): Record<string, unknown>;
export function main(argv: string[]): Promise<void>;
