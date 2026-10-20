# Tasks: Pre-release Stabilization

**Input**: Design documents from `/specs/003-pre-release-stabilization/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ipc-reuse.md, quickstart.md

**Tests**: Required for C-006 (CL-C006-08). Other stories: add targeted tests where the package is CONFIRMED. LIKELY stories: diagnosis notes before code.

**Organization**: User stories US1–US15. Spec-Kit tasks do **not** authorize source edits — each package still needs `docs/refactoring/tasks/*.md` + `--seal` before Write.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no incomplete deps)
- **[Story]**: US1…US15 for story phases only

## Phase 1: Setup

**Purpose**: Planning artifacts exist; bind implementation to TASK_HANDOFF

- [x] T001 Confirm feature dir `specs/003-pre-release-stabilization/` and `.specify/feature.json` point at this feature
- [x] T002 Record owner-chosen implementation branch name (ordinary `feat/003-pre-release-stabilization` or per-package `fix/*`) without switching a dirty tree
- [x] T003 [P] For each package, create a TASK_HANDOFF file under `docs/refactoring/tasks/` only when that package starts (template `TASK_TEMPLATE.md`); do not pre-seal the whole 003

---

## Phase 2: Foundational

**Purpose**: Cross-cutting constraints before any source package

- [x] T004 Freeze out-of-scope in every sealed task: no `pick_index` rewrite, no second cache, no updater plugin, no worktree, no user-photo fixtures
- [x] T005 Document viewer chain dependency in sealed tasks for US4–US6: B-007 then C-006 then remaining B-009 (`research.md` D-04; порядок срезов в `BUGS.md`; при старте US4–US6 — явная зависимость в YAML sealed TASK)

**Checkpoint**: Packages US1–US3 and US7–US9 may start in parallel after T004. US5 must not start before US4. US6 must not start before US5.

---

## Phase 3: User Story 7 - Empty/loading template (Priority: P2)

**Goal**: One emptyGallery family  
**Independent Test**: Opening / empty / unsupported / subfolders / favorites / trash / error share one layout

- [x] T006 [P] [US7] Extend `GalleryEmptyKind` in `src/features/gallery/lib/listing/galleryEmptyState.ts` (loading, error, subfoldersOnly, emptyFavorites, emptyTrash); stop returning `'none'` solely because `serviceRole` is set
- [x] T007 [P] [US7] Update `src/features/gallery/lib/listing/galleryEmptyState.test.ts` for each kind including `gallery.subfoldersOnly`
- [x] T008 [US7] Wire `src/pages/gallery/GalleryPage.tsx` to the shared `emptyGallery` layout; remove parallel `styles.message` branches for those kinds

---

## Phase 4: User Story 8 - Settings height (Priority: P2)

**Goal**: Stable dialog chrome on locale change  
**Independent Test**: Cycle ru/en/de/zh-Hans; height does not jump

- [x] T009 [US8] Fix `.dialog` height in `src/widgets/settings-dialog/SettingsDialog.module.scss` (fixed/min height; pane already `overflow-y: auto`)

---

## Phase 5: User Story 9 - Support GitHub star (Priority: P2)

**Goal**: Star action + button icons on Support  
**Independent Test**: Button opens `githubRepo`; hideReminders unchanged

- [x] T010 [US9] Add GitHub star card/action and `StitchVueIcon` buttons in `SupportPanel` inside `src/widgets/settings-dialog/SettingsDialog.tsx` using `openExternalLink("github_repo")`
- [x] T011 [P] [US9] Add i18n keys in `src/shared/i18n/locales/{ru,en,de,zh-Hans}.json`

---

## Phase 6: User Story 1 - Jump to folder end (Priority: P1) 🎯 MVP

**Goal**: `pendingScrollToEnd` follow-max  
**Independent Test**: Down before ready reaches real end; up immediate; manual scroll cancels

- [x] T012 [US1] Add `pendingScrollToEnd` and re-stick on `scrollHeight` growth in `src/features/gallery/model/viewport/useGalleryScrollJump.ts` (`behavior: 'auto'` while flagged)
- [x] T013 [US1] Cover flag lifecycle in `src/features/gallery/model/viewport/useGalleryScrollJump.test.ts`
- [x] T014 [US1] Wire cancel on user scroll / up / folder change from `src/pages/gallery/GalleryPage.tsx` if the hook cannot see those events alone

---

## Phase 7: User Story 2 - Grid follows rotate (Priority: P1) 🎯 MVP

**Goal**: Thaw one mosaic index; no tile `fill` squash  
**Independent Test**: 90° rotate → slot aspect changes, no stretch

- [x] T015 [US2] Invalidate published geometry for the rotated index in `src/widgets/gallery-grid/StitchVueGrid.tsx` / `src/widgets/gallery-grid/layout.ts` (`freezeUsedAspects` keepEnd / key)
- [x] T016 [US2] Change odd-quarter `tilePhotoStyle` off `objectFit: "fill"` in `src/features/gallery/lib/viewer/displayRotation.ts` (cover + size swap)
- [x] T017 [P] [US2] Extend `src/features/gallery/lib/listing/galleryOrder.test.ts` or layout tests for thawed aspect after quarters change

---

## Phase 8: User Story 3 - Optimistic unfavorite remainder (Priority: P1) 🎯 MVP

**Goal**: Filter listing; hide folder without extra listingReady wait when batch is complete  
**Independent Test**: Mass/partial hide tiles+stars; originals remain; rollback on fail

- [x] T018 [US3] Filter Favorites `view.images` / viewer by pending `desired: false` using `src/features/favorites/lib/favoriteOptimisticOverlay.ts` from `src/pages/gallery/GalleryPage.tsx`
- [x] T019 [US3] Relax `shouldOptimisticallyHideFavoritesServiceFolder` in `src/features/favorites/lib/favoriteMassUnfavoriteOptimistic.ts` when the batch equals known listing files
- [x] T020 [P] [US3] Update `src/features/favorites/lib/favoriteMassUnfavoriteOptimistic.test.ts` and overlay tests; keep I4/I5/I8

---

## Phase 9: User Story 10 - Single-tile fullscreen zoom (Priority: P2)

**Goal**: Diagnose then local mosaic last-row fix if reproduced  
**Independent Test**: One photo + app-FS slider changes tile size

- [ ] T021 [US10] Diagnose: log `tile.width`/`row.height` vs `rowsPerScreen` in app-fullscreen vs window (`src/widgets/gallery-grid/layout.ts` `placeRow` last-row; `fsLayoutFreeze` in `src/pages/gallery/GalleryPage.tsx`)
- [ ] T022 [US10] If reproduced, apply the **smallest** layout change for last-row/single tile; do not disable zoom when `images.length === 1`

---

## Phase 10: User Story 4 - Hover/open join (Priority: P1)

**Goal**: Do not cancel the opened path; join inflight; peek without waiting on `naturalWidth` if src exists  
**Independent Test**: Hover ≥100 ms then click vs cold click

- [ ] T023 [US4] Diagnose leave/`LEAVE_GRACE_MS` vs open in `src/features/gallery/lib/pipeline/hoverPrefetch.ts` and `src/features/gallery/lib/viewer/galleryHover.ts`
- [ ] T024 [US4] Stop `cancel_photo_prefetch` for the path being opened; Join existing `prefetch_photo` job (`src-tauri/src/pipeline/hover.rs` only if FE glue is insufficient)
- [ ] T025 [US4] Adjust `peekPreloaded` in `src/features/gallery/lib/viewer/viewerPreload.ts` so a started warm src can be used before `naturalWidth > 0` if that is the confirmed gap
- [ ] T026 [P] [US4] Extend `src/features/gallery/lib/pipeline/hoverPrefetch.test.ts`

---

## Phase 11: User Story 5 - Neighbor window C-006 (Priority: P1)

**Goal**: P1=N+dir, P2=+2…+5, P3=two back after high-pri; fast does not drop P1  
**Independent Test**: See spec US5 + CL-C006-08  
**Depends on**: T023–T026 (US4)

- [ ] T027 [US5] Change `buildNeighborJobs` in `src/features/gallery/lib/viewer/viewerPreloadLogic.ts`: `near` = P1 only; P2 = +2…+5; P3 backward; fast MUST NOT set `near=[]`; decode window 5 not `VIEWER_AHEAD_FAST=12`
- [ ] T028 [US5] Change `pump`/`loadOne` in `src/features/gallery/lib/viewer/viewerPreload.ts`: P3 after P1/P2; reuse `kept`; do not `kept.clear` on index change; far path must not full-decode RAW/HEIC without need
- [ ] T029 [US5] Keep `MAX_ACTIVE=2`; measure `MAX_KEPT=8` retained cost before any increase (`viewerPreload.ts`)
- [ ] T030 [P] [US5] Targeted tests in `src/features/gallery/lib/viewer/viewerPreloadLogic.test.ts`: fast navigation keeps P1; direction change; inflight/ready reuse; memory/protect cap
- [ ] T031 [US5] Do **not** modify `pick_index` in `src-tauri/src/pipeline/mod.rs`; optional P1 Join via existing `prefetch_photo` only after US4

---

## Phase 12: User Story 6 - Viewer first frame remainder (Priority: P1)

**Goal**: Fill-screen from known display-aspect; orientation diagnose separate  
**Depends on**: US4 and US5

- [ ] T032 [US6] Diagnose remaining B-009 after C-006: `aspectFromMeta` vs `displayAspect` in `src/widgets/image-viewer/viewerFrame.ts` / `ImageViewer.tsx`
- [ ] T033 [US6] If postage-stamp remains, set first frame from known display-aspect / `fillViewport`; do not block paging
- [ ] T034 [P] [US6] If sideways first bytes remain, diagnose B-002/B-004 in `src-tauri/src/thumbnail/mod.rs` `embedded_orientation` / `produce_jpeg` — do not recode thumbs for B-003

---

## Phase 13: User Story 11 - Fast scroll flash (Priority: P2)

**Goal**: Three-way diagnose; no virt-off / no HDD parallelism bump

- [ ] T035 [US11] Diagnose empty slots: `thumbs.get` vs unpublished mosaic vs blank `img` in `src/widgets/gallery-grid/StitchVueGrid.tsx` (`rowsCovering`) and `flushThumbnailBatch` in `src/features/gallery/model/pipeline/galleryPipelineEvents.ts`
- [ ] T036 [US11] Apply the smallest confirmed FE fix only (placeholder from known src or modest overscan) — not as a first assumption

---

## Phase 14: User Story 12 - Toasts/modals map (Priority: P2)

**Goal**: Explicit toast vs modal vs empty; existing widgets

- [ ] T037 [US12] Document and implement the channel map on `OperationNoticeView` in `src/widgets/selection-actions/SelectionActions.tsx` and `useAnimatedModal` in `src/shared/ui/useAnimatedModal.ts`; fold `bootNotice` in `src/pages/gallery/GalleryPage.tsx`
- [ ] T038 [P] [US12] Optional `ui-catalog/` index for fixtures; no new UI library; no Storybook

---

## Phase 15: User Story 13 - Mock updater (Priority: P2)

**Goal**: `src/features/app-update/` mock; no plugin  
**Depends on**: US12 shell if sharing dialog chrome

- [ ] T039 [US13] Add mock `UpdateDialog` under `src/features/app-update/` and mount from `src/app/App.tsx`
- [ ] T040 [US13] About entry in `src/widgets/settings-dialog/SettingsDialog.tsx`; disable Update while file op / unfavorite
- [ ] T041 [P] [US13] Fixture i18n; do not add `tauri-plugin-updater` to `src-tauri/Cargo.toml`

---

## Phase 16: User Story 14 - Favorites thumb reuse (Priority: P2)

**Goal**: Alias origin cache JPEGs onto copy identity  
**Risk**: high (cache)

- [ ] T042 [US14] On copy-to-favorites, share existing `thumbnail_path` rows for matching size (prefer snapshot sha256) in `src-tauri/src/cache/mod.rs` and copy completion in `src-tauri/src/file_ops/` — no user originals, no new table by default
- [ ] T043 [US14] Fallback: copy miss → `favorite_snapshot_for_copy` → `cached_thumb` origin → emit on copy path in `src-tauri/src/pipeline/mod.rs` only if add-time alias is incomplete
- [ ] T044 [P] [US14] Fixture tests under `src-tauri/src/cache/` and/or file_ops; different size must not share

---

## Phase 17: User Story 15 - Background fill measure (Priority: P3)

**Goal**: Numbers for Idle P4 vs P5; no rewrite

- [ ] T045 [US15] Measure idle read slots / `pick_index` P4 vs P5 using existing `pipeline_stats` (or equivalent logs) in `src-tauri/src/pipeline/mod.rs` **without** changing fairness
- [ ] T046 [US15] Stop. Any fairness tweak requires a **new** owner seal; keep viewport-first tests in `src-tauri/src/pipeline/mod.rs` unchanged in meaning

---

## Phase 18: Polish

- [ ] T047 [P] Update `BUGS.md` statuses (FIXED / still LIKELY) per landed package without renaming IDs
- [ ] T048 [P] Sync `docs/stabilization/BUGS_REVALIDATION_REPORT.md` package outcomes if architecture notes drift
- [ ] T049 High-risk smoke after C-005 / B-005 / viewer chain: folder switch, favorites originals, scroll thumbs (constitution)

---

## Dependencies

```text
T001-T005 foundational
US7, US8, US9, US1, US2, US3  — parallel after T004
US10 diagnose independent
US4 → US5 → US6              — locked viewer chain
US11 after or independent of US1 (watch empty tail)
US12 → US13
US14 independent of C-005 overlay (time of add only)
US15 last, measure-only
```

## Parallel examples

- T006 + T009 + T010 after T004
- T012 and T015 after T004
- T030 tests once T027 logic is written

## Implementation strategy

**MVP**: US1 + US2 + US3 (CONFIRMED navigation/rotate/unfavorite).  
**Viewer increment**: US4 → US5 → US6.  
**Polish**: US7–US9, US12–US13.  
**High-risk last**: US14.  
**B-006**: measure only.

## Suggested first sealed tasks

1. `TASK-2026-003-C001-empty` (T006–T008)  
2. `TASK-2026-003-B001-scroll-end` (T012–T014)  
3. `TASK-2026-003-B003-rotate-grid` (T015–T017)  
4. `TASK-2026-003-C005-unfavorite-ux` (T018–T020)  
5. `TASK-2026-003-B007-hover-join` then `…-C006-neighbors` then `…-B009-frame`
