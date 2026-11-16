// Pure edits of a launch.json text with jsonc-parser: comments, trailing commas and the
// formatting of untouched entries survive every change.
import {
  applyEdits,
  findNodeAtLocation,
  modify,
  parse,
  parseTree,
  type FormattingOptions,
  type ParseError,
} from "jsonc-parser";
import type { LaunchEntry, Section } from "../shared/model";

export const EMPTY_LAUNCH = '{\n  "version": "0.2.0",\n  "configurations": []\n}\n';

export interface ParsedLaunch {
  configurations: LaunchEntry[];
  compounds: LaunchEntry[];
  /** Set when the file cannot be read as JSON with comments. */
  error?: string;
}

const isEntry = (v: unknown): v is LaunchEntry => !!v && typeof v === "object" && !Array.isArray(v);

export function parseLaunch(text: string): ParsedLaunch {
  if (!text.trim()) return { configurations: [], compounds: [] };
  const errors: ParseError[] = [];
  const root = parse(text, errors, { allowTrailingComma: true }) as Record<string, unknown>;
  const list = (k: string) =>
    Array.isArray(root?.[k]) ? (root[k] as unknown[]).filter(isEntry) : [];
  return {
    configurations: list("configurations"),
    compounds: list("compounds"),
    error: errors.length && !isEntry(root) ? "launch.json is not valid JSON." : undefined,
  };
}

/** Indentation of the existing file, so inserted entries look like their neighbours. */
export function formattingOf(text: string): FormattingOptions {
  const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? "  ";
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return indent.startsWith("\t")
    ? { insertSpaces: false, tabSize: 4, eol }
    : { insertSpaces: true, tabSize: Math.min(indent.length, 8), eol };
}

function indexOfName(text: string, section: Section, name: string): number {
  return parseLaunch(text)[section].findIndex((e) => e.name === name);
}

function edit(text: string, path: (string | number)[], value: unknown, insert = false): string {
  const base = text.trim() ? text : EMPTY_LAUNCH;
  const edits = modify(base, path, value, {
    formattingOptions: formattingOf(base),
    isArrayInsertion: insert,
  });
  return applyEdits(base, edits);
}

/**
 * Inserts or replaces one entry. `oldName`/`oldSection` locate the entry being edited (it may
 * move between `configurations` and `compounds` when its kind changes); a new entry is appended.
 */
export function upsertEntry(
  text: string,
  section: Section,
  entry: LaunchEntry,
  oldName?: string,
  oldSection: Section = section,
): string {
  let out = text.trim() ? text : EMPTY_LAUNCH;
  if (oldName !== undefined && oldSection !== section) {
    out = removeEntry(out, oldSection, oldName);
    oldName = undefined;
  }
  const index = oldName === undefined ? -1 : indexOfName(out, section, oldName);
  if (index >= 0) return edit(out, [section, index], entry);
  const tree = parseTree(out);
  const array = tree && findNodeAtLocation(tree, [section]);
  if (!array || array.type !== "array") return edit(out, [section], [entry]);
  return edit(out, [section, array.children?.length ?? 0], entry, true);
}

export function removeEntry(text: string, section: Section, name: string): string {
  const index = indexOfName(text, section, name);
  return index < 0 ? text : edit(text, [section, index], undefined);
}

/** Keeps compounds pointing at a configuration after it is renamed (or drops it on delete). */
export function renameInCompounds(text: string, oldName: string, newName?: string): string {
  let out = text;
  parseLaunch(text).compounds.forEach((compound, i) => {
    const members = compound.configurations;
    if (!Array.isArray(members) || !members.includes(oldName)) return;
    const next = newName
      ? members.map((m) => (m === oldName ? newName : m))
      : members.filter((m) => m !== oldName);
    out = edit(out, ["compounds", i, "configurations"], next);
  });
  return out;
}

/** Character offset of an entry, to reveal it in the editor. */
export function offsetOf(text: string, section: Section, name: string): number | undefined {
  const index = indexOfName(text, section, name);
  const tree = parseTree(text);
  if (index < 0 || !tree) return undefined;
  return findNodeAtLocation(tree, [section, index])?.offset;
}

/** A name not used yet: "Name (copy)", "Name (copy 2)", … */
export function uniqueName(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? `${base} (copy)` : `${base} (copy ${i})`;
    if (!taken.includes(candidate)) return candidate;
  }
}
