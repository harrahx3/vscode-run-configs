// User templates in the settings, and the "Manage Templates…" command.
import * as vscode from "vscode";
import { KINDS, toLaunch, type ConfigKind, type FormModel } from "../shared/model";
import {
  ALWAYS_SHOWN,
  configurationError,
  DEFAULT_TEMPLATE_ICON,
  labelError,
  parseHiddenKinds,
  parseTemplates,
  type Template,
  type TileContext,
} from "../shared/templates";

const section = () => vscode.workspace.getConfiguration("runConfigs");

/** Templates of the user settings (editable here) and of the workspace settings (shared). */
export function readTemplates(): { user: Template[]; workspace: Template[] } {
  const inspected = section().inspect<unknown>("templates");
  return {
    user: parseTemplates(inspected?.globalValue).map((t) => ({ ...t, scope: "user" as const })),
    workspace: parseTemplates(inspected?.workspaceValue).map((t) => ({
      ...t,
      scope: "workspace" as const,
    })),
  };
}

/** What the form shows: the user's templates, then the workspace's. */
export function allTemplates(): Template[] {
  const { user, workspace } = readTemplates();
  return [...user, ...workspace];
}

export function hiddenKinds() {
  return parseHiddenKinds(section().get("hiddenKinds"));
}

/** Stores the user templates, without the `scope` added when reading them. */
const writeUser = (templates: Template[]) =>
  section().update(
    "templates",
    templates.map(({ scope: _scope, ...t }) => t),
    vscode.ConfigurationTarget.Global,
  );

/** Asks for the label, hint and icon of a template, then stores it. Returns false if cancelled. */
async function promptTemplate(
  configuration: Template["configuration"],
  existing?: Pick<Template, "label" | "hint" | "icon">,
  editing?: Template,
): Promise<Template | undefined> {
  const others = readTemplates().user.filter((t) => t.label !== editing?.label);
  const label = await vscode.window.showInputBox({
    title: editing ? "Edit template" : "New template",
    prompt: "Name shown on the tile",
    value: existing?.label,
    validateInput: (v) =>
      labelError(
        v,
        others.map((t) => t.label),
      ),
  });
  if (label === undefined) return undefined;
  const hint = await vscode.window.showInputBox({
    title: "Template hint",
    prompt: "Short description under the name (optional)",
    value: existing?.hint,
  });
  if (hint === undefined) return undefined;
  const icon = await vscode.window.showInputBox({
    title: "Template icon",
    prompt: "A codicon name, like rocket, flame or database (see the VS Code icon reference)",
    value: existing?.icon ?? DEFAULT_TEMPLATE_ICON,
    validateInput: (v) =>
      /^[a-z0-9-]+$/.test(v.trim()) ? undefined : "Letters, digits and dashes.",
  });
  if (icon === undefined) return undefined;
  const json = await vscode.window.showInputBox({
    title: "Template configuration",
    prompt: "The launch.json entry, as JSON (no name: it is chosen in the form)",
    value: JSON.stringify(configuration),
    validateInput: configurationError,
  });
  if (json === undefined) return undefined;
  return {
    label: label.trim(),
    hint: hint.trim(),
    icon: icon.trim() || DEFAULT_TEMPLATE_ICON,
    configuration: JSON.parse(json),
  };
}

/** "Save as Template…" of the form: the current configuration becomes a tile. */
export async function saveAsTemplate(model: FormModel): Promise<boolean> {
  const built = toLaunch(model);
  if (built.section === "compounds")
    throw new Error("A group of configurations cannot be a template.");
  const { name, ...configuration } = built.entry;
  const user = readTemplates().user;
  const made = await promptTemplate(configuration, {
    label: String(name ?? ""),
    hint: "",
    icon: DEFAULT_TEMPLATE_ICON,
  });
  if (!made) return false;
  await writeUser([...user, made]);
  return true;
}

async function pickUserTemplate(title: string): Promise<Template | undefined> {
  const user = readTemplates().user;
  if (!user.length) {
    void vscode.window.showInformationMessage(
      "No template yet. Use “Save as Template…” in the configuration form, or add one here.",
    );
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    user.map((t) => ({ label: `$(${t.icon}) ${t.label}`, description: t.hint, template: t })),
    { title, placeHolder: "Which template?" },
  );
  return picked?.template;
}

