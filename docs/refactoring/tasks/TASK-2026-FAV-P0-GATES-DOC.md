---
task_id: TASK-2026-FAV-P0-GATES-DOC
title: "P0 Safe Favorites — gates doc & baseline (T007)"
status: approved
risk: low
responsible_agent: frontend-executor
base_commit: "8ca8deb4880d066cf4d81972ca95cd35c5de2269"
approval_hash: 4f05aef0c8e463f569f79f2a7f853de9e24cda11ccd34b80422bd4d1555d900c
allowed_paths:
  - specs/001-safe-favorites-lifecycle/quickstart.md
  - docs/refactoring/tasks/TASK-2026-FAV-P0-GATES-DOC.md
  - docs/refactoring/tasks/TASK-2026-FAV-P0-RUST-VERIFY.md
  - docs/refactoring/tasks/TASK-2026-FAV-P0-FE-VERIFY.md
forbidden_paths:
  - src/**
  - src-tauri/**
tests:
  - cargo test favorites_copy_recovery --
  - cargo test favorites_trash_lifecycle_final --
---

# Задача: P0 Safe Favorites — gates doc (T007)

Документация Phase 0 gates + подтверждение baseline. **Без кода приложения.**

## 1. Метаданные

| Поле | Значение |
|------|----------|
| ID | TASK-2026-FAV-P0-GATES-DOC |
| Статус | approved |
| Риск | low |
| Ответственный | любой executor (docs) или владелец |
| SpecKit | T007 |

## 2. Scope

### Разрешённые файлы

- `specs/001-safe-favorites-lifecycle/quickstart.md` — § «Phase 0 gates»
- Ссылки на sealed tasks P0 (пути выше)

### Разрешённые изменения

- Таблица: sealed task IDs, test filters, T001 red-until-T030 policy
- Команды baseline и P0 VERIFY
- Порядок seal: Rust VERIFY → FE VERIFY (параллельно OK) → GATES-DOC после имён тестов из §7 Rust/FE

### Запрещено

- Изменение `spec.md` / `tasks.md` без отдельного согласования
- Production / test code

### Зависимости

- Блокируется: **рекомендуется после** merge Rust+FE VERIFY (чтобы внести точные имена тестов)
- Блокирует: старт **P1** sealed tasks (baseline gate)

## 3. Business invariants

- [ ] N/A (документация)

## 4. Acceptance criteria

### Должно измениться

- `quickstart.md` содержит:
  - P0 recovery baseline: `favorites_copy_recovery`, `favorites_trash_lifecycle_final`
  - T001 lifecycle (red P0–P3, green after T030)
  - Ссылки на TASK-2026-FAV-P0-RUST-VERIFY / FE-VERIFY
  - Условие перехода к P1: baseline green + T002–T006 по политике §7 Rust/FE tasks

### Должно остаться неизменным

- Продуктовое поведение

### Автоматические проверки

- `cargo test favorites_copy_recovery --` → PASS
- `cargo test favorites_trash_lifecycle_final --` → PASS

(Исполнитель запускает для фиксации в §7; не пользовательские данные.)

### Ручная smoke

- [x] N/A

### Стоп

- Baseline тесты красные на `base_commit` без объяснимой причины вне scope

## 5. Rollback

Restore quickstart + task file from `base_commit`.

## 6. Маршрут

| Шаг | Действие |
|-----|----------|
| 1 | Владелец: `approved` + `--seal` |
| 2 | Executor: preflight → auth → doc → strict |
| 3 | Guardian: опционально для low |

## 7. Отчёт исполнителя

(пусто)
