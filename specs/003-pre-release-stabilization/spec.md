# Feature Specification: Pre-release Stabilization

**Feature ID**: `003-pre-release-stabilization`  
**Spec directory**: `specs/003-pre-release-stabilization/`  
**Git branch (planning)**: `docs/revalidate-bugs` (ordinary checkout `C:\Users\Pavel\Desktop\ImageGrid`; implementation branch later — `.cursor/rules/git-branch-workflow.mdc`)

**Created**: 2026-10-19

**Status**: Draft — ready for owner review of spec + plan + tasks (no application source in this phase)

**Input**: Revalidated [`docs/stabilization/BUGS.md`](../../docs/stabilization/BUGS.md) (B-001–B-011, C-001–C-006) + [`docs/stabilization/BUGS_REVALIDATION_REPORT.md`](../../docs/stabilization/BUGS_REVALIDATION_REPORT.md)

**Priority**: High — first-release gallery/viewer/favorites UX; **not** file-safety P0 (001) and **not** real updater (002)

## References

| Document | Role |
|----------|------|
| [`docs/stabilization/BUGS.md`](../../docs/stabilization/BUGS.md) | Canonical symptoms, repro, evidence status |
| [`docs/stabilization/BUGS_REVALIDATION_REPORT.md`](../../docs/stabilization/BUGS_REVALIDATION_REPORT.md) | Architecture mapping after backend/FSD/P0–P6 |
| [`docs/INVARIANTS.md`](../../docs/INVARIANTS.md) | I1–I10; I8 originals; I9 scheduler UNVERIFIED |
| [`specs/001-safe-favorites-lifecycle/`](../001-safe-favorites-lifecycle/) | Overlay, batch, reconcile — reuse, do not fork |
| [`specs/002-stitchvue-release-auto-update/`](../002-stitchvue-release-auto-update/) | Real updater; C-003 is **mock UI only** |
| `.specify/memory/constitution.md` v1.2.0 | Safety, scoped change, evidence |

## Evidence rule (product law for this feature)

Technical status from the revalidation **is** the requirement class:

| Class | IDs | Spec treatment |
|-------|-----|----------------|
| **CONFIRMED** | B-001, B-003, B-005, B-010, C-001–C-004, C-006 | MUST fix with the named minimal approach |
| **CHANGED** | C-005 | MUST close remaining UX gaps on existing overlay |
| **LIKELY** | B-002, B-004, B-007, B-008, B-009, B-011 | MUST diagnose with a short scenario; implement a listed minimal fix **only if reproduced**. Do not treat hypotheses as mandatory design. |
| **UNVERIFIED** | B-006 | MUST measure idle slot use **before** any scheduler change. No `pick_index` rewrite in this feature unless measurement proves P5 starvation **and** the owner re-seals scope. |

Unconfirmed guesses MUST NOT become required algorithms.

## Goals

1. User can jump to the real end of a large folder while listing still grows (B-001).
2. Manual rotate in the viewer updates the grid slot without stretching the thumb (B-003).
3. Unfavorite feels instant: tiles, stars, selection, and empty Favorites folder (C-005).
4. Hover-then-open and sequential browse in ImageViewer feel warm, at useful quality (B-007, C-006, remainder of B-009 if reproduced).
5. Empty/loading/error screens, settings height, support GitHub star, notices, and a **mock** update dialog look like one product (C-001–C-004, B-010).
6. Favorites copies reuse already-generated thumbnail quality when identity matches (B-005).
7. Do **not** regress originals, favorites P0–P6, directory session, or gallery viewport-first thumbs.

## Out of scope (explicit)

- Real Tauri Updater, GitHub Releases CI, signing, `latest.json` (feature **002**).
- Rewriting the thumbnail scheduler / `pick_index` as a first move (B-006).
- New ImageViewer preload subsystem or second image cache (C-006 decision).
- SQLite schema migration unless a later sealed task proves B-005 cannot reuse `thumbnail_cache` rows.
- General React FSD or Rust module rewrite; IPC DTO redesign; Storybook/Chromatic; Playwright as a product runtime.
- Changing invariants I1–I8; deleting or overwriting user originals.
- Extra git worktrees / project copies.

## Clarifications (locked)

### Session 2026-10-19 — C-006 architecture

