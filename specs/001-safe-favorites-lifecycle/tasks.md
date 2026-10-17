---
description: "Actionable task decomposition for Safe Favorites Lifecycle (plan phases 0–6)"
---

# Tasks: Safe Favorites Lifecycle

**Input**: [spec.md](./spec.md), [plan.md](./plan.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/ipc-favorites-lifecycle.md](./contracts/ipc-favorites-lifecycle.md)

**Prerequisites**: Approved spec (clarify complete), plan phases 0–6, audit `docs/audit/favorites/`

**Governance**: This file is **SpecKit planning only**. Each implementation slice MUST become a **sealed** task under `docs/refactoring/tasks/` per [TASK_HANDOFF.md](../../docs/refactoring/TASK_HANDOFF.md) (`--seal`, `--preflight`, `--auth`, `--strict`). **Do not** auto-create sealed tasks from this document.

**Risk legend**

| Label | Meaning |
|-------|---------|
| **HIGH** | Production FS / SQLite / IPC mutation — sealed **high** + auditor |
| **VERIFY** | Mandatory automated test — sealed **medium** (or bundled in HIGH phase task) |
| **VERIFY-COND** | Automated test only if T051 shows no equivalent existing coverage; skip requires documented proof in T051 |
| **MED** | React state / hooks / dialogs |
| **LOW** | i18n, docs, manual smoke |

**Identity gate (T009–T011, T032)** — applies to all relocate/restore/destructive unfavorite paths:

- `size` / `mtime`: pre-filter only; **not** sufficient to confirm origin identity.
- Content: `content_sha256` and/or `files_bytes_identical` **required** when proving «same file» or before writing to an occupied path.
- Content match **does not** auto-authorize recycle/delete if plan/classification is ambiguous (CL-P03).
- Overwrite of an unrelated file at target path: **forbidden**; stop with identity conflict (CL-00).
- Re-run full gate immediately before FS mutation after user confirm (TOCTOU, EC-17).

**GalleryPage rule**: Tasks touching `src/pages/gallery/GalleryPage.tsx` in P2–P5 (**T020, T025, T036, T043, T044b, T050**) MUST run **sequentially** in phase order — no parallel edits to that file.

