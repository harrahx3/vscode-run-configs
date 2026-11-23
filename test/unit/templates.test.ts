import { describe, expect, it } from "vitest";
import {
  configurationError,
  labelError,
  parseHiddenKinds,
  parseTemplates,
  templateEntry,
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
