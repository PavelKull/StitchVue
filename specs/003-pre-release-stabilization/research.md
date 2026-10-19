# Research & Decisions: 003-pre-release-stabilization

**Date**: 2026-10-19  
**Sources**: [`BUGS.md`](../../BUGS.md), [`docs/stabilization/BUGS_REVALIDATION_REPORT.md`](../../docs/stabilization/BUGS_REVALIDATION_REPORT.md), code on `main` `2b709cd`

No new full-app audit. Decisions below lock planning; LIKELY items still require the listed diagnosis at implementation time.

## D-01 Evidence classes

Use revalidation statuses as the spec class (MUST vs diagnose-then-fix). Do not promote hypotheses to algorithms.

## D-02 Independent packages

One sealed TASK_HANDOFF file per package. Do not mix orientation bake, mosaic thaw, hover join, and empty-state CSS in one diff.

## D-03 C-006 reuse existing viewer preload

**Decision:** Extend `preloadViewerNeighbors` / `buildNeighborJobs` / `viewerPreloadLogic.ts` / `viewerPreload.ts`.  
**Rationale:** Window already exists; gap is priority/quality, not missing infrastructure.  
**Rejected:** New preload subsystem; second cache; rewriting `pick_index` for viewer quality.

## D-04 Viewer implementation order

**Decision:** B-007 (join hover/open) → C-006 (window P1–P3) → remaining B-009 (frame geometry).  
**Rationale:** Owner lock 2026-10-19. Hover cancel would fight neighbor P1; warm N+1 does not fix 1:1 frame.

## D-05 Neighbor window

P0 = current (`viewer_frame`). P1 = next along `direction`. P2 = +2…+5. P3 = two behind after high-pri. Fast pace MUST NOT empty `near`. Do not use `VIEWER_AHEAD_FAST=12` as decode width.

## D-06 Memory caps

Keep `MAX_ACTIVE=2` without measurements. Do not raise `MAX_KEPT=8` until retained-frame cost is recorded. Evict outside protect set; do not `kept.clear` on every index change.

## D-07 Gallery viewport vs viewer background

`grid_blocks_hover` / `viewer_wants_read` already protect P0/P1 grid. Neighbor `viewer_source` / optional `prefetch_photo` Join must yield to visible 256 holes. B-006: measure Idle P4 vs P5; no fairness rewrite in 003 without a new seal.

## D-08 B-005 cache share

Reuse `favorite_snapshot_for_copy` + existing `cached_thumb` / `thumbnail_path` alias or hardlink of **cache JPEGs**, not user originals. No schema migration in the first B-005 task unless lookup cannot share `thumbnail_path`. Different size → no share.

## D-09 C-003 mock only

`src/features/app-update/` mock dialog + About button + busy gate. No `tauri-plugin-updater`. Production path remains spec 002.

## D-10 C-005 no second FSM

Filter listing/viewer by pending-off overlay; relax empty-folder hide vs `listingReady` when the batch is the full known listing. Keep generation rollback. I8 originals.

## D-11 B-001 follow-max not full spacer

`pendingScrollToEnd` in `useGalleryScrollJump.ts`; `behavior: 'auto'` while flagged. Do not reserve height for the entire unlisted folder as the first fix.

## D-12 B-003 thaw index, not recode JPEG

`geometryKey` / `freezeUsedAspects` + `tilePhotoStyle` cover/swap. Display rotate ≠ EXIF bake (B-002/B-004).

## D-13 Diagnose-gated packages

| ID | First action |
|----|----------------|
| B-007 | Confirm leave-cancel / naturalWidth / grid_blocks_hover |
| B-008 | Log tile/row size FS vs window across ZOOM_STEPS |
| B-009 | After C-006, check aspectFromMeta=1 vs sideways bytes |
| B-002/B-004 | Placeholder vs JPEG letterbox vs embedded_orientation |
| B-011 | thumbs Map vs unpublished spacer vs blank img |
| B-006 | pipeline_stats / idle P4 vs P5 |

## D-14 UI catalog

C-002 may add `ui-catalog/` fixtures using existing widgets. No Storybook/Chromatic. Playwright only as a later PNG generator (INVESTIGATE), not this feature’s runtime.

## D-15 Git

Planning on `docs/revalidate-bugs`. Implementation: ordinary `feat/003-pre-release-stabilization` (or per-package `fix/*`) in the same `ImageGrid` checkout after owner approval. No worktree.
