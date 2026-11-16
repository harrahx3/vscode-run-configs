import { describe, expect, it } from "vitest";
import { suggest, type Scan } from "../../src/extension/detectCore";
import { envNamesOf, fireCliOf, parseDocstring } from "../../src/extension/pythonCli";
import { buildFireArgs, fireArgsString, parseFireArgs, programKey } from "../../src/shared/fire";

// Shaped like paris_demo_site/main.py: a class given to Fire, Google-style docstrings.
const PARIS = `import os
from fire import Fire


def _helper(x):
    return x


class PdsCli:
    def __init__(self):
        load_dotenv()

    def pp(self, days: int = None, zero_demands: bool = False, assets_off: bool = False):
        """Run the simulation without DEMix.

        Args:
            days: Number of days to simulate (None = entire period).
            zero_demands: Zero the building demands so the loop has no load —
                used for network heat-loss characterisation.
            assets_off: Force every ON_* signal to 0.
        """
        def inner(y):
            return y
        return inner(days)

    def demix(self):
        """Run DEMix only"""

    def coupled(
        self,
        days: int = None,
        resume=None,  # a run folder
        stop_after: int = None,
    ):
        '''Run the coupled simulation with DEMix

        Args:
            resume: Path to an existing run folder to RESUME.
        '''

    @property
    def hidden(self):
        return 1

    def _private(self):
        pass


if __name__ == "__main__":
    Fire(PdsCli)
`;

const cli = fireCliOf("main.py", PARIS)!;

describe("finding a Fire CLI in Python source", () => {
  it("lists the public methods of the class given to Fire, with options and docs", () => {
    expect(cli.commands.map((c) => c.name)).toEqual(["pp", "demix", "coupled"]);
    const [pp, demix, coupled] = cli.commands;
    expect(pp.doc).toBe("Run the simulation without DEMix.");
    expect(pp.params).toEqual([
      {
        name: "days",
        type: "int",
        default: "None",
        doc: "Number of days to simulate (None = entire period).",
      },
      {
        name: "zero_demands",
        type: "bool",
        default: "False",
        doc: "Zero the building demands so the loop has no load — used for network heat-loss characterisation.",
      },
      { name: "assets_off", type: "bool", default: "False", doc: "Force every ON_* signal to 0." },
    ]);
    expect(demix).toEqual({ name: "demix", doc: "Run DEMix only", params: [] });
    expect(coupled.params.map((p) => [p.name, p.default])).toEqual([
      ["days", "None"],
      ["resume", "None"],
      ["stop_after", "None"],
    ]);
    expect(coupled.params[1].doc).toBe("Path to an existing run folder to RESUME.");
  });

  it("handles Fire(function), Fire({...}) and a bare Fire()", () => {
    const fn = fireCliOf(
      "cli.py",
      'import fire\n\ndef main(path: str, n=3):\n    """Do it."""\n\nfire.Fire(main)\n',
    );
    expect(fn?.commands).toEqual([
      {
        name: "",
        doc: "Do it.",
        params: [
          { name: "path", type: "str" },
          { name: "n", default: "3" },
        ],
      },
    ]);
    const dict = fireCliOf(
      "c.py",
      'from fire import Fire\ndef a(x=1): ...\ndef b(): ...\nFire({"run-a": a, "b": b})\n',
    );
    expect(dict?.commands.map((c) => [c.name, c.params.length])).toEqual([
      ["run-a", 1],
      ["b", 0],
    ]);
    const bare = fireCliOf(
      "c.py",
      "import fire\ndef go(): ...\ndef _no(): ...\nif __name__ == '__main__':\n    fire.Fire()\n",
    );
    expect(bare?.commands.map((c) => c.name)).toEqual(["go"]);
    expect(fireCliOf("c.py", "def Fire(x): ...\nFire(1)\n")).toBeUndefined();
  });

  it("parses NumPy-style parameter sections too", () => {
    const doc = parseDocstring(
      "Summary line\ncontinued.\n\nParameters\n----------\nn : int\n    How many.\n",
    );
    expect(doc).toEqual({ summary: "Summary line continued.", args: { n: "How many." } });
  });

  it("lists the environment variables a project reads, with literal defaults", () => {
    const env = envNamesOf([
      'x = os.getenv("PARIS_PIPE_SECTIONS", "10")\ny = os.environ["ARTELYS_LICENSE"]\nz = os.environ.get("PARIS_TMAX_BET")\nw = os.getenv("PARIS_RESOL_S", str(300))',
    ]);
    expect(env).toEqual([
      { name: "ARTELYS_LICENSE", default: undefined },
      { name: "PARIS_PIPE_SECTIONS", default: "10" },
      { name: "PARIS_RESOL_S", default: undefined },
      { name: "PARIS_TMAX_BET", default: undefined },
    ]);
  });
});

