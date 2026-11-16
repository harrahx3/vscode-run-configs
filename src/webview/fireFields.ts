// The Python Fire block of the form: a command picker and one field per option, kept in
// sync with the configuration's argument string.
import {
  fireArgsString,
  isBoolParam,
  parseFireArgs,
  type FireArgs,
  type FireCli,
  type FireParam,
} from "../shared/fire";
import { joinArgs, splitArgs } from "../shared/args";
import { h, icon, uid } from "./dom";
import type { FieldContext } from "./fields";

/** "None" / quotes are noise in a placeholder: show the default as a user would type it. */
function shownDefault(p: FireParam): string {
  const d = p.default;
  if (d === undefined) return "required";
  if (d === "None") return "not set";
  return d.replace(/^(["'])(.*)\1$/, "$2");
}

export function fireBlock(ctx: FieldContext, cli: FireCli): HTMLElement {
  let parsed: FireArgs = parseFireArgs(ctx.model.args, cli);
  const commit = (next: FireArgs, redraw = false) => {
    parsed = next;
    ctx.set("args", fireArgsString(parsed, cli));
    if (redraw) draw();
  };
  const body = h("div", { class: "fire-body" });

  const draw = () => {
    const command = cli.commands.find((c) => c.name === parsed.command);
    const named = cli.commands.filter((c) => c.name);
    const parts: HTMLElement[] = [];
    if (named.length) {
      const id = uid("fire-command");
      parts.push(
        h(
          "div",
          { class: "field" },
          h("label", { for: id }, "Command"),
          h(
            "select",
            {
              id,
              "data-fire": "command",
              onchange: (e) => {
                const name = (e.target as HTMLSelectElement).value;
                const params = cli.commands.find((c) => c.name === name)?.params ?? [];
                const keep = Object.fromEntries(
                  Object.entries(parsed.values).filter(([k]) => params.some((p) => p.name === k)),
                );
                commit({ command: name, values: keep, rest: parsed.rest }, true);
              },
            },
            !command ? h("option", { value: "", selected: true }, "— choose a command —") : null,
            ...named.map((c) =>
              h(
                "option",
                { value: c.name, selected: c.name === parsed.command },
                c.doc ? `${c.name} — ${c.doc}` : c.name,
              ),
            ),
          ),
          h("div", { class: "help" }, `Commands of the Fire CLI in ${cli.file}.`),
        ),
      );
    }
    if (command?.params.length) {
      const rows = command.params.map((p) => optionField(p));
      parts.push(h("div", { class: "fire-options" }, ...rows));
    } else if (command) {
      parts.push(h("div", { class: "help" }, "This command takes no options."));
    }
    const restId = uid("fire-rest");
    parts.push(
      h(
        "div",
        { class: "field" },
        h("label", { for: restId }, "Other arguments"),
        h("input", {
          id: restId,
          type: "text",
          class: "mono",
          spellcheck: "false",
          value: joinArgs(parsed.rest),
          "data-fire": "rest",
          placeholder: "e.g. -- --help",
          oninput: (e) =>
            commit({ ...parsed, rest: splitArgs((e.target as HTMLInputElement).value) }),
        }),
        h("div", { class: "help" }, "Anything else, passed as typed."),
      ),
    );
    body.replaceChildren(...parts);
  };

  const optionField = (p: FireParam): HTMLElement => {
    const id = uid(`fire-${p.name}`);
    const help = [p.doc, p.type && `Type: ${p.type}.`].filter(Boolean).join(" ");
    if (isBoolParam(p)) {
      const on = parsed.values[p.name] ?? p.default === "True";
      return h(
        "div",
        { class: "field check" },
        h("input", {
          id,
          type: "checkbox",
          checked: on === true,
          "data-fire": p.name,
          onchange: (e) =>
            commit({
              ...parsed,
              values: { ...parsed.values, [p.name]: (e.target as HTMLInputElement).checked },
            }),
        }),
        h("label", { for: id, class: "mono" }, `--${p.name}`),
        help && h("div", { class: "help" }, help),
      );
    }
    const value = parsed.values[p.name];
    return h(
      "div",
      { class: "field" },
      h("label", { for: id, class: "mono" }, `--${p.name}`),
      h("input", {
        id,
        type: "text",
        class: "mono",
        spellcheck: "false",
        value: typeof value === "string" ? value : "",
        placeholder: shownDefault(p),
        "data-fire": p.name,
        oninput: (e) => {
          const v = (e.target as HTMLInputElement).value;
          const values = { ...parsed.values };
          if (v.trim()) values[p.name] = v.trim();
          else delete values[p.name];
          commit({ ...parsed, values });
        },
      }),
      help && h("div", { class: "help" }, help),
    );
  };

  draw();
  return h(
    "fieldset",
    { class: "fire" },
    h("legend", {}, icon("terminal"), " Fire command line"),
    body,
  );
}
