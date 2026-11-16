# Changelog

## Unreleased

- Published on GitHub and the Visual Studio Marketplace under the MIT license, as
  _Run Configurations Panel_. The extension ID is now `harrahx3.vscode-run-configs`:
  uninstall a build installed earlier from a `.vsix` with another ID, or both run side by side.

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
