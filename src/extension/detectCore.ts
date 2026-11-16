// Turns a scan of a workspace folder into ready-to-edit configuration suggestions.
// Pure: the scan (paths + the text of the interesting files) is collected by detect.ts.
import type { Hints } from "../shared/messages";
import type { FireCli } from "../shared/fire";
import { envNamesOf, fireCliOf } from "./pythonCli";
import { emptyModel, type FormModel, type PackageManager } from "../shared/model";

export type { Hints };

export interface Scan {
  /** Relative POSIX path -> text, for the files whose content matters. */
  texts: Map<string, string>;
  /** Every relative path known to exist (files and the few directories we look for). */
  exists: Set<string>;
}

export type SuggestionGroup = "Commands" | "Python" | "Tests" | "Web" | "Together";

export interface Suggestion {
  group: SuggestionGroup;
  label: string;
  detail: string;
  model: FormModel;
  /** Configurations a compound suggestion needs; created with it when missing. */
  alsoCreate?: FormModel[];
}

const WS = "${workspaceFolder}";
export const wsPath = (rel: string) => (rel ? `${WS}/${rel}` : WS);
const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const baseOf = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const depth = (p: string) => p.split("/").length;
const MAIN_GUARD = /^if\s+__name__\s*==\s*["']__main__["']\s*:/m;
const FASTAPI = /^(\w+)\s*(?::\s*[\w.[\]]+\s*)?=\s*(?:fastapi\.)?FastAPI\s*\(/gm;
const TEST_FILE = /(^|\/)(test_[^/]*|[^/]*_test)\.py$/;

function pathsWith(scan: Scan, name: string): string[] {
  return [...scan.exists].filter((p) => baseOf(p) === name).sort((a, b) => depth(a) - depth(b));
}

/** Folder of the nearest pyproject.toml above a file (the root of its Python project). */
function pythonRootOf(file: string, roots: string[]): string {
  let best = "";
  for (const r of roots)
    if ((r === "" || file.startsWith(`${r}/`)) && r.length > best.length) best = r;
  return best;
}

function venvPython(scan: Scan, root: string): string {
  for (const venv of [".venv", "venv"]) {
    if (scan.exists.has(join(root, `${venv}/bin/python`)))
      return wsPath(join(root, `${venv}/bin/python`));
    if (scan.exists.has(join(root, `${venv}/Scripts/python.exe`)))
      return wsPath(join(root, `${venv}/Scripts/python.exe`));
  }
  return "";
}

/** `src/pkg/api/main.py` under root -> module `pkg.api.main`, run from `<root>/src`. */
function moduleOf(file: string, root: string): { module: string; cwd: string } {
  let rel = root ? file.slice(root.length + 1) : file;
  let cwd = root;
  if (rel.startsWith("src/")) {
    rel = rel.slice(4);
    cwd = join(root, "src");
  }
  const module = rel
    .replace(/\.py$/, "")
    .split("/")
    .filter((p) => p !== "__init__" && p !== "__main__")
    .join(".");
  return { module, cwd };
}

function pythonModel(kind: FormModel["kind"], name: string, root: string, scan: Scan): FormModel {
  const m = emptyModel(kind);
  m.name = name;
  m.cwd = wsPath(root);
  m.python = venvPython(scan, root);
  // debugpy reads the workspace's env file by itself; a sub-project's must be named.
  if (root && scan.exists.has(join(root, ".env"))) m.envFile = wsPath(join(root, ".env"));
  return m;
}

/** Entries of `[project.scripts]` and `[tool.poetry.scripts]`. */
export function consoleScripts(pyproject: string): string[] {
  const names: string[] = [];
  let inScripts = false;
  for (const line of pyproject.split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+)\]/.exec(line);
    if (header) inScripts = ["project.scripts", "tool.poetry.scripts"].includes(header[1].trim());
    else if (inScripts) {
      const entry = /^\s*["']?([\w.-]+)["']?\s*=/.exec(line);
      if (entry) names.push(entry[1]);
    }
  }
  return names;
}

function suffix(dir: string): string {
  return dir ? ` (${dir})` : "";
}

/** Python Fire command lines of the project (files importing fire and calling Fire). */
export function fireClis(scan: Scan): FireCli[] {
  const out: FireCli[] = [];
  for (const [file, text] of scan.texts) {
    if (!file.endsWith(".py") || !/\bFire\(/.test(text) || TEST_FILE.test(file)) continue;
    const cli = fireCliOf(file, text);
    if (cli) out.push(cli);
  }
  return out
    .sort((a, b) => depth(a.file) - depth(b.file) || a.file.localeCompare(b.file))
    .slice(0, 20);
}

/** One configuration per Fire command: `main.py coupled`, `main.py pp`… */
function fireSuggestions(scan: Scan, clis: FireCli[], roots: string[]): Suggestion[] {
  const out: Suggestion[] = [];
  for (const cli of clis) {
    const root = pythonRootOf(cli.file, roots);
    for (const command of cli.commands) {
      const where = baseOf(cli.file) + suffix(dirOf(cli.file));
      const m = pythonModel(
        "python-file",
        command.name ? `${command.name} (${where})` : `Run ${where}`,
        root,
        scan,
      );
      m.program = wsPath(cli.file);
      m.args = command.name;
      const options = command.params.map((p) => `--${p.name}`).join(" ");
      out.push({
        group: "Commands",
        label: `${cli.file} ${command.name}`.trim(),
        detail: [command.doc, options && `options: ${options}`].filter(Boolean).join(" · "),
        model: m,
      });
    }
  }
  return out;
}

function pythonSuggestions(scan: Scan): Suggestion[] {
  const out: Suggestion[] = [];
  const roots = pathsWith(scan, "pyproject.toml").map(dirOf);
  const pyFiles = [...scan.texts.keys()].filter((p) => p.endsWith(".py"));
  if (!roots.length && !pyFiles.length) return out;
  const clis = fireClis(scan);
  const fireFiles = new Set(clis.map((c) => c.file));
  out.push(...fireSuggestions(scan, clis, roots));

  for (const file of pyFiles) {
    const root = pythonRootOf(file, roots);
    const text = scan.texts.get(file)!;
    for (const match of text.matchAll(FASTAPI)) {
      const { module, cwd } = moduleOf(file, root);
      const app = `${module}:${match[1]}`;
      const m = pythonModel("fastapi", `FastAPI ${app}${suffix(root)}`, root, scan);
      m.app = app;
      m.cwd = wsPath(cwd);
      out.push({ group: "Python", label: `FastAPI app ${app}`, detail: file, model: m });
    }
  }

  const mains = pyFiles
    .filter((p) => !TEST_FILE.test(p) && !/(^|\/)(setup|conftest)\.py$/.test(p))
    // A Fire CLI without a command only prints its help: its commands are suggested instead.
    .filter((p) => !fireFiles.has(p))
    .filter((p) => MAIN_GUARD.test(scan.texts.get(p)!) || baseOf(p) === "__main__.py")
    .sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))
    .slice(0, 40);
  for (const file of mains) {
    const root = pythonRootOf(file, roots);
    if (baseOf(file) === "__main__.py") {
      const { module, cwd } = moduleOf(file, root);
      if (!module) continue;
      const m = pythonModel("python-module", `python -m ${module}${suffix(root)}`, root, scan);
      m.module = module;
      m.cwd = wsPath(cwd);
      out.push({ group: "Python", label: `python -m ${module}`, detail: file, model: m });
    } else {
      const m = pythonModel("python-file", `Run ${baseOf(file)}${suffix(dirOf(file))}`, root, scan);
      m.program = wsPath(file);
      out.push({
        group: "Python",
        label: `Script ${file}`,
        detail: 'has an if __name__ == "__main__" block',
        model: m,
      });
    }
  }

  for (const root of roots) {
    const python = venvPython(scan, root);
    if (!python) continue;
    for (const script of consoleScripts(scan.texts.get(join(root, "pyproject.toml")) ?? "")) {
      const m = pythonModel("python-file", `${script}${suffix(root)}`, root, scan);
      m.program = python.replace(/python(\.exe)?$/, script);
      out.push({
        group: "Python",
        label: `Command ${script}`,
        detail: "console script from pyproject.toml",
        model: m,
      });
    }
  }

  for (const root of roots.length ? roots : [""]) {
    const pyproject = scan.texts.get(join(root, "pyproject.toml")) ?? "";
    const hasTests =
      /pytest/.test(pyproject) ||
      scan.exists.has(join(root, "tests")) ||
      pyFiles.some((p) => pythonRootOf(p, roots) === root && TEST_FILE.test(p));
    if (!hasTests) continue;
    const all = pythonModel("pytest", `Tests${suffix(root)}`, root, scan);
    all.justMyCode = false;
    out.push({ group: "Tests", label: `All tests${suffix(root)}`, detail: "pytest", model: all });
    const current = pythonModel("pytest", `Tests: current file${suffix(root)}`, root, scan);
    current.args = "${file}";
    current.justMyCode = false;
    out.push({
      group: "Tests",
      label: `Tests in the open file${suffix(root)}`,
      detail: "pytest ${file}",
      model: current,
    });
  }

  const current = pythonModel("python-file", "Python: current file", "", scan);
  current.program = "${file}";
  out.push({
    group: "Python",
    label: "The Python file open in the editor",
    detail: "${file}",
    model: current,
  });
  return out;
}

