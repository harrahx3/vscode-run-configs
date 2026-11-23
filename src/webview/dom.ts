// Tiny DOM helpers (no framework: the form is small and the bundle stays light).

type Child = Node | string | null | undefined | false;
type Props = Record<string, string | number | boolean | undefined | ((e: Event) => void)>;

/** `h("input", { type: "text", oninput: fn }, …children)`; `class` and `for` work as in HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (typeof value === "function") el.addEventListener(key.replace(/^on/, ""), value);
    else if (key === "value" && "value" in el) (el as HTMLInputElement).value = String(value);
    else if (key === "checked" && el instanceof HTMLInputElement) el.checked = Boolean(value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  // The page hides the webview's default Cut/Copy/Paste menu; text fields keep it.
  if ((tag === "input" || tag === "textarea") && !el.hasAttribute("data-vscode-context"))
    el.setAttribute(
      "data-vscode-context",
      JSON.stringify({ preventDefaultContextMenuItems: false }),
    );
  for (const child of children) if (child) el.append(child);
  return el;
}

export function icon(name: string): HTMLElement {
  return h("span", { class: `codicon codicon-${name}`, "aria-hidden": "true" });
}

let ids = 0;
export const uid = (prefix: string) => `${prefix}-${++ids}`;
