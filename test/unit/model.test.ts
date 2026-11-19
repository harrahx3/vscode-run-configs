import { describe, expect, it } from "vitest";
import { joinArgs, splitArgs } from "../../src/shared/args";
import {
  emptyModel,
  fromLaunch,
  kindOf,
  summary,
  toLaunch,
  validate,
} from "../../src/shared/model";

describe("argument strings", () => {
  it("splits like a shell", () => {
    expect(splitArgs(`a "b c" 'd e' f\\ g ""`)).toEqual(["a", "b c", "d e", "f g", ""]);
    expect(splitArgs("  --port   8000 ")).toEqual(["--port", "8000"]);
    expect(splitArgs(`"say \\"hi\\""`)).toEqual(['say "hi"']);
  });
  it("round-trips through join", () => {
    for (const args of [
      ["a b", "it's", 'q"x', "", "${file}", "plain"],
      ["--k", "x and y"],
    ])
      expect(splitArgs(joinArgs(args))).toEqual(args);
  });
});

// The FastAPI configuration of backend-api, as found on disk.
const BACKEND_API = {
  name: "Debug FastAPI Project backend: Python Debugger",
  type: "debugpy",
  request: "launch",
  module: "uvicorn",
  args: ["app.main:app", "--reload"],
  cwd: "${workspaceFolder}",
  jinja: true,
  justMyCode: false,
  envFile: "${workspaceFolder}/.env",
};

describe("launch entry <-> form", () => {
  it("reads uvicorn args into FastAPI fields and keeps unknown keys", () => {
    const m = fromLaunch(BACKEND_API);
    expect(m.kind).toBe("fastapi");
    expect([m.app, m.reload, m.port, m.args, m.justMyCode]).toEqual([
      "app.main:app",
      true,
      "",
      "",
      false,
    ]);
    const { entry } = toLaunch(m, BACKEND_API);
    expect(entry).toEqual({ ...BACKEND_API, console: "integratedTerminal" });
  });

  it("changes the port without losing anything else", () => {
    const m = fromLaunch(BACKEND_API);
    m.port = "8001";
    m.args = "--log-level debug";
    const { entry } = toLaunch(m, BACKEND_API);
    expect(entry.args).toEqual([
      "app.main:app",
      "--port",
      "8001",
      "--reload",
      "--log-level",
      "debug",
    ]);
    expect(entry.jinja).toBe(true);
  });

  it("accepts debugpy's single-string args (poseidon-library)", () => {
    const original = {
      name: "Value Chain Config",
      type: "debugpy",
      request: "launch",
      program: "cli.py",
      console: "integratedTerminal",
      args: "config/value_chain/co2_emitter_amount.json",
    };
    const m = fromLaunch(original);
    expect(m.kind).toBe("python-file");
    expect(m.args).toBe("config/value_chain/co2_emitter_amount.json");
    expect(m.cwd).toBe("${workspaceFolder}");
    expect(toLaunch(m, original).entry.args).toEqual([
      "config/value_chain/co2_emitter_amount.json",
    ]);
  });

  it("recognises npm, browser, pytest, module, compound and other entries", () => {
    expect(kindOf({ type: "node-terminal", request: "launch", command: "pnpm dev" })).toBe(
      "npm-script",
    );
    expect(kindOf({ type: "node-terminal", request: "launch", command: "node x.js" })).toBe(
      "custom",
    );
    expect(kindOf({ type: "chrome", request: "launch", url: "x" })).toBe("browser");
    expect(kindOf({ type: "chrome", request: "attach" })).toBe("custom");
    expect(kindOf({ type: "debugpy", request: "launch", module: "pytest" })).toBe("pytest");
    expect(kindOf({ type: "python", request: "launch", module: "pkg" })).toBe("python-module");
    expect(kindOf({ type: "debugpy", request: "attach", connect: {} })).toBe("custom");
    expect(kindOf({ name: "x", configurations: [] }, "compounds")).toBe("compound");
  });

  it("builds package-manager commands", () => {
    const m = emptyModel("npm-script");
    Object.assign(m, {
      name: "dev",
      packageManager: "pnpm",
      script: "dev",
      args: "--port 5174",
      cwd: "${workspaceFolder}/web",
    });
    const { entry } = toLaunch(m);
    expect(entry).toEqual({
      name: "dev",
      type: "node-terminal",
      request: "launch",
      command: "pnpm dev --port 5174",
      cwd: "${workspaceFolder}/web",
    });
    expect(fromLaunch(entry)).toMatchObject({
      packageManager: "pnpm",
      script: "dev",
      args: "--port 5174",
    });
    m.packageManager = "npm";
    expect(toLaunch(m).entry.command).toBe("npm run dev -- --port 5174");
    expect(fromLaunch(toLaunch(m).entry)).toMatchObject({ script: "dev", args: "--port 5174" });
  });

  it("writes compounds to their own section and starts from scratch when the kind changes", () => {
    const m = emptyModel("compound");
    Object.assign(m, { name: "Both", members: ["api", "web"] });
    expect(toLaunch(m)).toEqual({
      section: "compounds",
      entry: { name: "Both", configurations: ["api", "web"], stopAll: true },
    });
    const switched = fromLaunch(BACKEND_API);
    switched.kind = "python-module";
    switched.module = "app.cli";
    expect(toLaunch(switched, BACKEND_API).entry.jinja).toBeUndefined();
  });

  it("writes env rows as an object and drops empty values", () => {
    const m = emptyModel("python-file");
    Object.assign(m, {
      name: "x",
      program: "${file}",
      env: [
        { key: "A", value: "1" },
        { key: " ", value: "" },
        { key: "NOT_YET", value: "" },
      ],
    });
    expect(toLaunch(m).entry).toEqual({
      name: "x",
      type: "debugpy",
      request: "launch",
      program: "${file}",
      cwd: "${workspaceFolder}",
      env: { A: "1" },
      console: "integratedTerminal",
      justMyCode: true,
    });
  });

  it("always writes justMyCode, true or false", () => {
    const m = emptyModel("fastapi");
    Object.assign(m, { name: "api", app: "app.main:app" });
    expect(toLaunch(m).entry.justMyCode).toBe(true);
    m.justMyCode = false;
    expect(toLaunch(m).entry.justMyCode).toBe(false);
  });

  it("keeps custom entries as typed, the form name winning", () => {
    const m = fromLaunch({
      name: "Attach",
      type: "debugpy",
      request: "attach",
      connect: { port: 5678 },
    });
    expect(m.kind).toBe("custom");
    m.name = "Attach 2";
    expect(toLaunch(m).entry).toEqual({
      name: "Attach 2",
      type: "debugpy",
      request: "attach",
      connect: { port: 5678 },
    });
  });

  it("summarises for the side panel", () => {
    expect(summary(fromLaunch(BACKEND_API))).toBe("uvicorn app.main:app (reload)");
    expect(
      summary(
        fromLaunch({
          type: "debugpy",
          request: "launch",
          program: "${workspaceFolder}/a/b.py",
          args: ["-v"],
        }),
      ),
    ).toBe("a/b.py -v");
  });
});

