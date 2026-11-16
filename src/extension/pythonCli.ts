// Reads Python source (without running it) to find a Python Fire command line: the object
// given to `Fire(...)`, its public methods or functions, their parameters and docstrings.
// Also lists the environment variables a project reads. Pure text analysis, best effort.
import type { FireCli, FireCommand, FireParam } from "../shared/fire";
import type { EnvName } from "../shared/messages";

const indentOf = (line: string) => /^[ \t]*/.exec(line)![0].length;
const FIRE_IMPORT = /^\s*(?:import\s+fire\b|from\s+fire\s+import\b)/m;
const FIRE_CALL = /\b(?:fire\.)?Fire\(\s*([A-Za-z_]\w*|\{[\s\S]*?\})?\s*[,)]/g;

/** Text between the parenthesis at `open` and its match (strings and nesting respected). */
function balanced(text: string, open: number): { inner: string; end: number } | undefined {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "#") while (i < text.length && text[i] !== "\n") i++;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c) && --depth === 0) return { inner: text.slice(open + 1, i), end: i };
  }
  return undefined;
}

/** Splits on commas outside brackets and strings. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") current += text[i++];
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "#") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    } else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseParams(signature: string): FireParam[] {
  const out: FireParam[] = [];
  for (const raw of splitTopLevel(signature)) {
    if (raw === "*" || raw === "/" || raw.startsWith("*")) continue;
    const m = /^(\w+)\s*(?::\s*([^=]+?))?\s*(?:=\s*([\s\S]+))?$/.exec(raw);
    if (!m || m[1] === "self" || m[1] === "cls") continue;
    out.push({ name: m[1], type: m[2]?.trim() || undefined, default: m[3]?.trim() || undefined });
  }
  return out;
}

/** First paragraph of a docstring, and the Google/NumPy-style `Args:` descriptions. */
export function parseDocstring(doc: string): { summary: string; args: Record<string, string> } {
  const lines = doc.replace(/\r/g, "").split("\n");
  const summary: string[] = [];
  for (const l of lines) {
    if (!l.trim()) {
      if (summary.length) break;
      continue;
    }
    if (/^\s*(Args|Arguments|Parameters|Returns|Raises)\s*:?\s*$/.test(l)) break;
    summary.push(l.trim());
  }
  const args: Record<string, string> = {};
  const start = lines.findIndex((l) => /^\s*(Args|Arguments|Parameters)\s*:?\s*$/.test(l));
  if (start >= 0) {
    const base = indentOf(lines[start]);
    const UNDERLINE = /^\s*-{3,}\s*$/;
    const body = lines.slice(start + 1).filter((l) => l.trim());
    let current: string | undefined;
    const add = (text: string) => {
      if (current) args[current] = `${args[current]} ${text.trim()}`.trim();
    };
    if (body.length && UNDERLINE.test(body[0])) {
      // NumPy: `name : type` at the header's indentation, the description indented below;
      // the next underlined header ends the section.
      const rest = body.slice(1);
      for (let i = 0; i < rest.length; i++) {
        const l = rest[i];
        if (UNDERLINE.test(rest[i + 1] ?? "")) break;
        const item = indentOf(l) <= base && /^\s*\*{0,2}(\w+)\s*(?::.*)?$/.exec(l);
        if (item) args[(current = item[1])] = "";
        else add(l);
      }
    } else {
      // Google: an indented block of `name (type): description` items.
      let itemIndent = -1;
      for (const l of body) {
        const ind = indentOf(l);
        if (ind <= base) break;
        const item = /^\s*\*{0,2}(\w+)\s*(?:\([^)]*\))?\s*:\s*(.*)$/.exec(l);
        if (item && (itemIndent < 0 || ind <= itemIndent)) {
          itemIndent = ind;
          current = item[1];
          args[current] = item[2].trim();
        } else add(l);
      }
    }
  }
  return { summary: summary.join(" "), args };
}

interface Def {
  name: string;
  indent: number;
  params: FireParam[];
  doc: string;
  decorators: string[];
}

