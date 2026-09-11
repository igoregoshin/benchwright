// Type surface of benchwright. Runtime is plain ESM JavaScript; these types exist
// so a TypeScript test suite can call `check()` without `any`.

export type Layer = 'trigger' | 'functional' | 'ablation';
export type Category = 'diff' | 'repo' | 'doc' | 'mcp' | 'chain' | 'none';
export type Arm = 'with' | 'without';

export const ALL_LAYERS: Layer[];
export const CATEGORIES: Category[];
export const KNOWN_GRADERS: string[];
export const RELIABLE_RUNS: number;
export const CONFIG_NAMES: string[];
export const HARNESS_PATHS: string[];
export const CLAUDE: string;
export const HELP: string;

export interface Defaults {
  runs: number;
  triggerRuns: number;
  model: string;
  judgeModel: string;
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
  model: string;
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
  skillsRoot?: string;
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

export function buildWorkspace(args: { subject: Subject; testCase: Case; workdir: string; arm: Arm; defaults?: Partial<Defaults> }): { workdir: string; excludes: string[] };
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
  judgeModel: string;
}): Promise<{ graders: GraderResult[]; score: number }>;
export function matchPaths(files: Map<string, string>, pattern: string): string[];

export function runCase(args: { prompt: string; cwd: string; model: string; maxTurns: number; timeoutSeconds: number; allowedTools?: string[]; systemPrompt?: string }): Promise<RunResult>;
export function judge(args: { criterion: string; prompt?: string; transcript?: string; toolCalls?: Array<{ name: string; summary: string }>; autopilot?: string[]; files?: string; model: string; timeoutSeconds?: number }): Promise<{ pass: boolean; why: string; error?: boolean }>;
export function classifyTrigger(args: { name: string; description: string; query: string; model: string; timeoutSeconds?: number }): Promise<{ triggered: boolean; error?: string }>;
export function checkAgentBinary(): { ok: true; version: string } | { ok: false; error: string };
export function renderTranscript(events: Array<Record<string, unknown>>): string;
export function summarizeInput(name: string, input: unknown): string;

export function runTriggerLayer(subjects: Subject[], args: Record<string, unknown>, defaults: Defaults, stream: RunStream): Promise<void>;
export function runFunctionalLayer(subjects: Subject[], args: Record<string, unknown>, defaults: Defaults, tmpRoot: string, opts: { sections: string[] }, stream: RunStream): Promise<void>;
export function runOneArm(args: { subject: Subject; testCase: Case; args: Record<string, unknown>; defaults: Defaults; arm: Arm; tmpRoot: string }): Promise<{ workdir: string; run: RunResult; graders: GraderResult[]; score: number }>;
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
