// Starts / stops configurations and tracks which ones are running.
import * as vscode from "vscode";
import type { ConfigRef } from "./store";

const LAST_RUN = "runConfigs.lastRun";

interface LastRun {
  folder: string;
  name: string;
  noDebug: boolean;
}

export class Runner implements vscode.Disposable {
  private readonly sessions = new Set<vscode.DebugSession>();
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private readonly disposables: vscode.Disposable[] = [this.changed];

  constructor(private readonly state: vscode.Memento) {
    for (const s of vscode.debug.activeDebugSession ? [vscode.debug.activeDebugSession] : [])
      if (!s.parentSession) this.sessions.add(s);
    this.disposables.push(
      vscode.debug.onDidStartDebugSession((s) => {
        if (s.parentSession) return; // child processes of a run show under their parent
        this.sessions.add(s);
        this.changed.fire();
      }),
      vscode.debug.onDidTerminateDebugSession((s) => {
        if (this.sessions.delete(s)) this.changed.fire();
      }),
    );
  }

  private sameFolder(s: vscode.DebugSession, folder: vscode.WorkspaceFolder): boolean {
    return !s.workspaceFolder || s.workspaceFolder.uri.toString() === folder.uri.toString();
  }

  /** Top-level sessions of a configuration (for a compound: of any of its members). */
  sessionsOf(ref: ConfigRef, members: readonly string[] = []): vscode.DebugSession[] {
    const names = ref.section === "compounds" ? members : [ref.name];
    return [...this.sessions].filter(
      (s) => names.includes(s.configuration.name) && this.sameFolder(s, ref.folder),
    );
  }

  async start(ref: ConfigRef, noDebug: boolean): Promise<boolean> {
    await this.state.update(LAST_RUN, {
      folder: ref.folder.uri.toString(),
      name: ref.name,
      noDebug,
    } satisfies LastRun);
    this.changed.fire();
    // By name: VS Code resolves it from launch.json, compounds included.
    return vscode.debug.startDebugging(ref.folder, ref.name, { noDebug });
  }

  async stop(ref: ConfigRef, members: readonly string[] = []): Promise<void> {
    await Promise.all(this.sessionsOf(ref, members).map((s) => vscode.debug.stopDebugging(s)));
  }

  async restart(ref: ConfigRef, members: readonly string[] = []): Promise<void> {
    const running = this.sessionsOf(ref, members);
    const noDebug = running.some((s) => s.configuration.noDebug === true);
    await this.stop(ref, members);
    await this.start(ref, noDebug);
  }

  lastRun(): (ConfigRef & { noDebug: boolean }) | undefined {
    const last = this.state.get<LastRun>(LAST_RUN);
    const folder = vscode.workspace.workspaceFolders?.find(
      (f) => f.uri.toString() === last?.folder,
    );
    if (!last || !folder) return undefined;
    return { folder, section: "configurations", name: last.name, noDebug: last.noDebug };
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
