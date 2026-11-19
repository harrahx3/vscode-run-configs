// Environment variable names offered by the form, beyond the Python `os.getenv` calls:
// the ones a Vite config reads (`process.env.X`, `env.X` from `loadEnv`) and the ones an env
// *template* lists. A real env file (`.env`, `.env.local`…) is never read: only the committed
// template, whose job is to document the variables.
import type { EnvName } from "../shared/messages";

/** `.env.template`, `.env.example`, `.env.sample`, `.env_template`, `env.example`. */
export const ENV_TEMPLATE = /(^|\/)(\.env[._](template|example|sample)|env\.example)$/;

const JS_ENV_READ = /\b(?:process\.env|import\.meta\.env|env)\.([A-Z][A-Z0-9_]*)\b/g;
const TEMPLATE_LINE = /^\s*#?\s*([A-Z][A-Z0-9_]*)=(.*)$/;

/** Names read by a JavaScript / TypeScript config, e.g. `env.FRONTEND_PORT || 5173`. */
export function jsEnvNamesOf(texts: Iterable<string>): EnvName[] {
  const found = new Map<string, EnvName>();
  for (const text of texts)
    for (const m of text.matchAll(JS_ENV_READ)) {
      const rest = text.slice(m.index! + m[0].length, m.index! + m[0].length + 40);
      const literal = /^\s*(?:\|\||\?\?)\s*(?:Number\()?\s*(["']?)([\w.:/-]+)\1/.exec(rest);
      const prev = found.get(m[1]);
      if (!prev || (!prev.default && literal))
        found.set(m[1], { name: m[1], default: literal?.[2] });
    }
  return [...found.values()];
}

/** Names listed by env templates, with the value shown there as the default. */
export function templateEnvNamesOf(texts: Iterable<string>): EnvName[] {
  const found = new Map<string, EnvName>();
  for (const text of texts)
    for (const line of text.split(/\r?\n/)) {
      const m = TEMPLATE_LINE.exec(line);
      if (!m) continue;
      const value = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
      // A commented example with a path or a list is documentation, not a usable default.
      const plain = /^[\w.:/-]*$/.test(value) ? value : undefined;
      const prev = found.get(m[1]);
      if (!prev || (!prev.default && plain))
        found.set(m[1], { name: m[1], default: plain || prev?.default });
    }
  return [...found.values()];
}

/** Merges the lists by name; the first non-empty default wins, the result is sorted. */
export function mergeEnvNames(...lists: EnvName[][]): EnvName[] {
  const merged = new Map<string, EnvName>();
  for (const item of lists.flat()) {
    const prev = merged.get(item.name);
    merged.set(item.name, { name: item.name, default: prev?.default || item.default });
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}
