# Feature Specification: Safe Favorites Lifecycle

**Feature Branch**: `001-safe-favorites-lifecycle` (optional; independent of spec directory)

**Created**: 2026-10-17

**Status**: Draft — product requirements agreed; implementation not started

**Input**: Product TZ «Безопасный жизненный цикл Favorites» + read-only audit `docs/audit/favorites/`

**Priority**: High — user file operations

## References

| Document | Role |
|----------|------|
| `docs/audit/favorites/AUDIT_SUMMARY.md` | As-is architecture and gaps |
| `docs/audit/favorites/EDGE_CASE_MATRIX.md` | Evidence status baseline |
| `docs/audit/favorites/FAILURE_RECOVERY.md` | Reconcile / undo stubs |
| `.specify/memory/constitution.md` v1.1.0 | Governance and safety |
| `docs/INVARIANTS.md` | Canonical invariants I1–I10 |

**Out of scope (explicit):** sidebar folder bookmarks (`favorite_folders`), gallery-wide refactor, thumbnails/virtualization unless required for favorites UX, cloud storage, disk-wide photo search, in-app restore from Windows Recycle Bin, unrelated IPC/SQLite schema changes without justification.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add photos to Favorites safely (Priority: P1)

A user selects one or more photos in a normal album and marks them as favorites. The app creates independent copies in the active «Избранное» folder, shows stars only for confirmed successes, and never modifies originals.

**Why this priority**: Core value of Favorites; highest file-safety risk if implemented as move or silent failure.

**Independent Test**: Add single and batch favorites on a temp album; verify originals unchanged, copies exist, stars match confirmed successes, partial batch shows «N of M» summary.

**Acceptance Scenarios**:

1. **Given** a readable photo in an open album, **When** the user adds it to favorites, **Then** a copy exists in active Favorites, the original is unchanged, and the star reflects a confirmed link.
2. **Given** a multi-select of 50 photos, **When** disk space runs out partway, **Then** successful copies remain, stars appear only for successes, and the user sees «Added 35 of 50» (or equivalent) with failure details — without rolling back successful copies.
3. **Given** an identical file already in Favorites, **When** the user adds again, **Then** the app does not overwrite; it reuses or suffixes per safe duplicate rules (no uncontrolled duplicates).

---

### User Story 2 - Remove star from album (copy to Recycle, origin kept) (Priority: P1)

In the parent album, the user taps an active star. The app removes only the confirmed Favorites copy (via Windows Recycle Bin), leaves the original intact, and updates the star after confirmed success.

**Why this priority**: Most common unfavorite path; must not delete originals or wrong files.

**Independent Test**: Star on → star off from album grid; original remains; copy leaves active Favorites; ambiguous cases require confirmation, not silent delete.

**Acceptance Scenarios**:

1. **Given** a confirmed origin↔copy link, **When** the user clears the star in the album, **Then** only the copy is recycled, the original is unchanged, and the star is off after confirmed result.
2. **Given** ambiguous copy identification, **When** the user clears the star, **Then** the app does not perform dangerous deletion until the situation is resolved per FR-11 / existing confirm kinds.

---

### User Story 3 - Last copy when origin is missing (Priority: P1)

Inside active Favorites, the user tries to unfavorite a copy whose original is missing or unverified. The app must not silently delete the possibly last instance.

**Why this priority**: Directly addresses «last available instance» safety from the TZ.

**Independent Test**: Remove or rename origin externally; unfavorite from Favorites folder; dialog offers return / choose folder / recycle with extra confirm / cancel.

**Acceptance Scenarios**:

1. **Given** a copy in active Favorites and no verified original, **When** the user attempts to remove the star from the copy, **Then** the app shows the «Оригинал фотографии не найден» choice dialog (actions A–D per FR-11) instead of silent recycle.
2. **Given** the user chooses «Вернуть в исходную папку» with a valid safe target, **When** move succeeds, **Then** Favorites status is cleared and no file is overwritten at destination.
3. **Given** move fails, **When** the operation completes, **Then** the file remains in Favorites and is not treated as deleted.

---

### User Story 4 - Rename Favorites folder to a normal collection (Priority: P2)

