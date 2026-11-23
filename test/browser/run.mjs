// Drives the real form bundle in headless Chromium with a fake VS Code host.
// Usage: npm run test:browser [-- --chromium=<path-to-chrome>]
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const shots = join(root, "test", "browser", "screenshots");
mkdirSync(shots, { recursive: true });

/** Chromium from --chromium=<path>, else the newest one in Playwright's browser cache. */
function chromiumPath() {
  const arg = process.argv.find((a) => a.startsWith("--chromium="));
  if (arg) return arg.slice("--chromium=".length);
  const cache = join(homedir(), ".cache", "ms-playwright");
  const dirs = existsSync(cache)
    ? readdirSync(cache)
        .filter((d) => /^chromium-\d+$/.test(d))
        .sort()
    : [];
  for (const d of dirs.reverse()) {
    const exe = join(cache, d, "chrome-linux64", "chrome");
    if (existsSync(exe)) return exe;
  }
  throw new Error(
    "No Chromium found: pass --chromium=<path> or run `npx playwright-core install chromium`.",
  );
}

// A subset of the Dark+ / Light+ theme variables VS Code injects into webviews.
const THEMES = {
  dark: `--vscode-editor-background:#1e1e1e; --vscode-foreground:#cccccc; --vscode-descriptionForeground:#9d9d9d;
    --vscode-font-family:system-ui,sans-serif; --vscode-font-size:13px; --vscode-sideBar-background:#252526;
    --vscode-input-background:#3c3c3c; --vscode-input-foreground:#cccccc; --vscode-dropdown-background:#3c3c3c;
    --vscode-dropdown-foreground:#f0f0f0; --vscode-button-background:#0e639c; --vscode-button-foreground:#fff;
    --vscode-button-hoverBackground:#1177bb; --vscode-button-secondaryBackground:#3a3d41;
    --vscode-button-secondaryForeground:#fff; --vscode-focusBorder:#007fd4; --vscode-panel-border:#80808059;
    --vscode-list-activeSelectionBackground:#04395e; --vscode-list-activeSelectionForeground:#fff;
    --vscode-list-hoverBackground:#2a2d2e; --vscode-textLink-foreground:#3794ff; --vscode-errorForeground:#f48771; --vscode-input-placeholderForeground:#a6a6a6;
    --vscode-textCodeBlock-background:#0a0a0a66; --vscode-editor-font-family:monospace;`,
  light: `--vscode-editor-background:#ffffff; --vscode-foreground:#616161; --vscode-descriptionForeground:#717171;
    --vscode-font-family:system-ui,sans-serif; --vscode-font-size:13px; --vscode-sideBar-background:#f3f3f3;
    --vscode-input-background:#fff; --vscode-input-foreground:#616161; --vscode-input-border:#cecece;
    --vscode-button-background:#007acc; --vscode-button-foreground:#fff; --vscode-button-secondaryBackground:#5f6a79;
    --vscode-button-secondaryForeground:#fff; --vscode-focusBorder:#0090f1; --vscode-panel-border:#80808059;
    --vscode-list-activeSelectionBackground:#0060c0; --vscode-list-activeSelectionForeground:#fff;
    --vscode-list-hoverBackground:#e8e8e8; --vscode-textLink-foreground:#006ab1; --vscode-errorForeground:#a1260d; --vscode-input-placeholderForeground:#767676;
    --vscode-editor-font-family:monospace;`,
};

