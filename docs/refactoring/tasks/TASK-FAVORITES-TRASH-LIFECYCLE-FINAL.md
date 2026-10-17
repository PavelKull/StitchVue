---
task_id: TASK-FAVORITES-TRASH-LIFECYCLE-FINAL
title: Favorites trash lifecycle — batch, journal, UI finalization
status: approved
risk: high
responsible_agent: backend-executor
base_commit: "7aaa92dee3d8b4ed221246fab546534fd8e73a77"
depends_on:
  - TASK-FAVORITES-TRASH-LIFECYCLE
  - TASK-FAVORITE-TRASH-DIALOG-UI
allowed_paths:
  - src-tauri/src/file_ops/favorites.rs
  - src-tauri/src/file_ops/favorites_batch.rs
  - src-tauri/src/file_ops/favorites_trash_lifecycle.rs
  - src-tauri/src/file_ops/favorites_trash_lifecycle_final.rs
  - src-tauri/src/file_ops/reconcile.rs
  - src-tauri/src/database/mod.rs
  - src/features/selection/lib/removeFavoritesBatch.ts
  - src/features/selection/lib/removeFavoritesBatch.test.ts
  - src/features/selection/lib/fileOperation.ts
  - src/pages/gallery/GalleryPage.tsx
  - src/widgets/favorites-trash-unfavorite-dialog/**
  - src/shared/i18n/locales/en.json
  - src/shared/i18n/locales/ru.json
  - src/shared/i18n/locales/de.json
  - src/shared/i18n/locales/zh-Hans.json
  - docs/refactoring/tasks/TASK-FAVORITES-TRASH-LIFECYCLE-FINAL.md
  - docs/refactoring/FAVORITES_TRASH_LIFECYCLE_FINAL_REPORT.md
forbidden_paths:
  - src-tauri/src/thumbnail/**
  - src-tauri/src/pipeline/viewer.rs
  - src-tauri/src/pipeline/hover.rs
tests:
  - cargo test favorites_trash_lifecycle --
  - cargo test favorites_trash_lifecycle_final --
  - cargo test favorites_copy_recovery --
  - npm run typecheck
  - npm test -- src/features/selection/lib/removeFavoritesBatch.test.ts
  - node --experimental-strip-types --test src/shared/i18n/__tests__/i18n-check.test.ts
---

# TASK-FAVORITES-TRASH-LIFECYCLE-FINAL

См. пользовательское ТЗ (batch resolution, journal, i18n, smoke). Backend до frontend.

## Acceptance (кратко)

- Mass unfavorite: диалог при `origin_in_local_trash`, `resolution` в batch.
- `restore_origin` в batch не снимает звёзды с доступных оригиналов.
- `recycle_copy` / `restore_origin` через pending op + reconcile.
- Per-file skipped/failed/restored_origin в batch UI.
- I1–I12, FIX-C1C2 recycle без изменений.
