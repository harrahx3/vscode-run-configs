// Commands of the side panel, the command palette and the status bar.
import * as vscode from "vscode";
import { emptyModel, KINDS, summary, toLaunch, type FormModel } from "../shared/model";
import { detect } from "./detect";
import type { Suggestion } from "./detectCore";
import { EditorPanel } from "./editorPanel";
import { uniqueName } from "./launchText";
import type { Runner } from "./runner";
import {
  deleteEntry,
  findConfig,
  openLaunchJson,
  readFolder,
  revealEntry,
  saveEntry,
  type StoredConfig,
} from "./store";
import { manageTemplates } from "./templates";
import type { ConfigTree, Node } from "./tree";

type ConfigNode = Extract<Node, { type: "config" }>;
type AddItem = vscode.QuickPickItem & { suggestion?: Suggestion; blank?: FormModel["kind"] };

async function chooseFolder(node?: Node): Promise<vscode.WorkspaceFolder | undefined> {
  if (node?.type === "folder") return node.folder;
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length <= 1) return folders[0];
  return vscode.window.showWorkspaceFolderPick({ placeHolder: "Which folder?" });
}

/** The configuration a command acts on: the clicked tree item, or one picked from a list. */
async function configOf(node?: Node): Promise<StoredConfig | undefined> {
  if (node?.type === "config") return (await findConfig(node.config)) ?? node.config;
  const picked = await pickConfig("Which configuration?");
  return picked?.config;
}

async function allConfigs(): Promise<StoredConfig[]> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  return (await Promise.all(folders.map((f) => readFolder(f)))).flatMap((r) => r.items);
}

const DEBUG_BUTTON = { iconPath: new vscode.ThemeIcon("debug-alt"), tooltip: "Debug" };
const RUN_BUTTON = { iconPath: new vscode.ThemeIcon("play"), tooltip: "Run without debugging" };
const EDIT_BUTTON = { iconPath: new vscode.ThemeIcon("edit"), tooltip: "Edit" };

interface Picked {
  config: StoredConfig;
  action: "default" | "debug" | "run" | "edit";
}

async function pickConfig(placeHolder: string, withButtons = false): Promise<Picked | undefined> {
  const configs = await allConfigs();
  if (!configs.length) {
    const add = await vscode.window.showInformationMessage("No run configuration yet.", "Add one…");
    if (add) await vscode.commands.executeCommand("runConfigs.add");
    return undefined;
  }
  const multi = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
  const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { config: StoredConfig }>();
  qp.placeholder = placeHolder;
  qp.matchOnDescription = true;
  qp.items = configs.map((config) => ({
    label: `$(${KINDS.find((k) => k.kind === config.model.kind)?.icon ?? "gear"}) ${config.name}`,
    description: (multi ? `${config.folder.name} · ` : "") + summary(config.model),
    config,
    buttons: withButtons ? [DEBUG_BUTTON, RUN_BUTTON, EDIT_BUTTON] : [],
  }));
  return new Promise((resolve) => {
    let result: Picked | undefined;
    qp.onDidAccept(() => {
      const item = qp.selectedItems[0];
      if (item) result = { config: item.config, action: "default" };
      qp.hide();
    });
    qp.onDidTriggerItemButton((e) => {
      const action = e.button === DEBUG_BUTTON ? "debug" : e.button === RUN_BUTTON ? "run" : "edit";
      result = { config: e.item.config, action };
      qp.hide();
    });
    qp.onDidHide(() => {
      qp.dispose();
      resolve(result);
    });
    qp.show();
  });
}

function defaultNoDebug(): boolean {
  return vscode.workspace.getConfiguration("runConfigs").get("defaultAction") === "run";
}