export function packageManagerOf(scan: Scan, dir: string): PackageManager {
  for (let d: string | null = dir; d !== null; d = d ? dirOf(d) : null) {
    if (scan.exists.has(join(d, "pnpm-lock.yaml"))) return "pnpm";
    if (scan.exists.has(join(d, "yarn.lock"))) return "yarn";
    if (scan.exists.has(join(d, "bun.lockb")) || scan.exists.has(join(d, "bun.lock"))) return "bun";
    if (scan.exists.has(join(d, "package-lock.json"))) return "npm";
  }
  return "npm";
}

const SCRIPT_ORDER = ["dev", "start", "serve", "preview", "test"];
const DEV_PORTS: [string, number][] = [
  ["vite", 5173],
  ["next", 3000],
  ["nuxt", 3000],
  ["react-scripts", 3000],
  ["@angular/core", 4200],
  ["@vue/cli-service", 8080],
];

/** The `server: { port }` of a Vite config, ignoring commented-out lines. */
export function vitePort(config: string): number | undefined {
  const code = config.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const server = /\bserver\s*:\s*\{/.exec(code);
  const found = server && /\bport\s*:\s*(\d{2,5})/.exec(code.slice(server.index));
  return found ? Number(found[1]) : undefined;
}

export function devServerUrl(
  scan: Scan,
  dir: string,
  deps: Record<string, unknown>,
): string | undefined {
  const framework = DEV_PORTS.find(([dep]) => dep in deps);
  if (!framework) return undefined;
  let port = framework[1];
  for (const ext of ["ts", "js", "mjs", "mts", "cjs"]) {
    const text = scan.texts.get(join(dir, `vite.config.${ext}`));
    port = (text && vitePort(text)) || port;
  }
  return `http://localhost:${port}`;
}

function webSuggestions(scan: Scan): Suggestion[] {
  const out: Suggestion[] = [];
  for (const file of pathsWith(scan, "package.json")) {
    const dir = dirOf(file);
    let pkg: { scripts?: Record<string, string>; dependencies?: object; devDependencies?: object };
    try {
      pkg = JSON.parse(scan.texts.get(file) ?? "{}");
    } catch {
      continue;
    }
    const pm = packageManagerOf(scan, dir);
    const rank = (s: string) => (SCRIPT_ORDER.includes(s) ? SCRIPT_ORDER.indexOf(s) : 99);
    const scripts = Object.keys(pkg.scripts ?? {}).sort((a, b) => rank(a) - rank(b));
    for (const script of scripts) {
      const m = emptyModel("npm-script");
      m.packageManager = pm;
      m.script = script;
      m.cwd = wsPath(dir);
      m.name = `${pm} ${script}${suffix(dir)}`;
      out.push({
        group: "Web",
        label: `${pm} run ${script}${suffix(dir)}`,
        detail: pkg.scripts![script],
        model: m,
      });
    }
    const url = devServerUrl(scan, dir, { ...pkg.dependencies, ...pkg.devDependencies });
    if (url) {
      const m = emptyModel("browser");
      m.url = url;
      m.webRoot = wsPath(dir);
      m.name = `Browser ${url.replace("http://", "")}${suffix(dir)}`;
      out.push({
        group: "Web",
        label: `Debug the page ${url}${suffix(dir)}`,
        detail: "Chrome, breakpoints in your source",
        model: m,
      });
    }
  }
  return out;
}

export function suggest(scan: Scan): Suggestion[] {
  const python = pythonSuggestions(scan);
  const web = webSuggestions(scan);
  const together: Suggestion[] = [];
  const api = python.find((s) => s.model.kind === "fastapi");
  const dev = web.find(
    (s) => s.model.kind === "npm-script" && ["dev", "start", "serve"].includes(s.model.script),
  );
  if (api && dev) {
    const m = emptyModel("compound");
    m.name = "Backend + frontend";
    m.members = [api.model.name, dev.model.name];
    together.push({
      group: "Together",
      label: "Backend + frontend",
      detail: `${api.model.name} and ${dev.model.name}, stopped together`,
      model: m,
      alsoCreate: [api.model, dev.model],
    });
  }
  return [...together, ...python, ...web];
}

export function hintsOf(scan: Scan, suggestions: Suggestion[]): Hints {
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];
  const models = suggestions.map((s) => s.model);
  return {
    programs: uniq([
      ...[...scan.texts.keys()].filter((p) => p.endsWith(".py")).map(wsPath),
      "${file}",
    ]).slice(0, 200),
    modules: uniq(models.filter((m) => m.kind === "python-module").map((m) => m.module)),
    apps: uniq(models.filter((m) => m.kind === "fastapi").map((m) => m.app)),
    scripts: uniq(models.filter((m) => m.kind === "npm-script").map((m) => m.script)),
    urls: uniq(models.filter((m) => m.kind === "browser").map((m) => m.url)),
    pythons: uniq(models.map((m) => m.python)),
    fire: fireClis(scan),
    envNames: envNamesOf(
      [...scan.texts].filter(([p]) => p.endsWith(".py")).map(([, t]) => t),
    ).slice(0, 300),
  };
}