function page(theme) {
  const js = readFileSync(join(root, "dist", "webview.js"), "utf8");
  const font = readFileSync(join(root, "dist", "codicon.ttf")).toString("base64");
  const css = readFileSync(join(root, "dist", "webview.css"), "utf8").replace(
    /url\("?\.\/codicon\.ttf[^)]*\)/,
    `url(data:font/ttf;base64,${font})`,
  );
  // Same policy as the real webview (src/extension/html.ts), assets inlined.
  const csp =
    "default-src 'none'; style-src 'unsafe-inline'; font-src data:; script-src 'nonce-test'";
  return `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}">
<style>html{${THEMES[theme]}}</style><style>${css}</style></head>
<body class="vscode-${theme}"><main id="app"></main>
  <script nonce="test">window.__sent=[];window.acquireVsCodeApi=()=>({postMessage:(m)=>window.__sent.push(m)});
    document.addEventListener("securitypolicyviolation", (e) => console.error("CSP violation: " + e.violatedDirective));</script>
  <script nonce="test">${js.replace(/<\/script/g, "<\\/script")}</script>
</body></html>`;
}

const browser = await chromium.launch({ executablePath: chromiumPath() });
let failures = 0;

async function scenario(name, fn, { theme = "dark", shot } = {}) {
  const p = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await p.setContent(page(theme));
  try {
    await fn(p);
    assert.deepEqual(errors, [], "no page errors");
    if (shot) await p.screenshot({ path: join(shots, `${shot}.png`), fullPage: true });
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.log(`  ✗ ${name}\n    ${e.message.split("\n").join("\n    ")}`);
    await p.screenshot({
      path: join(shots, `FAILED-${name.replace(/\W+/g, "_")}.png`),
      fullPage: true,
    });
  }
  await p.close();
}

// window.postMessage is delivered asynchronously: wait for the handler to have run.
const post = (p, message) =>
  p.evaluate(
    (m) =>
      new Promise((resolve) => {
        window.addEventListener("message", () => setTimeout(resolve, 0), { once: true });
        window.postMessage(m, "*");
      }),
    message,
  );
const sent = (p) => p.evaluate(() => window.__sent);
const field = (p, name) => p.locator(`[data-field="${name}"]`).first();
const preview = (p) => p.locator("#preview").textContent();

function emptyModel(kind) {
  return {
    kind,
    name: "",
    program: "",
    module: "",
    args: "",
    cwd: "${workspaceFolder}",
    python: "",
    envFile: "",
    env: [],
    justMyCode: true,
    console: "integratedTerminal",
    app: "",
    host: "",
    port: "",
    portEnv: "",
    strictPort: false,
    reload: true,
    packageManager: "npm",
    script: "dev",
    url: "http://localhost:5173",
    webRoot: "${workspaceFolder}",
    browser: "chrome",
    members: [],
    stopAll: true,
    preLaunchTask: "",
    json: "{}",
  };
}

const init = (model, extra = {}) => ({
  type: "init",
  model,
  folderName: "backend-api",
  otherNames: ["api"],
  memberChoices: ["api", "pnpm dev (web)"],
  isNew: true,
  templates: [],
  hiddenKinds: [],
  ...extra,
});
const HINTS = {
  type: "hints",
  hints: {
    programs: ["${workspaceFolder}/scripts/seed.py", "${file}"],
    modules: [],
    apps: ["app.main:app"],
    scripts: ["dev"],
    urls: [],
    pythons: ["${workspaceFolder}/.venv/bin/python"],
    fire: [],
    envNames: [],
  },
  tasks: ["build"],
};

// What the scan reports for paris_demo_site/main.py (`Fire(PdsCli)`).
const PARIS_CLI = {
  file: "main.py",
  commands: [
    {
      name: "pp",
      doc: "Run the pandaprosumer/pandapipes simulation without DEMix.",
      params: [
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
          doc: "Zero the building demands (heat-loss mode).",
        },
        {
          name: "assets_off",
          type: "bool",
          default: "False",
          doc: "Force every DEMix ON_* signal to 0.",
        },
      ],
    },
    { name: "demix", doc: "Run DEMix only", params: [] },
    {
      name: "coupled",
      doc: "Run the coupled pandaprosumer/pandapipes simulation with DEMix",
      params: [
        { name: "days", type: "int", default: "None", doc: "Number of days to simulate." },
        { name: "resume", default: "None", doc: "Path to an existing run folder to RESUME." },
        {
          name: "stop_after",
          type: "int",
          default: "None",
          doc: "Stop cleanly after this many iterations.",
        },
      ],
    },
  ],
};
const PARIS_HINTS = {
  ...HINTS,
  hints: {
    ...HINTS.hints,
    programs: ["${workspaceFolder}/main.py"],
    fire: [PARIS_CLI],
    envNames: [{ name: "PARIS_ACTIVE_WEEK" }, { name: "PARIS_PIPE_SECTIONS", default: "10" }],
  },
};

