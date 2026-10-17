# Favorites — data model (as implemented)

## SQLite tables

### `favorite_copies` (origin ↔ copy link)

**Defined:** `database/mod.rs` migrate (~74–80), extended columns via `ensure_column`.

| Column | Role |
|--------|------|
| `origin_path`, `origin_size`, `origin_modified_at` | Primary identity of source file at link time |
| `copy_path` | Path under service favorites folder |
| `copy_size`, `copy_modified_at` | Copy metadata snapshot |
| `content_sha256` | Hash (from copy pipeline or recompute) |
| `record_version` | `FAVORITE_RECORD_VERSION` (= 2) |
| `origin_key`, `copy_key` | Normalized path keys for lookup / dedupe |

**Write path:** `record_favorite_copy` deletes rows sharing `copy_key` or `origin_key`, then upserts on PK `(origin_path, origin_size, origin_modified_at)` (`database/mod.rs` ~161–210).

**Read paths:** `favorite_origin_paths`, `favorite_snapshot_for_copy`, `favorite_snapshot_for_origin`, `load_all_favorite_snapshots`.

### `file_op_log` (journal for crash recovery)

Tracks pending/completed ops including `OP_ADD_TO_FAVORITES`, `OP_REMOVE_FROM_FAVORITES`, restore/trash types (`database/mod.rs` ~102–116, constants ~698+). Used by `reconcile_on_boot` (`reconcile.rs`).

### `favorite_undo` (legacy)

Schema retained; `undo_favorite_removal` IPC is stubbed. `reconcile::recover_legacy_undo` attempts to recycle `held_path` on boot (`reconcile.rs` ~18–37).

### `trash_entries`

Links local trash files to origins; used when unfavorite path restores origin from `Удаленное` (`favorites.rs` removal plans involving `OriginInTrash`).

### `favorite_folders` (sidebar bookmarks)

Unrelated to photo stars; `library::toggle_favorite`.

## Filesystem model

| Concept | Implementation |
|---------|----------------|
| Service folder leaf | `LOCAL_FAVORITES` = `Избранное`, alt `Избранная` (`file_ops/mod.rs`) |
| Active folder | Exactly one per parent with `.stitchvue.role` content `favorites` (`active_favorites_folder`) |
| Role marker | `.stitchvue.role` file (`ROLE_FILE`) |
| Copy naming | Basename preserved; collisions → suffix loop up to `MAX_SUFFIX` (`copy_one`, `claim_free`) |
| Duplicate content | `already_exists` if identical file at target (`files_identical`) |
| Reparse points | Rejected for destination and copy targets (`is_reparse`) |

## Identity rules

- **Star display:** origin path string in set returned by `active_favorite_origins_in` — requires copy under **active** favorites dir and regular file present (`favorites.rs` ~22–54).
- **Stale rows:** DB rows for copies outside active folder or missing files **do not** remove SQLite row automatically when listing stars (**CODE-SUPPORTED**); removal paths use snapshot + classify.
- **Path normalization:** `path_key`, `normalize_stored_path`; extended `\\?\` prefix handling tested in `database/mod.rs` tests.

## Album folder rename

`database::relocate_folder_path` rewrites `favorite_folders`, `favorite_copies` origin/copy prefixes, `trash_entries`, then `sync_favorite_copy_keys` (`database/mod.rs` ~579–615). FS rename happens first in `Pipeline::rename_folder` (~1213–1226).

**Activity after rename:** if renamed folder no longer matches `is_favorites_folder_name`, UI treats collection as deactivated (`favoritesCollectionLifecycle.ts`); Rust stops returning stars until new active folder exists (`favorites_lifecycle.rs` tests).

## Frontend state (non-persistent)

| State | Location | Purpose |
|-------|----------|---------|
| `favoritePaths` | `GalleryPage` | Confirmed star set from server |
| `favoriteOverlay` | `GalleryPage` | Pending add/remove per `pathKey` |
| `favoriteOverlayGenerations` | ref map | Prevent stale overlay clear |
| `favoritePathsSync` counters | refs | Stale IPC guard (`favoritePathsServerSync.ts`) |
| `unfavoriteGate` | ref | Mutex for unfavorite session |
| Copy origin cache | `favoriteMassUnfavoriteOptimistic` | Batch origin hints |