The user renames «Избранное» to a custom name (in StitchVue or Explorer after sync). Files stay in place; stars on originals in the album go off; new favorites use a new active folder; old copies are not auto-migrated.

**Why this priority**: Preserves user collections without hidden data loss.

**Independent Test**: Rename service folder; verify files remain browsable; stars off; new star creates new active Favorites; historical links do not re-light old stars.

**Acceptance Scenarios**:

1. **Given** active Favorites with copies, **When** the folder is renamed to a non-canonical name, **Then** files remain, folder is a normal folder, stars on originals are off, and new adds create/use new active Favorites per rules.
2. **Given** historical SQLite links to the old folder, **When** the user opens the album, **Then** stars do not reactivate for that old collection without a new confirmed add.

---

### User Story 5 - External Explorer changes and recovery (Priority: P2)

While StitchVue is open, the user deletes, moves, or adds files via Windows Explorer. The app reconciles affected areas safely, avoids false stars, and notifies when automatic repair cannot finish.

**Why this priority**: Real-world HDD workflows; prevents silent DB/disk drift.

**Independent Test**: Delete copy in Explorer → star off after sync; add foreign file into Favorites → no automatic origin link; FS/SQLite mismatch → non-blocking user notice after safe reconcile attempt.

**Acceptance Scenarios**:

1. **Given** a copy deleted in Explorer, **When** the app syncs the affected folder, **Then** the star is off and metadata is updated without deleting unrelated files.
2. **Given** a copy on disk but incomplete SQLite record, **When** reconcile runs, **Then** safe repair is attempted; if still unresolved, a plain-language notice appears — copy is not auto-deleted.
3. **Given** a file manually dropped into Favorites, **When** listing runs, **Then** it is not auto-linked to an origin by name alone.

---

### Edge Cases

Mandatory scenarios **EC-01** through **EC-22** from the product TZ (§6) are in scope. Each must map to at least one acceptance test or manual smoke step before release. Summary table:

| ID | Expected result (abbrev.) |
|----|---------------------------|
| EC-01 | Do not recreate deleted source folder without consent |
| EC-02 | Offline source disk → no random restore path |
| EC-03 | Name collision → no overwrite; safe alternative |
| EC-04 | Origin in Windows Recycle ≠ confirmed destroyed |
| EC-05 | Renamed origin outside app → no link by name only |
| EC-06 | Modified copy content preserved |
| EC-07 | Failed move → source still available when confirmed |
| EC-08 | FS move without SQLite → safe reconcile |
| EC-09 | Crash mid-move → no duplicate dangerous retry |
| EC-10 | Mass unfavorite with missing origins → no ambiguous auto-delete |
| EC-11 | Renamed old Favorites → normal folder, no auto-stars |
| EC-12 | New file at old path → no inherited star |
| EC-13 | Cross-disk move OOM → keep source on failure |
| EC-14 | No target permission → do not delete source |
| EC-15 | Parallel ops on same photo → blocked or serialized safely |
| EC-16 | Folder switch during op → stale UI not applied |
| EC-17 | External change during confirm → re-validate |
| EC-18 | IPC retry after crash → no unsafe double apply |
| EC-19 | Long paths, Unicode, junction/symlink → safe path checks |
| EC-20 | Partial mass op → preserve successes, show errors |
| EC-21 | Copy exists, no SQLite row → do not delete copy to «fix» DB |
| EC-22 | Different file at old origin path → not confirmed origin |

---

## Requirements *(mandatory)*

### Non-functional priorities

1. User file safety  
2. Correct application state (stars, links)  
3. Predictable UI  
4. Performance  
5. Implementation convenience  

### Product invariants (INV-01 – INV-08)

| ID | Requirement |
|----|-------------|
| INV-01 | Add-to-favorites is always copy; never mutates original; star-off from album does not mutate original |
| INV-02 | Copies are independent; origin delete/move/rename does not auto-delete copy |
| INV-03 | No implicit delete/move; ambiguity ≠ permission to delete |
| INV-04 | No false success in UI or persistence when required steps unconfirmed |
| INV-05 | No automatic overwrite on name/path collision |
| INV-06 | Stars reflect confirmed active Favorites link; path/name alone ≠ restore old link |
| INV-07 | Crashes/errors must allow safe determination of state; no deleting user files to «fix» DB |
| INV-08 | Deactivated renamed Favorites remains a normal folder; no auto-delete or auto-migrate of old copies |

