// The fields of the form for each kind of configuration.
import type { Hints, PickField } from "../shared/messages";
import type { FormModel } from "../shared/model";
import { h, icon, uid } from "./dom";
import { envTable, members } from "./widgets";
import { fireBlock } from "./fireFields";
import type { FireCli } from "../shared/fire";

export interface FieldContext {
  model: FormModel;
  hints: Hints;
  tasks: string[];
  memberChoices: string[];
  /** The Fire CLI of the selected program, when it is one. */
  fire?: FireCli;
  /** Updates one field of the model (the form re-validates and refreshes the preview). */
  set<K extends keyof FormModel>(field: K, value: FormModel[K]): void;
  pick(field: PickField): void;
  /** Inputs and error slots by field, so values and messages update without a re-render. */
  inputs: Map<string, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>;
  errors: Map<string, HTMLElement>;
}

type TextField =
  | "program"
  | "module"
  | "args"
  | "cwd"
  | "python"
  | "envFile"
  | "app"
  | "host"
  | "port"
  | "portEnv"
  | "script"
  | "url"
  | "webRoot"
  | "preLaunchTask"
  | "name";

interface TextOptions {
  help?: string;
  placeholder?: string;
  suggestions?: string[];
  pick?: PickField;
  mono?: boolean;
}

function datalist(id: string, values: string[]): HTMLDataListElement {
  return h("datalist", { id }, ...values.map((v) => h("option", { value: v })));
}

export function text(
  ctx: FieldContext,
  field: TextField,
  label: string,
  o: TextOptions = {},
): HTMLElement {
  const id = uid(field);
  const listId = o.suggestions?.length ? `${id}-list` : undefined;
  const input = h("input", {
    id,
    type: "text",
    value: ctx.model[field],
    placeholder: o.placeholder,
    list: listId,
    spellcheck: "false",
    class: o.mono ? "mono" : undefined,
    "data-field": field,
    oninput: (e) => ctx.set(field, (e.target as HTMLInputElement).value),
  });
  ctx.inputs.set(field, input);
  const error = h("div", { class: "error", role: "alert" });
  ctx.errors.set(field, error);
  const browse =
    o.pick &&
    h(
      "button",
      { type: "button", class: "secondary", title: "Browse…", onclick: () => ctx.pick(o.pick!) },
      icon("folder-opened"),
      " Browse…",
    );
  return h(
    "div",
    { class: "field" },
    h("label", { for: id }, label),
    h("div", { class: "row" }, input, browse),
    listId && datalist(listId, o.suggestions!),
    o.help && h("div", { class: "help" }, o.help),
    error,
  );
}

export function check(
  ctx: FieldContext,
  field: "justMyCode" | "reload" | "stopAll" | "strictPort",
  label: string,
  help?: string,
): HTMLElement {
  const id = uid(field);
  return h(
    "div",
    { class: "field check" },
    h("input", {
      id,
      type: "checkbox",
      checked: ctx.model[field],
      "data-field": field,
      onchange: (e) => ctx.set(field, (e.target as HTMLInputElement).checked),
    }),
    h("label", { for: id }, label),
    help && h("div", { class: "help" }, help),
  );
}

export function select<K extends "console" | "packageManager" | "browser">(
  ctx: FieldContext,
  field: K,
  label: string,
  options: [FormModel[K], string][],
): HTMLElement {
  const id = uid(field);
  const el = h(
    "select",
    {
      id,
      "data-field": field,
      onchange: (e) => ctx.set(field, (e.target as HTMLSelectElement).value as FormModel[K]),
    },
    ...options.map(([value, text]) =>
      h("option", { value, selected: ctx.model[field] === value }, text),
    ),
  );
  ctx.inputs.set(field, el);
  return h("div", { class: "field" }, h("label", { for: id }, label), el);
}

const PYTHON_HELP =
  "Leave empty to use the interpreter selected in VS Code (bottom-right of the status bar).";
const CWD_HELP = "${workspaceFolder} is the folder open in VS Code.";
const ARGS_HELP = 'Typed like in a terminal: quote values with spaces, e.g. --name "my study".';

