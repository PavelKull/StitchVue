---
task_id: TASK-2026-FAV-P0-RUST-VERIFY
title: "P0 Safe Favorites — Rust VERIFY (T001–T004)"
status: verification
risk: medium
responsible_agent: backend-executor
base_commit: "d2f96ac33bb9a1415a92ee9c0987febc14b42109"
approval_hash: 4527116a55008c4c89af11796072af376a099cfdf935e2614bb4c9a99a877cb6
allowed_paths:
  - src-tauri/src/file_ops/p0_safe_favorites.rs
  - src-tauri/src/file_ops/mod.rs
  - docs/refactoring/tasks/TASK-2026-FAV-P0-RUST-VERIFY.md
forbidden_paths:
  - src/**
  - src-tauri/src/commands/**
  - src-tauri/src/pipeline/**
  - src-tauri/src/database/**
  - src-tauri/src/thumbnail/**
  - src-tauri/src/file_ops/favorites.rs
  - src-tauri/src/file_ops/reconcile.rs
  - specs/**
tests:
  - cargo fmt --check
  - cargo test favorites_copy_recovery --
  - cargo test favorites_trash_lifecycle_final --
  - cargo test p0_safe_favorites --
---

# Задача: P0 Safe Favorites — Rust VERIFY (T001–T004)

SpecKit: `specs/001-safe-favorites-lifecycle/tasks.md` Phase 0. **Только тесты** (`#[cfg(test)]` / новые `mod` тестов); production-логика **не меняется**.

## 1. Метаданные

| Поле | Значение |
|------|----------|
| ID | TASK-2026-FAV-P0-RUST-VERIFY |
| Статус | verification |
| Риск | medium — тесты вызывают file_ops на temp FS; без изменения prod |
| Ответственный | backend-executor |
| SpecKit | T001, T002, T003, T004 |

## 2. Scope

### Разрешённые файлы

- `src-tauri/src/file_ops/p0_safe_favorites.rs` — **новый** `#[cfg(test)]` модуль: T001–T004 (temp dirs + in-memory SQLite)
- `src-tauri/src/file_ops/mod.rs` — **только** одна строка `#[cfg(test)] mod p0_safe_favorites;` (без правок production)

### Разрешённые типы изменений

- Новые `#[test]` с `temp_dir` / in-memory SQLite (`Connection::open_in_memory` + `database::migrate`)
- Вспомогательные fixture-функции **только в test modules**

### Запрещено

- Любые изменения вне `#[cfg(test)]` / non-test code paths
- Исправление `dispatch_removal_plan` (это T030 / P4)
- Реализация `reconcile_favorites_scope` (T015)
- Пользовательские каталоги, боевая SQLite, ослабление assert в T001

### Зависимости

- Блокируется: нет
- Блокирует: TASK-2026-FAV-P0-GATES-DOC (T007 ссылается на имена тестов)
- Coordinator: нет
- **code-auditor**: рекомендуется read-only до seal (medium + favorites FS semantics), не обязателен по HANDOFF low-route — **опционально по желанию владельца**

## 3. Business invariants

- [x] Исходные фото не изменяются без явной user-операции (тесты только temp)
- [x] copy/move/delete без ложного успеха — T001 фиксирует дефект dispatch, не нормализует его
- [ ] directorySession / gallery order / thumbnails — не затрагиваются

Дополнительно: CL-P03, CL-P04, CL-00, EC-02, EC-12, EC-22; FR-011b (ожидание теста).

## 4. Acceptance criteria

### Должно измениться

| ID | Тест | Ожидание на текущем `main` |
|----|------|----------------------------|
| **T001** | `unknown_origin` + `confirmed` без FR-11 resolution → **не** `relocate_distributed` | Тест **падает** (воспроизводит баг) |
| **T002** | Другой файл на stored origin path → return/relocate без overwrite | Падает или проходит — зафиксировать в §7; assert не ослаблять |
| **T003** | Scoped reconcile fixture: **нет** unlink пользовательских фото | Падает до T015 или проходит на stub — assert «no delete» |
| **T004** | Unavailable volume → row `favorite_copies` не purge | По факту кода |

Имена тестов — префикс `p0_safe_favorites_` или модуль `p0_safe_favorites` для фильтра `cargo test p0_safe_favorites --`.

### Должно остаться неизменным

- Поведение production favorites/reconcile/pipeline
- IPC, commands, frontend

### Автоматические проверки

1. `cargo fmt --check`
2. `cargo test favorites_copy_recovery --` → **PASS** (baseline)
3. `cargo test favorites_trash_lifecycle_final --` → **PASS** (baseline)
4. `cargo test p0_safe_favorites --` → **T001 FAIL ожидаем**; T002–T004 — задокументировать в §7

**Закрытие P0:** успех задачи **не требует** зелёного T001. Запрещено `#[ignore]` / ослабление assert T001 «чтобы прошёл CI».

### Ручная проверка (smoke)

- [x] N/A — только тесты на temp

### Защита данных

- Только `std::env::temp_dir()` / уникальные префиксы `sv-fav-p0-*`; in-memory DB.

### Блокирующие условия (стоп)

- Любое изменение production-кода вне test
- Baseline `favorites_copy_recovery` / `favorites_trash_lifecycle_final` красные после добавления тестов
- Неясность в assert T001 (должен ловить auto-relocate, не другое)

## 5. Rollback

`git restore --source=<base_commit> -- <allowed_paths>`

## 6. Уровень риска и маршрут

| Шаг | Действие |
|-----|----------|
| 1 | **code-auditor** (опционально): scope test-only, T001 lifecycle |
| 2 | Владелец: `status: approved`, `base_commit`, глаза §2–4 → **`--seal`** |
| 3 | **backend-executor**: `--preflight` → `--auth` → тесты → `--strict` |
| 4 | **regression-guardian**: diff + T001 red policy + baseline green |

## 7. Отчёт исполнителя

**Worktree:** `C:\Users\Pavel\Desktop\ImageGrid-fav-lifecycle` / `feat/safe-favorites-lifecycle`

**Модуль:** `src-tauri/src/file_ops/p0_safe_favorites.rs` + `#[cfg(test)] mod p0_safe_favorites;` в `mod.rs`

| Тест | Имя | Результат | Факт |
|------|-----|-----------|------|
| T001 | `p0_safe_favorites_t001_unknown_origin_confirmed_must_not_relocate` | **FAIL (ожидаемо RED)** | `remove_favorite_copy(..., true, None)` → `status == "relocated"` (дефект dispatch) |
| T002 | `p0_safe_favorites_t002_return_to_source_aborts_if_origin_path_occupied_by_other_file` | **PASS** | OriginChanged + confirmed → `relocated` в parent (`… (из избранного)`); байты чужого файла на origin **не** перезаписаны |
| T003 | `p0_safe_favorites_t003_reconcile_paths_do_not_delete_user_photos` | **PASS** | `reconcile_one` / `reconcile_on_boot` на pending/needs_reconciliation add-to-favorites: origin + album + copy не unlink |
| T004 | `p0_safe_favorites_t004_unavailable_origin_does_not_purge_favorite_copies_row` | **PASS** | Origin `Z:\sv-fav-p0-missing\…`; preview + unconfirmed remove → `favorite_copies` count=1 |

**Baseline:** `favorites_copy_recovery` 10/10 PASS; `favorites_trash_lifecycle_final` 14/14 PASS.

**fmt:** `rustfmt --check` на allowed OK. Полный `cargo fmt --check` по crate — FAIL из‑за pre-existing (вне scope; не трогали).

**Production:** не менялся. STOP не требовался (T001 RED как в ТЗ).
