# Favorites — audit summary

**Mode:** STRICT READ-ONLY (2026-10-17). **No application code changed.**

## 1. Architecture map (short)

```text
UI (GalleryPage, SelectionActions, overlays)
  → invoke: run_file_operation | favorite_origin_paths | remove_favorite_*
    → commands/mod.rs
      → Pipeline (execute_file_operation, record_operation_links, favorites IPC)
        → file_ops (copy_one, favorites removal engine, locks, recycle)
        → database (favorite_copies, file_op_log, trash_entries)
        → events: file-operation-progress; folder-changed (indirect)
```

Detail: [`ARCHITECTURE.md`](ARCHITECTURE.md). Evidence index: [`EVIDENCE_INDEX.md`](EVIDENCE_INDEX.md).

**Separate feature:** sidebar folder bookmarks (`toggle_favorite` / `favorite_folders` table) — not photo stars.

## 2. Edge matrix scenario counts

From [`EDGE_CASE_MATRIX.md`](EDGE_CASE_MATRIX.md) (**48** scenarios):

| Status | Count | Meaning |
|--------|------:|---------|
| VERIFIED | 18 | Direct test or CP coverage |
| CODE-SUPPORTED | 17 | Logic present; scenario not fully tested |
| PARTIAL | 9 | Incomplete handling or weak evidence |
| MISSING | 1 | No meaningful handling found (e.g. long-path suite) |
| UNVERIFIED | 3 | Product rule unclear |

## 3. Critical risks

| Risk | Why | Mitigation today |
|------|-----|------------------|
| FS/SQLite desync after add | Copy succeeds, link fails → `NEEDS_RECONCILIATION` | Boot reconcile; no user UI |
| Wrong origin on ambiguous unfavorite | Parent scan ambiguity | `needs_confirm` + dialog |
| Origin in trash mishandled | Cross-feature trash + favorites | `OriginInTrash` + restore/recycle_copy (tested CP) |
| Original deleted by favorite add | Would violate I8/I10 | **Not observed** — copy-only path |
| Silent orphan DB rows | Stars off but rows remain | No GC |
| Stub undo | User may expect in-app undo | Error message → Windows recycle |
| Partial batch IPC failure | All items marked failed | Documented residual in final report |

## 4. Missing tests (priority)

1. End-to-end Tauri favorites IPC (add + list + remove).
2. GalleryPage orchestration (extract or component tests).
3. Long Windows paths, ACL denied, disk-full simulations.
4. External Explorer delete/move while app open.
5. Mass unfavorite session stale guard (F11).
6. Manual smoke checklist execution (10 scenarios in INVARIANTS rules).

See [`TEST_COVERAGE.md`](TEST_COVERAGE.md).

## 5. Tooling recommendations

- **Regression:** `cargo test favorites_trash_lifecycle_final --`, `favorites_copy_recovery --`, `favorites_lifecycle --`; frontend `removeFavoritesBatch.test.ts`, `favoritePathsServerSync.test.ts`.
- **Planning:** use this audit folder as SpecKit evidence input (constitution v1.1.0: audit before `/speckit-specify`).
- **Implementation:** sealed tasks per `docs/refactoring/TASK_HANDOFF.md` when code changes.

## 6. Documents created

| File | Purpose |
|------|---------|
| [`EVIDENCE_INDEX.md`](EVIDENCE_INDEX.md) | File/symbol map |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Flows + Mermaid |
| [`DATA_MODEL.md`](DATA_MODEL.md) | SQLite + FS |
| [`OPERATION_LIFECYCLE.md`](OPERATION_LIFECYCLE.md) | Add/list/remove/rename/boot |
| [`EDGE_CASE_MATRIX.md`](EDGE_CASE_MATRIX.md) | 48 scenarios |
| [`FAILURE_RECOVERY.md`](FAILURE_RECOVERY.md) | Journal, reconcile, stubs |
| [`INVARIANTS.md`](INVARIANTS.md) | I1–I10 mapping |
| [`TEST_COVERAGE.md`](TEST_COVERAGE.md) | Suite map |
| [`GAP_ANALYSIS.md`](GAP_ANALYSIS.md) | Risks + recommendations |
| [`AUDIT_SUMMARY.md`](AUDIT_SUMMARY.md) | This file |

## 7. Open questions before `/speckit-specify`

1. Orphan `favorite_copies` policy (prune on read vs background vs ignore).
2. User-visible handling for `ST_NEEDS_RECONCILIATION`.
3. Expected behavior when user stars from parent album (path to remove copy).
4. External edits (Explorer) — should watcher trigger DB reconcile or only UI refresh?
5. Is Windows Recycle Bin the permanent unfavorite undo story?
6. Multi-album move/rename outside in-app `rename_folder` — supported?
7. Maximum acceptable partial-failure UX for batch add (disk full).
8. Should inactive historical `Избранное` folders be browsable with old copies?

## Security analysis (condensed)

- **Origin safety on add:** copy-only; temp+rename; locks reduce parallel corruption (**strong CODE-SUPPORTED**).
- **Origin safety on remove:** recycle targets copy; restore_origin tested; confirm gates for mismatch (**strong where tested**).
- **False success:** per-outcome statuses; batch maps failures; link failure marks reconciliation — **UI star may lag** on edge cases (**PARTIAL**).
- **Handler presence ≠ safety:** e.g. `discard_favorite_undo` no-op; undo stub — documented.

---

*SpecKit commands not run per task instructions.*