console.log("browser tests");

await scenario("a blank form selects no kind until one is chosen", async (p) => {
  await p.waitForFunction(() => window.__sent.some((m) => m.type === "ready"));
  await post(p, init(emptyModel("unset")));
  await post(p, HINTS);
  await p.locator(".kind").first().waitFor();
  assert.equal(await p.locator(".kind[aria-checked=true]").count(), 0);
  await p
    .locator("[data-action=save]")
    .first()
    .click()
    .catch(() => {});
  await p.locator(".error", { hasText: "Choose what you want to run" }).waitFor();
  assert.equal((await sent(p)).filter((m) => m.type === "save").length, 0);
  await p.locator(".kind", { hasText: "Vite dev server" }).click();
  await p.locator(".kind[aria-checked=true]", { hasText: "Vite dev server" }).waitFor();
});

await scenario(
  "new Python script: the name follows the file, Save & Debug sends the model",
  async (p) => {
    await p.waitForFunction(() => window.__sent.some((m) => m.type === "ready"));
    await post(p, init(emptyModel("python-file")));
    await post(p, HINTS);
    await p.locator(".kind[aria-checked=true]", { hasText: "Python script" }).waitFor();
    await field(p, "program").fill("${workspaceFolder}/scripts/seed.py");
    assert.equal(await field(p, "name").inputValue(), "Run seed.py");
    await field(p, "args").fill('--study "Milano demo" -v');
    await p.getByRole("button", { name: "Add variable" }).click();
    await p.getByLabel("Variable name").fill("LOG_LEVEL");
    await p.getByLabel("Value").fill("debug");
    const json = JSON.parse((await preview(p)).replace(/^"configurations": \[|\]$/g, ""));
    assert.deepEqual(json.args, ["--study", "Milano demo", "-v"]);
    assert.deepEqual(json.env, { LOG_LEVEL: "debug" });
    await p.locator(".preview summary").click();
    await p.locator("[data-action=debug]").click();
    const save = (await sent(p)).find((m) => m.type === "save");
    assert.equal(save.then, "debug");
    assert.equal(save.model.name, "Run seed.py");
    assert.equal(await p.locator("#status").textContent(), "Saving…");
    await post(p, {
      type: "saved",
      model: save.model,
      original: json,
      originalSection: "configurations",
    });
    assert.equal(await p.locator("#status").textContent(), "Saved ✓");
    assert.match(await p.locator("h1").textContent(), /Edit “Run seed.py”/);
  },
  { shot: "new-python-dark" },
);

await scenario(
  "nothing is saved while required fields are missing; errors appear on the fields",
  async (p) => {
    await post(p, init(emptyModel("fastapi")));
    await p.locator("[data-action=save]").click();
    assert.equal((await sent(p)).filter((m) => m.type === "save").length, 0);
    assert.match(
      await p.locator(".error", { hasText: "module:variable" }).textContent(),
      /app\.main:app/,
    );
    assert.equal(await field(p, "app").getAttribute("aria-invalid"), "");
    assert.match(await p.locator("#status").textContent(), /Fix the highlighted/);
    await field(p, "name").fill("api");
    assert.match(
      await p.locator(".error", { hasText: "already" }).textContent(),
      /already has this name/,
    );
    assert.equal(await p.locator("#status").textContent(), "", "editing clears the status");
  },
  { shot: "errors-dark" },
);

const BACKEND = {
  name: "Debug FastAPI",
  type: "debugpy",
  request: "launch",
  module: "uvicorn",
  args: ["app.main:app", "--reload"],
  cwd: "${workspaceFolder}",
  jinja: true,
  justMyCode: false,
  envFile: "${workspaceFolder}/.env",
};

