# Implementation Plan: Safe Favorites Lifecycle

**Branch**: `001-safe-favorites-lifecycle` | **Date**: 2026-10-17 | **Spec**: [spec.md](./spec.md)

**Input**: Approved spec + clarifications CL-00, CL-P01–P05 + audit `docs/audit/favorites/`

## Summary

Deliver spec-compliant Favorites lifecycle with **minimal delta**: extend existing copy/removal/reconcile pipeline, tighten identity checks and dialog routing, add scoped reconcile triggers and user notices — without gallery/thumbnail rewrite or SQLite schema migration.

**Critical gaps vs spec** (code-verified):

1. FR-11 A–D UI incomplete (`unknown_origin` → simple move confirm only).
2. `dispatch_removal_plan` may auto-relocate on `NeedsConfirm` + `confirmed` without FR-11 resolution.
3. CL-P01/P02: no post-op / album-open / Explorer favorites metadata reconcile (only `reconcile_on_boot` + listing filter).
4. CL-P05: no «needs review» UI for `ST_NEEDS_RECONCILIATION`.
5. Batch IPC total failure may mark all failed (`GalleryPage` catch — audit residual).

No product contradiction with spec; gaps are implementation debt to close.

---

## Technical Context

| Item | Value |
|------|--------|
| **Languages** | TypeScript (React), Rust (Tauri 2) |
| **Storage** | SQLite app DB + filesystem copies |
| **Testing** | `cargo test` (temp dirs), `npm test` / `node --test` |
| **Platform** | Windows desktop |
| **Constraints** | No per-open full hash; no FS+SQLite atomicity; sealed high-risk tasks |
| **Performance** | Debounced light reconcile on album open; scope limited to open album + active Favorites + local trash |

---

## Constitution Check

| Principle | Plan compliance |
|-----------|-----------------|
| I File safety | All phases prioritize no overwrite / no silent delete; CL-00 enforced in relocate paths |
| II Invariants | Aligns `docs/INVARIANTS.md` I4–I10; documents I1 partial for favorites IPC |
| III Session | Preserves `favoritePathsServerSync`; no regression to directory session for gallery events |
| IV Sealed tasks | Each phase → `docs/refactoring/tasks/TASK-*.md`, high risk for FS/SQLite/IPC |
| V Evidence | Phases start with tests; audit gaps explicitly listed |
| Audit-before-specify | Honored |
| CL-P01–P05 | Addressed in phases 2–5 |

**Gate**: PASS — no unjustified constitution violations. Complexity table empty.

---

## 1. Existing architecture (short map)

```text
GalleryPage
  ├─ add: favoriteOptimisticOverlay → run_file_operation(copy_to_local_favorites)
  │       → Pipeline::execute_file_operation → file_ops::copy_one
  │       → record_operation_links → record_favorite_copy
  ├─ stars: favorite_origin_paths → active_favorite_origins_in (Rust)
  ├─ toggleFavoriteFile: remove_favorite_copy (origin path in album)
  ├─ mass unfavorite: preview_remove_favorite_copies → remove_favorite_copies_batch
  ├─ dialogs: unfavoritePrompt, FavoriteTrashUnfavoriteDialog
  └─ events: galleryPipelineEvents (folder-changed → refreshRef only)

Rust: commands → Pipeline → file_ops::{execute, favorites, reconcile, recycle}
SQLite: favorite_copies, file_op_log, trash_entries
Boot: reconcile_on_boot (pipeline/mod.rs ~353)
```

---

## 2. Requirement traceability

Legend: **OK** implemented | **REUSE** extend | **FIX** behavior bug | **NEW** capability | Tests in parentheses.

