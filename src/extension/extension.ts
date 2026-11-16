import * as vscode from "vscode";
import { createStatusBar, registerCommands, saveModel } from "./commands";
import { detect } from "./detect";
import { EditorPanel } from "./editorPanel";
import { Runner } from "./runner";
import { ConfigTree } from "./tree";

export function activate(context: vscode.ExtensionContext) {
  const runner = new Runner(context.workspaceState);
  const tree = new ConfigTree(runner);
  const view = vscode.window.createTreeView("runConfigs.list", {
    treeDataProvider: tree,
    showCollapseAll: false,
  });
  context.subscriptions.push(runner, tree, view, createStatusBar(runner));
  registerCommands(context, runner, tree);
  // Returned for the integration tests.
  return { tree, runner, detect, saveModel, panels: () => EditorPanel.all() };
}

export function deactivate(): void {}
