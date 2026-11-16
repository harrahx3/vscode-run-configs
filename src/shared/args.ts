// Shell-style argument strings <-> argument arrays, so the form shows one editable line.

/** Splits a command line like a POSIX shell would (quotes group, backslash escapes). */
export function splitArgs(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inToken = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote === "'") {
      if (c === "'") quote = null;
      else current += c;
    } else if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === "\\" && i + 1 < line.length && /["\\$`]/.test(line[i + 1]))
        current += line[++i];
      else current += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      inToken = true;
    } else if (c === "\\" && i + 1 < line.length) {
      current += line[++i];
      inToken = true;
    } else if (/\s/.test(c)) {
      if (inToken) out.push(current);
      current = "";
      inToken = false;
    } else {
      current += c;
      inToken = true;
    }
  }
  if (inToken) out.push(current);
  return out;
}

/** Quotes one argument only when it needs it, so `splitArgs(joinArgs(a))` gives back `a`. */
export function quoteArg(arg: string): string {
  if (arg === "") return '""';
  if (!/[\s"'\\$`]/.test(arg)) return arg;
  if (!arg.includes("'")) return `'${arg}'`;
  return `"${arg.replace(/(["\\$`])/g, "\\$1")}"`;
}

export function joinArgs(args: readonly string[]): string {
  return args.map(quoteArg).join(" ");
}

/** launch.json allows `args` as an array or (debugpy) as a single string. */
export function argsToString(args: unknown): string {
  if (typeof args === "string") return args;
  if (Array.isArray(args)) return joinArgs(args.map(String));
  return "";
}
