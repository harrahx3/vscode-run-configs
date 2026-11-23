// Multi-root workspace tests: folders "alpha" and "beta", each with a launch.json that holds a
// configuration called "Wait a minute".
import * as assert from "assert";
import * as vscode from "vscode";

const ID = "harrahx3.vscode-run-configs";

async function waitFor(
  check: () => boolean | Promise<boolean>,
  what: string,
  timeoutMs = 15_000,
): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the extension's API is untyped here */
async function api(): Promise<any> {
  const ext = vscode.extensions.getExtension(ID)!;
  return ext.isActive ? ext.exports : ext.activate();
}

const folders = () => vscode.workspace.workspaceFolders!;
const folderNamed = (name: string) => folders().find((f) => f.name === name)!;
const text = async (f: vscode.WorkspaceFolder) =>
  new TextDecoder().decode(
    await vscode.workspace.fs.readFile(vscode.Uri.joinPath(f.uri, ".vscode", "launch.json")),
  );

async function rootNodes(): Promise<{ node: any; item: vscode.TreeItem }[]> {
  const { tree } = await api();
  return (await tree.getChildren()).map((node: any) => ({ node, item: tree.getTreeItem(node) }));
}
async function configsIn(name: string): Promise<{ node: any; item: vscode.TreeItem }[]> {
  const { tree } = await api();
  const parent = (await rootNodes()).find((n) => n.item.label === name)!.node;
  return (await tree.getChildren(parent)).map((node: any) => ({
    node,
    item: tree.getTreeItem(node),
  }));
}

const tests: [string, () => Promise<void>][] = [
  [
    "the workspace has two folders",
    async () => {
      assert.deepStrictEqual(
        folders().map((f) => f.name),
        ["alpha", "beta"],
      );
    },
  ],
  [
    "the side panel groups the configurations by folder",
    async () => {
      assert.deepStrictEqual(
        (await rootNodes()).map((n) => n.item.label),
        ["alpha", "beta"],
      );
      for (const name of ["alpha", "beta"])
        assert.deepStrictEqual(
          (await configsIn(name)).map((n) => n.item.label),
          ["Wait a minute"],
        );
    },
  ],
  [
    "the project scan of one folder reports folder-relative paths and only its own files",
    async () => {
      const { detect } = await api();
      const { suggestions } = await detect(folderNamed("beta"), true);
      const names = suggestions.map((s: any) => s.model.name);
      assert.ok(names.includes("FastAPI app.main:app"), names.join(", "));
      assert.ok(names.includes("Run hello.py (scripts)"), names.join(", "));
      assert.ok(
        !names.some((n: string) => n.includes("beta/") || n.includes("alpha/")),
        names.join(", "),
      );
    },
  ],
  [
    "saving a model writes to the launch.json of its own folder only",
    async () => {
      const { detect, saveModel } = await api();
      const { suggestions } = await detect(folderNamed("beta"));
      const fastapi = suggestions.find((s: any) => s.model.kind === "fastapi").model;
      await saveModel(folderNamed("beta"), fastapi);
      assert.match(await text(folderNamed("beta")), /"module": "uvicorn"/);
      assert.doesNotMatch(await text(folderNamed("alpha")), /uvicorn/);
      await waitFor(
        async () => (await configsIn("beta")).some((n) => n.item.label === "FastAPI app.main:app"),
        "the new item under beta",
      );
      assert.ok(!(await configsIn("alpha")).some((n) => n.item.label === "FastAPI app.main:app"));
    },
  ],
  [
    "running a configuration of beta marks only beta's item as running",
    async () => {
      const started = new Promise<vscode.DebugSession>((resolve) => {
        const sub = vscode.debug.onDidStartDebugSession((s) => {
          if (s.configuration.name === "Wait a minute") {
            sub.dispose();
            resolve(s);
          }
        });
      });
      const beta = (await configsIn("beta")).find((n) => n.item.label === "Wait a minute")!;
      await vscode.commands.executeCommand("runConfigs.run", beta.node);
      const session = await started;
      assert.strictEqual(session.workspaceFolder?.name, "beta");
      const state = async (name: string) =>
        (await configsIn(name)).find((n) => n.item.label === "Wait a minute")!.item.contextValue;
      await waitFor(async () => (await state("beta")) === "config.running", "beta running");
      assert.strictEqual(await state("alpha"), "config.idle");
      const ended = new Promise<void>((resolve) => {
        const sub = vscode.debug.onDidTerminateDebugSession((s) => {
          if (s === session) {
            sub.dispose();
            resolve();
          }
        });
      });
      const again = (await configsIn("beta")).find((n) => n.item.label === "Wait a minute")!;
      await vscode.commands.executeCommand("runConfigs.stop", again.node);
      await ended;
      await waitFor(async () => (await state("beta")) === "config.idle", "beta idle");
    },
  ],
  [
    "the status bar command restarts the last run in the folder it came from",
    async () => {
      const started = new Promise<vscode.DebugSession>((resolve) => {
        const sub = vscode.debug.onDidStartDebugSession((s) => {
          sub.dispose();
          resolve(s);
        });
      });
      await vscode.commands.executeCommand("runConfigs.runLast");
      const session = await started;
      assert.strictEqual(session.workspaceFolder?.name, "beta");
      await vscode.debug.stopDebugging(session);
    },
  ],
  [
    "removing a folder from the workspace removes its group from the side panel",
    async () => {
      vscode.workspace.updateWorkspaceFolders(1, 1);
      await waitFor(() => folders().length === 1, "one folder left");
      // With a single folder the panel lists its configurations directly.
      await waitFor(
        async () => (await rootNodes()).every((n) => n.node.type === "config"),
        "flat list",
      );
    },
  ],
];

export async function run(): Promise<void> {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.log(`  ✗ ${name}\n    ${(err as Error).message}`);
    }
  }
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  if (failed) throw new Error(`${failed} integration test(s) failed`);
}
