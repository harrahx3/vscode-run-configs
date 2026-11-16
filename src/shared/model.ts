// The form model of one run configuration and its conversion to / from a launch.json entry.
// Pure code: used by the extension host (saving, tree labels) and the webview (live preview).
import { argsToString, joinArgs, splitArgs } from "./args";

export type ConfigKind =
  | "python-file"
  | "python-module"
  | "fastapi"
  | "pytest"
  | "npm-script"
  | "browser"
  | "compound"
  | "custom";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";
export type ConsoleKind = "integratedTerminal" | "internalConsole" | "externalTerminal";

export interface EnvVar {
  key: string;
  value: string;
}

/** Flat on purpose: switching kind in the form keeps what was typed in shared fields. */
export interface FormModel {
  kind: ConfigKind;
  name: string;
  /** Python script path (python-file). */
  program: string;
  /** Python module (python-module). */
  module: string;
  /** Extra arguments, shell-style (python kinds, pytest targets, npm script arguments). */
  args: string;
  cwd: string;
  /** Python interpreter; empty = the interpreter selected in VS Code. */
  python: string;
  envFile: string;
  env: EnvVar[];
  justMyCode: boolean;
  console: ConsoleKind;
  /** FastAPI: `module.path:variable`. */
  app: string;
  host: string;
  port: string;
  reload: boolean;
  packageManager: PackageManager;
  script: string;
  url: string;
  webRoot: string;
  browser: "chrome" | "msedge";
  /** Compound: names of the configurations started together. */
  members: string[];
  stopAll: boolean;
  preLaunchTask: string;
  /** Custom: the raw JSON of the entry. */
  json: string;
}

export type LaunchEntry = Record<string, unknown>;
export type Section = "configurations" | "compounds";

export interface KindInfo {
  kind: ConfigKind;
  label: string;
  hint: string;
  icon: string;
}

export const KINDS: KindInfo[] = [
  { kind: "python-file", label: "Python script", hint: "Run a .py file", icon: "file-code" },
  {
    kind: "python-module",
    label: "Python module",
    hint: "python -m <module>",
    icon: "symbol-module",
  },
  { kind: "fastapi", label: "FastAPI app", hint: "uvicorn with reload", icon: "server-process" },
  { kind: "pytest", label: "Tests (pytest)", hint: "Debug a test run", icon: "beaker" },
  {
    kind: "npm-script",
    label: "package.json script",
    hint: "npm / pnpm run dev…",
    icon: "package",
  },
  { kind: "browser", label: "Browser", hint: "Debug a web page", icon: "globe" },
  { kind: "compound", label: "Start together", hint: "Several at once", icon: "layers" },
  { kind: "custom", label: "Other (JSON)", hint: "Any debugger type", icon: "json" },
];

export const PYTHON_KINDS: ConfigKind[] = ["python-file", "python-module", "fastapi", "pytest"];
const PYTHON_TYPES = ["debugpy", "python"];
const BROWSER_TYPES = ["chrome", "msedge", "pwa-chrome", "pwa-msedge"];

export function emptyModel(kind: ConfigKind = "python-file"): FormModel {
  return {
    kind,
    name: "",
    program: "",
    module: "",
    args: "",
    cwd: "${workspaceFolder}",
    python: "",
    envFile: "",
    env: [],
    justMyCode: true,
    console: "integratedTerminal",
    app: "",
    host: "",
    port: "",
    reload: true,
    packageManager: "npm",
    script: "dev",
    url: "http://localhost:5173",
    webRoot: "${workspaceFolder}",
    browser: "chrome",
    members: [],
    stopAll: true,
    preLaunchTask: "",
    json: "{}",
  };
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const NPM_COMMAND = /^(npm|pnpm|yarn|bun)\s+(?:run\s+)?(\S+)(?:\s+--)?(?:\s+(.*))?$/;

/** Guesses which form kind an existing entry belongs to. */
export function kindOf(entry: LaunchEntry, section: Section = "configurations"): ConfigKind {
  if (section === "compounds") return "compound";
  const type = str(entry.type);
  if (PYTHON_TYPES.includes(type) && entry.request !== "attach") {
    if (entry.module === "uvicorn") return "fastapi";
    if (entry.module === "pytest") return "pytest";
    if (typeof entry.module === "string") return "python-module";
    if (typeof entry.program === "string") return "python-file";
    return "custom";
  }
  if (type === "node-terminal" && NPM_COMMAND.test(str(entry.command).trim())) return "npm-script";
  if (BROWSER_TYPES.includes(type) && entry.request === "launch") return "browser";
  return "custom";
}

function envFromEntry(env: unknown): EnvVar[] {
  if (!env || typeof env !== "object") return [];
  return Object.entries(env as Record<string, unknown>).map(([key, value]) => ({
    key,
    value: value === null ? "" : String(value),
  }));
}

/** Reads FastAPI's uvicorn arguments back into separate fields; unknown ones stay in `args`. */
function parseUvicornArgs(args: string[], model: FormModel): void {
  const rest: string[] = [];
  model.reload = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--reload") model.reload = true;
    else if (a === "--host" && i + 1 < args.length) model.host = args[++i];
    else if (a === "--port" && i + 1 < args.length) model.port = args[++i];
    else if (a.startsWith("--host=")) model.host = a.slice(7);
    else if (a.startsWith("--port=")) model.port = a.slice(7);
    else if (!a.startsWith("-") && !model.app) model.app = a;
    else rest.push(a);
  }
  model.args = joinArgs(rest);
}