- **CL-C006-01** — Reuse `preloadViewerNeighbors`, `buildNeighborJobs`, `viewerPreloadLogic.ts`, `viewerPreload.ts`. No new preload subsystem.
- **CL-C006-02** — Do not rewrite `pick_index`. Do not add a second cache.
- **CL-C006-03** — Implementation order for viewer: **B-007 → C-006 → remaining B-009**.
- **CL-C006-04** — Window: P0 = current N; P1 = N+1 (along navigation direction); P2 = N+2…N+5; P3 = N−1…N−2 after high-priority work.
- **CL-C006-05** — Fast paging MUST NOT drop P1 priority. Direction follows actual navigation; current frame stays absolute priority.
- **CL-C006-06** — `MAX_ACTIVE=2` unchanged without measurements. Do not raise `MAX_KEPT=8` unconditionally; measure retained-frame cost first.
- **CL-C006-07** — No full-resolution RAW/HEIC decode unless it improves on-screen quality. Gallery viewport thumbs outrank background viewer prefetch.
- **CL-C006-08** — Targeted tests: fast navigation, direction change, inflight reuse, memory cap.

### Session 2026-10-19 — C-003

- **CL-C003-01** — This feature ships **mock** update UI only (dialog + About entry + busy gate). Production `check()` / plugin / CI stay in **002**.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Jump to the real end of a folder (Priority: P1)

While a large folder is still listing, the user presses the gallery «down» control and expects the real end of the filmstrip, not the current published height.

**Why this priority**: Everyday navigation; CONFIRMED.

**Independent Test**: Open a large folder; press down before `ready`; after listing completes the viewport is at the last slots (not mid-spacer). Up-jump is immediate. Manual scroll cancels stick-to-end.

**Acceptance Scenarios**:

1. **Given** listing/layout still growing, **When** the user presses down, **Then** the viewport follows the growing `scrollHeight` until the folder is ready **and** at the bottom.
2. **Given** stick-to-end is active, **When** the user scrolls manually, presses up, or changes folder, **Then** follow-end stops.

**Bug**: B-001. **Evidence**: CONFIRMED.

---

### User Story 2 - Grid follows a viewer rotate (Priority: P1)

The user rotates a photo in the viewer, returns to the grid, and the same tile changes aspect without squashing the bitmap.

**Why this priority**: Display rotation is a core viewer action; CONFIRMED; independent of first-thumb EXIF.

**Independent Test**: Open photo → rotate 90° → close viewer → tile aspect swapped, no `fill` squash; other published tiles do not rebuild the whole catalog.

**Acceptance Scenarios**:

1. **Given** a photo with display rotation 0, **When** the user rotates clockwise once, **Then** the grid slot uses the new aspect and the thumb is not stretched.
2. **Given** other photos in the same row, **When** one path’s quarters change, **Then** only that published geometry is invalidated.

**Bug**: B-003. **Evidence**: CONFIRMED. JPEG cache need not be recoded.

---

### User Story 3 - Unfavorite feels already done (Priority: P1)

In Favorites, removing copies (all or some) immediately hides tiles, turns stars off, clears selection, and hides the empty Favorites folder — without waiting for disk. Originals stay untouched. Failure rolls back overlay only.

**Why this priority**: User already decided; P0–P6 overlay exists (CHANGED remainder).

**Independent Test**: Mass unfavorite all copies; parent view and hidden Favorites tile in the same tick when the batch is the full listing. Partial unfavorite: pending-off copies leave the grid immediately; stars off. Failed IPC restores overlay, never deletes originals.

**Acceptance Scenarios**:

1. **Given** Favorites with N copies and listing ready, **When** the user removes all, **Then** tiles/stars/selection/folder tile update immediately and navigation is the parent album.
2. **Given** a partial unfavorite, **When** overlay `desired: false` is pending, **Then** those copies are gone from grid and viewer without waiting for batch IPC.
3. **Given** IPC failure, **When** rollback runs, **Then** only failed paths restore; originals on disk are unchanged.

**Item**: C-005. **Evidence**: CHANGED (stars already honor pending-off; listing/hide gaps remain). Reuse overlay — no second favorites state machine.

---

### User Story 4 - Hover then open is already warm (Priority: P1)

After the pointer rests on a tile long enough to start prefetch, opening the viewer uses that work (or joins the in-flight job) instead of starting from zero. Viewport holes still beat hover.

**Why this priority**: Viewer entry path; LIKELY — diagnose then glue existing prefetch.

**Independent Test**: Wait ≥100 ms on a JPEG tile, open; compare with an immediate click. Hover must not cancel the path being opened. RAW checked separately.

**Acceptance Scenarios**:

1. **Given** a hovered JPEG with prefetch started, **When** the user clicks that tile, **Then** the viewer does not cancel and restart the same job as a cold load.
2. **Given** visible tiles missing 256, **When** the user hovers, **Then** viewport thumbs still go first.