| Req | Current | Change | Tests |
|-----|---------|--------|-------|
| FR-001 add copy | `copy_one`, overlay, `record_favorite_link` | **REUSE**; **FIX** CL-P05 outcome messaging | `file_ops` tests, `favoriteOptimisticOverlay` |
| FR-002 stale links | Stars filter disk; no background metadata reconcile | **NEW** scoped reconcile job (R3) | new Rust integration tests |
| FR-003 FS/SQLite | `reconcile_on_boot`, `ST_NEEDS_RECONCILIATION` | **NEW** UI notice; post-op reconcile | `favorites_copy_recovery`, CP tests |
| FR-004 star off album | `toggleFavoriteFile` + `remove_favorite_copy` | **REUSE** + CL-P03 routing | `removeFavoritesBatch` |
| FR-005 Explorer | `folder-changed` → listing refresh only | **FIX** favorites refetch + scoped reconcile | new integration test |
| FR-006 undo | Stub IPC | **FIX** UI copy only (no invoke) | manual |
| FR-007 album move | No auto re-link | **OK** document; guard in reconcile | — |
| FR-008 batch add | Per-outcome partial success | **REUSE**; **FIX** IPC total failure handling | `removeFavoritesBatch`, GalleryPage test |
| FR-009 rename Favorites | `rename_folder` + DB rewrite | **OK** | `favorites_lifecycle` |
| FR-010 delete origin | Copy independent | **OK** | lifecycle tests |
| FR-011 / FR-011a/b | Partial dialogs; backend relocate/recycle | **FIX** UI FR-11; **FIX** dispatch routing | new TS + Rust tests |
| FR-012–014 safety | locks, claim, journals, temp copy | **REUSE** extend identity in relocate | existing + new |
| FR-015–017 UI | Partial notices | **NEW** needs-review + FR-11 strings | i18n-check |
| CL-00 identity | Hash in DB; `files_bytes_identical` in places | **FIX** enforce on all return-to-source paths | EC-12/22 cases |
| CL-P01 triggers | Boot only | **NEW** post-op + album-open debounced | SC-011 |
| CL-P02 scope | Partial | **NEW** wire trash + favorites paths | SC-007 |
| CL-P03 routing | Overlapping confirms | **FIX** matrix R5 | SC-014 |
| CL-P04 unavailable | Not distinguished | **NEW** `OriginAvailability` | SC-012 |
| CL-P05 SQLite lag | Journal exists | **NEW** UI + no false success | SC-013 |
| EC-01–22 | Mixed in audit matrix | Map per EC in phase tests | SC-008 |

---

## 3. Reuse list

- `file_ops::execute` / `copy_one` / `claim` / `try_lock_paths`
- `record_favorite_copy`, `active_favorite_origins_in`, `favorites.rs` classify/remove
- `reconcile.rs` / `reconcile_on_boot`
- `favoriteOptimisticOverlay`, `favoritePathsServerSync`, `unfavoriteGate`
- `removeFavoritesBatch` bucketing
- `FavoriteTrashUnfavoriteDialog` (origin in trash)
- Fault-injection tests `favorites_trash_lifecycle_final`, `favorites_copy_recovery`

---

## 4. New / materially changed components

| Component | Layer | Purpose |
|-----------|-------|---------|
| `reconcile_favorites_scope` (fn/module) | Rust | CL-P01 light metadata reconcile for one album |
| `OriginAvailability` + identity gate | Rust | CL-P04, CL-00 before relocate |
| `FavoriteMissingOriginDialog` (or extend widget) | React | FR-11 A–D |
| `favoritesReconcile.ts` (lib) | React | Debounced album-open + post-op hooks |
| `mapRemovalToUiRoute` | React | CL-P03: FR-11 vs confirm vs trash |
| Optional `favorites_reconcile_status` IPC | Rust | CL-P05 notice feed |

No new npm/cargo dependencies anticipated.

---

## 5. SQLite & IPC changes

| Area | Migration? | Plan |
|------|------------|------|
| SQLite schema | **No** | Use `file_op_log`, existing columns |
| IPC breaking | **Avoid** | Optional serde fields on existing DTOs |
| New command | **Optional** | `favorites_reconcile_status` if frontend cannot derive |

