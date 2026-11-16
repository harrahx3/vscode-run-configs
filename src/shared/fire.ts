// Python Fire command lines: the description of a CLI (found by the project scan) and the
// two-way mapping between an argument string and "command + option values".
import { joinArgs, splitArgs } from "./args";

export interface FireParam {
  name: string;
  /** Python default as written (`None`, `False`, `3`, `"x"`); undefined = required. */
  default?: string;
  /** Annotation as written (`int`, `bool`, `str | None`). */
  type?: string;
  doc?: string;
}

export interface FireCommand {
  /** Empty for `Fire(function)`: the options follow the file name directly. */
  name: string;
  doc?: string;
  params: FireParam[];
}

export interface FireCli {
  /** Workspace-relative path of the file calling `Fire(...)`. */
  file: string;
  commands: FireCommand[];
}

export type FireValues = Record<string, string | boolean>;

export interface FireArgs {
  command: string;
  values: FireValues;
  /** Tokens that are not a known option (kept verbatim). */
  rest: string[];
}

export function isBoolParam(p: FireParam): boolean {
  return /^(True|False)$/.test(p.default ?? "") || /^bool\b/.test(p.type ?? "");
}

const norm = (flag: string) => flag.replace(/-/g, "_");

/** Reads an argument string against a CLI: `coupled --days 3 --resume=x -v`. */
export function parseFireArgs(args: string, cli: FireCli): FireArgs {
  const tokens = splitArgs(args);
  const named = cli.commands.filter((c) => c.name);
  let command = named.length ? "" : (cli.commands[0]?.name ?? "");
  if (named.length && tokens.length && named.some((c) => c.name === norm(tokens[0])))
    command = norm(tokens.shift()!);
  const params = cli.commands.find((c) => c.name === command)?.params ?? [];
  const byName = new Map(params.map((p) => [p.name, p]));
  const values: FireValues = {};
  const rest: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const flag = /^--([\w-]+)(?:=(.*))?$/s.exec(token);
    if (!flag) {
      const next = params.find((p) => !(p.name in values) && !isBoolParam(p));
      if (next && !rest.length) values[next.name] = token;
      else rest.push(token);
      continue;
    }
    const name = norm(flag[1]);
    const param =
      byName.get(name) ?? (name.startsWith("no") ? byName.get(name.slice(2)) : undefined);
    if (!param) {
      rest.push(token);
      continue;
    }
    if (isBoolParam(param)) {
      if (param.name !== name) values[param.name] = false;
      else values[param.name] = flag[2] === undefined ? true : !/^(false|0|no)$/i.test(flag[2]);
    } else if (flag[2] !== undefined) values[param.name] = flag[2];
    else if (i + 1 < tokens.length && !tokens[i + 1].startsWith("--"))
      values[param.name] = tokens[++i];
    else rest.push(token);
  }
  return { command, values, rest };
}

/** The argument list for a command and its option values (only non-default values). */
export function buildFireArgs(parsed: FireArgs, cli: FireCli): string[] {
  const params = cli.commands.find((c) => c.name === parsed.command)?.params ?? [];
  const out = parsed.command ? [parsed.command] : [];
  for (const p of params) {
    const v = parsed.values[p.name];
    if (v === undefined || v === "") continue;
    if (isBoolParam(p)) {
      const byDefault = p.default === "True";
      if (v !== byDefault) out.push(v ? `--${p.name}` : `--no${p.name}`);
    } else {
      const s = String(v);
      out.push(...(s.startsWith("-") ? [`--${p.name}=${s}`] : [`--${p.name}`, s]));
    }
  }
  return [...out, ...parsed.rest];
}

export function fireArgsString(parsed: FireArgs, cli: FireCli): string {
  return joinArgs(buildFireArgs(parsed, cli));
}

/**
 * Workspace-relative path of a configuration's program (a relative program is resolved
 * against its cwd), or undefined when it cannot be known statically (`${file}`, absolute).
 */
export function programKey(program: string, cwd: string): string | undefined {
  const ws = /^\$\{workspaceFolder\}\/?/;
  const p = program.trim();
  if (!p || (p.includes("${") && !ws.test(p))) return undefined;
  if (ws.test(p)) return clean(p.replace(ws, ""));
  if (p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p)) return undefined;
  const base =
    cwd.trim() && ws.test(cwd.trim()) ? cwd.trim().replace(ws, "") : cwd.trim() ? undefined : "";
  if (base === undefined) return undefined;
  return clean(base ? `${base}/${p}` : p);
}

function clean(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}
