# Quickstart validation: 003-pre-release-stabilization

Planning-only. Do not run a full typecheck/build as part of **writing** this feature. Each sealed implementation package runs its own targeted tests.

## Prerequisites

- Checkout `C:\Users\Pavel\Desktop\ImageGrid`
- Fixture/temp albums only (constitution I)
- `BUGS.md` repro steps per ID

## Per-story smoke (after that package lands)

| Story | Smoke |
|-------|--------|
| US1 B-001 | Large folder, down before ready → real end; up immediate; manual scroll cancels |
| US2 B-003 | Rotate 90° → grid aspect, no squash |
| US3 C-005 | Mass unfavorite → parent + hidden tile; partial → tiles gone; fail → overlay rollback; originals exist |
| US4 B-007 | Hover ≥100 ms JPEG → open without cold reload if warm exists |
| US5 C-006 | Open N → N+1…N+5; back lower; step N+1 no re-decode; reverse direction; jump retargets |
| US6 B-009 | After US4–US5, fast EXIF 6/8 browse: fill-screen, not sideways stamp |
| US7 C-001 | Empty / unsupported / subfolders / favorites / trash / opening share template |
| US8 B-010 | Settings language cycle, chrome height stable |
| US9 C-004 | Support GitHub star opens repo |
| US10 B-008 | One photo + app-FS zoom changes tile (if reproduced) |
| US11 B-011 | Warm folder fast jump: no full blank pack (if reproduced) |
| US12 C-002 | One toast host / one dialog shell for a sample file-op and confirm |
| US13 C-003 | About → mock dialog; Update disabled during file op |
| US14 B-005 | Origin 1024 then Favorites copy shows ≥ that tier when size matches |
| US15 B-006 | Record idle P4 vs P5; no scheduler change unless sealed |

## Targeted tests required for C-006 (CL-C006-08)

`viewerPreloadLogic.test.ts` / `viewerPreload` tests:

- Fast navigation does not drop P1
- Direction change rebuilds P1–P3 from new direction
- Ready `kept` skips a new start (inflight/reuse)
- Protect/evict respects `MAX_KEPT` without clearing the whole map on next

## Regression (high-risk packages)

Favorites originals (I8), session filter (I1), viewport-first thumbs, existing `pick_index` idle/scroll/fast tests **unchanged in meaning**.
