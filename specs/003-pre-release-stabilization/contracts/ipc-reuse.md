# IPC contract: 003-pre-release-stabilization

**Default:** no new Tauri commands and no DTO changes.

Reuse existing commands (`docs/IPC.md`):

| Command | Use in 003 |
|---------|------------|
| `rotate_display_clockwise` | B-003 (already writes quarters) |
| `prefetch_photo` / `cancel_photo_prefetch` | B-007 join; optional C-006 P1 Join — **do not cancel the path being opened** |
| `viewer_frame` | P0 current photo |
| `viewer_source` | Neighbor prepared/native (C-006 P2; not full RAW unless needed) |
| `set_viewer` | Existing grid-thumb ahead; do not expand `pick_index` |
| `preview_remove_favorite_copies` / `remove_favorite_copies_batch` | C-005 (already) |
| `favorite_origins_for_copies` | C-005 origin overlay |

## Forbidden in 003 without a new sealed task

- New viewer-prefetch command family
- New cache tables / identity columns
- `tauri-plugin-updater` / `checkForUpdate` (spec 002)
- Changing `pick_index` argument or priority enum

## C-003 mock

Frontend-only fixture state. No updater IPC in this feature.

## B-005

Prefer extra `thumbnail_cache` **rows** (same `thumbnail_path`) written from existing cache APIs. If a new command is unavoidable, it MUST be a thin alias helper and a separate high-risk TASK with `allowed_paths` limited to `cache/` + `file_ops` copy completion — not a pipeline rewrite.
