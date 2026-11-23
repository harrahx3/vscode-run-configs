// Integration tests against a multi-root workspace (two folders), run inside a real VS Code.
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { runTests } from "@vscode/test-electron";

function inheritedVsCodeVariables(): string[] {
  return Object.keys(process.env).filter(
    (k) => k === "ELECTRON_RUN_AS_NODE" || k.startsWith("VSCODE_"),
  );
}

async function main(): Promise<void> {
  const unset: Record<string, undefined> = {};
  for (const key of inheritedVsCodeVariables()) unset[key] = undefined;
  const root = path.resolve(__dirname, "../../..");
  const base = path.join(root, "out", "fixtures-multiroot");
  const folders = ["alpha", "beta"].map((n) => path.join(base, n));
  for (const f of folders) {
    const make = spawnSync(
      process.execPath,
      [path.join(root, "test", "fixtures", "make-fixtures.mjs"), f],
      { stdio: "inherit" },
    );
    if (make.status !== 0) throw new Error("fixture generation failed");
  }
  // Same configuration name in both folders: the extension must tell them apart by folder.
  const betaLaunch = path.join(folders[1], ".vscode", "launch.json");
  fs.writeFileSync(
    betaLaunch,
    fs.readFileSync(betaLaunch, "utf8").replace("// Kept by every edit.", "// Beta folder."),
  );
  const workspaceFile = path.join(base, "multi.code-workspace");
  fs.writeFileSync(
    workspaceFile,
    JSON.stringify({ folders: folders.map((p) => ({ path: p })) }, null, 2),
  );

  await runTests({
    version: "stable",
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(__dirname, "suite-multiroot"),
    launchArgs: [
      workspaceFile,
      "--disable-workspace-trust",
      "--disable-extensions",
      "--extensions-dir",
      path.join(root, ".vscode-test", "extensions"),
    ],
    extensionTestsEnv: { ...unset, DONT_PROMPT_WSL_INSTALL: "1" },
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
