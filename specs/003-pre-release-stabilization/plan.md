# Implementation Plan: 003-pre-release-stabilization

**Branch (planning)**: `docs/revalidate-bugs`  
**Implementation branch (later)**: ordinary `feat/003-pre-release-stabilization` in `C:\Users\Pavel\Desktop\ImageGrid` — no worktree  
**Date**: 2026-10-19  
**Spec**: [`spec.md`](./spec.md)

**Input**: Revalidated BUGS.md (B-001–B-011, C-001–C-006)

**Note**: This plan does **not** authorize application source edits. Each package needs a sealed file under `docs/refactoring/tasks/` (`TASK_HANDOFF.md`).

## Summary

Stabilize first-release gallery/viewer/favorites UX with **minimal independent packages**. CONFIRMED items get the named small fix. LIKELY/UNVERIFIED items start with diagnosis. Viewer chain is locked: **B-007 → C-006 → remaining B-009**. C-006 extends existing neighbor preload only. C-003 is mock UI. Real updater stays in 002. Do not rewrite `pick_index` or add a second cache.

## Technical Context

| Item | Value |
|------|--------|
| Stack | Tauri 2.12.x, React 19, TypeScript, Rust 2021 |
| Entry | `src/pages/gallery/GalleryPage.tsx` |
| Viewer preload | `src/features/gallery/lib/viewer/viewerPreload.ts`, `viewerPreloadLogic.ts`, `viewerPace.ts` |
| Hover | `hoverPrefetch.ts`, `galleryHover.ts`; IPC `prefetch_photo` |
| Layout | `src/widgets/gallery-grid/layout.ts`, `StitchVueGrid.tsx` |
| Favorites UX | `src/features/favorites/lib/*` |
| Cache | `src-tauri/src/cache/mod.rs`, `thumbnail/mod.rs` |
| Scheduler | `pipeline/mod.rs` `pick_index` — **out of rewrite scope** |
| Tests | `npm test -- <file>`, focused `cargo test` only when a sealed package touches Rust |
| App data | `%LOCALAPPDATA%\StitchVue\` — do not use live user photos in tests |

## Constitution Check

| Gate | Status | Notes |
|------|--------|-------|
| I User photo safety | PASS | B-005/C-005/C-006 must not mutate originals; tests on fixtures |
| II Invariants canonical | PASS | I4/I5/I8 for C-005; I9 untouched unless B-006 re-sealed |
| III Session | PASS | No session-number changes planned |
| IV Scoped reversible | PASS | One TASK_HANDOFF file per package; Spec-Kit tasks.md is planning |
| V Evidence | PASS | FR-D diagnose-gated for LIKELY/UNVERIFIED |
| VI One checkout | PASS | Current `ImageGrid`; no worktree |
| No gallery/pipeline rewrite | PASS | Local hooks/layout/CSS/preload logic |
| C-003 vs 002 | PASS | Mock only |

**Post-design re-check:** still PASS. C-006 FE-only preferred; B-005 may touch `cache/` in a **later** high-risk sealed task without schema as default.

## Project Structure

### Documentation (this feature)

```text
specs/003-pre-release-stabilization/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/ipc-reuse.md
├── checklists/requirements.md
└── tasks.md
```

### Source (touched later, by package)

```text
src/features/gallery/model/viewport/useGalleryScrollJump.ts   # B-001
src/widgets/gallery-grid/layout.ts                            # B-003, B-008
src/widgets/gallery-grid/StitchVueGrid.tsx                    # B-003 geometryKey
src/features/gallery/lib/viewer/displayRotation.ts            # B-003 tilePhotoStyle
src/features/favorites/lib/*                                  # C-005
src/pages/gallery/GalleryPage.tsx                             # wiring C-005, B-007, empty
src/features/gallery/lib/pipeline/hoverPrefetch.ts            # B-007
src/features/gallery/lib/viewer/galleryHover.ts               # B-007
src/features/gallery/lib/viewer/viewerPreload.ts              # C-006
src/features/gallery/lib/viewer/viewerPreloadLogic.ts         # C-006
src/widgets/image-viewer/viewerFrame.ts                       # B-009 remainder
src/features/gallery/lib/listing/galleryEmptyState.ts         # C-001
src/widgets/settings-dialog/                                  # B-010, C-004, C-003 About
src/features/app-update/                                      # C-003 mock (new slice)
src-tauri/src/cache/mod.rs                                    # B-005 only, separate high task
src-tauri/src/pipeline/hover.rs                               # B-007 Join only if FE glue insufficient
```

## Package sequence

| Order | Package | Stories | Risk | First action |
|-------|---------|---------|------|----------------|
| 1 | Shell polish | US7–US9 C-001, B-010, C-004 | low | implement |
| 2 | Scroll end | US1 B-001 | medium | implement follow-max |
| 3 | Rotate grid | US2 B-003 | medium | thaw + cover |
| 4 | Unfavorite UX | US3 C-005 | medium | overlay filter / hide |
| 5 | Single-tile zoom | US10 B-008 | medium | **diagnose** then local layout |
| 6 | Hover join | US4 B-007 | medium/high IPC | **diagnose** then glue |
| 7 | Neighbor window | US5 C-006 | medium | implement locked window |
| 8 | Viewer frame | US6 B-009 + D B-002/B-004 | medium/high thumbs | **diagnose** after 6–7 |
| 9 | Fast scroll flash | US11 B-011 | medium | **diagnose** 3-way |
| 10 | Notices | US12 C-002 | low | map + optional catalog |
| 11 | Mock updater | US13 C-003 | low | `features/app-update/` |
| 12 | Favorites thumbs | US14 B-005 | high cache | alias `thumbnail_path` |
| 13 | Idle fill | US15 B-006 | high scheduler | **measure only** |

Packages 1–4 may proceed without waiting for the viewer chain. 7 MUST wait for 6. 8 MUST wait for 7.

## Complexity Tracking

| Violation | Why needed | Simpler rejected because |
|-----------|------------|--------------------------|
| None planned | — | Scheduler rewrite, second cache, new preload stack rejected (D-03) |