export function fromLaunch(entry: LaunchEntry, section: Section = "configurations"): FormModel {
  const kind = kindOf(entry, section);
  const m = emptyModel(kind);
  m.name = str(entry.name);
  m.preLaunchTask = str(entry.preLaunchTask);
  m.json = JSON.stringify(entry, null, 2);
  if (kind === "compound") {
    m.members = Array.isArray(entry.configurations)
      ? entry.configurations.map((c) => (typeof c === "string" ? c : str((c as LaunchEntry)?.name)))
      : [];
    m.stopAll = entry.stopAll === true;
    return m;
  }
  m.cwd = str(entry.cwd, kind === "custom" ? "" : "${workspaceFolder}");
  m.env = envFromEntry(entry.env);
  if (PYTHON_KINDS.includes(kind)) {
    m.program = str(entry.program);
    m.module = kind === "python-module" ? str(entry.module) : "";
    m.python = str(entry.python);
    m.envFile = str(entry.envFile);
    m.justMyCode = entry.justMyCode !== false;
    m.console = (str(entry.console) || "integratedTerminal") as ConsoleKind;
    const args = typeof entry.args === "string" ? splitArgs(entry.args) : (entry.args ?? []);
    if (kind === "fastapi") parseUvicornArgs((args as unknown[]).map(String), m);
    else m.args = argsToString(entry.args);
  } else if (kind === "npm-script") {
    const [, pm, script, rest] = NPM_COMMAND.exec(str(entry.command).trim())!;
    m.packageManager = pm as PackageManager;
    m.script = script;
    m.args = rest ?? "";
  } else if (kind === "browser") {
    m.url = str(entry.url);
    m.webRoot = str(entry.webRoot, "${workspaceFolder}");
    m.browser = str(entry.type).includes("msedge") ? "msedge" : "chrome";
  }
  return m;
}

/** Keys the form owns for each kind; every other key of an existing entry is kept as is. */
const COMMON = ["name", "type", "request", "cwd", "env", "preLaunchTask"];
const PY = [...COMMON, "program", "module", "args", "python", "envFile", "justMyCode", "console"];
const MANAGED: Record<ConfigKind, string[]> = {
  "python-file": PY,
  "python-module": PY,
  fastapi: PY,
  pytest: PY,
  "npm-script": [...COMMON, "command"],
  browser: [...COMMON, "url", "webRoot"],
  compound: ["name", "configurations", "stopAll", "preLaunchTask"],
  custom: [],
};

/**
 * Rows without a value are not written: `os.getenv("X", "10")` returns "" for a variable set
 * to an empty string, which silently replaces the project's default.
 */
function envToEntry(rows: EnvVar[]): Record<string, string> | undefined {
  const named = rows.filter((e) => e.key.trim() && e.value !== "");
  if (!named.length) return undefined;
  return Object.fromEntries(named.map((e) => [e.key.trim(), e.value]));
}

function uvicornArgs(m: FormModel): string[] {
  const args = [m.app.trim()];
  if (m.host.trim()) args.push("--host", m.host.trim());
  if (m.port.trim()) args.push("--port", m.port.trim());
  if (m.reload) args.push("--reload");
  return [...args, ...splitArgs(m.args)];
}

export function npmCommand(m: FormModel): string {
  const run = m.packageManager === "npm" || m.packageManager === "bun" ? " run" : "";
  const extra = m.args.trim() ? ` ${m.packageManager === "npm" ? "-- " : ""}${m.args.trim()}` : "";
  return `${m.packageManager}${run} ${m.script.trim()}${extra}`;
}

