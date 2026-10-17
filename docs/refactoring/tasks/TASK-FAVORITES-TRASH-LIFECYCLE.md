---
task_id: TASK-FAVORITES-TRASH-LIFECYCLE
title: Favorites + local trash lifecycle (unfavorite when origin in trash)
status: approved
risk: high
responsible_agent: backend-executor
base_commit: "464ac686c709ba57c661921c8fa3711c2df48947"
allowed_paths:
  - src-tauri/src/database/mod.rs
  - src-tauri/src/file_ops/favorites.rs
  - src-tauri/src/file_ops/favorites_batch.rs
  - src-tauri/src/file_ops/favorites_trash_lifecycle.rs
  - src-tauri/src/commands/mod.rs
  - src-tauri/src/pipeline/mod.rs
  - src/features/selection/lib/fileOperation.ts
  - src/features/selection/lib/removeFavoritesBatch.ts
  - src/widgets/selection-actions/SelectionActions.tsx
  - src/pages/gallery/GalleryPage.tsx
  - src/shared/i18n/locales/en.json
  - src/shared/i18n/locales/ru.json
  - docs/refactoring/tasks/TASK-FAVORITES-TRASH-LIFECYCLE.md
  - docs/refactoring/FAVORITES_TRASH_LIFECYCLE_REPORT.md
forbidden_paths:
  - src-tauri/src/thumbnail/**
  - src-tauri/src/pipeline/viewer.rs
  - src-tauri/src/pipeline/hover.rs
tests:
  - cargo test favorites_trash_lifecycle --
  - cargo test favorites_copy_recovery --
  - npm run typecheck
  - npm test -- src/features/selection/lib/removeFavoritesBatch.test.ts
---

# TASK-FAVORITES-TRASH-LIFECYCLE

Зависимости: FIX-C1C2 (journal/reconcile). Не R1–R7, не TASK-017.

## 1. Метаданные

| Поле | Значение |
|------|----------|
| ID | TASK-FAVORITES-TRASH-LIFECYCLE |
| Риск | high |
| База | 464ac686c709ba57c661921c8fa3711c2df48947 |

## 2. Scope

Сценарии C–F, G неизменны где указано. Диалог при `origin_in_local_trash`. IPC: optional `resolution` на `remove_favorite_copy` / batch.

## 3. Business invariants

- [x] I1–I12 из ТЗ (файлы не удаляются автоматически при ошибке SQLite; независимые жизненные циклы)

## 4. Acceptance criteria

- Unfavorite в избранном при origin в локальной корзине → 3-way диалог, без немедленного relocate
- `restore_origin` восстанавливает оригинал, копия и связь сохраняются
- `recycle_copy` убирает копию, origin остаётся в корзине
- Origin доступен → прежний recycle
- Missing origin (не в trash) → confirm unknown_origin, затем relocate
- Smoke — пользователь

### Автопроверки

`cargo test favorites_trash_lifecycle --`, `npm run typecheck`

### Smoke (не отмечать без пользователя)

- [ ] fav → delete original → unfavorite copy → dialog → restore
- [ ] тот же → remove from favorites
- [ ] перезапуск

## 5. Rollback

Revert коммита задачи; `cargo test favorites`.

## 7. Отчёт

`docs/refactoring/FAVORITES_TRASH_LIFECYCLE_REPORT.md`
