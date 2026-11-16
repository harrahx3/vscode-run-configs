// The configuration form: one webview panel per configuration being edited.
import * as path from "path";
import * as vscode from "vscode";
import type { HostMessage, PickField, WebviewMessage } from "../shared/messages";
import {
  toLaunch,
  validate,
  type FormModel,
  type LaunchEntry,
  type Section,
} from "../shared/model";
import { detect } from "./detect";
import { webviewHtml } from "./html";
import type { Runner } from "./runner";
import { readFolder, revealEntry, saveEntry } from "./store";

export interface EditRequest {
  folder: vscode.WorkspaceFolder;
  model: FormModel;
  original?: LaunchEntry;
  originalSection?: Section;
  /** Members a compound suggestion needs; created on save when missing. */
  alsoCreate?: FormModel[];
}

const PICK: Record<PickField, { folders: boolean; title: string }> = {
  program: { folders: false, title: "Python file to run" },
  python: { folders: false, title: "Python interpreter (e.g. .venv/bin/python)" },
  envFile: { folders: false, title: "File with environment variables" },
  cwd: { folders: true, title: "Folder to run in" },
  webRoot: { folders: true, title: "Folder holding the web sources" },
};

async function tasksWithin(ms: number): Promise<string[]> {
  const timeout = new Promise<vscode.Task[]>((r) => setTimeout(() => r([]), ms));
  const tasks = await Promise.race([vscode.tasks.fetchTasks().then(undefined, () => []), timeout]);
  return [...new Set(tasks.map((t) => t.name))].sort();
}

export class EditorPanel {
  private static readonly open = new Map<string, EditorPanel>();

  static show(context: vscode.ExtensionContext, runner: Runner, request: EditRequest): EditorPanel {
    const key = EditorPanel.keyOf(request);
    const existing = key && EditorPanel.open.get(key);
    if (existing) {
      existing.panel.reveal();
      return existing;
    }
    return new EditorPanel(context, runner, request);
  }

  /** Test hook: the open panels. */
  static all(): EditorPanel[] {
    return [...new Set(EditorPanel.open.values())];
  }

  private static keyOf(r: EditRequest): string | undefined {
    if (!r.original) return undefined;
    return `${r.folder.uri}|${r.originalSection}|${String(r.original.name)}`;
  }

  readonly panel: vscode.WebviewPanel;
  private key: string | undefined;

  private constructor(
    context: vscode.ExtensionContext,
    private readonly runner: Runner,
    private request: EditRequest,
  ) {
    const title = request.original ? `Edit: ${request.model.name}` : "New run configuration";
    this.panel = vscode.window.createWebviewPanel(
      "runConfigs.editor",
      title,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
      },
    );
    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "icon.svg");
    this.panel.webview.html = webviewHtml(this.panel.webview, context.extensionUri);
    this.rekey();
    this.panel.onDidDispose(() => this.key && EditorPanel.open.delete(this.key));
    this.panel.webview.onDidReceiveMessage((m: WebviewMessage) =>
      this.onMessage(m).catch((err: Error) => this.post({ type: "error", message: err.message })),
    );
  }

  private rekey(): void {
    if (this.key) EditorPanel.open.delete(this.key);
    this.key = EditorPanel.keyOf(this.request);
    if (this.key) EditorPanel.open.set(this.key, this);
  }

  private post(message: HostMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private async sendInit(): Promise<void> {
    const { folder, model, original, originalSection } = this.request;
    const { items } = await readFolder(folder);
    const self = (i: { name: string; section: Section }) =>
      original && i.name === original.name && i.section === originalSection;
    this.post({
      type: "init",
      model,
      original,
      originalSection,
      folderName: folder.name,
      otherNames: items.filter((i) => !self(i)).map((i) => i.name),
      memberChoices: [
        ...items.filter((i) => i.section === "configurations").map((i) => i.name),
        ...(this.request.alsoCreate ?? []).map((m) => m.name),
      ].filter((n, i, all) => all.indexOf(n) === i),
      isNew: !original,
    });
    const [detection, tasks] = await Promise.all([
      detect(folder).catch(() => undefined),
      tasksWithin(3000),
    ]);
    if (detection) this.post({ type: "hints", hints: detection.hints, tasks });
  }

  private async onMessage(m: WebviewMessage): Promise<void> {
    switch (m.type) {
      case "ready":
        return this.sendInit();
      case "pick":
        return this.pick(m.field);
      case "save":
        return this.save(m.model, m.then);
      case "openJson":
        if (this.request.original)
          await revealEntry({
            folder: this.request.folder,
            section: this.request.originalSection ?? "configurations",
            name: String(this.request.original.name),
          });
        return;
      case "close":
        this.panel.dispose();
    }
  }

  private async pick(field: PickField): Promise<void> {
    const { folders, title } = PICK[field];
    const root = this.request.folder.uri;
    const picked = await vscode.window.showOpenDialog({
      title,
      defaultUri: root,
      canSelectFiles: !folders,
      canSelectFolders: folders,
      canSelectMany: false,
      openLabel: "Choose",
    });
    if (!picked?.[0]) return;
    const rel = path.relative(root.fsPath, picked[0].fsPath).split(path.sep).join("/");
    const value =
      rel === ""
        ? "${workspaceFolder}"
        : rel.startsWith("..") || path.isAbsolute(rel)
          ? picked[0].fsPath
          : `\${workspaceFolder}/${rel}`;
    this.post({ type: "picked", field, value });
  }

  private async save(model: FormModel, then: "none" | "run" | "debug"): Promise<void> {
    const { folder, original, originalSection } = this.request;
    const { items } = await readFolder(folder);
    const others = items
      .filter((i) => !(original && i.name === original.name && i.section === originalSection))
      .map((i) => i.name);
    const errors = validate(model, others);
    if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);

    for (const member of this.request.alsoCreate ?? []) {
      if (!model.members.includes(member.name) || items.some((i) => i.name === member.name))
        continue;
      const built = toLaunch(member);
      await saveEntry(folder, built.section, built.entry);
    }
    const built = toLaunch(model, original, originalSection);
    const previous = original
      ? { name: String(original.name), section: originalSection ?? "configurations" }
      : undefined;
    await saveEntry(folder, built.section, built.entry, previous);

    this.request = { folder, model, original: built.entry, originalSection: built.section };
    this.rekey();
    this.panel.title = `Edit: ${model.name}`;
    this.post({ type: "saved", model, original: built.entry, originalSection: built.section });
    if (then !== "none")
      await this.runner.start(
        { folder, section: built.section, name: model.name.trim() },
        then === "run",
      );
  }
}