describe("Fire arguments <-> command and option values", () => {
  it("reads flags in every Fire spelling", () => {
    expect(
      parseFireArgs("coupled --days 3 --resume=results/run_1 --stop-after=-1 -v", cli),
    ).toEqual({
      command: "coupled",
      values: { days: "3", resume: "results/run_1", stop_after: "-1" },
      rest: ["-v"],
    });
    expect(parseFireArgs("pp --zero_demands --noassets_off", cli).values).toEqual({
      zero_demands: true,
      assets_off: false,
    });
    expect(parseFireArgs("pp 2", cli).values).toEqual({ days: "2" });
    expect(parseFireArgs("", cli)).toEqual({ command: "", values: {}, rest: [] });
    expect(parseFireArgs("nope --x", cli)).toEqual({
      command: "",
      values: {},
      rest: ["nope", "--x"],
    });
  });

  it("writes only what differs from the defaults", () => {
    expect(
      buildFireArgs(
        { command: "pp", values: { days: "7", zero_demands: true, assets_off: false }, rest: [] },
        cli,
      ),
    ).toEqual(["pp", "--days", "7", "--zero_demands"]);
    expect(
      buildFireArgs({ command: "coupled", values: { days: "-1" }, rest: ["--", "--help"] }, cli),
    ).toEqual(["coupled", "--days=-1", "--", "--help"]);
    const round = "coupled --days 3 --resume 'results/run 1'";
    expect(fireArgsString(parseFireArgs(round, cli), cli)).toBe(round);
  });

  it("resolves a configuration's program to a workspace path", () => {
    expect(programKey("main.py", "")).toBe("main.py");
    expect(programKey("main.py", "${workspaceFolder}")).toBe("main.py");
    expect(programKey("../main.py", "${workspaceFolder}/sub")).toBe("main.py");
    expect(programKey("${workspaceFolder}/a/./b.py", "/elsewhere")).toBe("a/b.py");
    expect(programKey("run.py", "/abs/dir")).toBeUndefined();
    expect(programKey("${file}", "")).toBeUndefined();
  });
});

describe("Fire suggestions", () => {
  it("suggests one configuration per command instead of a bare 'Run main.py'", () => {
    const scan: Scan = {
      texts: new Map([["main.py", PARIS]]),
      exists: new Set(["main.py", ".venv/bin/python"]),
    };
    const s = suggest(scan).filter((x) => x.group === "Commands");
    expect(s.map((x) => x.model.name)).toEqual([
      "pp (main.py)",
      "demix (main.py)",
      "coupled (main.py)",
    ]);
    expect(s[0].model).toMatchObject({
      kind: "python-file",
      program: "${workspaceFolder}/main.py",
      args: "pp",
      python: "${workspaceFolder}/.venv/bin/python",
    });
    expect(s[0].detail).toBe(
      "Run the simulation without DEMix. · options: --days --zero_demands --assets_off",
    );
    expect(suggest(scan).some((x) => x.model.name === "Run main.py")).toBe(false);
  });
});
