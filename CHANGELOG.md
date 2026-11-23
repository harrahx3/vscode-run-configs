# Changelog

## 1.1.1 — 2026-11-23

- **Right-click on the form's tiles**: edit or delete a template, hide a built-in tile, add a
  new template, show or hide the built-in tiles. The form no longer opens the default
  Cut/Copy/Paste menu outside text fields.

## 1.1.0 — 2026-11-23

- **Templates**: add your own tiles under "What do you want to run?" for technologies the
  built-in ones do not cover. **Save as Template…** in the form keeps the current
  configuration as a tile; **Run Configurations: Manage Templates…** adds, edits and deletes
  templates and shows or hides the built-in tiles. Stored in the `runConfigs.templates` and
  `runConfigs.hiddenKinds` user settings.
- FastAPI: a **Port from environment variable** field. Type the variable's name (e.g.
  `BACKEND_PORT`); the entry then starts uvicorn through debugpy's `code` property and reads
  the port from the environment or from the entry's env file, with the Port field as fallback.
- Vite: the same **Port from environment variable** field, plus an **Environment file** field.
  The command reads that one variable out of the file (bash / zsh), after the environment and
  before the fallback port; the rest of the file is never sourced.
- The variable-name suggestions now also come from the project's Vite config (`env.X`,
  `process.env.X`) and from an env **template** (`.env.template`, `.env.example`…), with its
  value as the default. A real env file is still never read.
- Add Configuration…: the list shows only the suggestions detected in the project, with none
  highlighted; the search bar says that pressing Enter alone opens a blank form with no kind
  selected (the kind must be chosen before saving). When nothing is detected, the blank form
  opens directly. The "Start from a blank form" entries are gone from the list.
- New **Vite dev server** kind in "What do you want to run?": port, host, `--strictPort`,
  package manager and folder; the project scan suggests it when `vite` is a dependency.

## 1.0.1 — 2026-11-16

- The changelog of 1.0.0 now lists every change of that release; the first 1.0.0 package
  left several out. No change to the extension itself.

## 1.0.0 — 2026-11-16

- Published on GitHub and the Visual Studio Marketplace under the MIT license, as
  _Run Configurations Panel_. The extension ID is now `harrahx3.vscode-run-configs`:
  uninstall a build installed earlier from a `.vsix` with another ID, or both run side by side.
- The command palette category, the activity-bar icon and the settings section are now called
  _Run Configurations_. Settings (`runConfigs.*`) and command IDs are unchanged.
- Python configurations always write `justMyCode` (debugpy takes a missing value as `true`), so
  the choice is visible in `launch.json` and in the form's preview.

## 0.2.0

- Python Fire support: the project scan suggests one configuration per Fire command, and the
  form shows a command picker and one field per option (defaults, types and docstring help),
  kept in sync with the arguments.
- The environment-variable table suggests the variables the project reads, with their
  defaults; rows without a value are no longer written as empty strings.

## 0.1.0

- Side panel listing the configurations of every workspace folder, with Debug / Run / Stop /
  Restart / Edit buttons and a running indicator.
- Form editor for Python script, Python module, FastAPI (uvicorn), pytest, `package.json`
  script, browser, compound and raw-JSON configurations, with a live `launch.json` preview.
- Project scan suggesting configurations (FastAPI apps, `__main__` scripts, console scripts,
  pytest, package.json scripts, dev-server URL, backend + frontend compound).
- Comment-preserving edits of `launch.json`; renames followed in compounds.
- Status-bar button to start the last configuration again; _Run or Debug…_ picker.
