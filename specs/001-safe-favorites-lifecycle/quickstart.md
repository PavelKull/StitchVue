# Quickstart: Safe Favorites (dev verification)

**Fixtures only** — never user photo libraries or production SQLite.

## Prerequisites

```text
npm install
```

## Targeted tests (baseline before changes)

```text
cd src-tauri
cargo test favorites_copy_recovery --
cargo test favorites_trash_lifecycle_final --
cargo test favorites_lifecycle --
cargo test favorites_batch::
cargo test reconcile::
```

```text
npm test -- src/features/selection/lib/removeFavoritesBatch.test.ts
npm test -- src/features/favorites/lib/favoritePathsServerSync.test.ts
npm test -- src/features/favorites/lib/favoriteOptimisticOverlay.test.ts
```

## Manual smoke (after implementation phases)

1. Add single favorite → original unchanged, copy in `Избранное`, star on.
2. Batch add 10 files → partial fail inject (read-only dest) → «N of M» message.
3. Star off from album → copy in Recycle, original remains.
4. Delete origin in Explorer → copy remains, star off after folder refresh.
5. Rename `Избранное` → files remain, stars off, new favorite creates new folder.
6. Unfavorite copy with deleted origin → FR-11 dialog; cancel leaves copy.
7. Place new file at old origin path → «return to source» must not overwrite (CL-00).
8. Rapid folder switch during add → no wrong-directory stars.

## Sealed tasks

Each implementation phase → `docs/refactoring/tasks/TASK-*.md` per `TASK_HANDOFF.md` (risk **high** for FS/SQLite/IPC).