See [contracts/ipc-favorites-lifecycle.md](./contracts/ipc-favorites-lifecycle.md).

---

## 6. File-loss risks & mitigations

| Risk | Mitigation |
|------|------------|
| Overwrite on return-to-source | T2 identity + CL-00 block; `path_is_free` / hash |
| Auto relocate deletes last copy | CL-P03: FR-11 before recycle; fix dispatch |
| Reconcile deletes user photos | Spec forbid; implement metadata-only reconcile |
| False star / false success | CL-P05; overlay rollback; journal states |
| Batch partial → total fail UI | Verify disk before marking all failed |
| TOCTOU confirm → execute | Revalidate plan (`revalidate_*` exists — extend) |
| Cross-disk move partial | Keep source until dest verified (existing relocate pattern) |
| Concurrent ops | `try_lock_paths` + unfavoriteGate |
| Stale directory UI | `result.directory` check + sync tickets |

---

## 7. FR-11 design

**Route**:

```text
User unfavorite (Favorites folder or ambiguous)
  → preview_remove_favorite_copy (optional)
  → if fr11Required: FavoriteMissingOriginDialog
       A: relocate to stored parent if T2 ok else conflict UI
       B: folder picker → relocate with T2
       C: recycle with extra confirm
       D: cancel
  → else if origin_in_local_trash: FavoriteTrashUnfavoriteDialog
  → else if needs_confirm (verified): single unfavoritePrompt
  → else remove_favorite_copy(confirmed, resolution)
```

**Backend**: Introduce explicit `resolution` enum values for FR-11 A/B/C matching `relocate_distributed` / `recycle` with identity checks — extend beyond `recycle_copy` | `restore_origin`.

**Batch**: Preview buckets `fr11Required`; batch sheet shows counts; execute per-file resolutions (no auto-delete bucket).

**Mass safety**: Same as single — EC-10.

---

## 8. Sync design (CL-P01–P05)

| Event | Action |
|-------|--------|
| App start | `reconcile_on_boot` (keep) |
| Favorites file-op ends | `reconcile_favorites_scope(album)` + refetch stars |
| Album open (debounced) | Light metadata reconcile + `favorite_origin_paths` |
| `folder-changed` (in scope) | `refreshRef` + favorites refetch + scoped reconcile |
| Unavailable disk | Skip purge; set internal unavailable; retry next event |
| Persistent failure | `fileNotice` needs-review (i18n) |

**Not in scope**: library-wide scan; per-open SHA-256 of all copies.

---

## 9. Architecture decisions (ADRs summary)

| ID | Problem | Decision | Modules | Risk |
|----|---------|----------|---------|------|
| ADR-1 | CL-P01 triggers | Debounced scoped reconcile fn | `reconcile.rs`, `pipeline` | Medium — load |
| ADR-2 | CL-00 | Tiered identity T0–T3 | `favorites.rs` relocate | High — file loss if wrong |
| ADR-3 | FR-11 UI | New dialog vs extend | `widgets/favorites-*` | Medium — UX |
| ADR-4 | CL-P03 dispatch | Gate auto-relocate on `unknown_origin` | `dispatch_removal_plan` | **High** |
| ADR-5 | CL-P05 notice | Optional IPC vs parse last op result | commands + GalleryPage | Low |

Alternatives for ADR-1: only boot reconcile — **rejected** (fails CL-P01/SC-007).

---

## 10. Phased implementation strategy

Each phase = one sealed **high** task (or medium for pure UI strings if no FS). Stop if `allowed_paths` exceeded.

### Phase 0 — Test harness & safety nets

**Goal**: Regression tests for CL-00, CL-P05, dispatch routing before behavior change.

**Done when**: New tests fail on current main demonstrating gaps; existing suites green; **P0 baseline** green: `favorites_copy_recovery`, `favorites_trash_lifecycle_final` (see tasks T007).

