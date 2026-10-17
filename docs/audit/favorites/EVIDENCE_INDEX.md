# Favorites audit — evidence index

Read-only audit snapshot. Canonical product invariants remain in [`docs/INVARIANTS.md`](../../INVARIANTS.md).

## Scope note

This audit covers **photo copy favorites** (`Избранное` service folder, `favorite_copies`, `copy_to_local_favorites`). **Folder bookmarks** (`favorite_folders`, `toggle_favorite` / `favorite_folders` IPC) are a separate feature; cross-links only where UI shares naming.

## Frontend (React / TypeScript)

| Area | Path | Key symbols |
|------|------|-------------|
| Orchestration | `src/pages/gallery/GalleryPage.tsx` | `runFileAction`, `favorite_origin_paths`, mass/single unfavorite, overlay |
| File op client | `src/features/selection/lib/fileOperation.ts` | `FileAction`, `run_file_operation` types, service-folder gating |
| Batch unfavorite | `src/features/selection/lib/removeFavoritesBatch.ts` | `prepareFavoriteRemovalTargets`, `interpretRemovalOutcome`, summaries |
| Unfavorite gate | `src/features/selection/lib/unfavoriteGate.ts` | session lock during confirm/batch |
| Optimistic stars | `src/features/favorites/lib/favoriteOptimisticOverlay.ts` | overlay map, `favoriteDisplayOn` |
| Server sync | `src/features/favorites/lib/favoritePathsServerSync.ts` | stale `favorite_origin_paths` rejection |
| Mass unfavorite UI | `src/features/favorites/lib/favoriteMassUnfavoriteOptimistic.ts` | hide service folder overlay |
| Rename semantics | `src/features/favorites/lib/favoritesCollectionLifecycle.ts` | `favoritesActivityAfterRename` |
| Service folder names | `src/entities/folder/serviceFolder.ts` | `DISK_SERVICE_FOLDER_LEAF`, `isFavoritesFolderName` |
| Dialog | `src/widgets/favorites-trash-unfavorite-dialog/ui/FavoriteTrashUnfavoriteDialog.tsx` | trash-origin confirm |
| Pipeline events | `src/features/gallery/model/pipeline/galleryPipelineEvents.ts` | `folder-changed` (indirect refresh) |

## Backend (Rust / Tauri)

| Area | Path | Key symbols |
|------|------|-------------|
| IPC | `src-tauri/src/commands/mod.rs` | `run_file_operation`, `favorite_origin_paths`, `remove_favorite_*`, batch DTOs |
| Pipeline glue | `src-tauri/src/pipeline/mod.rs` | `execute_file_operation`, `record_operation_links`, `record_favorite_link`, rename/purge |
| Copy / trash ops | `src-tauri/src/file_ops/mod.rs` | `Action::CopyToLocalFavorites`, `execute`, `copy_one`, `claim`, `active_favorites_folder` |
| Removal engine | `src-tauri/src/file_ops/favorites.rs` | `active_favorite_origins_in`, `plan_removal`, `classify`, `ConfirmKind` |
| Batch removal | `src-tauri/src/file_ops/favorites_batch.rs` | preview/batch wrappers |
| Boot reconcile | `src-tauri/src/file_ops/reconcile.rs` | `reconcile_on_boot`, `reconcile_add_to_favorites` |
| SQLite | `src-tauri/src/database/mod.rs` | `favorite_copies`, `file_op_log`, `record_favorite_copy`, `relocate_folder_path` |
| Folder bookmarks | `src-tauri/src/library/mod.rs` | `toggle_favorite`, `favorite_folders` table |
| Path locks | `src-tauri/src/file_ops/locks.rs` | `try_lock_paths` |
| Recycle (Windows) | `src-tauri/src/file_ops/recycle.rs` | `recycle_path`, `authorize_favorite_copy` |

## Tests (primary)

| Layer | Paths |
|-------|--------|
| Rust unit/integration | `favorites.rs`, `favorites_lifecycle.rs`, `favorites_copy_recovery.rs`, `favorites_trash_lifecycle*.rs`, `favorites_batch.rs`, `reconcile.rs` (`#[cfg(test)]`), `database/mod.rs` (path key tests) |
| Frontend unit | `src/features/favorites/lib/*.test.ts`, `removeFavoritesBatch.test.ts`, `unfavoriteGate.test.ts`, `selectionMode.test.ts` |

## Existing narrative docs (not duplicated here)

- [`docs/ARCHITECTURE.md`](../../ARCHITECTURE.md) — directory open flow
- [`docs/IPC.md`](../../IPC.md) — command index
- [`docs/refactoring/FAVORITES_TRASH_LIFECYCLE_FINAL_REPORT.md`](../../refactoring/FAVORITES_TRASH_LIFECYCLE_FINAL_REPORT.md) — CP1–CP4 reconcile (2026-10-16)