describe("validation", () => {
  it("asks for a unique name and the fields of the kind", () => {
    const m = emptyModel("fastapi");
    expect(validate(m, [])).toMatchObject({ name: expect.any(String), app: expect.any(String) });
    Object.assign(m, { name: "api", app: "main", port: "80a" });
    expect(Object.keys(validate(m, ["api"])).sort()).toEqual(["app", "name", "port"]);
    Object.assign(m, { name: "api2", app: "app.main:app", port: "8000" });
    expect(validate(m, ["api"])).toEqual({});
  });
  it("checks custom JSON", () => {
    const m = emptyModel("custom");
    m.name = "x";
    m.json = "{ nope";
    expect(validate(m, []).json).toMatch(/Invalid JSON/);
    m.json = '{"type": "node"}';
    expect(validate(m, []).json).toMatch(/request/);
  });
});

describe("FastAPI port from an environment variable", () => {
  const entry = {
    name: "API",
    type: "debugpy",
    request: "launch",
    code: 'import os, uvicorn; uvicorn.run("app.main:app", port=int(os.environ.get("BACKEND_PORT", "8010")), reload=True)',
    cwd: "${workspaceFolder}/backend",
    envFile: "${workspaceFolder}/.env",
    justMyCode: true,
    console: "integratedTerminal",
  };

  it("reads the variable name and the fallback port back", () => {
    const m = fromLaunch(entry);
    expect(m.kind).toBe("fastapi");
    expect([m.app, m.portEnv, m.port, m.reload]).toEqual([
      "app.main:app",
      "BACKEND_PORT",
      "8010",
      true,
    ]);
    expect(summary(m)).toBe("uvicorn app.main:app :$BACKEND_PORT (reload)");
  });

  it("round-trips through the form", () => {
    expect(toLaunch(fromLaunch(entry), entry).entry).toEqual(entry);
  });

  it("writes a literal --port again once the variable is cleared", () => {
    const m = fromLaunch(entry);
    m.portEnv = "";
    const { entry: out } = toLaunch(m, entry);
    expect(out.code).toBeUndefined();
    expect(out.module).toBe("uvicorn");
    expect(out.args).toEqual(["app.main:app", "--port", "8010", "--reload"]);
  });

  it("rejects a bad variable name and extra options", () => {
    const m = fromLaunch(entry);
    m.portEnv = "1 BAD";
    m.args = "--log-level debug";
    expect(Object.keys(validate(m, []))).toEqual(expect.arrayContaining(["portEnv", "args"]));
  });
});