/** Every `def` of a text (any depth), with its signature and docstring. */
function defsOf(text: string): Def[] {
  const defs: Def[] = [];
  const re = /^([ \t]*)(?:async\s+)?def\s+(\w+)\s*\(/gm;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const sig = balanced(text, m.index + m[0].length - 1);
    if (!sig) continue;
    const after = text.slice(sig.end + 1);
    const docMatch = /^[^\n]*:[ \t]*(?:#[^\n]*)?\n\s*[rRuU]?("""|''')([\s\S]*?)\1/.exec(after);
    const before = text.slice(0, m.index).split("\n").slice(0, -1);
    const decorators: string[] = [];
    for (let i = before.length - 1; i >= 0 && /^\s*@/.test(before[i]); i--)
      decorators.push(before[i].trim());
    defs.push({
      name: m[2],
      indent: m[1].length,
      params: parseParams(sig.inner),
      doc: docMatch ? docMatch[2] : "",
      decorators,
    });
  }
  return defs;
}

function toCommand(def: Def, name: string): FireCommand {
  const { summary, args } = parseDocstring(def.doc);
  return {
    name,
    doc: summary || undefined,
    params: def.params.map((p) => ({ ...p, doc: args[p.name] })),
  };
}

const isPublic = (name: string) => !name.startsWith("_");

/** Public methods of a top-level class (properties and private methods excluded). */
function classCommands(text: string, className: string): FireCommand[] | undefined {
  const head = new RegExp(`^class\\s+${className}\\b[^\\n]*:`, "m").exec(text);
  if (!head) return undefined;
  const lines = text.slice(head.index + head[0].length).split("\n");
  const body: string[] = [];
  for (const line of lines.slice(1)) {
    if (line.trim() && indentOf(line) === 0) break;
    body.push(line);
  }
  const defs = defsOf(body.join("\n"));
  const methodIndent = Math.min(...defs.map((d) => d.indent));
  return defs
    .filter((d) => d.indent === methodIndent && isPublic(d.name))
    .filter((d) => !d.decorators.some((x) => /^@(property|\w+\.setter)\b/.test(x)))
    .map((d) => toCommand(d, d.name));
}

/** The Fire command line defined in a file, if it calls `Fire(...)`. */
export function fireCliOf(file: string, text: string): FireCli | undefined {
  if (!FIRE_IMPORT.test(text)) return undefined;
  const topDefs = defsOf(text).filter((d) => d.indent === 0);
  const fn = (name: string) => topDefs.find((d) => d.name === name);
  for (const call of text.matchAll(FIRE_CALL)) {
    const target = call[1];
    let commands: FireCommand[] | undefined;
    if (!target)
      commands = topDefs.filter((d) => isPublic(d.name)).map((d) => toCommand(d, d.name));
    else if (target.startsWith("{")) {
      commands = [];
      for (const entry of target.slice(1, -1).matchAll(/["'](\w[\w-]*)["']\s*:\s*(\w+)/g)) {
        const def = fn(entry[2]);
        commands.push(def ? toCommand(def, entry[1]) : { name: entry[1], params: [] });
      }
    } else if (fn(target)) commands = [toCommand(fn(target)!, "")];
    else commands = classCommands(text, target);
    if (commands?.length) return { file, commands };
  }
  return undefined;
}

const ENV_READ =
  /\bos\.(?:environ\.get|getenv)\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*(?:,\s*([^)\n]{0,60}))?\)|\bos\.environ\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]/g;

/** Environment variables read with `os.getenv` / `os.environ`, with their literal default. */
export function envNamesOf(texts: Iterable<string>): EnvName[] {
  const found = new Map<string, EnvName>();
  for (const text of texts)
    for (const m of text.matchAll(ENV_READ)) {
      const name = m[1] ?? m[3];
      const literal = m[2] && /^\s*(["'])(.*)\1\s*$/.exec(m[2]);
      const prev = found.get(name);
      if (!prev || (!prev.default && literal))
        found.set(name, { name, default: literal ? literal[2] : prev?.default });
    }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}
