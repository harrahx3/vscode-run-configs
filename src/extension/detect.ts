// Scans a workspace folder (bounded: excluded build/venv folders, capped file count and size)
// and hands the result to the pure detectCore.
import * as vscode from "vscode";
import { hintsOf, suggest, type Hints, type Scan, type Suggestion } from "./detectCore";

const EXCLUDE =
  "**/{node_modules,.venv,venv,.git,dist,build,out,__pycache__,.tox,.mypy_cache,.pytest_cache,.ruff_cache,site-packages,.vscode-test,archive}/**";
const MAX_PY_FILES = 3000;
const MAX_BYTES = 256 * 1024;
const CACHE_MS = 20_000;

export interface Detection {
  suggestions: Suggestion[];
  hints: Hints;
}

const cache = new Map<string, { at: number; result: Promise<Detection> }>();

async function readText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > MAX_BYTES) return undefined;
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function scanFolder(folder: vscode.WorkspaceFolder): Promise<Scan> {
  const rel = (uri: vscode.Uri) => vscode.workspace.asRelativePath(uri, false).replace(/\\/g, "/");
  const relIn = (uri: vscode.Uri) => {
    const r = rel(uri);
    // In a multi-root workspace asRelativePath prefixes the folder name.
    const prefix = `${folder.name}/`;
    return (vscode.workspace.workspaceFolders?.length ?? 0) > 1 && r.startsWith(prefix)
      ? r.slice(prefix.length)
      : r;
  };
  const pattern = (glob: string) => new vscode.RelativePattern(folder, glob);
  const [pyFiles, projectFiles] = await Promise.all([
    vscode.workspace.findFiles(pattern("**/*.py"), EXCLUDE, MAX_PY_FILES),
    vscode.workspace.findFiles(
      pattern(
        "**/{pyproject.toml,package.json,pnpm-lock.yaml,yarn.lock,bun.lockb,bun.lock,package-lock.json,vite.config.*}",
      ),
      EXCLUDE,
      500,
    ),
  ]);
  const texts = new Map<string, string>();
  const known = new Set<string>();
  const wanted = (p: string) => /(pyproject\.toml|package\.json|vite\.config\.\w+|\.py)$/.test(p);
  const all = [...pyFiles, ...projectFiles];
  for (let i = 0; i < all.length; i += 64) {
    await Promise.all(
      all.slice(i, i + 64).map(async (uri) => {
        const p = relIn(uri);
        known.add(p);
        if (!wanted(p)) return;
        const text = await readText(uri);
        if (text !== undefined) texts.set(p, text);
      }),
    );
  }
  // Interpreters, test folders and env files of every Python project root (only checked
  // for existence; env files are never read).
  const roots = new Set([""]);
  for (const p of known)
    if (p.endsWith("pyproject.toml")) roots.add(p.split("/").slice(0, -1).join("/"));
  const probes = [
    ".venv/bin/python",
    "venv/bin/python",
    ".venv/Scripts/python.exe",
    "tests",
    ".env",
  ];
  await Promise.all(
    [...roots].flatMap((root) =>
      probes.map(async (probe) => {
        const p = root ? `${root}/${probe}` : probe;
        if (await exists(vscode.Uri.joinPath(folder.uri, p))) known.add(p);
      }),
    ),
  );
  return { texts, exists: known };
}

/** Suggestions and form hints for a folder; cached briefly so the form opens fast. */
export function detect(folder: vscode.WorkspaceFolder, fresh = false): Promise<Detection> {
  const key = folder.uri.toString();
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.result;
  const result = scanFolder(folder).then((scan) => {
    const suggestions = suggest(scan);
    return { suggestions, hints: hintsOf(scan, suggestions) };
  });
  cache.set(key, { at: Date.now(), result });
  result.catch(() => cache.delete(key));
  return result;
}
