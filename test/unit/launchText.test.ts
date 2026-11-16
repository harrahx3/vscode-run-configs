import { describe, expect, it } from "vitest";
import {
  formattingOf,
  offsetOf,
  parseLaunch,
  removeEntry,
  renameInCompounds,
  uniqueName,
  upsertEntry,
} from "../../src/extension/launchText";

const WITH_COMMENTS = `{
    // Use IntelliSense to learn about possible attributes.
    "version": "0.2.0",
    "configurations": [
        {
            "name": "api",
            "type": "debugpy",
            "request": "launch",
            "module": "uvicorn", // the server
            "envFile": "\${workspaceFolder}/.env",
        }
    ],
    "compounds": [
        { "name": "all", "configurations": ["api", "web"] }
    ]
}`;

describe("launch.json text edits", () => {
  it("parses JSON with comments and trailing commas", () => {
    const parsed = parseLaunch(WITH_COMMENTS);
    expect(parsed.configurations.map((c) => c.name)).toEqual(["api"]);
    expect(parsed.compounds[0].configurations).toEqual(["api", "web"]);
    expect(parsed.error).toBeUndefined();
    expect(parseLaunch("").configurations).toEqual([]);
    expect(parseLaunch("[ nope").error).toBeTruthy();
  });

  it("appends with the file's indentation and keeps comments", () => {
    const out = upsertEntry(WITH_COMMENTS, "configurations", {
      name: "web",
      type: "node-terminal",
    });
    expect(out).toContain("// Use IntelliSense");
    expect(out).toContain("// the server");
    expect(out).toMatch(/\n {8}\{\n {12}"name": "web"/);
    expect(parseLaunch(out).configurations.map((c) => c.name)).toEqual(["api", "web"]);
  });

  it("replaces an entry in place, renaming it", () => {
    const out = upsertEntry(
      WITH_COMMENTS,
      "configurations",
      { name: "api2", type: "debugpy" },
      "api",
    );
    expect(parseLaunch(out).configurations).toEqual([{ name: "api2", type: "debugpy" }]);
    expect(out).toContain("// Use IntelliSense");
  });

  it("moves an entry between sections when its kind changes", () => {
    const out = upsertEntry(
      WITH_COMMENTS,
      "compounds",
      { name: "api", configurations: ["web"] },
      "api",
      "configurations",
    );
    const parsed = parseLaunch(out);
    expect(parsed.configurations).toEqual([]);
    expect(parsed.compounds.map((c) => c.name)).toEqual(["all", "api"]);
  });

  it("creates the file content and missing sections", () => {
    const out = upsertEntry("", "compounds", { name: "c", configurations: [] });
    expect(JSON.parse(out)).toEqual({
      version: "0.2.0",
      configurations: [],
      compounds: [{ name: "c", configurations: [] }],
    });
  });

  it("removes entries and follows renames in compounds", () => {
    expect(parseLaunch(removeEntry(WITH_COMMENTS, "configurations", "api")).configurations).toEqual(
      [],
    );
    expect(
      parseLaunch(renameInCompounds(WITH_COMMENTS, "api", "backend")).compounds[0].configurations,
    ).toEqual(["backend", "web"]);
    expect(
      parseLaunch(renameInCompounds(WITH_COMMENTS, "api")).compounds[0].configurations,
    ).toEqual(["web"]);
  });

  it("finds an entry's offset, detects tabs and builds unique names", () => {
    expect(
      WITH_COMMENTS.slice(offsetOf(WITH_COMMENTS, "configurations", "api")!).startsWith("{"),
    ).toBe(true);
    expect(formattingOf('{\n\t"a": 1\n}')).toMatchObject({ insertSpaces: false });
    expect(formattingOf(WITH_COMMENTS)).toMatchObject({ insertSpaces: true, tabSize: 4 });
    expect(uniqueName("x", ["x", "x (copy)"])).toBe("x (copy 2)");
    expect(uniqueName("y", ["x"])).toBe("y");
  });
});
