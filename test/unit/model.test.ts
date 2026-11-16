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
