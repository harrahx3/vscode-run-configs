// Writes the sample workspace used by the VS Code integration tests.
// Usage: node test/fixtures/make-fixtures.mjs <target-folder>
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const target = process.argv[2];
if (!target) throw new Error("usage: make-fixtures.mjs <target-folder>");
rmSync(target, { recursive: true, force: true });

const files = {
  "pyproject.toml": '[project]\nname = "demo"\nrequires-python = ">=3.12"\n\n[dependency-groups]\ndev = ["pytest"]\n',
  "app/__init__.py": "",
  "app/main.py": "from fastapi import FastAPI\n\napp = FastAPI()\n",
  "scripts/hello.py": 'if __name__ == "__main__":\n    print("hello")\n',
  "sim.py":
    'from fire import Fire\n\n\nclass Cli:\n    def pp(self, days: int = None):\n        """Run the network only."""\n\n    def coupled(self, days: int = None, resume=None):\n        """Run with the optimiser."""\n\n\nif __name__ == "__main__":\n    Fire(Cli)\n',
  "tests/test_x.py": "def test_x():\n    assert True\n",
  "web/package.json": JSON.stringify(
    { name: "web", private: true, scripts: { dev: "vite", wait: 'node -e "setTimeout(() => {}, 60000)"' }, devDependencies: { vite: "7.0.0" } },
    null,
    2,
  ),
  ".vscode/launch.json": `{
    // Kept by every edit.
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Wait a minute",
            "type": "node-terminal",
            "request": "launch",
            "command": "npm run wait",
            "cwd": "\${workspaceFolder}/web",
        },
    ]
}
`,
};
for (const [path, text] of Object.entries(files)) {
  mkdirSync(dirname(join(target, path)), { recursive: true });
  writeFileSync(join(target, path), text);
}