describe("Vite kind", () => {
  it("builds and reads back the command", () => {
    const m = emptyModel("vite");
    m.name = "Vite";
    m.cwd = "${workspaceFolder}/frontend";
    m.port = "5183";
    m.strictPort = true;
    m.args = "--mode staging";
    const { entry } = toLaunch(m);
    expect(entry.command).toBe("npx vite --port 5183 --strictPort --mode staging");
    const back = fromLaunch(entry);
    expect(back.kind).toBe("vite");
    expect([back.port, back.strictPort, back.args]).toEqual(["5183", true, "--mode staging"]);
  });

  it("keeps npm scripts as npm scripts", () => {
    expect(kindOf({ type: "node-terminal", command: "npm run dev" })).toBe("npm-script");
    expect(kindOf({ type: "node-terminal", command: "pnpm exec vite --host 0.0.0.0" })).toBe(
      "vite",
    );
  });

  it("a bare vite command needs no port", () => {
    const m = emptyModel("vite");
    m.name = "Vite";
    expect(validate(m, [])).toEqual({});
    expect(toLaunch(m).entry.command).toBe("npx vite");
  });
});

describe("Vite port from an environment variable and an env file", () => {
  const make = (file: string) => {
    const m = emptyModel("vite");
    m.name = "Vite";
    m.cwd = "${workspaceFolder}/frontend";
    m.portEnv = "FRONTEND_PORT";
    m.port = "8098";
    m.envFile = file;
    m.host = "0.0.0.0";
    m.strictPort = true;
    return m;
  };

  it("reads the variable from the environment only when there is no file", () => {
    const { entry } = toLaunch(make(""));
    expect(entry.command).toBe(
      'vite_port="$FRONTEND_PORT"; [ -n "$vite_port" ] || vite_port=8098; npx vite --host 0.0.0.0 --port "$vite_port" --strictPort',
    );
    const back = fromLaunch(entry);
    expect([back.portEnv, back.port, back.envFile, back.host, back.strictPort]).toEqual([
      "FRONTEND_PORT",
      "8098",
      "",
      "0.0.0.0",
      true,
    ]);
  });

  it("with a file, reads that one variable out of it and round-trips", () => {
    const m = make("${workspaceFolder}/.env");
    const { entry } = toLaunch(m);
    expect(entry.command).toContain(
      `vite_port=$(sed -n 's/^FRONTEND_PORT=//p' "\${workspaceFolder}/.env"`,
    );
    expect(entry.command).not.toContain("${FRONTEND_PORT");
    expect(entry.command).toContain('--port "$vite_port"');
    const back = fromLaunch(entry);
    expect(back.kind).toBe("vite");
    expect([back.portEnv, back.port, back.envFile]).toEqual([
      "FRONTEND_PORT",
      "8098",
      "${workspaceFolder}/.env",
    ]);
    expect(toLaunch(back, entry).entry).toEqual(entry);
  });

  it("asks for a fallback port and a variable name", () => {
    const m = make("");
    m.port = "";
    expect(validate(m, [])).toHaveProperty("port");
    const n = emptyModel("vite");
    n.name = "V";
    n.envFile = "x";
    expect(validate(n, [])).toHaveProperty("portEnv");
  });
});

describe("blank form with no kind chosen", () => {
  it("cannot be saved until a kind is picked", () => {
    const m = emptyModel("unset");
    m.name = "X";
    expect(validate(m, [])).toHaveProperty("kind");
    expect(() => toLaunch(m)).toThrow();
    m.kind = "vite";
    expect(validate(m, [])).toEqual({});
  });
});
