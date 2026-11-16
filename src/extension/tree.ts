// The side panel: workspace folders (when several) -> their configurations.
import * as vscode from "vscode";
import { KINDS, summary } from "../shared/model";
import type { Runner } from "./runner";
import { launchUri, readFolder, type StoredConfig } from "./store";

export type Node =
  | { type: "folder"; folder: vscode.WorkspaceFolder }
  | { type: "config"; config: StoredConfig }
  | { type: "error"; folder: vscode.WorkspaceFolder; message: string };

const KIND_ICON = Object.fromEntries(KINDS.map((k) => [k.kind, k.icon]));

export class ConfigTree implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly disposables: vscode.Disposable[] = [this.changed];

  constructor(private readonly runner: Runner) {
    const watcher = vscode.workspace.createFileSystemWatcher("**/.vscode/launch.json");
    this.disposables.push(
      watcher,
      watcher.onDidChange(() => this.refresh()),
      watcher.onDidCreate(() => this.refresh()),
      watcher.onDidDelete(() => this.refresh()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh()),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.path.endsWith("/.vscode/launch.json")) this.refresh();
      }),
      runner.onDidChange(() => this.refresh()),
    );
  }

  refresh(): void {
    this.changed.fire(undefined);
  }

  async getChildren(node?: Node): Promise<Node[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!node) {
      if (folders.length === 1) return this.configsOf(folders[0]);
      return folders.map((folder) => ({ type: "folder", folder }));
    }
    return node.type === "folder" ? this.configsOf(node.folder) : [];
  }

  private async configsOf(folder: vscode.WorkspaceFolder): Promise<Node[]> {
    const read = await readFolder(folder);
    const nodes: Node[] = read.items.map((config) => ({ type: "config", config }));
    if (read.error) nodes.unshift({ type: "error", folder, message: read.error });
    return nodes;
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.type === "folder") {
      const item = new vscode.TreeItem(node.folder.name, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = vscode.ThemeIcon.Folder;
      item.contextValue = "folder";
      item.resourceUri = node.folder.uri;
      return item;
    }
    if (node.type === "error") {
      const item = new vscode.TreeItem(node.message);
      item.iconPath = new vscode.ThemeIcon("warning");
      item.description = "click to open it";
      item.command = { command: "vscode.open", title: "Open", arguments: [launchUri(node.folder)] };
      return item;
    }
    const { config } = node;
    const running = this.runner.sessionsOf(config, config.model.members);
    const item = new vscode.TreeItem(config.name);
    item.description = running.length
      ? `● running · ${summary(config.model)}`
      : summary(config.model);
    item.iconPath = running.length
      ? new vscode.ThemeIcon("debug-alt", new vscode.ThemeColor("debugIcon.startForeground"))
      : new vscode.ThemeIcon(KIND_ICON[config.model.kind] ?? "gear");
    item.contextValue = running.length ? "config.running" : "config.idle";
    item.tooltip = new vscode.MarkdownString(
      `**${config.name}**\n\n${KINDS.find((k) => k.kind === config.model.kind)?.label}` +
        `\n\n\`\`\`json\n${JSON.stringify(config.entry, null, 2)}\n\`\`\`\n\nClick to edit.`,
    );
    item.command = { command: "runConfigs.edit", title: "Edit", arguments: [node] };
    return item;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