await scenario(
  "editing the existing FastAPI entry keeps unknown keys and shows the port",
  async (p) => {
    const model = {
      ...emptyModel("fastapi"),
      name: "Debug FastAPI",
      app: "app.main:app",
      reload: true,
      justMyCode: false,
      envFile: BACKEND.envFile,
    };
    await post(
      p,
      init(model, { isNew: false, original: BACKEND, originalSection: "configurations" }),
    );
    await post(p, HINTS);
    assert.equal(await field(p, "app").inputValue(), "app.main:app");
    assert.equal(await field(p, "reload").isChecked(), true);
    await field(p, "port").fill("8001");
    assert.equal(
      await field(p, "name").inputValue(),
      "Debug FastAPI",
      "name of an existing entry is kept",
    );
    const text = await preview(p);
    assert.match(text, /"--port",\s*"8001"/);
    assert.match(text, /"jinja": true/);
    await p.locator(".advanced summary").click();
    assert.equal(await field(p, "justMyCode").isChecked(), false);
    await p.locator(".preview summary").click();
    assert.equal(await p.getByRole("button", { name: "Show it in launch.json" }).count(), 1);
  },
  { theme: "light", shot: "edit-fastapi-light" },
);

await scenario(
  "switching to 'Start together' lists the other configurations",
  async (p) => {
    await post(p, init(emptyModel("python-file")));
    await p.locator("[data-kind=compound]").click();
    await p.locator('[data-member="api"]').check();
    await p.locator('[data-member="pnpm dev (web)"]').check();
    assert.equal(await field(p, "name").inputValue(), "api + pnpm dev (web)");
    assert.match(await preview(p), /^"compounds": \[/);
    assert.match(await preview(p), /"stopAll": true/);
  },
  { shot: "compound-dark" },
);

await scenario("pasting KEY=value lines fills several variables", async (p) => {
  await post(p, init(emptyModel("python-module")));
  await p.getByRole("button", { name: "Add variable" }).click();
  await p.getByLabel("Variable name").focus();
  await p.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text", "# comment\nexport A=1\nB='two words'\n");
    document.activeElement.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  assert.equal(await p.getByLabel("Variable name").count(), 2);
  assert.match(await preview(p), /"A": "1",\s*"B": "two words"/);
});

await scenario("a picked file lands in its field", async (p) => {
  await post(p, init(emptyModel("python-file")));
  await p.getByRole("button", { name: "Browse…" }).first().click();
  assert.deepEqual((await sent(p)).at(-1), { type: "pick", field: "program" });
  await post(p, { type: "picked", field: "program", value: "${workspaceFolder}/run.py" });
  assert.equal(await field(p, "program").inputValue(), "${workspaceFolder}/run.py");
  assert.equal(await field(p, "name").inputValue(), "Run run.py");
});

await scenario(
  "other debugger types are edited as JSON, with JSON errors shown",
  async (p) => {
    const original = {
      name: "Attach",
      type: "debugpy",
      request: "attach",
      connect: { port: 5678 },
    };
    const model = {
      ...emptyModel("custom"),
      name: "Attach",
      json: JSON.stringify(original, null, 2),
    };
    await post(p, init(model, { isNew: false, original, originalSection: "configurations" }));
    await field(p, "json").fill('{ "type": "node", ');
    await p.locator("[data-action=save]").click();
    assert.match(
      await p.locator(".error", { hasText: "Invalid JSON" }).textContent(),
      /Invalid JSON/,
    );
    await field(p, "json").fill('{ "type": "node", "request": "attach", "port": 9229 }');
    await p.locator("[data-action=run]").click();
    const save = (await sent(p)).find((m) => m.type === "save");
    assert.equal(save.then, "run");
  },
  { theme: "light", shot: "custom-light" },
);

await scenario(
  "a Fire CLI shows its commands and options, in sync with the arguments",
  async (p) => {
    // The paris_demo_site entry as found on disk: relative program, args as a string.
    const original = {
      name: "Python Debugger: coupled",
      type: "debugpy",
      request: "launch",
      program: "main.py",
      console: "integratedTerminal",
      args: "coupled",
      justMyCode: false,
    };
    const model = {
      ...emptyModel("python-file"),
      name: original.name,
      program: "main.py",
      args: "coupled",
      justMyCode: false,
    };
    await post(p, init(model, { isNew: false, original, originalSection: "configurations" }));
    assert.equal(await p.locator("fieldset.fire").count(), 0, "no Fire block before the scan");
    await post(p, PARIS_HINTS);
    assert.equal(await p.locator("[data-fire=command]").inputValue(), "coupled");
    await p.locator("[data-fire=days]").fill("2");
    await p.locator("[data-fire=resume]").fill("results/run 1");
    assert.equal(await p.locator("[data-fire=resume]").getAttribute("placeholder"), "not set");
    let json = JSON.parse((await preview(p)).replace(/^"configurations": \[|\]$/g, ""));
    assert.deepEqual(json.args, ["coupled", "--days", "2", "--resume", "results/run 1"]);
    // Switching command keeps the options both share, drops the others.
    await p.locator("[data-fire=command]").selectOption("pp");
    await p.locator("[data-fire=zero_demands]").check();
    json = JSON.parse((await preview(p)).replace(/^"configurations": \[|\]$/g, ""));
    assert.deepEqual(json.args, ["pp", "--days", "2", "--zero_demands"]);
    // A known environment variable shows its default.
    await p.getByRole("button", { name: "Add variable" }).click();
    await p.getByLabel("Variable name").fill("PARIS_PIPE_SECTIONS");
    assert.equal(await p.getByLabel("Value").getAttribute("placeholder"), "default: 10");
    assert.match(
      await p.locator(".help", { hasText: "The project reads 2 variables" }).textContent(),
      /pick one/,
    );
    assert.doesNotMatch(
      await preview(p),
      /PARIS_PIPE_SECTIONS/,
      "a variable without a value is not set",
    );
    await p.getByLabel("Value").fill("20");
    assert.match(await preview(p), /"PARIS_PIPE_SECTIONS": "20"/);
    await p.locator(".preview summary").click();
  },
  { shot: "fire-dark" },
);

await scenario(
  "picking another file hides the Fire block, picking main.py brings it back",
  async (p) => {
    await post(p, init(emptyModel("python-file")));
    await post(p, PARIS_HINTS);
    await field(p, "program").fill("${workspaceFolder}/main.py");
    await p.locator("fieldset.fire").waitFor();
    assert.equal(
      await p.locator("[data-fire=command] option:checked").textContent(),
      "— choose a command —",
    );
    await p.locator("[data-fire=command]").selectOption("demix");
    assert.equal(await p.locator(".fire .help", { hasText: "no options" }).count(), 1);
    assert.equal(await field(p, "name").inputValue(), "Run main.py");
    await field(p, "program").fill("${workspaceFolder}/other.py");
    assert.equal(await p.locator("fieldset.fire").count(), 0);
    assert.equal(await field(p, "args").inputValue(), "demix", "arguments kept as typed");
  },
);

await scenario(
  "template tiles open the JSON editor with their entry; built-in tiles can be hidden",
  async (p) => {
    await p.waitForFunction(() => window.__sent.some((m) => m.type === "ready"));
    const go = {
      label: "Go",
      hint: "dlv debug",
      icon: "rocket",
      configuration: {
        type: "go",
        request: "launch",
        mode: "debug",
        program: "${workspaceFolder}",
      },
    };
    await post(p, init(emptyModel("unset"), { templates: [go], hiddenKinds: ["vite", "browser"] }));
    await p.locator(".kind").first().waitFor();
    assert.equal(await p.locator("[data-kind=vite]").count(), 0, "hidden tile");
    assert.equal(await p.locator("[data-kind=custom]").count(), 1, "JSON tile stays");
    await p.locator("[data-template='0']").click();
    await p.locator("[data-template='0'][aria-checked=true]").waitFor();
    assert.equal(await field(p, "name").inputValue(), "Go");
    assert.match(await preview(p), /"type": "go"/);
    assert.match(await preview(p), /"mode": "debug"/);
    await p.locator("[data-action=template]").click();
    assert.equal((await sent(p)).filter((m) => m.type === "saveTemplate").length, 1);
    await post(p, { type: "templates", templates: [], hiddenKinds: [] });
    await p.locator("[data-kind=vite]").waitFor();
    assert.equal(await p.locator("[data-template]").count(), 0, "template removed live");
  },
);

await browser.close();
if (failures) {
  console.log(`\n${failures} browser test(s) failed (screenshots in test/browser/screenshots/)`);
  process.exit(1);
}
console.log("\nall browser tests passed");