### Functional Requirements

- **FR-001 (FR-01)**: Add to favorites — validate source and target; create independent copy; record confirmed origin↔copy link; optimistic UI allowed with rollback on failure; preserve partial batch results; safe duplicate handling.

- **FR-002 (FR-02)**: Stale SQLite links — **policy: safe background reconciliation**. Detect stale/ambiguous links; distinguish confirmed deletion vs temporary unavailability; preserve recovery data; metadata cleanup only when safe; **forbidden**: unconditional row delete on every star list fetch.

- **FR-003 (FR-03)**: FS/SQLite mismatch — **policy: auto-reconcile + notify if unresolved**. On copy exists but journal incomplete: persist needs-review state, attempt safe repair, verify, show non-blocking plain-language notice if still broken; never auto-delete copy. Align with existing reconciliation statuses where audit confirms them (e.g. needs-reconciliation).

- **FR-004 (FR-04)**: Star off from album — resolve confirmed copy; apply existing confirmations when needed; send copy to Windows Recycle Bin; keep origin; update star after confirmed result; no dangerous delete when ambiguous.

- **FR-005 (FR-05)**: Explorer changes — **policy: reconcile affected folders only**. Handle delete/move/rename/add/availability; no full-library scan; manual drops into Favorites do not auto-link by name; mark ambiguous states explicitly.

- **FR-006 (FR-06)**: Undo after unfavorite — **policy: Windows Recycle Bin only**. Clear messaging; do not advertise working in-app undo; do not treat undo stub as functional; no auto-restore without user action; do not touch unrelated Recycle Bin items.

- **FR-007 (FR-07)**: Album moved in Explorer — **policy: no auto re-guessing links**. Do not mutate photos; do not apply old links to different files; no disk-wide search; missing old path ≠ delete copies; no false stars from unconfirmed links.

- **FR-008 (FR-08)**: Batch add — **policy: partial success**. Keep successful copies and stars; report failures; summary «Added N of M»; no rollback of successes. If entire IPC fails without per-file truth, do not claim all failed without verifying disk state.

- **FR-009 (FR-09)**: Rename active Favorites — renamed folder becomes normal; files kept; stars off on originals; new favorites use new active folder; no auto-migrate; StitchVue and Explorer rename converge after sync; historical links do not reactivate old stars.

- **FR-010 (FR-10)**: Delete origin after favoriting — origin delete (app or Explorer) does not delete copy; copy remains usable; historical link may remain for safe recovery; new file at same path does not inherit star; mass origin delete does not remove copies.

- **FR-011 (FR-11)**: Unfavorite copy with missing/unverified origin — **choice dialog** (title, body, actions A–D as in TZ). No silent delete; failed move does not clear Favorites status; extra confirmation for Recycle when last instance possible.

### File-operation safety (§7)

- **FR-012**: Before high-risk ops: verify source identity, target availability, path safety, no forbidden source/target overlap, name conflicts, operation state, incompatible parallel ops.

- **FR-013**: During high-risk ops: intermediate states, idempotency/replay safety, clean failure, recovery metadata, crash-safe behavior (audit does not guarantee all are complete today — implementation must close gaps).

- **FR-014**: After ops: verify disk outcome, SQLite consistency, stars, user messaging, no false success. Cross-volume move not atomic; delete source only after confirmed destination ready.

### UI/UX (§8)

- **FR-015**: Minimize confirmations for safe routine actions; warn when last instance may be lost; plain language; no false stars or success toasts.

- **FR-016**: Required message classes: added; partial add count; single failure; needs review; origin not found; moved to chosen folder; move failed with file still in place (only when verified).

- **FR-017**: Optimistic UI must reconcile with backend or sync; unknown outcome ≠ assumed success or safe rollback without verification.

### Testing requirements (§9)

