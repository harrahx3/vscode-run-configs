import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  builtinTileContext,
  configurationError,
  labelError,
  parseHiddenKinds,
  parseTemplates,
  templateEntry,
  templateTileContext,
} from "../../src/shared/templates";

describe("templates setting", () => {
  it("keeps valid templates and skips malformed ones", () => {
    const parsed = parseTemplates([
      { label: " Go ", configuration: { type: "go", request: "launch" } },
      { label: "No configuration" },
      { configuration: { type: "x" } },
      "nope",
      { label: "Bad icon", icon: "Not An Icon!", configuration: { type: "x" } },
    ]);
    expect(parsed.map((t) => t.label)).toEqual(["Go", "Bad icon"]);
    expect(parsed[0]).toMatchObject({ hint: "", icon: "rocket" });
    expect(parsed[1].icon).toBe("rocket");
    expect(parseTemplates(undefined)).toEqual([]);
  });
  it("drops the name from the entry the form opens with", () => {
    const [t] = parseTemplates([{ label: "Go", configuration: { type: "go", name: "x" } }]);
    expect(templateEntry(t)).toEqual({ type: "go" });
    expect(t.configuration.name).toBe("x");
  });
  it("never hides the JSON tile and ignores unknown kinds", () => {
    expect(parseHiddenKinds(["vite", "custom", "bogus", "browser"])).toEqual(["vite", "browser"]);
  });
  it("validates labels and configurations", () => {
    expect(labelError(" ", [])).toBeDefined();
    expect(labelError("go", ["Go"])).toBeDefined();
    expect(labelError("Rust", ["Go"])).toBeUndefined();
    expect(configurationError("{")).toMatch(/Not valid JSON/);
    expect(configurationError("[]")).toBeDefined();
    expect(configurationError('{"request":"launch"}')).toMatch(/type/);
    expect(configurationError('{"type":"go"}')).toBeUndefined();
  });
});

describe("right-click menu on the tiles", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  const menu: { command: string; when: string }[] = pkg.contributes.menus["webview/context"];

  it("matches the form's webview by webviewId (webview == … never matches)", () => {
    expect(menu.length).toBeGreaterThan(0);
    for (const item of menu) expect(item.when).toMatch(/^webviewId == runConfigs\.editor /);
  });
  it("hides the tile commands from the command palette", () => {
    const hidden = pkg.contributes.menus.commandPalette
      .filter((c: { when: string }) => c.when === "false")
      .map((c: { command: string }) => c.command);
    for (const item of menu) expect(hidden).toContain(item.command);
  });
  it("says which tile was clicked; the JSON tile cannot be hidden", () => {
    expect(builtinTileContext("vite")).toEqual({
      webviewSection: "builtinTile",
      kind: "vite",
      hideable: true,
    });
    expect(builtinTileContext("custom").hideable).toBe(false);
    const [t] = parseTemplates([{ label: "Go", configuration: { type: "go" } }]);
    expect(templateTileContext(t)).toEqual({
      webviewSection: "templateTile",
      templateLabel: "Go",
      templateScope: "user",
    });
    expect(templateTileContext({ ...t, scope: "workspace" }).templateScope).toBe("workspace");
  });
});