**Bug**: B-007. **Evidence**: LIKELY. Mechanism exists (`hoverPrefetch`, `prefetch_photo`, `peekPreloaded`).

---

### User Story 5 - Neighbors are ready while paging (Priority: P1)

Once photo N is open, the next photo and the next four along the travel direction prepare at useful viewer quality; two behind wait their turn. Fast paging does not drop the nearest next photo. A jump retargets the window without wiping already-warm frames.

**Why this priority**: Sequential browse is the main viewer loop; CONFIRMED gap vs existing neighbor window.

**Independent Test**: Open N; N+1…N+5 start preparing; N−1/N−2 after high-pri. Advance to N+1 without re-decoding a ready frame. Reverse direction; window flips; current frame stays first. Jump far away; stale work yields. Memory cap holds.

**Acceptance Scenarios**:

1. **Given** viewer at index N, **When** the photo is displayed, **Then** preparation of N+1 (P1) and N+2…N+5 (P2) starts; N−1…N−2 (P3) only after high-pri or spare capacity.
2. **Given** fast forward paging, **When** interval is under the fast threshold, **Then** P1 is **not** demoted to a tiny grid thumb solely because pace is fast.
3. **Given** a ready neighbor in memory, **When** the user steps onto it, **Then** it is not fetched again from scratch.
4. **Given** an arbitrary jump, **When** the index changes, **Then** the new window has priority; `kept` is not fully cleared.

**Item**: C-006. **Evidence**: CONFIRMED gap. **Locked**: CL-C006-01…08.

---

### User Story 6 - First viewer frame fills the screen correctly (Priority: P1)

While paging, any shown frame (even a preview) is already in display orientation and uses on-screen geometry — not a tiny sideways stamp that later grows. Remaining after C-006: frame aspect and orientation of the first bytes.

**Why this priority**: Browse quality; LIKELY. C-006 reduces frequency; does not replace this story.

**Independent Test**: After B-007 and C-006, fast-browse EXIF 6/8 and RAW. If the small/sideways first paint still happens, apply the **geometry** fix (known display-aspect, not 1:1). Orientation-in-pixels is B-002/B-004 diagnose, not assumed one root.

**Acceptance Scenarios**:

1. **Given** known display aspect, **When** the file changes, **Then** the placeholder/thumb uses that aspect in fill-screen mode (no 1:1 postage stamp).
2. **Given** a baked upright preview, **When** it is the first paint, **Then** it is not shown on its side.

**Bug**: B-009 remainder; related LIKELY B-002/B-004. **Order**: after B-007 and C-006.

---

### User Story 7 - One empty/loading language for the gallery (Priority: P2)

Opening, empty folder, no supported files, subfolders only, empty Favorites, empty trash, and open errors share one visual template.

**Why this priority**: First-run polish; CONFIRMED; no data risk.

**Independent Test**: Each kind shows the shared empty layout (icon + title + description), not a bare centered sentence — except as designed inside that template.

**Item**: C-001. **Evidence**: CONFIRMED.

---

### User Story 8 - Settings shell does not jump when language changes (Priority: P2)

Changing ru/en/de/zh-Hans while Settings is open does not resize the dialog chrome; text wraps or scrolls inside.

**Independent Test**: Open Settings → Interface; cycle locales; dialog height stable.

**Bug**: B-010. **Evidence**: CONFIRMED.

---

### User Story 9 - Support tab has a GitHub star action (Priority: P2)

Settings → Support offers a clear «Star on GitHub» action with icons on the tab’s buttons. Reminders checkbox still works. Opens the repo URL; does not call the GitHub star API.

**Item**: C-004. **Evidence**: CONFIRMED.

---

### User Story 10 - One photo still zooms in app fullscreen (Priority: P2)

With a single remaining photo and the bottom-bar app-fullscreen, the zoom slider changes the tile size within the viewport. Windowed mode must not regress.

**Why this priority**: LIKELY — **diagnose** mosaic last-row vs freeze vs CSS before changing layout math for all galleries.

**Independent Test**: One photo + app-fullscreen; record `tile.width`/`row.height` across zoom steps vs windowed. Fix only the confirmed cause. Do not disable zoom when `images.length === 1`.

**Bug**: B-008. **Evidence**: LIKELY.

---

### User Story 11 - Warm thumbs do not vanish on a fast jump (Priority: P2)

On a fully warmed folder, fast scroll or jump-to-end does not blank the viewport and then flash a whole pack of thumbs.

