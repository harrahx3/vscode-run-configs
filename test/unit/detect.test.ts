import { describe, expect, it } from "vitest";
import {
  consoleScripts,
  hintsOf,
  suggest,
  vitePort,
  type Scan,
} from "../../src/extension/detectCore";

function scan(files: Record<string, string | null>): Scan {
  const texts = new Map<string, string>();
  for (const [p, t] of Object.entries(files)) if (t !== null) texts.set(p, t);
  return { texts, exists: new Set(Object.keys(files)) };
}

const byName = (s: ReturnType<typeof suggest>) =>
  Object.fromEntries(s.map((x) => [x.model.name, x]));

describe("project detection", () => {
  it("finds a FastAPI app, tests and the venv of a Poetry backend", () => {
    const found = byName(
      suggest(
        scan({
          "pyproject.toml":
            '[tool.poetry]\nname = "x"\n[tool.poetry.group.dev.dependencies]\npytest = "^8"\n',
          ".venv/bin/python": null,
          "app/main.py": "from fastapi import FastAPI\napp = FastAPI(title='x')\n",
          "app/__init__.py": "",
          "scripts/seed.py": 'def main(): ...\nif __name__ == "__main__":\n    main()\n',
          "tests/test_api.py": 'if __name__ == "__main__":\n    pass\n',
        }),
      ),
    );
    const api = found["FastAPI app.main:app"].model;
    expect(api).toMatchObject({
      kind: "fastapi",
      app: "app.main:app",
      cwd: "${workspaceFolder}",
      python: "${workspaceFolder}/.venv/bin/python",
      reload: true,
    });
    expect(found["Run seed.py (scripts)"].model.program).toBe("${workspaceFolder}/scripts/seed.py");
    expect(found["Tests"].model).toMatchObject({ kind: "pytest", justMyCode: false });
    expect(found["Tests: current file"].model.args).toBe("${file}");
    expect(Object.keys(found).some((n) => n.includes("test_api"))).toBe(false);
  });

  it("handles a sub-project with a src layout, __main__ and console scripts", () => {
    const found = byName(
      suggest(
        scan({
          "api/pyproject.toml":
            '[project]\nname = "p"\n[project.scripts]\np-cli = "pkg.cli:main"\n',
          "api/.venv/bin/python": null,
          "api/.env": null,
          "api/src/pkg/server.py": "import fastapi\nserver: fastapi.FastAPI = fastapi.FastAPI()\n",
          "api/src/pkg/__main__.py": "print(1)\n",
        }),
      ),
    );
    expect(found["FastAPI pkg.server:server (api)"].model).toMatchObject({
      app: "pkg.server:server",
      cwd: "${workspaceFolder}/api/src",
      envFile: "${workspaceFolder}/api/.env",
      python: "${workspaceFolder}/api/.venv/bin/python",
    });
    expect(found["python -m pkg (api)"].model).toMatchObject({
      kind: "python-module",
      module: "pkg",
      cwd: "${workspaceFolder}/api/src",
    });
    expect(found["p-cli (api)"].model.program).toBe("${workspaceFolder}/api/.venv/bin/p-cli");
  });

  it("finds package.json scripts, the package manager, the Vite port and a full-stack compound", () => {
    const suggestions = suggest(
      scan({
        "pyproject.toml": "",
        "main.py": "app = FastAPI()\n",
        "web/package.json": JSON.stringify({
          scripts: { lint: "eslint .", dev: "vite", build: "vite build" },
          devDependencies: { vite: "7" },
        }),
        "web/pnpm-lock.yaml": null,
        "web/vite.config.ts": "export default { server: { port: 5000, proxy: {} } }",
      }),
    );
    const found = byName(suggestions);
    expect(
      suggestions.filter((s) => s.model.kind === "npm-script").map((s) => s.model.script),
    ).toEqual(["dev", "lint", "build"]);
    expect(found["pnpm dev (web)"].model).toMatchObject({
      packageManager: "pnpm",
      cwd: "${workspaceFolder}/web",
    });
    expect(found["Browser localhost:5000 (web)"].model).toMatchObject({
      url: "http://localhost:5000",
      webRoot: "${workspaceFolder}/web",
    });
    const both = found["Backend + frontend"];
    expect(suggestions[0]).toBe(both);
    expect(both.model.members).toEqual(["FastAPI main:app", "pnpm dev (web)"]);
    expect(both.alsoCreate?.map((m) => m.name)).toEqual(both.model.members);
    const hints = hintsOf(scan({ "a.py": "" }), suggestions);
    expect(hints.scripts).toEqual(["dev", "lint", "build"]);
    expect(hints.programs).toContain("${workspaceFolder}/a.py");
  });

  it("reads console scripts from both pyproject styles", () => {
    expect(
      consoleScripts(
        '[tool.poetry.scripts]\nmy-tool = "a.b:c"\n"quoted" = "x:y"\n[tool.x]\nno = "1"\n',
      ),
    ).toEqual(["my-tool", "quoted"]);
  });

  it("suggests nothing Python-specific for a pure web folder", () => {
    const s = suggest(scan({ "package.json": JSON.stringify({ scripts: { start: "node ." } }) }));
    expect(s.map((x) => x.model.kind)).toEqual(["npm-script"]);
  });

  it("reads the Vite dev-server port, not a commented-out or preview one", () => {
    expect(vitePort("export default { server: { port: 3000 } }")).toBe(3000);
    expect(
      vitePort("export default {\n  server: {\n    // port: 3000,\n    proxy: {} } }"),
    ).toBeUndefined();
    expect(
      vitePort("export default { preview: { port: 4173 }, server: { /* port: 1 */ host: true } }"),
    ).toBeUndefined();
    expect(vitePort("const x = 'http://a'; export default { server: { port: 5000 } }")).toBe(5000);
  });
});
