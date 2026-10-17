# Data Model (plan): Safe Favorites Lifecycle

Canonical product entities: `spec.md` § Key Entities. This file adds **implementation-facing** state (no schema migration required for v1).

## Persistent (SQLite)

| Store | Role | Change in feature |
|-------|------|-------------------|
| `favorite_copies` | Origin↔copy link + keys + hash | Reconcile may update rows; **no** delete-on-list; safe prune only when confirmed deletion |
| `file_op_log` | Journal (`OP_ADD_TO_FAVORITES`, `OP_REMOVE_FROM_FAVORITES`, restore/trash) | Drive CL-P05 notices; existing statuses `ST_*` |
| `trash_entries` | Local trash origin mapping | Explorer sync within album scope |
| `favorite_undo` | Legacy | No new writes; boot cleanup only |

## Filesystem

| Artifact | Role |
|----------|------|
| `Избранное` / `Избранная` + `.stitchvue.role` | Active Favorites detection |
| Copy files under active Favorites | Star eligibility via `active_favorite_origins_in` |
| Windows Recycle Bin | Unfavorite undo channel (FR-06) |

## Runtime (frontend)

| State | Module | Notes |
|-------|--------|-------|
| `favoritePaths` | `GalleryPage` | Confirmed stars |
| `favoriteOverlay` | `favoriteOptimisticOverlay.ts` | CL-P05: clear on indeterminate |
| `favoritePathsSync` tickets | `favoritePathsServerSync.ts` | Stale IPC guard |
| `unfavoriteGate` | `unfavoriteGate.ts` | Serializes unfavorite |
| `unfavoritePrompt` / `favoriteTrashUnfavorite` | `GalleryPage` | To split: FR-11 vs trash vs standard confirm |
| `fileNotice` | `GalleryPage` | Add «needs review» tone |

## Runtime (backend)

| State | Module |
|-------|--------|
| In-process op claim | `file_ops::claim` / `locks::try_lock_paths` |
| Pipeline DB mutex | `Pipeline::inner.db` |
| Board session | `pipeline` board.session (thumbnails; partial favorites) |

## New logical types (Rust + TS, no DB columns)

```text
OriginAvailability: PresentVerified | PresentUnverified | Missing | Unavailable
Fr11Resolution: return_to_source | choose_folder(path) | recycle_copy | cancel
ReconcileScope: { album_path, favorites_path?, trash_prefix? }
```

## Identity conflict (CL-00)

```text
IdentityCheckResult:
  OkConfirmedOriginal
  TargetOccupiedByOtherFile   → block overwrite
  OriginUnavailable           → CL-P04
  SnapshotStale               → needs_confirm or FR-11
```
