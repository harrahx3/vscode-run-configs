// The configuration form: state, rendering, live preview and messages to the extension.
import type { Hints, HostMessage, InitMessage, SaveThen, WebviewMessage } from "../shared/messages";
import { programKey, type FireCli } from "../shared/fire";
import { KINDS, toLaunch, validate, type FormModel } from "../shared/model";
import { templateEntry, type Template } from "../shared/templates";
import { h, icon, uid } from "./dom";
import { kindFields, text, type FieldContext } from "./fields";

declare function acquireVsCodeApi(): { postMessage(m: WebviewMessage): void };
const vscode = acquireVsCodeApi();
const send = (m: WebviewMessage) => vscode.postMessage(m);

interface State extends Omit<InitMessage, "type"> {
  hints: Hints;
  tasks: string[];
  /** Errors show once the user tried to save (or edited a field after that). */
  tried: boolean;
  /** The name follows the fields until the user types one. */
  nameTouched: boolean;
  saving: boolean;
  advancedOpen: boolean;
  /** The template the form was filled from, shown as the selected tile. */
  template?: Template;
}

const NO_HINTS: Hints = {
  programs: [],
  modules: [],
  apps: [],
  scripts: [],
  urls: [],
  pythons: [],
  fire: [],
  envNames: [],
};

/** The Fire CLI behind a python-file configuration's program, if the scan found one. */
function fireOf(s: State): FireCli | undefined {
  if (s.model.kind !== "python-file") return undefined;
  const key = programKey(s.model.program, s.model.cwd);
  return key === undefined ? undefined : s.hints.fire.find((c) => c.file === key);
}
let state: State | undefined;
let ctx: FieldContext | undefined;
const app = document.getElementById("app")!;

/** A name derived from the fields, for new configurations. */
export function autoName(m: FormModel): string {
  const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);
  switch (m.kind) {
    case "python-file":
      return m.program === "${file}"
        ? "Python: current file"
        : m.program
          ? `Run ${base(m.program)}`
          : "";
    case "python-module":
      return m.module ? `python -m ${m.module}` : "";
    case "fastapi":
      return m.app ? `FastAPI ${m.app}` : "";
    case "pytest":
      return m.args.trim() ? `Tests ${m.args.trim()}` : "Tests";
    case "npm-script":
      return m.script ? `${m.packageManager} ${m.script}` : "";
    case "vite":
      return m.port ? `Vite :${m.port}` : "Vite";
    case "browser":
      return m.url ? `Browser ${m.url.replace(/^https?:\/\//, "")}` : "";
    case "compound":
      return m.members.join(" + ");
    default:
      return "";
  }
}

function errorsOf(s: State): Record<string, string> {
  return validate(s.model, s.otherNames);
}

function showErrors(): void {
  if (!state || !ctx) return;
  const errors = state.tried ? errorsOf(state) : {};
  for (const [field, el] of ctx.errors) el.textContent = errors[field] ?? "";
  for (const [field, el] of ctx.inputs) el.toggleAttribute("aria-invalid", !!errors[field]);
}

function updatePreview(): void {
  const pre = document.getElementById("preview");
  if (!state || !pre) return;
  try {
    const { section, entry } = toLaunch(state.model, state.original, state.originalSection);
    pre.textContent = `"${section}": [\n  ${JSON.stringify(entry, null, 2).replace(/\n/g, "\n  ")}\n]`;
  } catch (err) {
    pre.textContent = (err as Error).message;
  }
}

function setStatus(message: string, kind: "ok" | "error" | "" = ""): void {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = message;
  el.className = kind;
}

function set<K extends keyof FormModel>(field: K, value: FormModel[K]): void {
  if (!state) return;
  state.model[field] = value;
  if (field === "name") state.nameTouched = true;
  if (field !== "name" && state.isNew && !state.nameTouched) {
    state.model.name = autoName(state.model);
    const nameInput = ctx?.inputs.get("name");
    if (nameInput) nameInput.value = state.model.name;
  }
  if (field === "kind") render();
  else if ((field === "program" || field === "cwd") && fireOf(state) !== ctx?.fire) render();
  setStatus("");
  showErrors();
  updatePreview();
}

