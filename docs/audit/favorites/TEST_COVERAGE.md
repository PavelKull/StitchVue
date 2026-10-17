# Favorites — test coverage map

Tests prove only what they assert. This map links suites to behaviors.

## Rust (`src-tauri`)

| Module / command | Behaviors exercised | Gap |
|------------------|---------------------|-----|
| `file_ops/favorites.rs` `#[cfg(test)]` | classify, removal plans, recycle/relocate, snapshot checks, path resolve | Not full matrix of Windows ACL / long paths |
| `file_ops/favorites_lifecycle.rs` | active folder, rename deactivate, re-add, historical folder | External Explorer rename parallel |
| `file_ops/favorites_copy_recovery.rs` | add reconcile, partial copy, journal | — |
| `file_ops/favorites_trash_lifecycle.rs` | origin-in-trash flows | — |
| `file_ops/favorites_trash_lifecycle_final.rs` | CP1–CP4 fault injection, batch mixed, F-dispatch | Full panic mid-dispatch |
| `file_ops/favorites_batch.rs` | dedupe preview, per-file failure | — |
| `file_ops/reconcile.rs` tests | pending add/remove reconcile | Orphan trash ambiguous branch |
| `database/mod.rs` tests | path keys, rewrite after folder move | — |
| `file_ops/mod.rs` tests | copy collisions, locks, service folder | Disk full simulation |

**Run examples (safe, no user data):**

```text
cargo test favorites_lifecycle --
cargo test favorites_trash_lifecycle_final --
cargo test favorites_copy_recovery --
cargo test favorites_batch::
```

## Frontend (`src/features`)

| File | Behaviors |
|------|-----------|
| `favoriteOptimisticOverlay.test.ts` | overlay pending/success/clear generations |
| `favoritePathsServerSync.test.ts` | stale fetch rejection |
| `favoriteOptimisticLifecycle.test.ts` | overlay lifecycle edge cases |
| `favoriteMassUnfavoriteOptimistic.test.ts` | service folder hide overlay |
| `favoriteOptimisticMemoryDiag.test.ts` | diag hooks |
| `favoritesCollectionLifecycle.test.ts` | rename activity classification |
| `removeFavoritesBatch.test.ts` | buckets, summaries, landing keys, prepare targets |
| `unfavoriteGate.test.ts` | concurrent unfavorite guard |
| `selectionMode.test.ts` | mass unfavorite selection reset |
| `useGallerySelectionCoordinator.test.ts` | service folder selection (light) |
| `photoDeleteFlip.test.ts` | includes copy_to_local_favorites mock shape |

## Not covered (audit list)

- End-to-end Tauri IPC tests for favorites in CI (**MISSING**)
- GalleryPage integration tests for full add/unfavorite (**MISSING**)
- Manual smoke checklist from INVARIANTS (**UNVERIFIED** execution)
- `undo_favorite_removal` (stub — no tests expected)
- Concurrent `run_file_operation` from two windows (**MISSING** — single process locks only)
- Real Windows Recycle Bin permission failures (**PARTIAL** — depends on OS)

## Regression docs

[`FAVORITES_TRASH_LIFECYCLE_FINAL_REPORT.md`](../../refactoring/FAVORITES_TRASH_LIFECYCLE_FINAL_REPORT.md) records 2026-10-16 automated PASS + manual smoke **not** confirmed.
