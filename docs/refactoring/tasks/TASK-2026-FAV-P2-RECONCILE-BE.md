---
task_id: TASK-2026-FAV-P2-RECONCILE-BE
title: "P2 Safe Favorites — scoped reconcile backend (T015–T016, T021–T022b)"
status: completed
risk: high
responsible_agent: backend-executor
base_commit: "819bae3def4e865c56ed3148546976cbc0949b01"
approval_hash: 649876f7b37be522c2a2b946c4b850885c73bd90371077d25b9394ba12b83773
allowed_paths:
  - src-tauri/src/file_ops/reconcile.rs
  - src-tauri/src/pipeline/mod.rs
  - src-tauri/src/file_ops/favorites_lifecycle.rs
  - src-tauri/src/file_ops/p2_reconcile_scope.rs
  - src-tauri/src/file_ops/mod.rs
  - docs/refactoring/tasks/TASK-2026-FAV-P2-RECONCILE-BE.md
forbidden_paths:
  - src/**
  - src-tauri/src/commands/**
  - src-tauri/src/thumbnail/**
  - src-tauri/src/file_ops/favorites.rs
  - specs/**
tests:
  - cargo test --manifest-path src-tauri/Cargo.toml favorites_copy_recovery --
  - cargo test --manifest-path src-tauri/Cargo.toml favorites_trash_lifecycle_final --
  - cargo test --manifest-path src-tauri/Cargo.toml p0_safe_favorites_t003 --
  - cargo test --manifest-path src-tauri/Cargo.toml p2_reconcile --
---

# Задача: P2 Safe Favorites — scoped reconcile backend

SpecKit T015, T016, T021, T022, T022a, T022b. **Metadata-only** — never unlink user photos / orphan copies.

## 1. Метаданные

| Поле | Значение |
|------|----------|
| ID | TASK-2026-FAV-P2-RECONCILE-BE |
| Статус | verification |
| Риск | high |
| Ответственный | backend-executor |
| SpecKit | T015, T016, T021, T022, T022a, T022b |

## 2. Scope

### Разрешённые файлы

- `src-tauri/src/file_ops/reconcile.rs` — `reconcile_favorites_scope(db, directory_prefix)` metadata-only (CL-P01); skip purge when origin Unavailable (CL-P04); orphan copy on disk without row → **do not delete** (EC-21). Import `OriginAvailability` from `super::p1_identity_gate` (not favorites.rs). Do **not** call `recover_legacy_undo` from scope.
- `src-tauri/src/pipeline/mod.rs` — T016: after `finish_op` in `execute_file_operation` for `CopyToLocalFavorites` (Ok and Err paths). Optional same-file hooks on remove completion if trivial; document remove-gap in §7 if deferred to FE album-open
- `src-tauri/src/file_ops/favorites_lifecycle.rs` — T022a test only if needed
- `src-tauri/src/file_ops/p2_reconcile_scope.rs` — optional helpers + VERIFY tests
- `src-tauri/src/file_ops/mod.rs` — mod line only

### Разрешённые типы

- Metadata refresh / finish pending journal rows scoped to directory prefix
- Post-op hook after successful/failed favorites ops in pipeline
- VERIFY tests on temp + in-memory DB

### Запрещено

- `fs::remove_file` / recycle of user photos or orphan copies from reconcile
- Auto-link Explorer drops into Избранное (`record_favorite_copy` for unknown files)
- Changing favorites.rs identity gate / T030
- FE / GalleryPage / commands unless strictly required for T016 (prefer pipeline only)
- User paths / production SQLite

### Зависимости

- Requires: P1 T008 (OriginAvailability), P0 T003 green
- Blocks: P2 FE (T018–T020), P3
- **code-auditor** before seal

## 3. Business invariants

- [x] Исходные фото не изменяются / не удаляются reconcile
- [x] copy/move/delete без ложного успеха — journal statuses honest
- [ ] directorySession — не здесь

Дополнительно: CL-P01, CL-P02 (backend hook only), CL-P04, EC-02, EC-05, EC-21, SC-011.

## 4. Acceptance criteria

### Должно измениться

| ID | Критерий |
|----|----------|
| T015 | `reconcile_favorites_scope` exists; metadata-only |
| T016 | Called after favorites file-op completion in pipeline |
| T021 | Post-op reconcile updates metadata without deleting copies |
| T022 | Unavailable origin → no purge of favorite_copies |
| T022a | Explorer rename origin — no invent link by basename |
| T022b | Orphan copy without row — file **not** deleted (**P2 gate before P3**) |

### Должно остаться неизменным

- Boot `reconcile_on_boot` semantics (may call scope helpers)
- Baseline recovery suites GREEN
- T001 still RED

### Автоматические проверки

1–2. Baseline recovery PASS  
3. `p0_safe_favorites_t003` PASS  
4. `cargo test --manifest-path src-tauri/Cargo.toml p2_reconcile --` PASS (T021–T022b)

### Ручная smoke

- [ ] N/A fixture-covered; HANDOFF 4 if time

### Защита данных

Temp/`sv-fav-p2-*` only; in-memory SQLite.

### Стоп

- Any delete path in reconcile for photos
- Need favorites.rs edits for Unavailable (should already exist from P1 — use public/crate API)
- Expanding to commands/** without justification

## 5. Rollback

`git restore --source=<base_commit> -- <allowed_paths>`

## 6. Маршрут

Auditor → seal → backend-executor → guardian → strict.

## 7. Отчёт исполнителя

**STATUS:** verification (ожидает guardian; `completed` после review)

**CHANGED:**
- `src-tauri/src/file_ops/reconcile.rs` — `reconcile_favorites_scope(db, directory_prefix)`: scoped favorite journal finish + copy metadata refresh; `OriginAvailability` from `p1_identity_gate`; no `recover_legacy_undo`; no FS delete/recycle of photos/orphans; Unavailable/Missing → no `favorite_copies` purge
- `src-tauri/src/pipeline/mod.rs` — T016: after `finish_op` paths in `execute_file_operation`, call scope for `CopyToLocalFavorites` (Ok and Err)
- `src-tauri/src/file_ops/p2_reconcile_scope.rs` — VERIFY T021–T022b (`p2_reconcile` filter)
- `src-tauri/src/file_ops/mod.rs` — `mod p2_reconcile_scope`

**Remove-gap (T016):** post-op scope hooked only on `CopyToLocalFavorites` in `execute_file_operation`. Remove/unfavorite completion (`remove_favorite_copies_batch` / related IPC) **not** hooked here — deferred to FE album-open / folder-changed (T018–T019) or a follow-up BE hook.

**INVARIANTS:** originals/copies not unlinked by scope; CL-P04 Unavailable no purge; EC-21 orphan noop; EC-05 no basename invent. Boot `reconcile_on_boot` unchanged (still calls `recover_legacy_undo`). `favorites.rs` untouched; T001 stays RED.

**TESTS:**
| Filter | Result |
|--------|--------|
| `favorites_copy_recovery` | PASS (10) |
| `favorites_trash_lifecycle_final` | PASS (14) |
| `p0_safe_favorites_t003` | PASS |
| `p2_reconcile` | PASS (T021, T022, T022a, T022b) |
| `p0_safe_favorites_t001` | RED (expected) |

**GATES:** preflight OK · auth OK · strict+run-tests OK (working tree clean at strict after code commit)

**DIFF:** in scope

**SHAs:** seal `f22db40` · impl `f270e36` · report (this docs commit)

**SMOKE:** N/A fixture-covered; HANDOFF manual optional

**RISKS:** high (FS/SQLite metadata path); remove-gap until FE/album trigger; UNC Unavailable fixture depends on Windows BAD_NETPATH

**NEXT:** regression-guardian → then `completed` + smoke if guardian asks