function saveTemplate(): void {
  if (!state) return;
  state.tried = true;
  showErrors();
  const errors = errorsOf(state);
  if (Object.keys(errors).length) {
    setStatus("Fix the highlighted fields first.", "error");
    return;
  }
  send({ type: "saveTemplate", model: state.model });
}

function save(then: SaveThen): void {
  if (!state || state.saving) return;
  state.tried = true;
  showErrors();
  const errors = errorsOf(state);
  if (Object.keys(errors).length) {
    setStatus("Fix the highlighted fields first.", "error");
    document.querySelector<HTMLElement>("[aria-invalid]")?.focus();
    return;
  }
  state.saving = true;
  setStatus("Saving…");
  send({ type: "save", model: state.model, then });
}

/** A template tile: the JSON editor opens with the template's entry. */
function applyTemplate(t: Template): void {
  if (!state) return;
  state.template = t;
  state.model.json = JSON.stringify(templateEntry(t), null, 2);
  set("kind", "custom");
  // The name follows the fields until typed; for a template it starts as the template's label.
  if (state.isNew && !state.nameTouched) {
    state.model.name = t.label;
    const nameInput = ctx?.inputs.get("name");
    if (nameInput) nameInput.value = t.label;
    updatePreview();
  }
}

function kindPicker(s: State): HTMLElement {
  const error = h("div", { class: "error", role: "alert" });
  ctx?.errors.set("kind", error);
  return h(
    "div",
    {},
    h(
      "div",
      { class: "kinds", role: "radiogroup", "aria-label": "What do you want to run?" },
      ...KINDS.filter((k) => !s.hiddenKinds.includes(k.kind) || k.kind === s.model.kind).map((k) =>
        h(
          "button",
          {
            type: "button",
            class: "kind",
            role: "radio",
            "aria-checked": String(s.model.kind === k.kind && !s.template),
            "data-kind": k.kind,
            onclick: () => {
              if (s.model.kind === k.kind && !s.template) return;
              s.template = undefined;
              set("kind", k.kind);
            },
          },
          icon(k.icon),
          h("span", { class: "kind-label" }, k.label),
          h("span", { class: "kind-hint" }, k.hint),
        ),
      ),
      ...s.templates.map((t, i) =>
        h(
          "button",
          {
            type: "button",
            class: "kind",
            role: "radio",
            "aria-checked": String(s.template?.label === t.label && s.model.kind === "custom"),
            "data-template": String(i),
            onclick: () => applyTemplate(t),
          },
          icon(t.icon),
          h("span", { class: "kind-label" }, t.label),
          h("span", { class: "kind-hint" }, t.hint),
        ),
      ),
    ),
    error,
  );
}

function section(title: string, children: HTMLElement[]): HTMLElement | null {
  return children.length ? h("section", {}, h("h2", {}, title), ...children) : null;
}