/** Drops empty values so the written JSON stays short and readable. */
function compact(entry: LaunchEntry): LaunchEntry {
  return Object.fromEntries(
    Object.entries(entry).filter(
      ([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && !v.length),
    ),
  );
}

export interface BuiltEntry {
  section: Section;
  entry: LaunchEntry;
}

/**
 * Builds the launch.json entry of a form. Keys the form does not know about are kept from
 * `original` when the kind did not change (e.g. `jinja`, `subProcess`, `presentation`).
 * Throws on invalid custom JSON.
 */
export function toLaunch(
  m: FormModel,
  original?: LaunchEntry,
  originalSection?: Section,
): BuiltEntry {
  if (m.kind === "custom") {
    const parsed = JSON.parse(m.json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error('The JSON must be an object, like { "type": …, "request": … }.');
    return {
      section: "configurations",
      entry: { ...(parsed as LaunchEntry), name: m.name.trim() },
    };
  }
  const sameKind = original && kindOf(original, originalSection) === m.kind;
  const kept: LaunchEntry = {};
  if (sameKind)
    for (const [k, v] of Object.entries(original)) if (!MANAGED[m.kind].includes(k)) kept[k] = v;
  const name = m.name.trim();
  const preLaunchTask = m.preLaunchTask.trim();

  if (m.kind === "compound") {
    const entry = {
      name,
      configurations: m.members,
      stopAll: m.stopAll || undefined,
      preLaunchTask,
    };
    return { section: "compounds", entry: { ...compact(entry), ...kept } };
  }

  const env = envToEntry(m.env);
  let entry: LaunchEntry;
  if (PYTHON_KINDS.includes(m.kind)) {
    const originalType = str(original?.type);
    const type = sameKind && PYTHON_TYPES.includes(originalType) ? originalType : "debugpy";
    const what =
      m.kind === "python-file"
        ? { program: m.program.trim(), args: splitArgs(m.args) }
        : m.kind === "python-module"
          ? { module: m.module.trim(), args: splitArgs(m.args) }
          : m.kind === "fastapi"
            ? { module: "uvicorn", args: uvicornArgs(m) }
            : { module: "pytest", args: splitArgs(m.args) };
    entry = {
      name,
      type,
      request: "launch",
      ...what,
      cwd: m.cwd.trim(),
      python: m.python.trim(),
      envFile: m.envFile.trim(),
      env,
      console: m.console,
      // Written even when true (debugpy's default), so the choice is visible in launch.json.
      justMyCode: m.justMyCode,
      preLaunchTask,
    };
  } else if (m.kind === "npm-script") {
    entry = {
      name,
      type: "node-terminal",
      request: "launch",
      command: npmCommand(m),
      cwd: m.cwd.trim(),
      env,
      preLaunchTask,
    };
  } else {
    entry = {
      name,
      type: m.browser,
      request: "launch",
      url: m.url.trim(),
      webRoot: m.webRoot.trim(),
      preLaunchTask,
    };
  }
  return { section: "configurations", entry: { ...compact(entry), ...kept } };
}

/** One-line description shown next to the name in the side panel. */
export function summary(m: FormModel): string {
  const short = (p: string) => p.replace(/^\$\{workspaceFolder\}\/?/, "");
  switch (m.kind) {
    case "python-file":
      return [short(m.program), m.args].filter(Boolean).join(" ");
    case "python-module":
      return [`-m ${m.module}`, m.args].filter(Boolean).join(" ");
    case "fastapi":
      return `uvicorn ${m.app}${m.port ? ` :${m.port}` : ""}${m.reload ? " (reload)" : ""}`;
    case "pytest":
      return ["pytest", m.args].filter(Boolean).join(" ");
    case "npm-script":
      return npmCommand(m) + (short(m.cwd) ? ` in ${short(m.cwd)}` : "");
    case "browser":
      return m.url;
    case "compound":
      return m.members.join(" + ");
    default: {
      try {
        const e = JSON.parse(m.json) as LaunchEntry;
        return [str(e.type), str(e.request)].filter(Boolean).join(" · ");
      } catch {
        return "";
      }
    }
  }
}

/** Problems that block saving, as `{field: message}`; `names` are the folder's other entries. */
export function validate(m: FormModel, names: readonly string[]): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = m.name.trim();
  if (!name) errors.name = "Give the configuration a name.";
  else if (names.includes(name)) errors.name = "Another configuration already has this name.";
  const need = (field: keyof FormModel, message: string) => {
    if (!String(m[field]).trim()) errors[field] = message;
  };
  if (m.kind === "python-file") need("program", "Choose the Python file to run.");
  if (m.kind === "python-module") need("module", "Type the module to run, e.g. mypackage.cli.");
  if (m.kind === "fastapi") {
    need("app", "Type the app as module:variable, e.g. app.main:app.");
    if (m.app.trim() && !/^[\w.]+:[\w.()]+$/.test(m.app.trim()))
      errors.app = "Use module:variable, e.g. app.main:app.";
    if (m.port.trim() && !/^\d{2,5}$/.test(m.port.trim())) errors.port = "A port is a number.";
  }
  if (m.kind === "npm-script") need("script", "Choose the script to run.");
  if (m.kind === "browser") need("url", "Type the page address, e.g. http://localhost:5173.");
  if (m.kind === "compound" && !m.members.length)
    errors.members = "Tick at least one configuration.";
  if (m.kind === "custom") {
    try {
      const e = JSON.parse(m.json) as LaunchEntry;
      if (!e || typeof e !== "object" || Array.isArray(e))
        errors.json = "The JSON must be an object.";
      else if (!e.type || !e.request) errors.json = 'The JSON needs at least "type" and "request".';
    } catch (err) {
      errors.json = `Invalid JSON: ${(err as Error).message}`;
    }
  }
  const { env: rows } = m;
  if (rows.some((e) => !e.key.trim() && e.value.trim()))
    errors.env = "A variable has a value but no name.";
  return errors;
}
