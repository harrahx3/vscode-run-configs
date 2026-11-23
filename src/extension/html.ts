import * as vscode from "vscode";

/** HTML shell of the configuration form, with a strict Content-Security-Policy. */
export function webviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const asset = (file: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", file));
  const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 36).toString(36)).join(
    "",
  );
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${asset("webview.css")}">
  <title>Run configuration</title>
</head>
<body data-vscode-context='{"preventDefaultContextMenuItems":true}'>
  <main id="app"><p class="muted">Loading…</p></main>
  <script nonce="${nonce}" src="${asset("webview.js")}"></script>
</body>
</html>`;
}
