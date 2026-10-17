# IPC Contract Delta: Favorites Lifecycle (planned)

**Baseline**: `docs/IPC.md`, `docs/audit/favorites/ARCHITECTURE.md`  
**Principle**: Prefer backward-compatible extensions; no breaking renames.

## Unchanged commands (behavior may tighten)

| Command | Spec refs |
|---------|-----------|
| `run_file_operation` (`copy_to_local_favorites`) | FR-001, FR-008, CL-P01 post-op reconcile |
| `favorite_origin_paths` | FR-002, CL-P02 refresh |
| `favorite_origins_for_copies` | Batch origin cache |
| `preview_remove_favorite_copy` / `remove_favorite_copy` | FR-004, FR-011 |
| `preview_remove_favorite_copies` / `remove_favorite_copies_batch` | FR-011b, EC-10 |
| `rename_folder` | FR-009 |
| `cleanup_empty_service_folder` / `remove_empty_service_folder` | After batch remove |

## Stub (document only — FR-006)

| Command | Current | Plan |
|---------|---------|------|
| `undo_favorite_removal` | Error string to Windows Recycle | UI must not invoke; help text only |
| `discard_favorite_undo` | No-op | No change |

## Optional extension (Phase 3 — if UI cannot infer CL-P05)

**Command**: `favorites_reconcile_status`  
**Input**: `{ directory: string }`  
**Output**:

```typescript
{
  pendingReviewCount: number;
  hasNeedsReconciliation: boolean;
}
```

**Source**: Query `file_op_log` for open album prefix + `ST_NEEDS_RECONCILIATION`.  
**Alternative**: Extend `favorite_origin_paths` response wrapper in TS only after Rust adds optional field (coordinate in sealed task).

## `RemoveFavoriteCopyResult` (Rust → TS)

**Optional new fields** (serde `skip_if_none`):

| Field | Type | Purpose |
|-------|------|---------|
| `reconcileSuggested` | `boolean` | CL-P05 / FR-003 notice |
| `fr11Required` | `boolean` | CL-P03 routing hint for UI |

No removal of existing fields.

## Events

| Event | Plan change |
|-------|-------------|
| `folder-changed` | Handler also triggers favorites metadata reconcile (CL-P02) — may be frontend-only extra `invoke` chain |
| `file-operation-progress` | Unchanged |

## Disk truth after IPC failure (tasks T044a / T044b)

When a favorites-related `invoke` fails at the transport layer, UI MUST NOT infer per-file outcomes from optimistic overlay alone.

**Preferred sources (read-only, non-destructive):**

| Operation | Backend source |
|-----------|----------------|
| Batch/single add (`copy_to_local_favorites`) | `favorite_origin_paths` / star refetch for open album; optional `Claim::Replay` on `run_file_operation` **only** if the same `operationId` was persisted and `claim` returns `Replay` (idempotent replay of completed op — not a second destructive run) |
| Batch unfavorite | `remove_favorite_copies_batch` normally returns per-file `Vec` even on partial logical failure; on total invoke error, re-invoke batch preview or per-path `preview_remove_favorite_copy` + disk checks — **not** a blind retry of confirmed removals |
| Removal / link lag | `file_op_log` status + `favorite_origin_paths`; optional `reconcileSuggested` on DTO (T023) |

No new IPC command required for T044a unless T024 is approved later.

## New UI-only IPC (FR-11 action B)

Reuse existing folder picker flow used by trash restore (`restore_local_trash` with `chosenDirectory`) pattern for «choose another folder» move of copy.
