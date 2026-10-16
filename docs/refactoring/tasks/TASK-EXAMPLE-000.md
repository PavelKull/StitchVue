---
task_id: TASK-EXAMPLE-000
title: Пример проверки task-check (не выполнять)
status: draft
risk: low
responsible_agent: frontend-executor
base_commit: ""
allowed_paths:
  - docs/refactoring/**
forbidden_paths:
  - src/**
  - src-tauri/**
tests: []
---

# Задача: Пример

## 1. Метаданные

| Поле | Значение |
|------|----------|
| ID | TASK-EXAMPLE-000 |

## 2. Scope

### Разрешённые файлы и каталоги

- `docs/refactoring/**`

## 3. Business invariants

- N/A (только документация)

## 4. Acceptance criteria

### Автоматические проверки

- `npm run task-check -- docs/refactoring/tasks/TASK-EXAMPLE-000.md`

## 5. Rollback

- `git restore -- docs/refactoring/`