export function registerCommands(
  context: vscode.ExtensionContext,
  runner: Runner,
  tree: ConfigTree,
): void {
  const edit = (request: Parameters<typeof EditorPanel.show>[2]) =>
    EditorPanel.show(context, runner, request);

  const add = async (node?: Node) => {
    const folder = await chooseFolder(node);
    if (!folder) return;
    const taken = (await readFolder(folder)).items.map((i) => i.name);
    const qp = vscode.window.createQuickPick<AddItem>();
    qp.title = `Add a run configuration${(vscode.workspace.workspaceFolders?.length ?? 0) > 1 ? ` to ${folder.name}` : ""}`;
    qp.placeholder = "Pick a detected configuration, or just press Enter for a blank form";
    qp.matchOnDescription = true;
    qp.matchOnDetail = true;
    const blank: AddItem = { label: "", blank: "unset" };
    // No item is highlighted when the list opens (and each time the scan refreshes it), so what
    // is highlighted is always what Enter picks; Enter without a highlight is the blank form.
    const setItems = (items: AddItem[]) => {
      qp.items = items;
      qp.activeItems = [];
    };
    qp.busy = true;
    qp.show();
    const picked = await new Promise<AddItem | undefined>((resolve) => {
      qp.onDidAccept(() => {
        const chosen = qp.selectedItems[0];
        // A filter that matches nothing is not "no choice": stay in the list.
        if (chosen || !qp.value.trim()) resolve(chosen ?? blank);
      });
      qp.onDidHide(() => resolve(undefined));
      detect(folder, true)
        .then(({ suggestions }) => {
          const fresh = suggestions.filter((s) => !taken.includes(s.model.name));
          // Nothing detected: there is nothing to choose from, go straight to the blank form.
          if (!fresh.length) return resolve(blank);
          const items: AddItem[] = [];
          let group = "";
          for (const s of fresh) {
            if (s.group !== group) {
              group = s.group;
              items.push({
                label: `Detected · ${group}`,
                kind: vscode.QuickPickItemKind.Separator,
              });
            }
            const icon = KINDS.find((k) => k.kind === s.model.kind)?.icon ?? "gear";
            items.push({ label: `$(${icon}) ${s.label}`, description: s.detail, suggestion: s });
          }
          setItems(items);
        })
        .catch((err: Error) => {
          vscode.window.showWarningMessage(`Project scan failed: ${err.message}`);
          resolve(blank);
        })
        .finally(() => (qp.busy = false));
    });
    qp.dispose();
    if (!picked) return;
    const model = picked.suggestion
      ? structuredClone(picked.suggestion.model)
      : emptyModel(picked.blank);
    if (!picked.suggestion) model.name = "";
    model.name = model.name && uniqueName(model.name, taken);
    edit({ folder, model, alsoCreate: picked.suggestion?.alsoCreate });
  };

  const start = (noDebug: boolean) => async (node?: Node) => {
    const config = await configOf(node);
    if (config) await runner.start(config, noDebug);
  };

  const register = (id: string, fn: (...args: never[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  register("runConfigs.add", add);
  register("runConfigs.manageTemplates", manageTemplates);
  register("runConfigs.refresh", () => tree.refresh());
  register("runConfigs.openLaunchJson", async (node?: Node) => {
    const folder = node?.type === "config" ? node.config.folder : await chooseFolder(node);
    if (folder) await openLaunchJson(folder);
  });
  register("runConfigs.debug", start(false));
  register("runConfigs.run", start(true));
  register("runConfigs.stop", async (node?: ConfigNode) => {
    const config = await configOf(node);
    if (config) await runner.stop(config, config.model.members);
  });
  register("runConfigs.restart", async (node?: ConfigNode) => {
    const config = await configOf(node);
    if (config) await runner.restart(config, config.model.members);
  });
  register("runConfigs.edit", async (node?: Node) => {
    const config = await configOf(node);
    if (config)
      edit({
        folder: config.folder,
        model: config.model,
        original: config.entry,
        originalSection: config.section,
      });
  });
  register("runConfigs.duplicate", async (node?: ConfigNode) => {
    const config = await configOf(node);
    if (!config) return;
    const taken = (await readFolder(config.folder)).items.map((i) => i.name);
    const model = { ...structuredClone(config.model), name: uniqueName(config.name, taken) };
    const entry = { ...structuredClone(config.entry), name: model.name };
    await saveEntry(config.folder, config.section, entry);
    edit({ folder: config.folder, model, original: entry, originalSection: config.section });
  });
  register("runConfigs.delete", async (node?: ConfigNode) => {
    const config = await configOf(node);
    if (!config) return;
    const ok = await vscode.window.showWarningMessage(
      `Delete the run configuration "${config.name}"?`,
      { modal: true, detail: "It is removed from .vscode/launch.json." },
      "Delete",
    );
    if (ok === "Delete") await deleteEntry(config);
  });
  register("runConfigs.reveal", async (node?: ConfigNode) => {
    const config = await configOf(node);
    if (config) await revealEntry(config);
  });
  register("runConfigs.pick", async () => {
    const picked = await pickConfig(
      "Run or debug (Enter = default action, buttons on the right)",
      true,
    );
    if (!picked) return;
    const { config, action } = picked;
    if (action === "edit")
      return edit({
        folder: config.folder,
        model: config.model,
        original: config.entry,
        originalSection: config.section,
      });
    await runner.start(config, action === "default" ? defaultNoDebug() : action === "run");
  });
  register("runConfigs.runLast", async () => {
    const last = runner.lastRun();
    const config = last && (await findConfig(last));
    if (last && config) return runner.start(config, last.noDebug);
    return vscode.commands.executeCommand("runConfigs.pick");
  });
}

/** Status-bar button: starts the last configuration again, or opens the picker. */
export function createStatusBar(runner: Runner): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  const update = () => {
    const visible = vscode.workspace.getConfiguration("runConfigs").get("showStatusBar", true);
    const last = runner.lastRun();
    if (!visible || !vscode.workspace.workspaceFolders?.length) return item.hide();
    item.text = last
      ? `$(${last.noDebug ? "play" : "debug-alt"}) ${last.name}`
      : "$(play-circle) Run…";
    item.tooltip = last
      ? `${last.noDebug ? "Run" : "Debug"} "${last.name}" again (Run Configurations)`
      : "Run or debug a configuration (Run Configurations)";
    item.command = last ? "runConfigs.runLast" : "runConfigs.pick";
    item.show();
  };
  update();
  return vscode.Disposable.from(
    item,
    runner.onDidChange(update),
    vscode.workspace.onDidChangeConfiguration(
      (e) => e.affectsConfiguration("runConfigs") && update(),
    ),
    vscode.workspace.onDidChangeWorkspaceFolders(update),
  );
}

/** Saves a form model without the UI (used by the integration tests). */
export async function saveModel(folder: vscode.WorkspaceFolder, model: FormModel): Promise<void> {
  const built = toLaunch(model);
  await saveEntry(folder, built.section, built.entry);
}
