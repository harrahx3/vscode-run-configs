// Integration tests, run inside a real VS Code instance by runTest.ts.
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

const folder = () => vscode.workspace.workspaceFolders![0];
const launchUri = () => vscode.Uri.joinPath(folder().uri, ".vscode", "launch.json");
const launchText = async () =>
  new TextDecoder().decode(await vscode.workspace.fs.readFile(launchUri()));

async function treeItems(): Promise<{ node: any; item: vscode.TreeItem }[]> {
  const { tree } = await api();
  const nodes = await tree.getChildren();
  return nodes.map((node: any) => ({ node, item: tree.getTreeItem(node) }));
}
const labels = async () => (await treeItems()).map((i) => i.item.label);
const itemNamed = async (name: string) => (await treeItems()).find((i) => i.item.label === name)!;

const tests: [string, () => Promise<void>][] = [
  [
    "user templates and hidden tiles come from the settings, skipping malformed ones",
    async () => {
      const { allTemplates, hiddenKinds } = await api();
      const cfg = vscode.workspace.getConfiguration("runConfigs");
      const user = vscode.ConfigurationTarget.Global;
      try {
        await cfg.update(
          "templates",
          [
            { label: "Go", hint: "dlv", configuration: { type: "go", request: "launch" } },
            { label: "Broken" },
          ],
          user,
        );
        await cfg.update("hiddenKinds", ["vite", "custom"], user);
        assert.deepStrictEqual(
          allTemplates().map((t: any) => t.label),
          ["Go"],
        );
        assert.deepStrictEqual(hiddenKinds(), ["vite"]);
      } finally {
        await cfg.update("templates", undefined, user);
        await cfg.update("hiddenKinds", undefined, user);
      }
      assert.deepStrictEqual(allTemplates(), []);
    },
  ],
  [
    "the tile menu hides a built-in tile, never the JSON one",
    async () => {
      const { hiddenKinds } = await api();
      const cfg = vscode.workspace.getConfiguration("runConfigs");
      try {
        // The argument is what a right-click on a tile passes (its data-vscode-context).
        await vscode.commands.executeCommand("runConfigs.tiles.hide", {
          webviewSection: "builtinTile",
          kind: "vite",
          hideable: true,
        });
        await vscode.commands.executeCommand("runConfigs.tiles.hide", { kind: "custom" });
        await vscode.commands.executeCommand("runConfigs.tiles.hide", { kind: "vite" });
        assert.deepStrictEqual(hiddenKinds(), ["vite"]);
        // A workspace template is not editable from the menu: nothing happens, no prompt.
        await vscode.commands.executeCommand("runConfigs.tiles.deleteTemplate", {
          templateLabel: "Nope",
          templateScope: "workspace",
        });
      } finally {
        await cfg.update("hiddenKinds", undefined, vscode.ConfigurationTarget.Global);
      }
    },
  ],
  [
    "the side panel lists the configurations of launch.json",
    async () => {
      assert.ok((await api()).tree, "extension activated");
      assert.deepStrictEqual(await labels(), ["Wait a minute"]);
      const { item } = await itemNamed("Wait a minute");
      assert.strictEqual(item.description, "npm run wait in web");
      assert.strictEqual(item.contextValue, "config.idle");
    },
  ],
  [
    "the project scan suggests the FastAPI app, tests, scripts and a full-stack compound",
    async () => {
      const { suggestions } = await (await api()).detect(folder(), true);
      const names = suggestions.map((s: any) => s.model.name);
      for (const expected of [
        "Backend + frontend",
        "FastAPI app.main:app",
        "Run hello.py (scripts)",
        "Tests",
        "npm dev (web)",
        "Browser localhost:5173 (web)",
        "pp (sim.py)",
        "coupled (sim.py)",
      ])
        assert.ok(names.includes(expected), `${expected} in ${names.join(", ")}`);
    },
  ],
  [
    "saving a form model appends to launch.json and keeps its comments",
    async () => {
      const { detect, saveModel } = await api();
      const { suggestions } = await detect(folder());
      const fastapi = suggestions.find((s: any) => s.model.kind === "fastapi").model;
      await saveModel(folder(), fastapi);
      const text = await launchText();
      assert.match(text, /\/\/ Kept by every edit\./);
      assert.match(text, /"module": "uvicorn"/);
      await waitFor(
        async () => (await labels()).includes("FastAPI app.main:app"),
        "the new item in the tree",
      );
    },
  ],
  [
    "Run starts the configuration, the item shows it running, Stop ends it",
    async () => {
      const started = new Promise<vscode.DebugSession>((resolve) => {
        const sub = vscode.debug.onDidStartDebugSession((s) => {
          if (s.configuration.name === "Wait a minute") {
            sub.dispose();
            resolve(s);
          }
        });
      });
      await vscode.commands.executeCommand(
        "runConfigs.run",
        (await itemNamed("Wait a minute")).node,
      );
      const session = await started;
      assert.strictEqual(session.configuration.noDebug, true);
      await waitFor(
        async () => (await itemNamed("Wait a minute")).item.contextValue === "config.running",
        "running state",
      );
      const ended = new Promise<void>((resolve) => {
        const sub = vscode.debug.onDidTerminateDebugSession((s) => {
          if (s === session) {
            sub.dispose();
            resolve();
          }
        });
      });
      await vscode.commands.executeCommand(
        "runConfigs.stop",
        (await itemNamed("Wait a minute")).node,
      );
      await ended;
      await waitFor(
        async () => (await itemNamed("Wait a minute")).item.contextValue === "config.idle",
        "idle state",
      );
    },
  ],
  [
    "Edit opens the form, once per configuration",
    async () => {
      const { node } = await itemNamed("FastAPI app.main:app");
      await vscode.commands.executeCommand("runConfigs.edit", node);
      await vscode.commands.executeCommand("runConfigs.edit", node);
      const panels = (await api()).panels();
      assert.strictEqual(panels.length, 1);
      assert.strictEqual(panels[0].panel.title, "Edit: FastAPI app.main:app");
      panels[0].panel.dispose();
    },
  ],
  [
    "the status bar command starts the last configuration again",
    async () => {
      const started = new Promise<vscode.DebugSession>((resolve) => {
        const sub = vscode.debug.onDidStartDebugSession((s) => {
          sub.dispose();
          resolve(s);
        });
      });
      await vscode.commands.executeCommand("runConfigs.runLast");
      const session = await started;
      assert.strictEqual(session.configuration.name, "Wait a minute");
      await vscode.debug.stopDebugging(session);
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
