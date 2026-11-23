// User templates: extra tiles under "What do you want to run?", stored in the user settings.
// Pure code: shared by the extension host (settings) and the form (tiles).
import { KINDS, type ConfigKind, type LaunchEntry } from "./model";

/** A tile of the form: a launch.json entry to start from, with a label, a hint and an icon. */
export interface Template {
  label: string;
  hint: string;
  /** A codicon name, without the `$(...)`. */
  icon: string;
  /** The launch.json entry the form opens with (its `name` is chosen in the form). */
  configuration: LaunchEntry;
  /** Where it is stored: user templates can be edited from the form, workspace ones cannot. */
  scope?: "user" | "workspace";
}

/** What a right-click on the form's tiles passes to the tile commands (`data-vscode-context`). */
export interface TileContext {
  /** On every tile and on the grid around them. */
  tiles?: boolean;
  webviewSection?: "builtinTile" | "templateTile";
  /** Built-in tile: its kind; `hideable` is false for the JSON editor. */
  kind?: ConfigKind;
  hideable?: boolean;
  /** Template tile: its label and where it is stored. */
  templateLabel?: string;
  templateScope?: "user" | "workspace";
}

/** The right-click context of a built-in tile. */
export function builtinTileContext(kind: ConfigKind): TileContext {
  return { webviewSection: "builtinTile", kind, hideable: kind !== ALWAYS_SHOWN };
}

/** The right-click context of a template tile. */
export function templateTileContext(t: Template): TileContext {
  return {
    webviewSection: "templateTile",
    templateLabel: t.label,
    templateScope: t.scope ?? "user",
  };
}

export const DEFAULT_TEMPLATE_ICON = "rocket";

/** The tile that holds the JSON editor: it cannot be hidden, templates are made from it. */
export const ALWAYS_SHOWN: ConfigKind = "custom";

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** Valid templates of a raw setting value; malformed items are skipped, not fatal. */
export function parseTemplates(raw: unknown): Template[] {
  if (!Array.isArray(raw)) return [];
  const out: Template[] = [];
  for (const item of raw) {
    if (!isObject(item) || !isObject(item.configuration)) continue;
    const label = typeof item.label === "string" ? item.label.trim() : "";
    if (!label) continue;
    out.push({
      label,
      hint: typeof item.hint === "string" ? item.hint : "",
      icon:
        typeof item.icon === "string" && /^[a-z0-9-]+$/.test(item.icon.trim())
          ? item.icon.trim()
          : DEFAULT_TEMPLATE_ICON,
      configuration: item.configuration as LaunchEntry,
    });
  }
  return out;
}

/** Built-in kinds that can be hidden: the known ones, minus the JSON editor. */
export function parseHiddenKinds(raw: unknown): ConfigKind[] {
  if (!Array.isArray(raw)) return [];
  return KINDS.map((k) => k.kind).filter((k) => k !== ALWAYS_SHOWN && raw.includes(k));
}

/** The configuration of a template without a name: the form asks for the name. */
export function templateEntry(t: Template): LaunchEntry {
  const { name: _name, ...rest } = structuredClone(t.configuration);
  return rest;
}

/** Validates a configuration typed as JSON; returns an error message, or undefined if fine. */
export function configurationError(json: string): string | undefined {
  try {
    const v = JSON.parse(json) as unknown;
    if (!isObject(v)) return 'Must be a JSON object, like { "type": "go", "request": "launch" }.';
    if (typeof v.type !== "string" || !v.type) return 'Needs a "type" (the debugger type).';
    return undefined;
  } catch (e) {
    return `Not valid JSON: ${(e as Error).message}`;
  }
}

export function labelError(label: string, others: readonly string[]): string | undefined {
  const l = label.trim();
  if (!l) return "Give the template a name.";
  if (others.some((o) => o.toLowerCase() === l.toLowerCase()))
    return "Another template already has this name.";
  return undefined;
}
