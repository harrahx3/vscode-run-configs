// The Vite dev-server kind: the shell command of a `node-terminal` entry and its reverse.
// Pure code, shared by the form model (saving, reading back) and the webview (preview).
//
// The port can come from an environment variable. A terminal entry has no `envFile`, so when an
// env file is chosen the command itself reads the one variable out of it (bash / zsh syntax):
//
//   vite_port="$FRONTEND_PORT"; [ -n "$vite_port" ] || vite_port=$(sed -n 's/^FRONTEND_PORT=//p' "<file>" 2>/dev/null | tail -n 1 | tr -d '\r'); [ -n "$vite_port" ] || vite_port=5173; npx vite --port "$vite_port"
//
// The variable already set in the environment wins, then the file, then the fallback. Only that
// variable is read (not the whole file), so JSON lists and other values that bash would choke
// on in a dotenv file are harmless. No `${...}` is used: VS Code substitutes every `${...}` of a
// launch.json string before the shell sees it (only `${workspaceFolder}` and co. are meant).
import { joinArgs, splitArgs } from "./args";
import type { FormModel, PackageManager } from "./model";

/** `npx vite …`, `pnpm exec vite …`, `yarn vite …`, `bunx vite …`. */
const VITE_COMMAND = /^(npx|pnpm exec|yarn|bunx)\s+vite(?:\s+(.*))?$/;
const ENV_PREFIX =
  /^vite_port="\$(\w+)"; (?:\[ -n "\$vite_port" \] \|\| vite_port=\$\(sed -n 's\/\^(\w+)=\/\/p' "([^"]*)" 2>\/dev\/null \| tail -n 1 \| tr -d '\\r'\); )?\[ -n "\$vite_port" \] \|\| vite_port=(\d+); (.*)$/;

export const VITE_RUNNER: Record<PackageManager, string> = {
  npm: "npx",
  pnpm: "pnpm exec",
  yarn: "yarn",
  bun: "bunx",
};

/** The env prefix of a command, when it is one this module wrote. */
function prefixOf(command: string): RegExpExecArray | null {
  const found = ENV_PREFIX.exec(command.trim());
  return found && (found[2] === undefined || found[1] === found[2]) ? found : null;
}

function withoutPrefix(command: string): string {
  const found = prefixOf(command);
  return found ? found[5] : command.trim();
}

export function isViteCommand(command: string): boolean {
  return VITE_COMMAND.test(withoutPrefix(command));
}

export function viteCommand(m: FormModel): string {
  const variable = m.portEnv.trim();
  const file = m.envFile.trim();
  const parts = [`${VITE_RUNNER[m.packageManager]} vite`];
  if (m.host.trim()) parts.push("--host", m.host.trim());
  if (variable) parts.push("--port", '"$vite_port"');
  else if (m.port.trim()) parts.push("--port", m.port.trim());
  if (m.strictPort) parts.push("--strictPort");
  if (m.args.trim()) parts.push(m.args.trim());
  const command = parts.join(" ");
  if (!variable) return command;
  const read = file
    ? `[ -n "$vite_port" ] || vite_port=$(sed -n 's/^${variable}=//p' "${file}" 2>/dev/null | tail -n 1 | tr -d '\\r'); `
    : "";
  const fallback = `[ -n "$vite_port" ] || vite_port=${m.port.trim() || "5173"}; `;
  return `vite_port="$${variable}"; ${read}${fallback}${command}`;
}

/** Reads a Vite command into the form fields; options it does not know stay in `args`. */
export function parseViteCommand(command: string, m: FormModel): void {
  const prefix = prefixOf(command);
  if (prefix) {
    m.portEnv = prefix[1];
    m.envFile = prefix[3] ?? "";
    m.port = prefix[4];
  }
  const [, runner, rest] = VITE_COMMAND.exec(withoutPrefix(command))!;
  m.packageManager = (Object.entries(VITE_RUNNER).find(([, r]) => r === runner)?.[0] ??
    "npm") as PackageManager;
  const args = splitArgs(rest ?? "");
  const other: string[] = [];
  const setPort = (value: string) => {
    if (value !== "$vite_port") m.port = value;
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--strictPort") m.strictPort = true;
    else if (a === "--host" && i + 1 < args.length) m.host = args[++i];
    else if (a === "--port" && i + 1 < args.length) setPort(args[++i]);
    else if (a.startsWith("--host=")) m.host = a.slice(7);
    else if (a.startsWith("--port=")) setPort(a.slice(7));
    else other.push(a);
  }
  m.args = joinArgs(other);
}