**Why this priority**: LIKELY — three-way diagnose (`thumbs.get` vs unpublished mosaic vs blank `<img>`). Do not blame overscan first. Do not disable virtualization or raise HDD parallelism.

**Bug**: B-011. **Evidence**: LIKELY. Related to B-001 follow-end empty tail.

---

### User Story 12 - One map for toasts, errors, and dialogs (Priority: P2)

File ops, boot, settings, confirm, and errors use: toast (short result + undo) **or** modal (decision) **or** empty screen (C-001) — not a third unnamed strip. Existing widgets; no new UI library. Optional `ui-catalog/` fixtures.

**Item**: C-002. **Evidence**: CONFIRMED. Depends on C-001 visual language; C-003 dialog uses the same shell.

---

### User Story 13 - Mock update dialog (Priority: P2)

The user can see where updates will live: a dialog (version, notes, Update / Later) and an About entry. Update is disabled during a file operation or unfavorite. Progress and error states are fixtures. **No** plugin `check()`, no download.

**Item**: C-003. **Evidence**: CONFIRMED absence. **CL-C003-01**. Real updater = 002.

---

### User Story 14 - Favorites copies look as sharp as the origin grid (Priority: P2)

After adding to Favorites, opening the Favorites folder shows the same useful thumbnail tier already generated for the origin when size (and preferably hash) match — not a muddy 256 while origin already had 512/1024.

**Independent Test**: Warm origin thumbs → add to favorites → open Favorites; quality matches origin tier; origin file is not re-read if cache JPEGs exist. Different size → no share.

**Bug**: B-005. **Evidence**: CONFIRMED. Reuse `favorite_snapshot_for_copy` + `cached_thumb`. Do not wait on C-005 overlay. Never share cache if copy size ≠ origin. Originals not mutated.

---

### User Story 15 - Background folder fill is measured before any scheduler tweak (Priority: P3)

The product order remains: viewport, then newly scrolled tiles, then the rest of the folder (including while idle). If the folder «feels sluggish» while sitting still, **measure** idle read-slot use (P4 upgrades vs P5 background) before changing fairness. Viewport-first must not be inverted.

**Bug**: B-006. **Evidence**: UNVERIFIED as a defect; queue policy CONFIRMED. **No `pick_index` rewrite** in this feature without a new owner seal.

---

### Edge Cases

- Stick-to-end vs unpublished mosaic tail (B-001 × B-011).
- EXIF 1/3/6/8 and already-upright embedded preview (B-002/B-004) — diagnose separately from display `rotationQuarters` (B-003).
- Fast viewer pace currently drops `near`; C-006 forbids dropping P1.
- Mass unfavorite while listing is not `ready` (C-005 hide gate).
- Partial batch unfavorite failure (rollback overlay only; I4/I5/I8).
- Hover leave vs click on the same path (B-007).
- Arbitrary viewer jump with in-flight neighbor jobs (C-006).
- App-fullscreen freeze phases vs one-tile mosaic last-row (B-008).
- Favorites cache share after origin trash/rename (B-005 fallback to copy decode).
- Idle P4 starving P5 (B-006) — measure, do not assume.

---

## Requirements *(mandatory)*

### Functional Requirements — MUST (CONFIRMED / CHANGED)

- **FR-001**: Down-jump MUST follow growing scroll height until listing+layout ready and at bottom; up-jump MUST NOT wait (B-001).
- **FR-002**: Changing `rotationQuarters` MUST invalidate published geometry of **that** index and MUST NOT squash the thumb with `object-fit: fill` (B-003).
- **FR-003**: Pending unfavorite MUST hide those copies in grid/viewer, turn stars off, clear their selection, and hide an empty Favorites folder without waiting for cleanup; rollback only on IPC failure; originals MUST NOT be deleted (C-005, I8).
- **FR-004**: Neighbor window MUST be P0=N, P1=next along direction, P2=+2…+5, P3=two behind after high-pri (C-006, CL-C006-04).
- **FR-005**: Fast navigation MUST NOT drop P1 priority (CL-C006-05).
- **FR-006**: Direction changes MUST retarget the window from actual movement; current frame stays P0 (CL-C006-05).
- **FR-007**: Already-prepared viewer resources MUST be reused; inflight work MUST be joined, not duplicated (C-006, B-007 intent).
- **FR-008**: Neighbor work MUST NOT starve gallery viewport thumbs (CL-C006-07, I9 product order).
- **FR-009**: Empty/loading/error/Favorites/trash/subfolders-only MUST share one empty template (C-001).
- **FR-010**: Open Settings dialog height MUST stay stable across ru/en/de/zh-Hans (B-010).
- **FR-011**: Support tab MUST offer GitHub star via existing repo URL and button icons (C-004).
- **FR-012**: Toast vs modal vs empty MUST be an explicit map on existing widgets (C-002).
- **FR-013**: Mock update UI MUST exist (dialog + About); Update disabled on file op/unfavorite; no plugin `check()` (C-003).
- **FR-014**: Favorites copy thumbs MUST reuse origin cache files when identity matches; no new cache product (B-005).
- **FR-015**: C-006 MUST use existing preload modules only; MUST NOT rewrite `pick_index`; MUST NOT add a second cache (CL-C006-01/02).
- **FR-016**: `MAX_ACTIVE` MUST stay 2 unless a measured sealed follow-up changes it; `MAX_KEPT` MUST NOT increase without a memory-cost check (CL-C006-06).
- **FR-017**: RAW/HEIC MUST NOT be fully decoded at max resolution unless it improves the on-screen frame (CL-C006-07).