function pythonCommon(ctx: FieldContext): HTMLElement[] {
  return [
    text(ctx, "cwd", "Run in folder", { pick: "cwd", help: CWD_HELP, mono: true }),
    text(ctx, "python", "Python interpreter", {
      pick: "python",
      suggestions: ctx.hints.pythons,
      help: PYTHON_HELP,
      mono: true,
      placeholder: "selected interpreter",
    }),
    text(ctx, "envFile", "Environment file", {
      pick: "envFile",
      mono: true,
      placeholder: "${workspaceFolder}/.env (default)",
      help: "A file of KEY=value lines loaded before the start.",
    }),
    envTable(ctx),
  ];
}

/** The "what to run" block, then the "where / with what" block, per kind. */
export function kindFields(ctx: FieldContext): {
  main: HTMLElement[];
  context: HTMLElement[];
  advanced: HTMLElement[];
} {
  const m = ctx.model;
  const task = text(ctx, "preLaunchTask", "Task to run first", {
    suggestions: ctx.tasks,
    help: "A task from tasks.json (or a detected one) that runs before the start, e.g. a build.",
  });
  const debugOptions = [
    check(
      ctx,
      "justMyCode",
      "Only step through my code",
      "Untick to step into installed libraries (pandas, pandapower…).",
    ),
    select(ctx, "console", "Output goes to", [
      ["integratedTerminal", "Integrated terminal (can read input)"],
      ["internalConsole", "Debug console"],
      ["externalTerminal", "External terminal"],
    ]),
    task,
  ];
  switch (m.kind) {
    case "python-file":
      return {
        main: [
          text(ctx, "program", "Python file", {
            pick: "program",
            suggestions: ctx.hints.programs,
            mono: true,
            help: ctx.fire
              ? "A Python Fire command line: pick the command and its options below."
              : "${file} = the file open in the editor when you start.",
          }),
          ctx.fire
            ? fireBlock(ctx, ctx.fire)
            : text(ctx, "args", "Arguments", { mono: true, help: ARGS_HELP }),
        ],
        context: pythonCommon(ctx),
        advanced: debugOptions,
      };
    case "python-module":
      return {
        main: [
          text(ctx, "module", "Module", {
            suggestions: ctx.hints.modules,
            mono: true,
            placeholder: "mypackage.cli",
            help: "Runs python -m <module> (like a package's __main__.py).",
          }),
          text(ctx, "args", "Arguments", { mono: true, help: ARGS_HELP }),
        ],
        context: pythonCommon(ctx),
        advanced: debugOptions,
      };
    case "fastapi":
      return {
        main: [
          text(ctx, "app", "App", {
            suggestions: ctx.hints.apps,
            mono: true,
            placeholder: "app.main:app",
            help: "module:variable, relative to the folder below. Started with uvicorn.",
          }),
          h(
            "div",
            { class: "row two" },
            text(ctx, "port", "Port", {
              placeholder: "8000",
              help: "With a variable below: the port used when the variable is not set.",
            }),
            text(ctx, "host", "Host", {
              placeholder: "127.0.0.1",
              help: "0.0.0.0 to reach it from other machines.",
            }),
          ),
          text(ctx, "portEnv", "Port from environment variable (optional)", {
            mono: true,
            placeholder: "BACKEND_PORT",
            suggestions: ctx.hints.envNames.map((e) => e.name).filter((n) => /PORT/i.test(n)),
            help: "Name of the variable that holds the port, read from the environment or from the env file below.",
          }),
          check(ctx, "reload", "Restart on code changes (--reload)"),
          text(ctx, "args", "More uvicorn options", {
            mono: true,
            placeholder: "--log-level debug",
          }),
        ],
        context: pythonCommon(ctx),
        advanced: debugOptions,
      };
    case "pytest":
      return {
        main: [
          text(ctx, "args", "Tests and options", {
            mono: true,
            placeholder: "tests/test_api.py -k study -x",
            suggestions: ["${file}", "tests", "-x", "-k "],
            help: "Empty = every test. ${file} = the open file. -k <words> picks tests by name, -x stops at the first failure.",
          }),
        ],
        context: pythonCommon(ctx),
        advanced: debugOptions,
      };
    case "npm-script":
      return {
        main: [
          h(
            "div",
            { class: "row two" },
            select(ctx, "packageManager", "Package manager", [
              ["npm", "npm"],
              ["pnpm", "pnpm"],
              ["yarn", "yarn"],
              ["bun", "bun"],
            ]),
            text(ctx, "script", "Script", {
              suggestions: ctx.hints.scripts,
              mono: true,
              help: 'A name from "scripts" in package.json.',
            }),
          ),
          text(ctx, "args", "Arguments for the script", { mono: true, placeholder: "--port 5174" }),
        ],
        context: [
          text(ctx, "cwd", "Run in folder", {
            pick: "cwd",
            mono: true,
            help: "The folder holding package.json.",
          }),
          envTable(ctx),
        ],
        advanced: [task],
      };
    case "vite":
      return {
        main: [
          h(
            "div",
            { class: "row two" },
            text(ctx, "port", "Port", {
              placeholder: "from vite.config",
              help: "Empty = the port of vite.config. With a variable below: the port used when it is not set.",
            }),
            text(ctx, "host", "Host", {
              placeholder: "localhost",
              help: "0.0.0.0 to reach it from other machines.",
            }),
          ),
          text(ctx, "portEnv", "Port from environment variable (optional)", {
            mono: true,
            placeholder: "FRONTEND_PORT",
            suggestions: ctx.hints.envNames.map((e) => e.name).filter((n) => /PORT/i.test(n)),
            help: "Name of the variable that holds the port. The environment wins over the file.",
          }),
          text(ctx, "envFile", "Environment file to read it from (optional)", {
            pick: "envFile",
            mono: true,
            placeholder: "${workspaceFolder}/.env",
            help: "Only this one variable is read from the file (bash / zsh terminals).",
          }),
          check(ctx, "strictPort", "Fail if the port is taken (--strictPort)"),
          select(ctx, "packageManager", "Package manager", [
            ["npm", "npm (npx)"],
            ["pnpm", "pnpm (exec)"],
            ["yarn", "yarn"],
            ["bun", "bun (bunx)"],
          ]),
          text(ctx, "args", "More vite options", { mono: true, placeholder: "--mode staging" }),
        ],
        context: [
          text(ctx, "cwd", "Run in folder", {
            pick: "cwd",
            mono: true,
            help: "The folder holding vite.config and package.json.",
          }),
          envTable(ctx),
        ],
        advanced: [task],
      };
    case "browser":
      return {
        main: [
          text(ctx, "url", "Page address", {
            suggestions: ctx.hints.urls,
            mono: true,
            help: "Start the dev server first (or together, with a 'Start together' configuration).",
          }),
          select(ctx, "browser", "Browser", [
            ["chrome", "Chrome"],
            ["msedge", "Edge"],
          ]),
        ],
        context: [
          text(ctx, "webRoot", "Source folder", {
            pick: "webRoot",
            mono: true,
            help: "Where the page's sources live, so breakpoints in .vue / .ts files bind.",
          }),
        ],
        advanced: [task],
      };
    case "compound":
      return {
        main: [members(ctx), check(ctx, "stopAll", "Stop them all when one stops")],
        context: [],
        advanced: [task],
      };
    default: {
      const id = uid("json");
      const area = h("textarea", {
        id,
        class: "mono",
        rows: 16,
        spellcheck: "false",
        "data-field": "json",
        oninput: (e) => ctx.set("json", (e.target as HTMLTextAreaElement).value),
      });
      area.value = m.json;
      ctx.inputs.set("json", area);
      const error = h("div", { class: "error", role: "alert" });
      ctx.errors.set("json", error);
      return {
        main: [
          h(
            "div",
            { class: "field" },
            h("label", { for: id }, "launch.json entry"),
            area,
            h(
              "div",
              { class: "help" },
              "For debugger types the form does not cover (attach, Node, Docker…). The name above wins over the one in the JSON.",
            ),
            error,
          ),
        ],
        context: [],
        advanced: [],
      };
    }
  }
}
