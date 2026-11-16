// Downloads VS Code (cached in .vscode-test/) and runs the integration suite against a sample
// workspace. Needs a display (WSLg on Windows, or xvfb-run on a headless Linux).
import { spawnSync } from "child_process";
import * as path from "path";
import { runTests } from "@vscode/test-electron";

/**
 * Variables that make a nested VS Code misbehave when the tests are started from a VS Code
 * terminal: ELECTRON_RUN_AS_NODE turns it into plain Node, VSCODE_* route the CLI to the
 * running (remote) instance instead of the downloaded one.
 */
function inheritedVsCodeVariables(): string[] {
  return Object.keys(process.env).filter(
    (k) => k === "ELECTRON_RUN_AS_NODE" || k.startsWith("VSCODE_"),
  );
}

async function main(): Promise<void> {
  const unset: Record<string, undefined> = {};
  for (const key of inheritedVsCodeVariables()) unset[key] = undefined;
  const root = path.resolve(__dirname, "../../..");
  const workspace = path.join(root, "out", "fixtures", "workspace");
  const make = spawnSync(
    process.execPath,
    [path.join(root, "test", "fixtures", "make-fixtures.mjs"), workspace],
    { stdio: "inherit" },
  );
  if (make.status !== 0) throw new Error("fixture generation failed");

  await runTests({
    version: "stable",
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(__dirname, "suite"),
    launchArgs: [
      workspace,
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