/** A new template, from a blank configuration (only the debugger type to fill). */
export async function addTemplate(): Promise<void> {
  const made = await promptTemplate({ type: "", request: "launch" });
  if (made) await writeUser([...readTemplates().user, made]);
}

export async function editTemplate(t: Template): Promise<void> {
  const made = await promptTemplate(t.configuration, t, t);
  if (made) await writeUser(readTemplates().user.map((u) => (u.label === t.label ? made : u)));
}

export async function deleteTemplate(t: Template): Promise<void> {
  const ok = await vscode.window.showWarningMessage(
    `Delete the template "${t.label}"?`,
    { modal: true, detail: "It is removed from your user settings." },
    "Delete",
  );
  if (ok === "Delete") await writeUser(readTemplates().user.filter((u) => u.label !== t.label));
}

/** Hides one built-in tile (the JSON editor cannot be hidden). */
export async function hideKind(kind: ConfigKind): Promise<void> {
  if (kind === ALWAYS_SHOWN || !KINDS.some((k) => k.kind === kind)) return;
  const hidden = hiddenKinds();
  if (hidden.includes(kind)) return;
  await section().update("hiddenKinds", [...hidden, kind], vscode.ConfigurationTarget.Global);
}

export async function hideShowBuiltIns(): Promise<void> {
  const hidden = hiddenKinds();
  const picked = await vscode.window.showQuickPick<vscode.QuickPickItem & { builtin: ConfigKind }>(
    KINDS.filter((k) => k.kind !== ALWAYS_SHOWN).map((k) => ({
      label: `$(${k.icon}) ${k.label}`,
      description: k.hint,
      builtin: k.kind,
      picked: !hidden.includes(k.kind),
    })),
    {
      title: "Built-in tiles",
      placeHolder: "Checked tiles are shown in the form",
      canPickMany: true,
    },
  );
  if (!picked) return;
  const shown = new Set(picked.map((p) => p.builtin));
  const next = KINDS.map((k) => k.kind).filter((k) => k !== ALWAYS_SHOWN && !shown.has(k));
  await section().update("hiddenKinds", next, vscode.ConfigurationTarget.Global);
}

type Action = "add" | "edit" | "delete" | "builtin";

export async function manageTemplates(): Promise<void> {
  const action = await vscode.window.showQuickPick<vscode.QuickPickItem & { action: Action }>(
    [
      { label: "$(add) Add a template…", action: "add" },
      { label: "$(edit) Edit a template…", action: "edit" },
      { label: "$(trash) Delete a template…", action: "delete" },
      { label: "$(eye) Show or hide built-in tiles…", action: "builtin" },
    ],
    { title: "Run Configurations: templates", placeHolder: "What do you want to do?" },
  );
  if (!action) return;
  switch (action.action) {
    case "add":
      return addTemplate();
    case "edit": {
      const t = await pickUserTemplate("Edit a template");
      if (t) await editTemplate(t);
      return;
    }
    case "delete": {
      const t = await pickUserTemplate("Delete a template");
      if (t) await deleteTemplate(t);
      return;
    }
    case "builtin":
      return hideShowBuiltIns();
  }
}

/** The user template a right-click on a tile names, if it still exists. */
function userTemplateOf(ctx?: TileContext): Template | undefined {
  if (ctx?.templateScope !== "user" || !ctx.templateLabel) return undefined;
  return readTemplates().user.find((t) => t.label === ctx.templateLabel);
}

/** The commands of the right-click menu on the form's tiles (`webview/context`). */
export const tileCommands: Record<string, (ctx?: TileContext) => Promise<void>> = {
  "runConfigs.tiles.newTemplate": () => addTemplate(),
  "runConfigs.tiles.editTemplate": async (ctx) => {
    const t = userTemplateOf(ctx);
    if (t) await editTemplate(t);
  },
  "runConfigs.tiles.deleteTemplate": async (ctx) => {
    const t = userTemplateOf(ctx);
    if (t) await deleteTemplate(t);
  },
  "runConfigs.tiles.hide": async (ctx) => {
    if (ctx?.kind) await hideKind(ctx.kind);
  },
  "runConfigs.tiles.showHide": () => hideShowBuiltIns(),
};
