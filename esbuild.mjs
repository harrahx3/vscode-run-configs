// Bundles the extension host code (CommonJS, Node), the form (IIFE, browser) and its CSS
// (with the codicon font copied next to it).
import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const common = {
  bundle: true,
  minify: production,
  sourcemap: production ? false : "linked",
  logLevel: "info",
};

const builds = [
  {
    ...common,
    entryPoints: ["src/extension/extension.ts"],
    outfile: "dist/extension.js",
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode"],
    // jsonc-parser's default (UMD) build requires its modules dynamically: use its ES build.
    mainFields: ["module", "main"],
  },
  {
    ...common,
    entryPoints: ["src/webview/main.ts"],
    outfile: "dist/webview.js",
    platform: "browser",
    format: "iife",
    target: "es2022",
  },
  {
    ...common,
    sourcemap: false,
    entryPoints: ["src/webview/style.css"],
    outfile: "dist/webview.css",
    loader: { ".ttf": "file" },
    assetNames: "[name]",
  },
];

if (watch) {
  for (const options of builds) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
  }
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
