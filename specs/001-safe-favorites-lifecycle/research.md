# Research: Safe Favorites Lifecycle

**Feature**: `001-safe-favorites-lifecycle`  
**Date**: 2026-10-17  
**Sources**: `docs/audit/favorites/`, live code, `spec.md` clarifications CL-00 / CL-P01–P05

## R1 — Identity of «confirmed original»

**Decision**: Tiered verification without full-library hashing.

| Tier | When | Check |
|------|------|--------|
| T0 | Path lookup | Normalize Windows path keys (`path_key`, `\\?\` strip) — existing `database` tests |
| T1 | Snapshot row match | `(origin_path, origin_size, origin_modified_at)` PK + `content_sha256` if stored |
| T2 | Target empty or same inode | Before relocate to stored origin parent: destination missing OR `files_bytes_identical` / hash match vs snapshot |
| T3 | On ambiguity | Treat as identity conflict (CL-00) — no overwrite |

**Implementation rule (tasks T009–T011, T032):** `size` / `mtime` are **pre-filters only** — not sufficient to prove «confirmed original» or to authorize recycle/delete. Content proof (`content_sha256` and/or `files_bytes_identical`) is **required** before overwrite, return-to-source, or destructive unfavorite when a file already exists at the target path. Matching content alone does **not** auto-authorize delete if classification is ambiguous (FR-011b / CL-P03). Re-validate immediately before FS mutation (TOCTOU).

**Rationale**: Spec forbids per-album-open full hash scan (CL-P01). `record_favorite_link` already stores SHA-256 (`pipeline/mod.rs` `record_favorite_link`). `execute_relocate` / `inspect_origin` use size/mtime/hash selectively (`favorites.rs`).

**Alternatives rejected**: Filename-only (violates INV-06); always hash on open (violates CL-P01).

## R2 — Missing vs temporarily unavailable origin (CL-P04)

**Decision**: Classify FS errors into `Accessible` | `Missing` | `Unavailable`.

- `Unavailable`: `ERROR_PATH_NOT_FOUND` on removable drive, `ERROR_NOT_READY`, sharing violation transient — do not purge SQLite link; star state from last confirmed disk check.
- `Missing`: confirmed absent after successful parent listing or stable `NotFound` on fixed volume — may route to FR-11, not auto-delete copy.

**Evidence gap**: No single `OriginAvailability` enum today — **new small module** in `favorites.rs` or `favorites/classify.rs` (plan prefers extend `classify`).

## R3 — Reconcile trigger schedule (CL-P01)

**Decision**:

| Trigger | Action |
|---------|--------|
| `Pipeline::start` | Keep `reconcile_on_boot` (unfinished `file_op_log`) |
| After `execute_file_operation` / removal IPC completes | Call `reconcile_pending_for_directory(directory)` — scoped rows only |
| Album open (`begin_directory_session` or UI after browse ready) | Light pass: refresh stars via `active_favorite_origins_in` + optional metadata reconcile for open album prefix (no file deletes) |

**Alternatives rejected**: Timer polling entire DB; hash all copies on open.

**Load cap**: Debounce album-open reconcile 300–500 ms; skip if same `directoryKey` within 2 s unless forced by file-op completion.

## R4 — Explorer sync scope (CL-P02)

**Decision**: On `folder-changed` when session matches:

1. If path is open album or its active Favorites child or local trash under album — `refreshRef` (existing) **plus** `favorite_origin_paths` refetch **plus** scoped reconcile metadata for that prefix.

**Evidence**: `galleryPipelineEvents.ts` only calls `refreshRef` today — **gap** vs CL-P02.

**No auto-link**: Do not call `record_favorite_copy` for files appearing in Favorites without prior add op.

## R5 — FR-11 vs `needs_confirm` routing (CL-P03)

**Decision matrix**:

| Condition | UI | Backend |
|-----------|-----|---------|
| `Plan::Recycle` + verified origin | Optional single confirm if kind requires | `recycle_distributed` |
| `ConfirmKind` origin_changed / copy_changed / ambiguous + verified | Existing `unfavoritePrompt` or batch lines | `dispatch` with confirm |
| Origin missing / unverified / possible last instance | **New FR-11 dialog** (A–D) | No `recycle` until explicit resolution; relocate only after A/B with T2 checks |
| `OriginInTrash` | `FavoriteTrashUnfavoriteDialog` (existing) | `restore_origin` / `recycle_copy` |

**Critical code gap**: `dispatch_removal_plan` on `NeedsConfirm` + `confirmed` + no `resolution` calls `relocate_distributed` immediately (`favorites.rs` ~411–429) — conflicts with FR-11 for `unknown_origin` if UI only shows «move» confirm.

**UI gap**: `unknown_origin` uses `unfavoritePromptCopy` (move label only) — not full A–D (`GalleryPage.tsx` ~3700).

## R6 — FS ok / SQLite lag (CL-P05)

**Decision**: Reuse `file_op_log` + `ST_NEEDS_RECONCILIATION`; UI maps incomplete journal to «needs review» notice; stars from `favorite_origin_paths` (disk-based) not optimistic success.

**Evidence**: `record_operation_links` already sets `ST_NEEDS_RECONCILIATION` on link failure; no user notice — **new UI only**.

## R7 — IPC / SQLite changes

**Decision**: Prefer **no schema migration**. Optional additions:

- IPC: `list_favorites_reconcile_notices(directory)` → `{ count, samplePaths[] }` **or** fold into extended `favorite_origin_paths` response with `reconcilePending: boolean` (breaking TS — version field).

Minimal path: **frontend-only** notice driven by `FileOperationResult` outcomes + new optional field on removal results `reconcileSuggested: boolean` (serde optional, backward compatible).

## R8 — Stale session

**Decision**: Keep directory key match for file ops (`GalleryPage` result.directory); add reconcile refetch guarded by `favoritePathsServerSync` tickets (existing).

**Audit note**: Favorites IPC lacks session id (I1 partial) — plan does not add session to all IPC unless phase 6 integration proves necessary.

## R9 — Batch ambiguous files (CL-P03)

**Decision**: Extend `preview_remove_favorite_copies` bucketing: `fr11Required[]` vs `standardConfirm[]` vs `ready[]`. Batch UI: subgroup FR-11 wizard or per-file sequential (product: same guarantees; plan recommends single batch sheet listing counts per bucket).

## Open technical questions (for implementation tasks)

1. Exact debounce constants for album-open reconcile (measure on HDD fixture).
2. Whether `favorite_origin_paths` should prune metadata in reconcile pass or separate `reconcile_favorites_metadata` command.
3. Folder picker IPC reuse for FR-11 action B (`resolve_external_drop` / existing folder dialog).
