# Engineering case study — StitchVue

Short note for recruiters and engineers who open the repo from a resume. Detail lives in [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`IPC.md`](./IPC.md), and [`INVARIANTS.md`](./INVARIANTS.md).

## Problem

A desktop photo gallery on Windows must stay interactive while:

- listing and scrolling folders with tens of thousands of images;
- decoding thumbnails in the background without blocking the UI thread;
- switching folders quickly so late IPC events from the previous folder never paint the wrong grid;
- reopening the same library without re-decoding every file.

Stack: **Tauri 2** (WebView UI) + **Rust** backend + **React / TypeScript** frontend.

## Decisions

### 1. Virtualized justified grid (frontend)

Only the visible row window (plus overscan) is mounted. Layout math for justified rows and orientation modes lives under `src/widgets/gallery-grid/` and gallery feature helpers. Goal: scroll cost stays roughly proportional to viewport size, not to folder size.

### 2. Background thumbnail pipeline (Rust)

`src-tauri/src/pipeline/` owns directory sessions, indexing, thumbnail workers, and watchers. The UI sends viewport hints (`set_visible_range`, scrolling state) so decode priority follows what the user sees. Encoded JPEGs land in a disk cache indexed in SQLite (`src-tauri/src/cache/`).

### 3. Session-guarded async boundary (React ↔ Rust)

Every folder open bumps a monotonic `session` / `requestId`. Backend events carry `session`; frontend helpers in `src/features/gallery/directorySession.ts` drop stale batches. Same idea on the Rust side: `begin_directory_session` rejects going backwards and cancels work tied to the previous session. This is the main defense against “wrong folder flash” races.

### 4. Optimistic favorites with durable file ops

UI can flip favorites immediately and roll back on failure. Rust file operations use claim → complete / abandon so retries stay idempotent (`file_ops`). Originals are never deleted by favorites; copies go under a managed service folder.

## How to verify

| Claim | Evidence |
|-------|----------|
| Session safety | `src/features/gallery/**/directorySession.test.ts` and related gallery pipeline tests; invariant I1 in `INVARIANTS.md` |
| Frontend quality gate | `npm run typecheck`, `npm test` (also [CI](../.github/workflows/ci.yml)) |
| Rust quality gate | `cargo test --manifest-path src-tauri/Cargo.toml --locked` |
| Ship path | Tagged releases via [release.yml](../.github/workflows/release.yml); latest public build [v0.1.7](https://github.com/PavelKull/StitchVue/releases/tag/v0.1.7) |

## What this is not

- Not a cloud sync product — local folders only.
- Not a claim that every historical bug ID is closed — the working journal is [`stabilization/BUGS.md`](./stabilization/BUGS.md), separate from release notes.
