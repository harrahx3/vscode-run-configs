// Messages between the extension host and the configuration form (webview).
import type { FireCli } from "./fire";
import type { ConfigKind, FormModel, LaunchEntry, Section } from "./model";
import type { Template } from "./templates";

/** An environment variable the project reads, with its literal default if any. */
export interface EnvName {
  name: string;
  default?: string;
}

/** Autocompletion offered by the form, from the project scan. */
export interface Hints {
  programs: string[];
  modules: string[];
  apps: string[];
  scripts: string[];
  urls: string[];
  pythons: string[];
  /** Python Fire command lines, by file. */
  fire: FireCli[];
  envNames: EnvName[];
}

export type SaveThen = "none" | "run" | "debug";
export type PickField = "program" | "cwd" | "python" | "envFile" | "webRoot";

export interface InitMessage {
  type: "init";
  model: FormModel;
  /** The entry being edited (undefined for a new one): its unknown keys are kept on save. */
  original?: LaunchEntry;
  originalSection?: Section;
  folderName: string;
  /** Names of the folder's other configurations (unique names, compound members). */
  otherNames: string[];
  /** Configurations a compound may include (the folder's non-compound ones). */
  memberChoices: string[];
  isNew: boolean;
  templates: Template[];
  hiddenKinds: ConfigKind[];
}

export type HostMessage =
  | InitMessage
  | { type: "hints"; hints: Hints; tasks: string[] }
  | { type: "picked"; field: PickField; value: string }
  | { type: "templates"; templates: Template[]; hiddenKinds: ConfigKind[] }
  | { type: "templateSaved" }
  | { type: "error"; message: string }
  | { type: "saved"; model: FormModel; original: LaunchEntry; originalSection: Section };

export type WebviewMessage =
  | { type: "ready" }
  | { type: "pick"; field: PickField }
  | { type: "save"; model: FormModel; then: SaveThen }
  | { type: "saveTemplate"; model: FormModel }
  | { type: "openJson" }
  | { type: "close" };