- **FR-018**: Rust tests on temp dirs — copy, origin delete, copy delete, missing-origin unfavorite, relocate paths, collisions, partial failure, SQLite errors, retry, interrupt recovery, rename Favorites, external change simulation, Windows path normalization.

- **FR-019**: Frontend tests — stars, optimistic UI, FR-11 dialog, cancel, last-copy confirm, partial batch, folder switch during op, recovery notices.

- **FR-020**: Integration tests — React ↔ IPC ↔ Rust ↔ SQLite ↔ FS; especially failure ordering (FS ok / DB fail, DB ok / FS fail, restart, TOCTOU).

- **FR-021**: Never use real user photo libraries or production DB in automated tests.

### Key Entities

- **Original**: Photo file in a normal album that the user favorited.
- **Favorites copy**: Separate file created in active «Избранное».
- **Active Favorites**: Service folder recognized as current favorites container for an album.
- **Historical link**: SQLite record of a past origin↔copy association (may be inactive).
- **Ambiguous state**: Cannot reliably verify file identity or location.
- **Last available instance**: App cannot confirm another equivalent instance exists (not proof of uniqueness on disk).

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In acceptance tests, 100% of «add favorite» cases leave originals byte-identical on disk.
- **SC-002**: In acceptance tests, 100% of «delete origin» cases leave existing Favorites copies present unless user explicitly removed the copy.
- **SC-003**: Zero automated or manual acceptance cases where star-off from album deletes the original file.
- **SC-004**: Batch add tests with injected failures report correct success count and preserve all successful copies.
- **SC-005**: FR-11 dialog shown in 100% of tested «missing origin» unfavorite attempts from Favorites folder (no silent recycle).
- **SC-006**: Rename-to-normal-folder tests: 100% file retention in renamed folder; 0% erroneous star reactivation from historical links.
- **SC-007**: Explorer-delete-copy tests: star off within one sync cycle of affected folder (define cycle in plan).
- **SC-008**: All EC-01–EC-22 have traced test or documented manual smoke with pass/fail.
- **SC-009**: No acceptance case marks UI/SQLite success when audited required steps failed (INV-04).
- **SC-010**: Manual release smoke checklist for favorites (constitution + INVARIANTS) executed and recorded before ship.

---

## Assumptions

- Windows desktop target (Tauri 2) per existing StitchVue scope.
- Active Favorites folder rules (canonical name + role marker) remain as audited unless this spec explicitly changes them.
- Windows Recycle Bin is the only supported unfavorite undo channel in this release.
- Album path change via Explorer is unsupported for automatic link migration (FR-007).
- Photo favorites and sidebar folder bookmarks remain separate features.
- Implementation reuses existing file-op, IPC, and reconcile machinery where audit marks them **CODE-SUPPORTED** or **VERIFIED**; gaps are work items, not acceptance of defects.

## Current State (Audit) — not desired end state

Documented gaps to close during implementation (see `docs/audit/favorites/GAP_ANALYSIS.md`):

- No user UI for unresolved reconciliation (FR-003 adds requirement).
- Orphan `favorite_copies` rows not pruned on list (FR-002 adds background reconcile).
- Limited Explorer-driven DB sync (FR-005).
- `undo_favorite_removal` stub (FR-006 — document only, not implement Windows restore).
- Batch IPC total failure UX (FR-008).
- FR-11 dialog may extend existing `needs_confirm` / relocate flows — exact UI parity TBD in `/speckit-plan`.

## Constitution Alignment

- Principles I (file safety), II (invariants), V (evidence), audit-before-specify: satisfied by audit package.
- Implementation stages require sealed tasks per `TASK_HANDOFF.md` (high risk: FS, SQLite, IPC).

## Acceptance Criteria (Release) — TZ §11

Release-ready when items 1–15 of the product TZ acceptance list are verified by tests and smoke, matching FR/INV above.

---

## SpecKit Next Steps (no implementation)

1. `/speckit-clarify` — technical boundaries only (reconcile triggers, Explorer scope, FR-11 vs existing dialogs).  
2. `/speckit-plan` — minimal delta from audit baseline.  
3. `/speckit-checklist` / `/speckit-tasks` / `/speckit-analyze`.  
4. Implementation only with owner approval + sealed tasks.
