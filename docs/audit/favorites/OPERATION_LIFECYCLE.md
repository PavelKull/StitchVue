# Favorites — operation lifecycle (as implemented)

## Add to favorites (`copy_to_local_favorites`)

### Preconditions (enforced)

- Not inside a service folder (`read_service_role` on album directory) — `file_ops::execute` ~308–311.
- Sources resolved under open album (`resolve_source`).
- Parallel op on overlapping paths blocked (`try_lock_paths`).

### Steps

1. **UI** sets optimistic overlay (`applyFavoriteOverlayPendingBatch`), generates `operationId` (`GalleryPage` ~1891–1930).
2. **IPC** `run_file_operation` → `claim` → `Pipeline::execute_file_operation`.
3. **Journal:** per-file `file_op_log` row `OP_ADD_TO_FAVORITES`, status `PENDING`, optional destination updated via journal callback during copy (`update_pending_destination`).
4. **FS:** `prepare_destination` creates/uses `Избранное`, writes role marker; `copy_one` uses temp file + `move_noreplace` (`file_ops/mod.rs`).
5. **Outcomes:** `copied`, `already_exists`, `failed`, `cancelled` per file.
6. **SQLite link:** `record_operation_links` calls `record_favorite_link` for `copied` / `already_exists`; on link failure → `ST_NEEDS_RECONCILIATION` + `favorite_link` error on outcome (`pipeline/mod.rs` ~934–975).
7. **UI:** merges successful origin keys into `favoritePaths`; clears overlay by generation; may inject service folder into folder list if created (`GalleryPage` ~2019–2073).

### Idempotency

- Same `operation_id` replay returns cached `FileOperationResult` (`claim` → `Replay`).
- Identical bytes at target → `already_exists` still records link.

## List stars (`favorite_origin_paths`)

- Called on directory open / after local mutation (`noteFavoritePathsConfirmedLocalMutation`).
- Server filters DB + FS; **does not** delete orphan DB rows.
- Stale responses dropped when directory, `requestId`, or revision mismatch (`shouldApplyFavoritePathsFetch`).

## Remove copy (unfavorite)

### Phases (Rust)

1. **Phase A — SQLite:** `load_removal_context` (in favorites folder?, snapshot?, origin trash path).
2. **Phase B — classify:** `plan_removal` / `plan_removal_with_scan` → `Plan` variant:
   - `Recycle` — standard delete copy via Windows recycle
   - `Relocate` — restore/move copy when origin missing/changed (with notices)
   - `NeedsConfirm` — `ConfirmKind` gates
   - `OriginInTrash` — origin in local trash; user resolution (`restore_origin`, `recycle_copy`, etc.)
3. **Preview:** `preview_plan` → `RemoveFavoriteCopyResult` status `ready` | `needs_confirm` | ...
4. **Execute:** `remove_favorite_copy_distributed*` → journal (`begin_recycle_op`, etc.) → FS → SQLite → `finish_*` / reconcile hooks.

**Evidence:** `favorites.rs` module structure; `FAVORITES_TRASH_LIFECYCLE_FINAL_REPORT.md` for `recycle_copy` / `restore_origin` journals.

### UI flows

| Context | Entry | Backend |
|---------|-------|---------|
| Inside `Избранное`, single file | Viewer / selection | `remove_favorite_copy` after optional preview |
| Inside `Избранное`, multi | Mass unfavorite | `preview_remove_favorite_copies` → confirm → `remove_favorite_copies_batch` |
| Parent album | Toggle star off | Typically `run_file_operation` not used; removal when viewing copy in favorites folder |

**CODE-SUPPORTED:** removing star from parent album without opening favorites folder — verify product path in `GalleryPage` star toggle (~2400+); may invoke unfavorite on copy path via selection coordinator.

### Batch semantics

- Paths deduped (`favorites_batch.rs`).
- Per-item errors become `status: "failed"` result, batch continues (**VERIFIED** — `batch_remove_reports_per_file_failure_without_aborting_batch`).
- Shared scan caches across batch for classify performance (`BatchRemovalScanCaches`).

### Service folder cleanup

After removals, may call `cleanup_empty_service_folder` / `remove_empty_service_folder` → `purge_paths_under` for DB rows under folder prefix (`pipeline/mod.rs` ~1229–1254).

## Rename favorites folder

1. FS: `rename_child_folder` (role marker moves with folder).
2. DB: `relocate_folder_path` prefix rewrite.
3. UI: `favoritesActivityAfterRename` — losing canonical name → deactivated collection.

**Tests:** `favorites_lifecycle.rs` (rename, re-add, inactive historical folder).

## Boot / restart

1. `Pipeline::start` → `reconcile_on_boot` (`pipeline/mod.rs` ~351–353).
2. Unfinished `file_op_log` rows reconciled per op type (`reconcile.rs`).
3. Legacy `favorite_undo` rows processed (`recover_legacy_undo`).

## Parallel operations

| Mechanism | Behavior |
|-----------|----------|
| `try_lock_paths` | Second op errors if path prefix overlap |
| `claim(operation_id)` | Busy or Replay |
| UI overlay pending | Blocks second add on same path |
| `unfavoriteGate` | Blocks overlapping unfavorite sessions |

## External Explorer changes

- No dedicated watcher handler for favorites DB sync (**MISSING** dedicated module).
- Listing refresh via `folder-changed` may reload directory; stars re-fetched on navigation / explicit fetch.
- Orphan copy files / orphan DB rows: handled opportunistically on removal classify, not continuous reconcile (**PARTIAL**).