function render(): void {
  if (!state) return;
  const s = state;
  // Keep the caret where it was (suggestions arrive while the user may be typing).
  const active = document.activeElement as HTMLInputElement | null;
  const focused =
    active?.dataset?.field ?? (active?.dataset?.fire && `fire:${active.dataset.fire}`);
  const caret = active && "selectionStart" in active ? active.selectionStart : null;
  ctx = {
    model: s.model,
    hints: s.hints,
    tasks: s.tasks,
    memberChoices: s.memberChoices,
    fire: fireOf(s),
    set,
    pick: (field) => send({ type: "pick", field }),
    inputs: new Map(),
    errors: new Map(),
  };
  const fields = kindFields(ctx);
  const advancedId = uid("advanced");
  const parts: (HTMLElement | null)[] = [
    h(
      "header",
      {},
      h("h1", {}, s.isNew ? "New run configuration" : `Edit “${s.original?.name ?? s.model.name}”`),
      h("span", { class: "folder" }, icon("folder"), ` ${s.folderName} · .vscode/launch.json`),
    ),
    h("section", {}, h("h2", {}, "What do you want to run?"), kindPicker(s)),
    h(
      "section",
      {},
      text(ctx, "name", "Name", {
        help: "Shown in the side panel and in VS Code's Run and Debug list.",
      }),
      ...fields.main,
    ),
    section("Where and with what", fields.context),
    fields.advanced.length
      ? h(
          "details",
          {
            class: "advanced",
            id: advancedId,
            open: s.advancedOpen,
            ontoggle: (e) => (s.advancedOpen = (e.target as HTMLDetailsElement).open),
          },
          h("summary", {}, "More options"),
          ...fields.advanced,
        )
      : null,
    h(
      "details",
      { class: "preview" },
      h("summary", {}, "What will be written to launch.json"),
      h("pre", { id: "preview", class: "mono" }),
      !s.isNew &&
        h(
          "button",
          { type: "button", class: "link", onclick: () => send({ type: "openJson" }) },
          icon("go-to-file"),
          " Show it in launch.json",
        ),
    ),
    h(
      "footer",
      {},
      h("span", { id: "status", role: "status" }),
      h(
        "button",
        {
          type: "button",
          class: "secondary",
          "data-action": "template",
          title: "Keep this configuration as a tile under “What do you want to run?”",
          onclick: saveTemplate,
        },
        icon("save-as"),
        " Save as Template…",
      ),
      h(
        "button",
        { type: "button", class: "secondary", onclick: () => send({ type: "close" }) },
        "Close",
      ),
      h(
        "button",
        { type: "button", class: "secondary", "data-action": "save", onclick: () => save("none") },
        "Save",
      ),
      h(
        "button",
        {
          type: "button",
          class: "secondary",
          "data-action": "run",
          title: "Save, then start without the debugger",
          onclick: () => save("run"),
        },
        icon("play"),
        " Save & Run",
      ),
      h(
        "button",
        {
          type: "button",
          "data-action": "debug",
          title: "Save, then start with the debugger",
          onclick: () => save("debug"),
        },
        icon("debug-alt"),
        " Save & Debug",
      ),
    ),
  ];
  app.replaceChildren(...parts.filter((p): p is HTMLElement => p !== null));
  showErrors();
  updatePreview();
  if (focused) {
    const el = app.querySelector<HTMLInputElement>(
      focused.startsWith("fire:")
        ? `[data-fire="${focused.slice(5)}"]`
        : `[data-field="${focused}"]`,
    );
    el?.focus();
    if (el && caret !== null && "setSelectionRange" in el && el.type === "text")
      el.setSelectionRange(caret, caret);
  }
}

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  const m = event.data;
  switch (m.type) {
    case "init": {
      const { type: _, ...init } = m;
      state = {
        ...init,
        hints: NO_HINTS,
        tasks: [],
        tried: false,
        nameTouched: !init.isNew || !!init.model.name,
        saving: false,
        advancedOpen: false,
      };
      render();
      if (init.isNew) (ctx?.inputs.get("name") as HTMLInputElement | undefined)?.focus();
      break;
    }
    case "hints":
      if (!state) return;
      state.hints = m.hints;
      state.tasks = m.tasks;
      // Re-render keeps the model; only the suggestion lists change.
      render();
      break;
    case "templates":
      if (!state) return;
      state.templates = m.templates;
      state.hiddenKinds = m.hiddenKinds;
      render();
      break;
    case "templateSaved":
      setStatus("Template saved ✓", "ok");
      break;
    case "picked":
      if (!state) return;
      set(m.field, m.value);
      {
        const input = ctx?.inputs.get(m.field);
        if (input) input.value = m.value;
      }
      break;
    case "saved":
      if (!state) return;
      state.saving = false;
      state.isNew = false;
      state.original = m.original;
      state.originalSection = m.originalSection;
      state.nameTouched = true;
      document.querySelector("header h1")!.textContent = `Edit “${m.model.name}”`;
      setStatus("Saved ✓", "ok");
      updatePreview();
      break;
    case "error":
      if (state) state.saving = false;
      setStatus(m.message, "error");
      break;
  }
});

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    save("none");
  }
});

send({ type: "ready" });
