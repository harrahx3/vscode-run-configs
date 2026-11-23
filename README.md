# Run Configurations Panel

Create, edit and start the run and debug configurations of Python and web projects from a
side panel and a form, instead of editing `.vscode/launch.json` by hand.

## What it does

- **A side panel** (the ▷ icon in the activity bar) lists every configuration of every workspace
  folder, with a one-line summary (`uvicorn app.main:app :8001 (reload)`, `pnpm dev in web`…).
  Hover an item for its buttons: **Debug**, **Run** (without the debugger), **Edit**; a running
  one shows **Restart** and **Stop**. Right-click for Duplicate, Delete and Show in launch.json.
- **Add configuration (+)** scans the project and suggests ready-made configurations:
  - Python: FastAPI apps (`app = FastAPI(...)` → uvicorn with reload), scripts with an
    `if __name__ == "__main__":` block, packages with a `__main__.py`, console scripts from
    `pyproject.toml`, pytest (all tests, or the open file); the project's `.venv` interpreter
    is filled in, sub-projects (`api/pyproject.toml`) and `src/` layouts included.
  - Python Fire command lines (`Fire(MyCli)`, `Fire(function)`, `Fire({...})`, `Fire()`):
    one configuration per command (`main.py coupled`, `main.py pp`…) instead of a bare
    `Run main.py`, which would only print Fire's help.
  - Web: every `package.json` script with the right package manager (from the lock file), and
    a browser debug configuration on the dev server's address (Vite's `server.port` is read).
  - **Vite dev server** (`npx vite`, `pnpm exec vite`…) with port, host and `--strictPort`.
    The port can come from a variable, read from the environment or from an env file.
  - **Backend + frontend**: a FastAPI app and a `dev` script started (and stopped) together.
  - Or press Enter without choosing: a blank form with nothing selected, where you pick the
    kind. With no suggestion to offer, the blank form opens directly.
- **Your own templates** for other technologies (Go, Rust, Java…): in the form, fill in the
  **Other (JSON)** tile (or any tile) and click **Save as Template…**; it becomes a tile under
  "What do you want to run?" that opens with that entry. **Right-click a tile** to edit or
  delete your template, hide a built-in tile, add a new template or bring hidden tiles back;
  **Run Configurations: Manage Templates…** (the `…` menu of the side panel) does the same. They are stored in the `runConfigs.templates` user setting (a workspace
  setting of the same name is shown too, to share templates with a team).
- **The form** covers Python script, Python module, FastAPI, pytest, `package.json` script,
  browser, "start together" (compound) and, for anything else, the raw JSON of the entry.
  Arguments are typed like in a terminal, files and folders have a Browse… button,
  environment variables are rows (paste several `KEY=value` lines at once), and the bottom of
  the form shows exactly what will be written to `launch.json`. `Ctrl+S` saves.
- **Python Fire**: when the Python file is a Fire command line, the form shows a **Command**
  list and one field per option of that command (a checkbox for booleans), with its default
  and the description from the docstring (Google or NumPy style). The arguments line is
  rebuilt from them, and edited arguments are read back, in any Fire spelling
  (`--days 3`, `--days=3`, `--stop-after`, `--noflag`).
- **FastAPI port from a variable**: name an environment variable (e.g. `BACKEND_PORT`) and the
  entry reads the port from it (process environment or env file), with the Port field as fallback.
- **Environment variables the project reads** (`os.getenv("X", "default")`, `os.environ[...]`)
  are offered while typing a variable name, their default shown in the value box. A row left
  without a value is not written (an empty variable would replace the project's default).
- **The status bar** shows the last configuration started: one click starts it again.
  **Run Configurations: Run or Debug…** (command palette) picks any configuration.

Everything is stored in the standard `.vscode/launch.json`, so F5, the Run and Debug view and
colleagues without the extension keep working. Edits go through the file's text: comments,
trailing commas, formatting and keys the form does not know (`jinja`, `subProcess`…) are kept.
Renaming a configuration updates the compounds that use it.

Python configurations need the Python Debugger extension (`ms-python.debugpy`); browser and
`package.json` configurations use VS Code's built-in JavaScript debugger.

Not covered (yet): configurations stored in a `.code-workspace` file or in the user settings'
`launch` key are not listed; edit those as before.

## Settings

| Setting                    | Default | Meaning                                                               |
| -------------------------- | ------- | --------------------------------------------------------------------- |
| `runConfigs.defaultAction` | `debug` | What Enter does in _Run or Debug…_: `debug` or `run` (no debugger).   |
| `runConfigs.showStatusBar` | `true`  | Show the "start the last configuration again" status-bar button.      |
| `runConfigs.templates`     | `[]`    | Your own tiles in the form: `label`, `hint`, `icon`, `configuration`. |
| `runConfigs.hiddenKinds`   | `[]`    | Built-in tiles to hide in the form.                                   |

## Install

From the Visual Studio Marketplace: search for **Run Configurations Panel** in the Extensions view, or run

```bash
code --install-extension harrahx3.vscode-run-configs
```

Each release's `.vsix` is also attached to the [GitHub Releases](https://github.com/harrahx3/vscode-run-configs/releases)
(_Extensions view → … → Install from VSIX…_). It works in VS Code connected to WSL.

## Develop

Node 22, npm.

```bash
npm install
npm run build          # dist/ (extension + form); `npm run watch` to rebuild on save
npm run lint && npm run typecheck
npm test               # unit tests (Vitest): launch.json edits, form <-> entry, detection
npm run test:browser   # the real form in headless Chromium (screenshots in test/browser/screenshots/)
npm run test:vscode    # integration tests in a downloaded VS Code (needs a display: WSLg / xvfb-run)
npm run package        # vscode-run-configs-<version>.vsix
```

Layout: `src/shared/` holds the pure model (form ↔ `launch.json` entry, argument quoting) used
by both sides; `src/extension/` the host side (side panel, commands, project scan, `launch.json`
text edits); `src/webview/` the form.

Release: bump `version` in `package.json` (`npm version X.Y.Z --no-git-tag-version`), add a
`CHANGELOG.md` entry, commit, then push a tag `vX.Y.Z`. The _Publish_ workflow
(`.github/workflows/publish.yml`) runs the tests, builds the `.vsix`, attaches it to a GitHub
Release and publishes it to the Visual Studio Marketplace (Trusted Publishing, no stored token).

## License

[MIT](LICENSE). The bundled third-party libraries keep their own licenses, listed in
[ThirdPartyNotices.txt](ThirdPartyNotices.txt).
