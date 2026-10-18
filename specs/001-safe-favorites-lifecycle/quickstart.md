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

## P3 CL-P05 notices (T024 architecture)

**Deferred:** no `favorites_reconcile_status` IPC. UI uses optional DTO fields `reconcileSuggested` / `fr11Required` on `RemoveFavoriteCopyResult` plus `favorite_origin_paths` disk refetch. Incomplete journal / needs-reconciliation → needs-review notice, never false full success.

## Phase 6 — EC-01–EC-22 trace (T051)

| EC | Coverage evidence (VERIFY-COND cites) |
|----|--------------------------------------|
| EC-01 | `p1_identity_t014a_missing_parent_no_mkdir` |
| EC-02 | `p0_safe_favorites_t004`; `p2_reconcile` Unavailable no purge |
| EC-03 | `p1_identity_t012_name_collision_no_overwrite` |
| EC-05 | `p2_reconcile` T022a no invent link by basename |
| EC-07 / EC-13 | `p1_identity_t013_cross_volume_fail_keeps_source` |
| EC-08 | **cite** `favorites_copy_recovery` (T047 skip new) |
| EC-09 | **cite** `reconcile_on_boot` / trash CP in `favorites_trash_lifecycle_final` (T048 skip new) |
| EC-10 | `p5_batch` mixed missing-origin; FE `partitionFr11Required` / bucketUnfavoriteUiTargets |
| EC-11 | **cite** `favorites_lifecycle.rs` + `favoritesCollectionLifecycle.test.ts` |
| EC-12 / EC-22 | `p0_safe_favorites_t002` occupied origin |
| EC-14 | `p1_identity_t014_permission_denied_keeps_copy` |
| EC-16 | `directorySession.test.ts` EC-16 stale session |
| EC-17 | P1 revalidate + P4 identity before FS |
| EC-18 | `p4_dispatch` T033 in-flight |
| EC-19 | `p1_identity_t014b` extended/Unicode/reparse |
| EC-20 | `removeFavoritesBatch` T046 partial |
| EC-21 | `p2_reconcile` T022b orphan not deleted |

**T001:** GREEN after P4a T030 (`p0_safe_favorites_t001`).

## Manual smoke checklist (T053 / SC-010)

Fixtures / disposable albums only — never production libraries.

1. Add favorite → original unchanged; star on after disk refetch.
2. Batch add with partial fail → needs-review / partial notice, not false full success.
3. Star off verified origin → recycle/relocate per plan; original kept.
4. Missing origin → FR-11 A–D; cancel leaves copy; A relocates with identity; B choose folder; C keep.
5. Explorer rename origin → no invented link; star truthful after refetch.
6. Rapid folder switch → stale session does not apply previous favorites events (EC-16).
7. Mass unfavorite mixed FR-11 + ready → per-bucket; IPC fail → disk-truth refetch.
8. Cross-volume / permission failure → source copy retained.

## FR-006 undo

In-app `undo_favorite_removal` remains a stub: UI surfaces backend error and directs recovery via Windows Recycle Bin (GalleryPage `undoFavoriteRemovals`).