**Stop if**: Cannot reproduce gaps in temp dirs.

**Modules**: `favorites.rs` tests, `removeFavoritesBatch.test.ts`, optional GalleryPage extract.

---

### Phase 1 — Identity & relocate safety (CL-00, FR-011a)

**Goal**: `execute_relocate` / return-to-source refuses overwrite when file at target ≠ confirmed original; unavailable ≠ missing.

**Done when**: EC-12/EC-22 tests pass; SC-015.

**Stop if**: Requires schema change (escalate).

**Modules**: `src-tauri/src/file_ops/favorites.rs` (+ small helper).

---

### Phase 2 — Reconcile triggers (CL-P01, CL-P02, CL-P04 partial)

**Goal**: `reconcile_favorites_scope`; hook post file-op + album open + folder-changed favorites refetch.

**Done when**: SC-011, SC-007 (latency note in task); Explorer delete copy → star off.

**Stop if**: Performance regression > agreed budget on HDD fixture.

**Modules**: `reconcile.rs`, `pipeline/mod.rs`, `galleryPipelineEvents.ts`, `GalleryPage` fetch favorites.

---

### Phase 3 — CL-P05 notices & false success

**Goal**: UI «needs review»; no full success on link failure; optional IPC status.

**Done when**: SC-013, SC-009.

**Modules**: `GalleryPage`, `record_operation_links` outcome handling, i18n.

---

### Phase 4 — FR-11 UI + dispatch (CL-P03, FR-011b)

**Goal**: Full A–D dialog; fix `dispatch_removal_plan` routing; no duplicate confirms.

**Done when**: SC-005, SC-014; manual smoke §6–7 in quickstart.

**Modules**: new dialog widget, `GalleryPage`, `favorites.rs` dispatch, resolutions IPC DTO.

---

### Phase 5 — Batch & mass ambiguous (EC-10, FR-008 edge)

**Goal**: Batch buckets for FR-11; IPC total-failure disk verify.

**Done when**: SC-004, SC-014 batch; audit F11 gap closed.

**Modules**: `favorites_batch.rs`, `removeFavoritesBatch.ts`, `GalleryPage` mass unfavorite.

---

### Phase 6 — Integration & release

**Goal**: E2E-style tests Rust+TS; manual smoke log; guardian review.

**Done when**: SC-008, SC-010; `docs/INVARIANTS.md` statuses updated if needed.

---

## Project Structure

```text
specs/001-safe-favorites-lifecycle/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/ipc-favorites-lifecycle.md
├── spec.md
└── checklists/requirements.md

Implementation (future):
src/pages/gallery/GalleryPage.tsx
src/features/favorites/lib/*
src/widgets/favorites-*/*
src-tauri/src/file_ops/{favorites.rs,reconcile.rs,mod.rs}
src-tauri/src/pipeline/mod.rs
src-tauri/src/commands/mod.rs
```

---

## Complexity Tracking

(empty — no constitution violations)

---

## Open technical questions

1. Debounce interval for album-open reconcile (measure).
2. Single vs separate IPC for reconcile status (Phase 3 decision).
3. Folder picker reuse API for FR-11 B (align with trash restore).
4. Whether to add `session` to favorites IPC (I1) — defer unless phase 6 finds stale bugs.

---

## Audit vs code discrepancies

| Audit claim | Code check |
|-------------|------------|
| `undo` stub | Confirmed `pipeline/mod.rs` ~1322 |
| Batch per-file failure | Confirmed `favorites_batch.rs` |
| No Explorer favorites DB sync | Confirmed — only `refreshRef` on folder-changed |
| FR-11 full dialog | **Spec ahead of UI** — audit noted partial; plan closes gap |

---

## SpecKit next step

Run `/speckit-tasks` to produce planning `tasks.md` (not sealed `docs/refactoring/tasks/`). Implementation uses sealed tasks per phase above.
