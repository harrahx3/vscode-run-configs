// Reads and writes the .vscode/launch.json of each workspace folder.
import * as vscode from "vscode";
import { fromLaunch, type FormModel, type LaunchEntry, type Section } from "../shared/model";
import {
  offsetOf,
  parseLaunch,
  removeEntry,
  renameInCompounds,
  upsertEntry,
  type ParsedLaunch,
} from "./launchText";

export interface ConfigRef {
  folder: vscode.WorkspaceFolder;
  section: Section;
  name: string;
}

export interface StoredConfig extends ConfigRef {
  entry: LaunchEntry;
  model: FormModel;
}

export function launchUri(folder: vscode.WorkspaceFolder): vscode.Uri {
  return vscode.Uri.joinPath(folder.uri, ".vscode", "launch.json");
}

/** The text as VS Code sees it: an open (possibly unsaved) editor wins over the disk. */
export async function readLaunchText(folder: vscode.WorkspaceFolder): Promise<string> {
  const uri = launchUri(folder);
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (open) return open.getText();
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return "";
  }
}

export async function readFolder(
  folder: vscode.WorkspaceFolder,
): Promise<ParsedLaunch & { items: StoredConfig[] }> {
  const parsed = parseLaunch(await readLaunchText(folder));
  const items: StoredConfig[] = [];
  for (const section of ["configurations", "compounds"] as Section[])
    for (const entry of parsed[section]) {
      if (typeof entry.name !== "string") continue;
      items.push({ folder, section, name: entry.name, entry, model: fromLaunch(entry, section) });
    }
  return { ...parsed, items };
}

export async function findConfig(ref: ConfigRef): Promise<StoredConfig | undefined> {
  return (await readFolder(ref.folder)).items.find(
    (i) => i.section === ref.section && i.name === ref.name,
  );
}

/** Applies a text transformation to launch.json through the editor model, then saves it. */
export async function updateLaunch(
  folder: vscode.WorkspaceFolder,
  change: (text: string) => string,
): Promise<void> {
  const uri = launchUri(folder);
  const before = await readLaunchText(folder);
  const after = change(before);
  if (after === before) return;
  let doc: vscode.TextDocument | undefined;
  try {
    doc = await vscode.workspace.openTextDocument(uri);
  } catch {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, ".vscode"));
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(after));
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    uri,
    new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)),
    after,
  );
  if (!(await vscode.workspace.applyEdit(edit))) throw new Error("Could not edit launch.json.");
  await doc.save();
}

export async function saveEntry(
  folder: vscode.WorkspaceFolder,
  section: Section,
  entry: LaunchEntry,
  previous?: { name: string; section: Section },
): Promise<void> {
  await updateLaunch(folder, (text) => {
    let out = upsertEntry(text, section, entry, previous?.name, previous?.section);
    const name = entry.name as string;
    if (previous && previous.section === "configurations" && previous.name !== name)
      out = renameInCompounds(out, previous.name, name);
    return out;
  });
}

export async function deleteEntry(ref: ConfigRef): Promise<void> {
  await updateLaunch(ref.folder, (text) => {
    const out = removeEntry(text, ref.section, ref.name);
    return ref.section === "configurations" ? renameInCompounds(out, ref.name) : out;
  });
}

export async function revealEntry(ref: ConfigRef): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(launchUri(ref.folder));
  const offset = offsetOf(doc.getText(), ref.section, ref.name) ?? 0;
  const pos = doc.positionAt(offset);
  await vscode.window.showTextDocument(doc, { selection: new vscode.Range(pos, pos) });
}

export async function openLaunchJson(folder: vscode.WorkspaceFolder): Promise<void> {
  const uri = launchUri(folder);
  if (!(await readLaunchText(folder)).trim())
    await updateLaunch(folder, () => '{\n  "version": "0.2.0",\n  "configurations": []\n}\n');
  await vscode.window.showTextDocument(uri);
}
