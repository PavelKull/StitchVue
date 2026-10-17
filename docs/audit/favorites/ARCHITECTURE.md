# Favorites — architecture (as implemented)

Photo favorites = **copy** of originals into a per-album service folder `Избранное` (alt leaf `Избранная`), marked with `.stitchvue.role` = `favorites`. Stars in the parent album reflect origins whose **active** copy file exists on disk.

## End-to-end chain (add star)

```mermaid
sequenceDiagram
  participant UI as GalleryPage / SelectionActions
  participant OL as favoriteOptimisticOverlay
  participant IPC as Tauri invoke
  participant CMD as commands::run_file_operation
  participant PL as Pipeline::execute_file_operation
  participant FO as file_ops::execute / copy_one
  participant FS as Filesystem
  participant DB as SQLite
  participant EV as file-operation-progress

  UI->>OL: applyFavoriteOverlayPending (desired=true)
  UI->>IPC: run_file_operation(copy_to_local_favorites)
  IPC->>CMD: claim → Start/Busy/Replay
  CMD->>PL: execute_file_operation + disk gate
  PL->>FO: try_lock_paths, insert file_op_log PENDING
  FO->>FS: prepare_destination, temp copy, move_noreplace
  FO-->>EV: progress events
  PL->>DB: record_favorite_copy on copied/already_exists
  PL->>DB: finish_op COMPLETED / NEEDS_RECONCILIATION
  IPC-->>UI: FileOperationResult
  UI->>UI: favoritePaths += success keys, clear overlay
```

**Evidence:** `GalleryPage.tsx` (~1891–2064), `pipeline/mod.rs` (`execute_file_operation`, `record_operation_links`), `file_ops/mod.rs` (`execute`, `copy_one`).

## End-to-end chain (stars listing)

```mermaid
sequenceDiagram
  participant UI as GalleryPage
  participant SYNC as favoritePathsServerSync
  participant IPC as favorite_origin_paths
  participant PL as Pipeline::favorite_origins_in
  participant FAV as active_favorite_origins_in
  participant DB as favorite_copies
  participant FS as active favorites folder

  UI->>SYNC: beginFavoritePathsFetch (requestId + revision)
  UI->>IPC: favorite_origin_paths(directory)
  IPC->>PL: favorite_origins_in
  PL->>FAV: filter rows by parent + active folder + copy file exists
  FAV->>DB: favorite_origin_paths
  FAV->>FS: symlink_metadata(copy) is regular file
  IPC-->>UI: origin path strings
  UI->>SYNC: shouldApplyFavoritePathsFetch (drop stale)
  UI->>UI: setFavoritePaths(Set)
```

**Evidence:** `favorites.rs` (`active_favorite_origins_in`), `GalleryPage.tsx` (~1544, 2545).

## End-to-end chain (remove copy / unfavorite)

```mermaid
flowchart TD
  A[User in Избранное folder] --> B{Single vs mass}
  B -->|single| C[preview_remove_favorite_copy optional]
  B -->|mass| D[preview_remove_favorite_copies]
  C --> E{status needs_confirm?}
  D --> E
  E -->|yes| F[FavoriteTrashUnfavoriteDialog / batch confirm]
  E -->|no| G[remove_favorite_copy / remove_favorite_copies_batch]
  F --> G
  G --> H[favorites::plan_removal + dispatch]
  H --> I[Recycle copy and/or relocate restore origin]
  H --> J[file_op_log + reconcile paths]
  H --> K[delete_favorite_copy_path / cleanup service folder]
  G --> L[UI: refresh listing, overlay, navigation]
```

**Evidence:** `favorites.rs` (`Plan`, `ConfirmKind`, `dispatch_removal_plan`), `GalleryPage.tsx` (unfavorite handlers ~2569+), `FavoriteTrashUnfavoriteDialog.tsx`.

## IPC surface (photo favorites)

| Command | Role |
|---------|------|
| `run_file_operation` | Add copies (`copy_to_local_favorites`) |
| `favorite_origin_paths` | List starred origin paths for open album |
| `favorite_origins_for_copies` | Map copy paths → origin (batch) |
| `preview_remove_favorite_copy` / `remove_favorite_copy` | Unfavorite one file |
| `preview_remove_favorite_copies` / `remove_favorite_copies_batch` | Batch unfavorite |
| `undo_favorite_removal` / `discard_favorite_undo` | **Stub** (see FAILURE_RECOVERY) |
| `rename_folder` | Rewrites SQLite paths when favorites folder renamed |
| `remove_empty_service_folder` / `cleanup_empty_service_folder` | Purge DB under removed service path |

**Not photo copy favorites:** `toggle_favorite`, `favorite_folders` → `library/mod.rs` + `favorite_folders` table.

## Concurrency and locking

- **In-process path locks:** `try_lock_paths` during `execute_file_operation` (sources + album + destination). Conflicting ops return error string (`locks.rs`).
- **Operation claim:** `file_ops::claim` / `complete` / `abandon` for duplicate `operation_id` (Replay/Busy).
- **UI:** `unfavoriteGate` blocks parallel unfavorite; favorite add blocks duplicate pending overlay per path (`GalleryPage`).

## Watcher / external FS

- `folder-changed` pipeline event can trigger gallery refresh (`galleryPipelineEvents.ts`). **CODE-SUPPORTED:** no dedicated favorites reconcile on arbitrary external edits; stars re-derived on next `favorite_origin_paths` + copy existence check.

## Session semantics

- Directory `requestId` filters pipeline events (`directorySession.ts`). File operations are **not** tagged with gallery session in IPC; stale results discarded when `result.directory` ≠ current view (`GalleryPage` ~1945–1954).
