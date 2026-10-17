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

## Phase 0 gates (VERIFY)

Sealed tasks (worktree branch `feat/safe-favorites-lifecycle`):

| SpecKit | Sealed task | Filter / entry |
|---------|-------------|----------------|
| T001–T004 | [`TASK-2026-FAV-P0-RUST-VERIFY`](../../docs/refactoring/tasks/TASK-2026-FAV-P0-RUST-VERIFY.md) | `cargo test p0_safe_favorites --` |
| T005–T006 | [`TASK-2026-FAV-P0-FE-VERIFY`](../../docs/refactoring/tasks/TASK-2026-FAV-P0-FE-VERIFY.md) | `mapRemovalToUiRoute.test.ts`, `removeFavoritesBatch.test.ts` |
| T007 | [`TASK-2026-FAV-P0-GATES-DOC`](../../docs/refactoring/tasks/TASK-2026-FAV-P0-GATES-DOC.md) | this section + baseline below |

### Recovery baseline (must stay GREEN)

```text
cd src-tauri
cargo test favorites_copy_recovery --
cargo test favorites_trash_lifecycle_final --
```

### T001 lifecycle (red until T030)

- **P0–P3:** `p0_safe_favorites_t001_unknown_origin_confirmed_must_not_relocate` **FAIL** is expected — reproduces `dispatch_removal_plan` auto-relocate on `unknown_origin` + `confirmed` without FR-11 resolution.
- Do **not** `#[ignore]` or weaken the assert to green CI.
- **After T030 (P4):** the same test **must PASS**.

Recorded P0 results (temp/fixture only):

| ID | Result |
|----|--------|
| T001 | RED (expected) |
| T002–T004 | PASS |
| T005–T006 | PASS |
| Baseline recovery suites | PASS |

### Gate to P1

Start P1 sealed tasks only when:

1. Recovery baseline above is GREEN.
2. T002–T006 match the §7 reports in the P0 Rust/FE tasks (T001 may remain RED).
3. This Phase 0 gates section is present and accurate.

P1 still requires a **separate** owner-delegated seal scope (not covered by P0 approval).

## Sealed tasks

Each implementation phase → `docs/refactoring/tasks/TASK-*.md` per `TASK_HANDOFF.md` (risk **high** for FS/SQLite/IPC).

## P2 reconcile triggers (T017 architecture)

**No new IPC command** for scoped reconcile on album open — FE reuses `favorite_origin_paths`.

| Trigger | Where | Role |
|---------|--------|------|
| Post-op BE | `pipeline` after `CopyToLocalFavorites` (`finish_op`) | Metadata-only `reconcile_favorites_scope` (CL-P01.2) |
| Album open | FE `favoritesReconcile` debounce → `favorite_origin_paths` | Light star refetch; closes remove-gap when BE post-op not hooked |
| `folder-changed` | `galleryPipelineEvents` (session match) → refresh + favorites callback | Listing refresh + same star refetch (CL-P02) |

Remove/unfavorite completion is not BE post-op-hooked in P2; album-open + folder-changed refetch close that gap without a thin `commands/mod.rs` entry.
