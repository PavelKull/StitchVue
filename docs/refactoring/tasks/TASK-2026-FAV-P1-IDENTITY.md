---
task_id: TASK-2026-FAV-P1-IDENTITY
title: "P1 Safe Favorites — identity gate & relocate safety (T008–T014b)"
status: completed
risk: high
responsible_agent: backend-executor
base_commit: "3e6dcc603e23fc4a27e5e960c10467055bbdf16d"
approval_hash: 5a1f2ad715804d9008ecb9212c4b342ff9bba4abf865e279fc1ea7142292ab0a
allowed_paths:
  - src-tauri/src/file_ops/favorites.rs
  - src-tauri/src/file_ops/p0_safe_favorites.rs
  - src-tauri/src/file_ops/p1_identity_gate.rs
  - src-tauri/src/file_ops/mod.rs
  - docs/refactoring/tasks/TASK-2026-FAV-P1-IDENTITY.md
forbidden_paths:
  - src/**
  - src-tauri/src/commands/**
  - src-tauri/src/pipeline/**
  - src-tauri/src/thumbnail/**
  - specs/**
tests:
  - cargo test favorites_copy_recovery --
  - cargo test favorites_trash_lifecycle_final --
  - cargo test p0_safe_favorites --
  - cargo test p1_identity --
---

# Задача: P1 Safe Favorites — identity & relocate safety (T008–T014b)

SpecKit Phase 1. **HIGH** FS/SQLite. Только fixture/temp. Production originals вне temp — запрет.

## 1. Метаданные

| Поле | Значение |
|------|----------|
| ID | TASK-2026-FAV-P1-IDENTITY |
| Статус | completed |
| Риск | high |
| Ответственный | backend-executor |
| SpecKit | T008, T009, T010, T011, T012, T013, T014, T014a, T014b |

## 2. Scope

### Разрешённые файлы

- `src-tauri/src/file_ops/favorites.rs` — `OriginAvailability`; identity gate T0–T3; wire into `execute_relocate` / restore-to-origin paths; revalidate before FS move; **no** `create_dir_all` for missing stored-origin parent on relocate/return
- `src-tauri/src/file_ops/p1_identity_gate.rs` — опционально вынести pure helpers + `#[cfg(test)]` VERIFY T012–T014b
- `src-tauri/src/file_ops/p0_safe_favorites.rs` — только если нужны общие fixture helpers (без ослабления T001)
- `src-tauri/src/file_ops/mod.rs` — только `mod` для нового test/helper модуля

### Разрешённые типы изменений

- Enum `OriginAvailability { Accessible, Missing, Unavailable }` и классификация IO (CL-P04)
- Shared identity gate: size/mtime pre-filter only; content proof required before write to occupied path; identity-conflict outcome (no overwrite) — CL-00, FR-011a, research R1
- Re-run gate in `revalidate_*` / immediately before FS mutate after confirm (EC-17)
- VERIFY tests T012–T014b on temp only
- Cross-volume: on move failure keep source copy (EC-07/EC-13) — assert existing or strengthen
- Permission denied on target must not delete favorites copy (EC-14)
- Missing parent dir for relocate-to-stored-origin-parent → error, no `create_dir_all` (EC-01)
- Path safety: `\\?\` / Unicode keys; reject unsafe reparse/junction targets where already applicable (EC-19)

### Запрещено

- T030 dispatch fix (P4) — T001 остаётся RED
- `reconcile_favorites_scope` (T015)
- Frontend / IPC DTO / schema migration
- User photo dirs / production SQLite
- Destructive retry without idempotency
- Ослабление T001 assert / `#[ignore]`

### Зависимости

- Блокируется: P0 complete (есть)
- Блокирует: P2 T015, P4 T031/T032
- Coordinator: нет (внутри favorites.rs)
- **code-auditor**: обязателен до seal (high)

## 3. Business invariants

- [x] Исходные фото не изменяются без явной user-операции (temp only; no overwrite unrelated)
- [x] copy/move/delete без ложного успеха — identity conflict / FS error → Err, copy retained when move fails
- [ ] directorySession / gallery order / thumbnails — не затрагиваются

Дополнительно: CL-00, CL-P04, FR-011a, FR-012, EC-01, EC-03, EC-07, EC-12–14, EC-19; INV content-proof rule.

## 4. Acceptance criteria

### Должно измениться

| ID | Критерий |
|----|----------|
| T008 | `OriginAvailability` используется в classify/origin inspect |
| T009–T011 | Identity gate + wire + revalidate before FS |
| T012 | Name collision → no overwrite (PASS) |
| T013 | Cross-volume failure keeps source (PASS) — **P1 recovery gate** |
| T014 | Permission denied target → copy not deleted (PASS) |
| T014a | Missing parent → error, no mkdir (PASS) |
| T014b | Extended/Unicode path keys + reparse reject where applicable (PASS) |

### Должно остаться неизменным

- IPC shapes; schema; FE; T001 still RED; baseline recovery suites GREEN
- Recycle path semantics for verified `Plan::Recycle` (except stronger identity before destruct — if touched, must stay safe)

### Автоматические проверки

1. `cargo test favorites_copy_recovery --` PASS
2. `cargo test favorites_trash_lifecycle_final --` PASS
3. `cargo test p0_safe_favorites --` — T001 FAIL ok; T002–T004 PASS
4. `cargo test p1_identity --` PASS (все T012–T014b)

### Ручная smoke (§ HANDOFF, применимо)

- [ ] 4 — добавление в избранное не меняет оригинал (логика temp fixture покрывает)
- [ ] 5 — relocate/unfavorite не трогает файлы вне выбранного (tests)

Остальное N/A для backend-only.

### Защита данных

Только `temp_dir` / `sv-fav-p1-*`; in-memory SQLite. Нет пользовательских путей.

### Стоп

- Need schema/IPC change
- Baseline FAIL
- Cannot implement content gate without expanding allowed_paths beyond favorites.rs / p1 module
- Risk of delete-last-copy

## 5. Rollback

`git restore --source=<base_commit> -- <allowed_paths>`

## 6. Маршрут

| Шаг | Действие |
|-----|----------|
| 1 | **code-auditor** (favorites relocate/identity) |
| 2 | Orchestrator: approved + `--seal` |
| 3 | **backend-executor**: preflight → auth → impl → tests |
| 4 | **regression-guardian** |
| 5 | `--strict` (+ `--run-tests` по списку) |

## 7. Отчёт исполнителя

**STATUS:** completed  
**Commit (code):** `2d9a3a9` — `feat(favorites): P1 identity gate and relocate safety`  
**Worktree:** `ImageGrid-fav-lifecycle` @ `feat/safe-favorites-lifecycle`

### Изменения

| Файл | Суть |
|------|------|
| `p1_identity_gate.rs` | `OriginAvailability` + IO map (NotFound→Missing; access/not-ready/offline→Unavailable); identity gate T0–T3 (size pre-filter; content_sha256 / bytes required for occupied) |
| `favorites.rs` | Wire availability into `origin_diagnostics` (Unavailable→Ambiguous, no purge); `prepare_relocate_parent` **без** `create_dir_all`; revalidate+identity before FS in `execute_relocate` / `relocate_distributed`; `relocate_file` never `remove_file` source |
| `mod.rs` | `mod p1_identity_gate` |

**Не трогали:** T030 dispatch; `restore_recorded_file` body; commands/pipeline/FE/schema.

### VERIFY (`cargo test …` из `src-tauri/`)

| ID | Результат |
|----|-----------|
| T012 name collision no overwrite | **PASS** |
| T013 cross-volume/fail keeps source | **PASS** |
| T014 permission/inaccessible target keeps copy | **PASS** |
| T014a missing parent → error, no mkdir | **PASS** |
| T014b `\\?\` + Unicode + non-dir parent reject | **PASS** |
| `p1_identity` filter | **8/8 PASS** |

### Frontmatter

| Suite | Результат |
|-------|-----------|
| `favorites_copy_recovery` | **10/10 PASS** |
| `favorites_trash_lifecycle_final` | **14/14 PASS** |
| `p0_safe_favorites` | T001 **FAIL (RED expected)**; T002–T004 **PASS** |
| `p1_identity` | **PASS** |

### Инварианты

CL-00 / CL-P04 / EC-01 / EC-03 / EC-07 / EC-13 / EC-14 / EC-19 — покрыты тестами на temp. Production FS/БД не использовались.

### GATES

- preflight+auth: OK (seal `e9cc279`)
- `--strict` после code-first commit: FAIL ожидаемо (нет dirty `allowed_paths`; правка task-файла запрещена mid-strict; `cargo` из корня без `src-tauri`). Тесты прогнаны вручную из `src-tauri/`.
- T001 остаётся RED (P4 T030)

### NEXT

regression-guardian + ручной smoke (HANDOFF §4–5 на fixture).
