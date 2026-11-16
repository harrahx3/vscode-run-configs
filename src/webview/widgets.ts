// Composite fields: the environment-variable table and the compound member list.
import type { EnvVar } from "../shared/model";
import { h, icon, uid } from "./dom";
import type { FieldContext } from "./fields";

/** Environment variables as editable rows; pasting `KEY=value` lines splits them. */
export function envTable(ctx: FieldContext): HTMLElement {
  const body = h("div", { class: "env-rows" });
  const error = h("div", { class: "error", role: "alert" });
  ctx.errors.set("env", error);
  const rows = () => ctx.model.env;
  // Names the project reads (os.getenv / os.environ), offered while typing a name.
  const known = new Map(ctx.hints.envNames.map((e) => [e.name, e.default]));
  const listId = uid("env-names");
  const list = h(
    "datalist",
    { id: listId },
    ...ctx.hints.envNames.map((e) =>
      h("option", { value: e.name }, e.default !== undefined ? `default: ${e.default}` : ""),
    ),
  );
  const valuePlaceholder = (key: string) => {
    const d = known.get(key.trim());
    return d !== undefined ? `default: ${d}` : "value";
  };
  const commit = (next: EnvVar[]) => {
    ctx.set("env", next);
    draw();
  };
  const draw = () => {
    body.replaceChildren(
      ...rows().map((row, i) =>
        h(
          "div",
          { class: "row env-row" },
          h("input", {
            type: "text",
            class: "mono",
            value: row.key,
            placeholder: "NAME",
            "aria-label": "Variable name",
            spellcheck: "false",
            list: listId,
            oninput: (e) => {
              const input = e.target as HTMLInputElement;
              const next = structuredClone(rows());
              next[i].key = input.value;
              ctx.set("env", next);
              const value =
                input.parentElement?.querySelector<HTMLInputElement>("[aria-label=Value]");
              if (value) value.placeholder = valuePlaceholder(input.value);
            },
            onpaste: (e) => {
              const pasted = (e as ClipboardEvent).clipboardData?.getData("text") ?? "";
              if (!pasted.includes("=")) return;
              e.preventDefault();
              const parsed = pasted
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter((l) => l && !l.startsWith("#") && l.includes("="))
                .map((l) => ({
                  key: l
                    .slice(0, l.indexOf("="))
                    .replace(/^export\s+/, "")
                    .trim(),
                  value: l.slice(l.indexOf("=") + 1).replace(/^(["'])(.*)\1$/, "$2"),
                }));
              const next = structuredClone(rows());
              next.splice(i, 1, ...parsed);
              commit(next);
            },
          }),
          h("span", { class: "eq" }, "="),
          h("input", {
            type: "text",
            class: "mono",
            value: row.value,
            placeholder: valuePlaceholder(row.key),
            "aria-label": "Value",
            spellcheck: "false",
            oninput: (e) => {
              const next = structuredClone(rows());
              next[i].value = (e.target as HTMLInputElement).value;
              ctx.set("env", next);
            },
          }),
          h(
            "button",
            {
              type: "button",
              class: "icon-button",
              title: "Remove",
              "aria-label": "Remove variable",
              onclick: () => commit(rows().filter((_, j) => j !== i)),
            },
            icon("close"),
          ),
        ),
      ),
    );
  };
  draw();
  return h(
    "div",
    { class: "field" },
    h("label", {}, "Environment variables"),
    body,
    h(
      "button",
      {
        type: "button",
        class: "secondary",
        onclick: () => commit([...rows(), { key: "", value: "" }]),
      },
      icon("add"),
      " Add variable",
    ),
    list,
    h(
      "div",
      { class: "help" },
      ctx.hints.envNames.length
        ? `The project reads ${ctx.hints.envNames.length} variables: type in a name box to pick one (its default shows in the value box). `
        : "",
      "A row left without a value is not set. Tip: paste several KEY=value lines into a name box to add them all.",
    ),
    error,
  );
}

export function members(ctx: FieldContext): HTMLElement {
  const error = h("div", { class: "error", role: "alert" });
  ctx.errors.set("members", error);
  const choices = ctx.memberChoices.filter((n) => n !== ctx.model.name.trim());
  const toggle = (name: string, on: boolean) => {
    const set = new Set(ctx.model.members);
    if (on) set.add(name);
    else set.delete(name);
    // Keep the order of the list (the start order).
    ctx.set(
      "members",
      [...choices, ...ctx.model.members].filter((n, i, all) => set.has(n) && all.indexOf(n) === i),
    );
  };
  return h(
    "div",
    { class: "field" },
    h("label", {}, "Configurations to start together"),
    choices.length
      ? h(
          "div",
          { class: "members" },
          ...choices.map((name) => {
            const id = uid("member");
            return h(
              "div",
              { class: "check" },
              h("input", {
                id,
                type: "checkbox",
                checked: ctx.model.members.includes(name),
                "data-member": name,
                onchange: (e) => toggle(name, (e.target as HTMLInputElement).checked),
              }),
              h("label", { for: id }, name),
            );
          }),
        )
      : h("div", { class: "help" }, "Create the configurations first; they will be listed here."),
    error,
  );
}
