// Writes ThirdPartyNotices.txt: the licence and notice files of every runtime dependency that
// esbuild bundles into dist/. Run by `npm run package`, so the file follows dependency updates.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const listed = execFileSync("npm", ["ls", "--omit=dev", "--all", "--parseable"], {
  encoding: "utf8",
});
const dirs = [...new Set(listed.trim().split("\n").slice(1))].sort();
const isLegalFile = (name) => /^(licen[cs]e|notice|copying|copyrightnotice)/i.test(name);
const rule = "=".repeat(78);

let out = "This extension bundles the following third-party software.\n";
for (const dir of dirs) {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  out += `\n${rule}\n${pkg.name} ${pkg.version} (${pkg.license})\n${rule}\n`;
  const files = readdirSync(dir)
    .filter(isLegalFile)
    .map((name) => join(dir, name))
    .filter((file) => statSync(file).isFile());
  const extra = join(dir, "licenses");
  if (existsSync(extra) && statSync(extra).isDirectory())
    files.push(...readdirSync(extra).map((name) => join(extra, name)));
  for (const file of files)
    out += `\n--- ${relative(dir, file)} ---\n\n${readFileSync(file, "utf8").replace(/\r\n/g, "\n").trim()}\n`;
}
writeFileSync("ThirdPartyNotices.txt", out);
console.log(`ThirdPartyNotices.txt: ${dirs.length} packages`);