**Format**: `- [ ] [TaskID] [P?] [Phase] Short description with file path` — metadata in [Task catalog](#task-catalog).

---

## Phase 0 — Test harness & safety nets

**Goal**: Failing regression tests for known gaps; **P0 recovery baseline** green before any production FS change.

**Checkpoint**: New tests fail on `main` where gaps exist (except see T001 lifecycle below); baseline suites green (T007).

**Recovery gate (P0)**: `cargo test` modules `favorites_copy_recovery`, `favorites_trash_lifecycle_final` (and existing `reconcile_on_boot` coverage therein) — **mandatory green** before sealing P1+.

**T001 lifecycle (red → green, not a P0 failure):**

- **P0–P3**: T001 **must fail** on current `main` — it reproduces the known `dispatch_removal_plan` defect (`unknown_origin` + `confirmed` → auto-relocate). A failing T001 does **not** block P0 completion if T002–T006 and T007 baseline pass.
- **P4**: **T030** fixes production dispatch; **forbidden** to weaken T001 assertions to force green.
- **After T030**: T001 **must pass**; sealed P4 is not complete until T001 is green.

**Sealed task hint**: VERIFY bundle (P0) + optional FE VERIFY — split by layer.

- [ ] T001 [P] [P0] [VERIFY] Add Rust test: `NeedsConfirm` + `confirmed` without FR-11 resolution must not call `relocate_distributed` for `unknown_origin` in `src-tauri/src/file_ops/favorites.rs` (expect **fail** until T030)
- [ ] T002 [P] [P0] [VERIFY] Add Rust test: return-to-source with different file at stored origin path aborts without overwrite (EC-12, EC-22, CL-00) in `src-tauri/src/file_ops/favorites.rs` or `favorites_copy_recovery`
- [ ] T003 [P] [P0] [VERIFY] Add Rust test: scoped reconcile stub is metadata-only — no user photo delete in `src-tauri/src/file_ops/reconcile.rs` tests (blocks T015)
- [ ] T004 [P] [P0] [VERIFY] Add Rust test: unavailable volume does not purge `favorite_copies` row (EC-02, CL-P04) in `src-tauri/src/file_ops/favorites.rs`
- [ ] T005 [P] [P0] [VERIFY] Add frontend test: CL-P03 routing — unverified origin → FR-11 bucket in `src/features/favorites/lib/mapRemovalToUiRoute.test.ts`
- [ ] T006 [P] [P0] [VERIFY] Extend `src/features/selection/lib/removeFavoritesBatch.test.ts` for `fr11Required` preview bucket (EC-10)
- [ ] T007 [P0] [LOW] Document P0 sealed split + **recovery baseline** (`favorites_copy_recovery`, `favorites_trash_lifecycle_final`) in `specs/001-safe-favorites-lifecycle/quickstart.md` § «Phase 0 gates»

---

## Phase 1 — Identity & relocate safety (CL-00, FR-011a)

**Goal**: `OriginAvailability`; identity gate with content proof; no silent `mkdir` of deleted origin parent; cross-volume safety.

**Checkpoint**: SC-015; EC-01, EC-03, EC-12, EC-13, EC-14, EC-19 (favorites paths); T013 **gate** before T031.

**Depends on**: P0 VERIFY green (T001–T004, T007 baseline).

- [ ] T008 [P1] [HIGH] Implement `OriginAvailability` (Accessible | Missing | Unavailable) in `src-tauri/src/file_ops/favorites.rs`
- [ ] T009 [P1] [HIGH] Shared identity gate T0–T3 per [research.md](./research.md) R1 + identity rules above in `src-tauri/src/file_ops/favorites.rs`
- [ ] T010 [P1] [HIGH] Wire gate into `execute_relocate` / return-to-source: block overwrite; identity-conflict outcome (CL-00, FR-011a) in `src-tauri/src/file_ops/favorites.rs`
- [ ] T011 [P1] [HIGH] Re-run full gate in `revalidate_*` immediately before FS move after confirm (EC-17, FR-012) in `src-tauri/src/file_ops/favorites.rs`
- [ ] T012 [P] [P1] [VERIFY] Rust test: name collision — no overwrite (EC-03) in favorites test module
- [ ] T013 [P] [P1] [VERIFY] Rust test: cross-volume move failure keeps source (EC-07, EC-13) — **P1 recovery gate** before T031
- [ ] T014 [P] [P1] [VERIFY] Rust test: permission denied on target does not delete copy (EC-14)
- [ ] T014a [P] [P1] [VERIFY] Rust test: FR-11 A / relocate to stored origin parent — missing parent dir → error, **no** `create_dir_all` (EC-01) in `src-tauri/src/file_ops/favorites.rs` tests
- [ ] T014b [P] [P1] [VERIFY] Rust test: favorites path safety — extended `\\?\` + Unicode path keys; relocate/unfavorite rejects unsafe junction/reparse targets where applicable (EC-19) in `src-tauri/src/file_ops/favorites.rs` or `database` path_key tests

---

## Phase 2 — Reconcile triggers (CL-P01, CL-P02, CL-P04)

**Goal**: `reconcile_favorites_scope`; post-op + debounced album-open + `folder-changed` refetch; orphan copy never deleted by reconcile.

**Checkpoint**: SC-011, SC-007; EC-05, EC-21; **P2 not complete** until T022b green (after T015). EC-08 via P0 baseline + T051 trace.

**Depends on**: P1 T008; **T003 green before starting T015**; **T015 merged before T022b**.

**Order (no cycle):** `T003 → T015 → T022b` → then P3.

- [ ] T015 [P2] [HIGH] Implement `reconcile_favorites_scope` metadata-only in `src-tauri/src/file_ops/reconcile.rs`
- [ ] T016 [P2] [HIGH] Invoke scoped reconcile after favorites file-op completion in `src-tauri/src/pipeline/mod.rs` (CL-P01.2)
- [ ] T017 [P2] [MED] Document FE path: post-op reconcile in pipeline only; optional thin command in `src-tauri/src/commands/mod.rs` **only if** album-open cannot refetch without it (architecture note in sealed §2)
- [ ] T018 [P2] [MED] Debounced album-open reconcile + star refetch in `src/features/favorites/lib/favoritesReconcile.ts`
- [ ] T019 [P2] [MED] `folder-changed`: favorites refetch + scoped reconcile in scope in `src/features/gallery/model/pipeline/galleryPipelineEvents.ts`
- [ ] T020 [P2] [MED] Wire `favoritesReconcile` + `favorite_origin_paths` on album browse ready in `src/pages/gallery/GalleryPage.tsx` (**after** T018–T019; no parallel GalleryPage work in P3–P5)
- [ ] T021 [P] [P2] [VERIFY] Rust integration: post-op reconcile updates metadata without deleting copies (SC-011)
- [ ] T022 [P] [P2] [VERIFY] Rust test: scoped reconcile skips purge when origin `Unavailable` (CL-P04, EC-02)
- [ ] T022a [P] [P2] [VERIFY] Rust test: origin renamed in Explorer, SQLite unchanged — `active_favorite_origins_in` does not invent link by basename (EC-05) in `src-tauri/src/file_ops/favorites_lifecycle.rs` or `favorites.rs`
- [ ] T022b [P] [P2] [VERIFY] Rust test: orphan copy on disk without `favorite_copies` row — `reconcile_favorites_scope` does **not** delete file (EC-21) in `src-tauri/src/file_ops/reconcile.rs` tests (**after T015**; required before P3)

---

## Phase 3 — CL-P05 notices & false success

**Goal**: Disk-confirmed UI; «needs review»; no false full success.

**Checkpoint**: SC-013, SC-009, INV-04.

**Depends on**: P2 T020 (GalleryPage refetch). **P4 must not start** until P1 T009–T011 complete.

- [ ] T023 [P3] [MED] Optional `reconcileSuggested` / `fr11Required` on removal DTOs in `src-tauri/src/file_ops/favorites.rs` per [contracts/ipc-favorites-lifecycle.md](./contracts/ipc-favorites-lifecycle.md)
- [ ] T024 [P3] [MED] **Architecture gate**: optional `favorites_reconcile_status` IPC vs `file_op_log` in TS — defer unless T025 cannot use DTO + refetch
- [ ] T025 [P3] [MED] Map `ST_NEEDS_RECONCILIATION` to notice in `src/pages/gallery/GalleryPage.tsx` (after T020)
- [ ] T026 [P3] [MED] Disk-confirmed stars in `src/features/favorites/lib/favoritePathsServerSync.ts`
- [ ] T027 [P3] [MED] Optimistic rollback on indeterminate link in `src/features/favorites/lib/favoriteOptimisticOverlay.ts`
- [ ] T028 [P] [P3] [LOW] i18n keys for needs-review / partial success in `src/shared/locales/`
- [ ] T029 [P] [P3] [VERIFY] FE test: no full-success when journal incomplete in `src/features/favorites/lib/favoritePathsServerSync.test.ts`

---

## Phase 4 — FR-11 UI + dispatch (CL-P03, FR-011b)

**Goal**: Fix dispatch; full A–D dialog; backend re-identity + duplicate IPC guards.

**Checkpoint**: SC-005, SC-014, SC-015; **T001 green** after T030; FR-11 **A–D including B** before release (B may ship as **P4b** after P4a).

**Depends on**: **P1 complete** (T008–T011, T013 VERIFY); P2 T020 recommended; P3 T023 optional. **No P4 HIGH backend** until identity gate merged.

**P4a / P4b:** P4a — T030–T034, T036–T038 (dispatch + dialog A/C/D wiring). **P4b** — T035 action **B** (folder picker / choose destination), same widget; **release blocked** until P4b done.

- [ ] T030 [P4] [HIGH] Fix `dispatch_removal_plan`: no `relocate_distributed` for missing/unverified/`unknown_origin` without FR-11 resolution (CL-P03) in `src-tauri/src/file_ops/favorites.rs`
- [ ] T031 [P4] [HIGH] FR-11 resolution A/B/C with content gate at execute in `src-tauri/src/file_ops/favorites.rs` (after T013)
- [ ] T032 [P4] [HIGH] Full identity gate immediately before destructive `remove_favorite_copy` branch (FR-012, EC-17) in `src-tauri/src/file_ops/favorites.rs`
- [ ] T033 [P4] [HIGH] Duplicate IPC / in-flight guard for removal (EC-18, FR-013) in `src-tauri/src/file_ops/favorites.rs` + locks — **P4 recovery gate**
- [ ] T034 [P4] [MED] `mapRemovalToUiRoute` in `src/features/favorites/lib/mapRemovalToUiRoute.ts`
- [ ] T035 [P4] [MED] `FavoriteMissingOriginDialog` FR-11 **A–D** in `src/widgets/favorites-missing-origin-dialog/ui/FavoriteMissingOriginDialog.tsx` — **B** (choose another folder) via folder picker in **P4b** sub-sealed task; reuse trash-restore picker pattern; **mandatory for full FR-11 / release**
- [ ] T036 [P4] [MED] FR-11 wiring in `src/pages/gallery/GalleryPage.tsx` (after T025, before P5 T043)
- [ ] T037 [P4] [MED] `unfavoriteGate` in-flight token in `src/features/favorites/lib/unfavoriteGate.ts`
- [ ] T038 [P] [P4] [VERIFY] Rust: missing-origin unfavorite never recycles without resolution (SC-005)
- [ ] T039 [P] [P4] [VERIFY] FE: FR-11 cancel / identity conflict routing tests

---

## Phase 5 — Batch & mass ambiguous (EC-10, FR-008)

**Goal**: Batch buckets; disk-truth after IPC failure; partial errors.

**Checkpoint**: SC-004, SC-014; EC-10, EC-20.

**Depends on**: P4 **T030–T033**, **T044a**; FR-11 backend (T031) for ambiguous bucket execution.

- [ ] T040 [P5] [HIGH] Preview buckets (`fr11Required` / `standardConfirm` / `ready`) in `src-tauri/src/file_ops/favorites_batch.rs`
- [ ] T041 [P5] [HIGH] Per-item dispatch in `remove_favorite_copies_batch` in `src-tauri/src/file_ops/favorites_batch.rs`
- [ ] T042 [P5] [MED] Batch bucketing in `src/features/selection/lib/removeFavoritesBatch.ts`
- [ ] T043 [P5] [MED] Mass unfavorite UI in `src/pages/gallery/GalleryPage.tsx` (after T036)
- [ ] T044a [P5] [HIGH] Disk-truth helper: document + implement read-only recovery after IPC failure (`favorite_origin_paths` refetch; `Claim::Replay` for `run_file_operation` only when same `operationId` + proven replay) per [contracts/ipc-favorites-lifecycle.md](./contracts/ipc-favorites-lifecycle.md) — `src/features/favorites/lib/favoritesDiskTruthAfterIpc.ts` + pipeline/command touchpoints as needed
- [ ] T044b [P5] [MED] Use T044a in `src/pages/gallery/GalleryPage.tsx` for batch add / batch unfavorite catch paths — no «all failed» without disk truth (FR-008)
- [ ] T045 [P] [P5] [VERIFY] Rust batch: mixed missing-origin (EC-10)
- [ ] T046 [P] [P5] [VERIFY] FE partial batch (EC-20) in `removeFavoritesBatch.test.ts`

---

## Phase 6 — Integration & release

**Goal**: EC traceability table; supplemental regression; manual smoke (**additive** to SC-008 auto tests).

**Checkpoint**: SC-008 (auto for critical EC); SC-010.

**Depends on**: P1–P5 complete.

- [ ] T047 [P] [P6] [VERIFY-COND] Supplemental Rust regression **only if** T051 finds no equivalent: FS ok / SQLite lag (EC-08) — else cite `favorites_copy_recovery` / trash CP tests in T051
- [ ] T048 [P] [P6] [VERIFY-COND] Supplemental restart/journal regression **only if** T051 finds no equivalent (EC-09) — else cite `reconcile_on_boot` tests in T051
- [ ] T049 [P6] [VERIFY] FE stale session (EC-16) in `src/features/gallery/directorySession.test.ts` or extract
- [ ] T050 [P6] [LOW] FR-006 undo messaging in `src/pages/gallery/GalleryPage.tsx` (after T044b)
- [ ] T051 [P6] [LOW] EC-01–EC-22 trace table in `quickstart.md` — **EC-11**: cite existing `favorites_lifecycle.rs` + `favoritesCollectionLifecycle.test.ts` (no new EC-11 task)
- [ ] T052 [P6] [LOW] Update `docs/INVARIANTS.md` if behavior confirmed changed
- [ ] T053 [P6] [LOW] Manual smoke per `quickstart.md` (SC-010; **not** a substitute for SC-008 auto)

---

## Recovery gates (by phase)

| Phase | Gate | Tasks / evidence |
|-------|------|------------------|
| P0 | Journal / FS recovery baseline | T007: `favorites_copy_recovery`, `favorites_trash_lifecycle_final` green |
| P1 | Cross-volume partial failure | T013 green before T031 |
| P2 | Scoped reconcile no-delete | **T003** before **T015**; **T022b** after T015, green before **P3** |
| P4 | Dispatch + duplicate IPC | T001 → T030; T033 |
| P5 | Batch disk truth | T044a before T044b |
| P6 | Release trace + smoke | T051, T053 |

---

## Dependencies & execution order

### Phase dependencies

| Phase | Depends on | Blocks |
|-------|------------|--------|
| P0 | — | All VERIFY + baseline |
| P1 | P0 | P2, **P4 backend** |
| P2 | P1 T008; T003 | P3 T020 |
| P3 | P2 T018–T020 | P4 UI (optional DTO) |
| P4 | **P1 T009–T011, T013**; P2 T020 recommended; P4b (T035 B) before release | P5 |
| P5 | P4 T030–T033, T031, **T044a** | P6 |
| P6 | P1–P5 | Release |

### Task dependency graph (critical path)

```text
T007 baseline → P1+
T001 (red P0–P3) → T030 (green T001) → P4 sign-off
T001,T002 → T030,T010
T008 → T015,T022
T009,T010,T011,T013 → T031,T032
T003 → T015 → T022b → P3
T015,T016 → T018,T019 → T020
T030,T031,T033 → T040,T041
T044a → T044b; T036 before T043; T035 P4b before release
```

### Parallel opportunities (safe)

| Group | Tasks | Condition |
|-------|-------|-----------|
| P0 VERIFY | T001–T006 | Different files |
| P1 VERIFY | T012–T014b | After T009 stub |
| P2 backend vs FE libs | T015–T016 ∥ T018–T019 | **Not** `GalleryPage.tsx` |
| P3 | T028 ∥ T026–T027 | No GalleryPage conflict |
| P4 VERIFY | T038–T039 | After T030 |

**Not parallel**: `GalleryPage.tsx` (T020 → T025 → T036 → T043 → T044b → T050).

---

## Task catalog

### Phase 0

| ID | Goal | Modules | Deps | FR / INV / EC / CL | Tests | Acceptance | Risk |
|----|------|---------|------|-------------------|-------|------------|------|
| T001 | Dispatch guard test | `favorites.rs` | — | FR-011b, CL-P03, EC-10 | VERIFY | **Fails P0–P3**; passes after T030; no weakened asserts | VERIFY |
| T002 | CL-00 overwrite | `favorites.rs` | — | CL-00, EC-12/22 | VERIFY | No overwrite | VERIFY |
| T003 | Reconcile no delete | `reconcile.rs` | — | FR-002, INV-07 | VERIFY | No unlink | VERIFY |
| T004 | Unavailable ≠ missing | `favorites.rs` | — | CL-P04, EC-02 | VERIFY | Row kept | VERIFY |
| T005 | UI route | `mapRemovalToUiRoute.ts` | — | CL-P03 | VERIFY | FR-11 route | VERIFY |
| T006 | Batch bucket | `removeFavoritesBatch.test.ts` | — | EC-10 | VERIFY | Bucket | VERIFY |
| T007 | P0 gates doc | `quickstart.md` | — | SC-008 baseline | — | Baseline listed | LOW |

### Phase 1

| ID | Goal | Modules | Deps | FR / INV / EC / CL | Tests | Acceptance | Risk |
|----|------|---------|------|-------------------|-------|------------|------|
| T008 | OriginAvailability | `favorites.rs` | T004 | CL-P04 | T004 | Classify | **HIGH** |
| T009 | Identity gate + content proof | `favorites.rs` | T002 | CL-00, FR-011a | T002,T012 | Rules § above | **HIGH** |
| T010 | Relocate gate | `favorites.rs` | T009 | CL-00, SC-015 | T002,T014a | No overwrite | **HIGH** |
| T011 | TOCTOU gate | `favorites.rs` | T009 | EC-17 | VERIFY | Pre-FS check | **HIGH** |
| T012 | EC-03 | tests | T009 | EC-03 | VERIFY | No overwrite | VERIFY |
| T013 | EC-13 gate | tests | T010 | EC-07,13 | VERIFY | Source kept | VERIFY |
| T014 | EC-14 | tests | T010 | EC-14 | VERIFY | Copy kept | VERIFY |
| T014a | EC-01 | tests | T010 | EC-01 | VERIFY | No mkdir parent | VERIFY |
| T014b | EC-19 favorites | tests | T009 | EC-19 | VERIFY | Path/junction safe | VERIFY |

### Phase 2

| ID | Goal | Modules | Deps | FR / INV / EC / CL | Tests | Acceptance | Risk |
|----|------|---------|------|-------------------|-------|------------|------|
| T015 | Scoped reconcile | `reconcile.rs` | T003,T008 | FR-002, CL-P01 | T021,T022b | Metadata only | **HIGH** |
| T016 | Post-op hook | `pipeline/mod.rs` | T015 | CL-P01 | T021 | After fav ops | **HIGH** |
| T017 | IPC optional | `commands` | T015 | CL-P01 | — | Doc or thin cmd | MED |
| T018 | Debounce | `favoritesReconcile.ts` | T016 | SC-011 | — | Debounce | MED |
| T019 | folder-changed | `galleryPipelineEvents.ts` | T015 | CL-P02 | T022a | Refetch | MED |
| T020 | GalleryPage refetch | `GalleryPage.tsx` | T018,T019 | FR-005, INV-06 | SC-007 | Stars | MED |
| T021 | SC-011 | tests | T015,T016 | SC-011 | VERIFY | Trigger | VERIFY |
| T022 | Unavailable skip | tests | T008,T015 | CL-P04 | VERIFY | No purge | VERIFY |
| T022a | EC-05 | tests | T015 | EC-05 | VERIFY | No false link | VERIFY |
| T022b | EC-21 | tests | **T015** | EC-21 | VERIFY | Orphan copy not deleted by scope reconcile | VERIFY |

### Phase 3

| ID | Goal | Modules | Deps | FR / INV / EC / CL | Tests | Acceptance | Risk |
|----|------|---------|------|-------------------|-------|------------|------|
| T023 | DTO hints | `favorites.rs` | — | CL-P03, CL-P05, FR-003 | Optional contract | Optional serde fields; backward compatible | MED |
| T024 | reconcile status IPC | `commands`, `database` | T025 need | FR-003, CL-P05 | — | Defer unless refetch insufficient; arch note in sealed §2 | MED |
| T025 | Needs-review UI | `GalleryPage.tsx` | T020 | FR-003, FR-016, SC-013 | Manual | Non-blocking notice for unresolved reconcile | MED |
| T026 | Disk-confirmed stars | `favoritePathsServerSync.ts` | T020 | CL-P05, INV-04, FR-017 | T029 | Stars match server/disk only | MED |
| T027 | Optimistic rollback | `favoriteOptimisticOverlay.ts` | T026 | CL-P05, FR-017 | FE | Overlay cleared on indeterminate link | MED |
| T028 | i18n | `src/shared/locales/` | — | FR-016 | i18n-check | Required message classes present | LOW |
| T029 | No false success | `favoritePathsServerSync.test.ts` | T026 | SC-009, INV-04 | VERIFY | No success toast when journal incomplete | VERIFY |

### Phase 4

| ID | Goal | Modules | Deps | FR / INV / EC / CL | Tests | Acceptance | Risk |
|----|------|---------|------|-------------------|-------|------------|------|
| T030 | No auto-relocate | `favorites.rs` | T001 | FR-011b, CL-P03 | T001, T038 | T001 green; no relocate without FR-11 resolution | **HIGH** |
| T031 | FR-11 A/B/C execute | `favorites.rs` | T010,T011,T013 | FR-011, FR-011a | T038 | Content gate at execute; B path needs T035 P4b | **HIGH** |
| T032 | Pre-destructive gate | `favorites.rs` | T011 | FR-012, EC-17 | Rust | Full gate before recycle/delete | **HIGH** |
| T033 | Duplicate IPC | `favorites.rs`, locks | — | EC-18, FR-013 | Rust | Second in-flight removal safe | **HIGH** |
| T034 | UI routing | `mapRemovalToUiRoute.ts` | T005,T023 | CL-P03, SC-014 | T005, T039 | Single dialog stack | MED |
| T035 | FR-11 dialog A–D | `FavoriteMissingOriginDialog.tsx` | T034 | FR-011, FR-015 | T039 | A/C/D in P4a; **B picker in P4b**; release needs B | MED |
| T036 | GalleryPage FR-11 | `GalleryPage.tsx` | T034,T035 | SC-005, SC-014 | Manual | No move-only `unknown_origin` prompt | MED |
| T037 | unfavoriteGate | `unfavoriteGate.ts` | — | EC-15, EC-18 | FE | No double invoke | MED |
| T038 | Backend FR-11 | tests | T030,T031 | SC-005 | VERIFY | No silent recycle missing-origin | VERIFY |
| T039 | FE FR-11 | tests | T035,T034 | SC-005, SC-015 | VERIFY | Cancel / conflict routes | VERIFY |

### Phase 5

| ID | Goal | Modules | Deps | FR / INV / EC / CL | Tests | Acceptance | Risk |
|----|------|---------|------|-------------------|-------|------------|------|
| T040 | Preview buckets | `favorites_batch.rs` | T030 | FR-011b, EC-10 | T045 | `fr11Required` bucket present | **HIGH** |
| T041 | Batch dispatch | `favorites_batch.rs` | T040,T031 | EC-10, FR-011b | T045 | Per-file FR-11 rules | **HIGH** |
| T042 | FE batch map | `removeFavoritesBatch.ts` | T040 | EC-10, EC-20 | T046 | Buckets drive UI | MED |
| T043 | Mass unfavorite UI | `GalleryPage.tsx` | T042,T036 | SC-014 | Manual | FR-11 per ambiguous file | MED |
| T044a | Disk truth after IPC fail | `favoritesDiskTruthAfterIpc.ts` + touchpoints | — | FR-008, CL-P05, INV-04 | Integration | Read-only truth; replay only if idempotent | **HIGH** |
| T044b | FE disk truth | `GalleryPage.tsx` | T044a | FR-008 | FE | No «all failed» without T044a | MED |
| T045 | Batch EC-10 | tests | T041 | EC-10 | VERIFY | No ambiguous auto-delete | VERIFY |
| T046 | Batch EC-20 | `removeFavoritesBatch.test.ts` | T042 | EC-20, SC-004 | VERIFY | Partial successes kept | VERIFY |

### Phase 6

| ID | Goal | Modules | Deps | FR / INV / EC / CL | Tests | Acceptance | Risk |
|----|------|---------|------|-------------------|-------|------------|------|
| T047 | EC-08 supplemental | copy_recovery area | P2,P3 | EC-08, CL-P05 | VERIFY-COND | Skip only if T051 cites existing tests | VERIFY-COND |
| T048 | EC-09 supplemental | `pipeline` tests | P2 | EC-09, FR-013 | VERIFY-COND | Skip only if T051 cites boot reconcile tests | VERIFY-COND |
| T049 | EC-16 stale session | `directorySession.test.ts` | — | EC-16, I1 | VERIFY | Stale result dropped | VERIFY |
| T050 | FR-006 copy | `GalleryPage.tsx` | T044b | FR-006 | Manual | No `undo_favorite_removal` invoke | LOW |
| T051 | EC trace | `quickstart.md` | P0–P5 | SC-008 | — | All EC-01–22 traced; EC-04/06/11/15 existing tests named | LOW |
| T052 | INVARIANTS doc | `docs/INVARIANTS.md` | — | Constitution II | — | Statuses match shipped behavior | LOW |
| T053 | Manual smoke | human | P1–P5 | SC-010 | Checklist | Recorded in sealed §7; **additive** to SC-008 | LOW |

---

## Cross-cutting requirements

| Requirement | Primary tasks |
|-------------|----------------|
| Duplicate IPC | T033 (backend), T037 (FE assist) |
| Re-identity before destructive op | T011, T032 (content gate) |
| No auto-relocate unverified | T001, T030 |
| Name/path conflict | T009, T010, T012 |
| Cross-disk safety | T013 → T031 |
| FS ok / SQLite lag | T016, T026, T027; baseline T007; T047 if gap |
| Restart recovery | T007 baseline; T048 if gap |
| Batch IPC failure | **T044a**, T044b |
| Stale session | T049, T020 |
| EC-11 trace only | `favorites_lifecycle.rs`, `favoritesCollectionLifecycle.test.ts` → T051 |

---

## FR / INV / EC / CL coverage

| ID | Covered by tasks | Note |
|----|------------------|------|
| INV-01–08 | P1, P4, P5 | — |
| FR-001–FR-011b | Phases 1–5 | Identity § above |
| FR-012–014 | T011, T032, T033, T013 | — |
| CL-00, CL-P01–P05 | Per phase | — |
| EC-01 | T014a | Auto |
| EC-05 | T022a | Auto |
| EC-11 | **Existing tests** (T051 trace) | `app_rename_deactivates_stars_*`, `explorer_rename_*`, `favoritesCollectionLifecycle.test.ts` |
| EC-19 | T014b; partial existing `same_path_equates_extended_prefix`, `favorite_copy_lookup_ignores_extended_prefix` | Auto |
| EC-21 | T022b | Auto |
| EC-02,03,07,08,09,10,12,13,14,16,17,18,20,22 | P0–P6 VERIFY tasks as listed | — |
| **SC-008** | T051 + mandatory VERIFY + existing tests cited in T051 | **Critical file-operation EC** require **automated** tests; manual smoke (T053) **additive** only (see [spec.md](./spec.md) SC-008) |
| SC-001–SC-015 | Phase checkpoints | SC-010 = T053 |

---

## High-risk production tasks (sealed **high** + auditor)

**Count: 13** — T008, T009, T010, T011, T015, T016, T030, T031, T032, T033, T040, T041, T044a

## Mandatory verification tasks (sealed **medium**; must pass)

**Count: 21** — T001–T006, T012–T014b, T021, T022, T022a, T022b, T029, T038, T039, T045, T046, T049.

Plus **P0 baseline** (T007): `favorites_copy_recovery`, `favorites_trash_lifecycle_final` green before P1+.

## Conditional verification (VERIFY-COND)

**Count: 2** — T047, T048. May be **skipped** only when T051 documents equivalent existing automated coverage with test names; otherwise implement.

**T001 note:** Mandatory VERIFY, but expected **red** until T030 (see Phase 0).

---

## Task totals by phase

| Phase | Count | Task IDs |
|-------|-------|----------|
| P0 | 7 | T001–T007 |
| P1 | 9 | T008–T014, T014a, T014b |
| P2 | 10 | T015–T022, T022a, T022b |
| P3 | 7 | T023–T029 |
| P4 | 10 | T030–T039 |
| P5 | 8 | T040–T043, T044a, T044b, T045, T046 |
| P6 | 7 | T047–T053 |
| **Total** | **58** | |

---

## Architecture approval required

| Task | Reason |
|------|--------|
| T024 | Optional `favorites_reconcile_status` IPC |
| T017 | Separate scoped-reconcile command vs pipeline-only |
| T030 | ADR-4 dispatch semantics |
| T035 | FR-11 action **B** (folder picker) — **P4b** sealed slice; required before release (not optional product) |

---

## Constitution v1.1.0 readiness (planning)

| Principle | Alignment |
|-----------|-----------|
| I File safety | Content gate; VERIFY gates; T044a disk truth |
| II Invariants | Traceability table |
| III Session | T049, T020 |
| IV Sealed tasks | HIGH vs VERIFY split |
| V Evidence | SC-008 auto for critical EC |

---

## Implementation strategy (MVP)

1. **P0** — VERIFY + T007 baseline green → seal.
2. **P1** — identity HIGH (T008–T011) + VERIFY (EC-01, EC-19, EC-13 gate).
3. **P2 → P3** — reconcile + notices; **GalleryPage** sequential (T020 → T025 → …).
4. **P4a** — after **P1 complete**; T030 makes **T001 green**; **P4b** (T035 action B) before release.
5. **P5** — after P4 T030–T033, T031; **T044a** before T044b.
6. **P6** — T051 EC trace + T053 smoke; T047/T048 only if T051 finds gaps.

Stop after any phase if `--strict` or HDD budget fails (plan §Phase 2).

---

## Documents

| Path | Action |
|------|--------|
| `specs/001-safe-favorites-lifecycle/tasks.md` | Updated (final N1–N6) |
| `specs/001-safe-favorites-lifecycle/spec.md` | SC-008 automated-first wording |
| `specs/001-safe-favorites-lifecycle/research.md` | R1 identity implementation rule |
| `specs/001-safe-favorites-lifecycle/contracts/ipc-favorites-lifecycle.md` | Disk truth after IPC failure |
| `specs/001-safe-favorites-lifecycle/plan.md` | P0 baseline in Phase 0 |