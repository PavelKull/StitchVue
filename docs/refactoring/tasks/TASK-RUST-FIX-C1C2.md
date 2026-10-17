---
task_id: TASK-RUST-FIX-C1C2
title: FIX-C1C2 — надёжность копирования в избранное (FS↔SQLite)
status: approved
risk: high
responsible_agent: backend-executor
base_commit: "464ac686c709ba57c661921c8fa3711c2df48947"
approval_hash: fafc9d0c5946a4f4ee3499d889703811243fc0777498f9e10db0817787b8bf83
allowed_paths:
  - src-tauri/src/pipeline/mod.rs
  - src-tauri/src/file_ops/mod.rs
  - src-tauri/src/file_ops/reconcile.rs
  - src-tauri/src/file_ops/favorites_copy_recovery.rs
  - src-tauri/src/database/mod.rs
  - docs/refactoring/tasks/TASK-RUST-FIX-C1C2.md
  - docs/refactoring/RUST_FIX_C1C2_REPORT.md
forbidden_paths:
  - src/**
  - src-tauri/src/commands/**
  - src-tauri/src/thumbnail/**
  - src-tauri/src/pipeline/viewer.rs
  - src-tauri/src/pipeline/hover.rs
tests:
  - cargo fmt --check
  - cargo check
  - cargo test favorites_copy_recovery --
  - cargo test reconcile --
---

# Задача: FIX-C1C2 — надёжность копирования в избранное

Основание: [`RUST_ARCHITECTURE_AUDIT.md`](../RUST_ARCHITECTURE_AUDIT.md) (C1, C2). Зависимость: архитектурный аудит. Coordinator: только границы (не R6/R7).

## 1. Метаданные

| Поле | Значение |
|------|----------|
| ID | TASK-RUST-FIX-C1C2 |
| Статус | approved |
| Риск | high |
| Ответственный | backend-executor |
| База | 464ac686c709ba57c661921c8fa3711c2df48947 |
| Ветка | fix/rust-fix-c1c2 |

## 2. Scope

### Разрешённые файлы

- `src-tauri/src/pipeline/mod.rs` — journal pending destination, C2 в `record_operation_links`
- `src-tauri/src/file_ops/mod.rs` — hook фиксации destination до копирования
- `src-tauri/src/file_ops/reconcile.rs` — идемпотентный reconcile favorites
- `src-tauri/src/file_ops/favorites_copy_recovery.rs` — тесты T1–T12
- `src-tauri/src/database/mod.rs` — `update_pending_destination`
- Файл задачи и отчёт

### Разрешённые типы изменений

- Логика journal/reconcile/link failure; unit-тесты на temp/fixture; без смены IPC

### Запрещено

- Tauri commands/events, thumbnail/viewer/indexing, frontend, миграции схемы, массовый рефакторинг

### Зависимости

- Блокируется: нет
- Coordinator: нет (IPC frozen)

## 3. Business invariants

- [x] Исходные фото не изменяются без явной операции пользователя (I1)
- [x] Копирование в избранное не удаляет оригиналы (I2)
- [x] copy/move/delete без ложного успеха при частичном сбое (I4–I9)
- [x] Приоритеты очереди миниатюр без изменений

Дополнительно: I3–I10 из ТЗ FIX-C1C2.

## 4. Acceptance criteria

### Должно измениться

- Pending `OP_ADD_TO_FAVORITES` получает `destination_path` до необратимого копирования
- Ошибка `record_favorite_link` → `ST_NEEDS_RECONCILIATION`, копия не скрывается статусом `failed`
- Reconcile идемпотентен; восстановление по journal destination + проверка содержимого

### Должно остаться неизменным

- Имена Tauri commands и payload событий; семантика избранного; именование копий; session/generation

### Автоматические проверки

- `cargo fmt --check`, `cargo check`, `cargo test favorites_copy_recovery --`, `cargo test reconcile --`

### Ручная проверка (smoke)

- [ ] Добавить несколько фото в избранное; копии на диске; звёзды оригиналов
- [ ] Удалить одну копию штатно; оригинал на месте
- [ ] Повторно добавить; перезапуск приложения; связи и звёзды сохранены

### Защита данных

- Только `temp_dir` fixture и in-memory SQLite в тестах

## 5. Rollback

1. `git revert` коммита(ов) задачи или checkout `base_commit` для затронутых путей
2. Повторный `cargo test` на базе

## 6. (reserved)

## 7. Отчёт

См. `docs/refactoring/RUST_FIX_C1C2_REPORT.md` после реализации.
