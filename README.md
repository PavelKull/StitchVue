# StitchVue

Desktop gallery for large photo folders on **Windows**. Built with Tauri 2, Rust, React, and TypeScript.

StitchVue is meant for browsing very large local image libraries: fast folder navigation, justified grid layout, background thumbnail generation with disk cache, favorites (copies under a service folder), a local trash for safe deletes, and a built-in image viewer. Your original photos stay where you put them; the app stores only cache and library metadata under its app data folder (see below).

## Features

- **Browse** — open a folder and scroll large collections with virtualization and session-safe updates when you switch directories.
- **Thumbnails** — background pipeline with prioritized decoding and SQLite-backed thumbnail cache on disk.
- **Favorites** — copy selected images into a managed favorites area with optimistic UI and undo-friendly flows.
- **Local trash** — move files to an app-managed trash instead of immediate permanent deletion (restore supported).
- **Viewer** — open images from the grid in an integrated viewer.

## System requirements (Windows)

- **OS:** Windows 10 or later (64-bit)
- **Runtime:** [Microsoft Edge WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (usually already installed on current Windows; the installer may bundle it if needed)
- **Architecture:** x64

## Install

When a release is published on GitHub:

1. Open [Releases](https://github.com/PavelKull/StitchVue/releases) for this repository.
2. Download the **NSIS** setup executable (`.exe`) for the latest version.
3. Run the installer and launch StitchVue from the Start menu.

Automatic in-app updates are **not** implemented yet. A **Tauri updater** fed from GitHub Releases is planned for a future version; until then, install newer builds manually from Releases.

## Report bugs

- **In the app:** Settings → About → open the GitHub issues link (uses the repository URL configured in the app).
- **On GitHub:** [Issues](https://github.com/PavelKull/StitchVue/issues) — use “New issue” or the direct new-issue URL: `https://github.com/PavelKull/StitchVue/issues/new`.

Please include Windows version, app version, and steps to reproduce when you can.

## App data (not your photos)

StitchVue keeps cache and databases under:

```text
%LOCALAPPDATA%\StitchVue\
```

Typical contents include the thumbnail cache and `stitchvue.db` (library paths, cache index, and related metadata). **User photo files are not stored here** unless you explicitly use favorites or local trash features that copy or move files within your library layout.

## Run (development)

```text
npm install
npm run tauri dev
```

The first launch compiles Rust and can take several minutes.

## Documentation

Technical docs live under [`docs/`](./docs/DEVELOPMENT.md):

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — module map and data flows
- [`docs/INVARIANTS.md`](./docs/INVARIANTS.md) — business invariants
- [`docs/IPC.md`](./docs/IPC.md) — Tauri commands and events
- [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md) — scripts, layout, tests
- [`docs/refactoring/TASK_HANDOFF.md`](./docs/refactoring/TASK_HANDOFF.md) — safe refactoring handoff

Repository: [https://github.com/PavelKull/StitchVue](https://github.com/PavelKull/StitchVue)