### Functional Requirements — diagnose-then-fix (LIKELY / UNVERIFIED)

- **FR-D01**: B-007: confirm cancel-on-leave / `naturalWidth` / `grid_blocks_hover`; then join hover with open without a new preload system.
- **FR-D02**: B-009 after C-006: if first paint is still small or sideways, fix frame from known display-aspect; do not assume the same root as B-002/B-004.
- **FR-D03**: B-002/B-004: distinguish placeholder vs letterbox-in-JPEG vs embedded heuristic before changing emit.
- **FR-D04**: B-008: compare live tile boxes in app-fullscreen vs window; do not disable zoom for one photo.
- **FR-D05**: B-011: three-way slot check before changing overscan or batching.
- **FR-D06**: B-006: log/measure idle P4 vs P5; no scheduler rewrite in 003 without a new seal.

### Key Entities

- **Directory session**: only current session applies listing/thumbs (I1).
- **Published mosaic slot**: frozen aspect until explicitly thawed (B-003).
- **Favorite overlay**: per-path pending desired star (C-005, I4).
- **Viewer neighbor window**: P0–P3 relative to index and direction (C-006).
- **Thumbnail identity**: path + size + mtime (B-005); origin snapshot is lifecycle, not yet cache share.
- **Empty kind**: gallery placeholder taxonomy (C-001).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a large folder, down-jump before ready ends at the last grid slots after listing completes (not mid-strip) in one attempt of the documented repro.
- **SC-002**: After one 90° rotate, the same tile’s aspect matches the rotated photo with no visible squash.
- **SC-003**: Mass unfavorite of a ready Favorites listing removes tiles/stars/folder tile without waiting for recycle completion; originals remain on disk.
- **SC-004**: After hover ≥100 ms on a JPEG, open does not show a full cold-load spinner when a warm/native frame is already in memory (if B-007 reproduces).
- **SC-005**: Opening N starts preparation of the next five along direction; two behind wait; stepping to N+1 does not re-decode a ready frame.
- **SC-006**: Fast paging does not by itself demote the nearest next photo to a tiny preview when a higher-quality resource is available or in flight.
- **SC-007**: Settings language switch does not change dialog chrome height.
- **SC-008**: Empty Favorites/trash/unsupported/subfolders-only use the same empty layout family as an empty album.
- **SC-009**: Mock update dialog can be opened from About; Update is inert during file op/unfavorite; no updater plugin in this feature.
- **SC-010**: When origin already has 512/1024 cache files and copy size matches, Favorites shows that tier without waiting for a new 256-only pass.
- **SC-011**: No package in this feature deletes or overwrites user originals (I8) or inverts viewport-first thumbs without a measured B-006 seal.

## Assumptions

- Working tree for planning is `ImageGrid`; implementation uses sealed `docs/refactoring/tasks/` per TASK_HANDOFF — Spec-Kit `tasks.md` does **not** authorize source edits.
- Feature 001 lifecycle stays in place; 003 only closes UX remainder (C-005) and cache share (B-005).
- Feature 002 remains the only place for real updater.
- LIKELY bugs may close as «not reproduced» after the listed diagnosis, with BUGS.md updated to UNVERIFIED/FIXED — not silent scope expansion.
- `ui-catalog/` PNG policy is decided at first catalog commit (git vs gitignore), not in this spec.

## Constitution alignment

- I / I8: no original mutation in B-005/C-005/C-006.
- IV: one sealed task per implementation package; this document is planning only.
- V: LIKELY/UNVERIFIED stay diagnose-gated.
- VI: single checkout, ordinary branches; no worktree for 003.
