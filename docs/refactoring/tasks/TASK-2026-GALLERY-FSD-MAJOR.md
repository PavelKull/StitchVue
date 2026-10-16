---
task_id: TASK-2026-GALLERY-FSD-MAJOR
title: GalleryPage FSD 2.0 major decomposition (umbrella)
status: approved
risk: high
responsible_agent: frontend-executor
base_commit: "c5e2d420990ceaafe30edb2a63224a468e0ed79b"
approval_hash: 286801b8bae3b260dfb416671c857e9c569c626a76ccf625fa88390a2b70584f
allowed_paths:
  - src/pages/gallery/GalleryPage.tsx
  - src/pages/gallery/GalleryPage.module.scss
  - src/features/gallery/**
  - src/features/favorites/useGalleryFavoritesCoordinator.ts
  - src/features/favorites/useGalleryFavoritesCoordinator.test.ts
  - src/features/selection/useGalleryFileOperations.ts
  - src/features/selection/useGalleryFileOperations.test.ts
  - src/features/selection/useGallerySelectionCoordinator.ts
  - src/features/selection/useGallerySelectionCoordinator.test.ts
  - src/widgets/gallery-shell/**
  - src/widgets/folder-tile/FolderViewTile.tsx
  - src/widgets/folder-tile/FolderViewTile.module.scss
  - src/features/folder/insertServiceFolder.ts
  - src/features/folder/insertServiceFolder.test.ts
  - docs/refactoring/GALLERY_FSD_MAJOR_REFACTOR_REPORT.md
forbidden_paths:
  - src-tauri/**
  - src/shared/i18n/locales/**
  - src/widgets/gallery-grid/**
  - src/widgets/image-viewer/**
  - src/widgets/settings-dialog/**
tests:
  - npm run typecheck
  - npm test
---

# Umbrella: GalleryPage FSD 2.0 major decomposition

## 1. Метаданные

| Поле | Значение |
|------|----------|
| ID | `TASK-2026-GALLERY-FSD-MAJOR` |
| Название | GalleryPage FSD 2.0 major decomposition (umbrella) |
| Статус | `approved` |
| Риск | `high` |
| Ответственный агент | `frontend-executor` |
| База Git | `c5e2d420990ceaafe30edb2a63224a468e0ed79b` |
| Печать | после `--seal` |

**Основание:** пользовательское ТЗ «Масштабный рефакторинг GalleryPage» + `GALLERY_FSD_DECOMPOSITION_PLAN.md` rev. 3.

## 2. Scope

### Разрешённые файлы

См. YAML `allowed_paths`. Внутренние фазы: TASK-006…021 по плану rev. 3.

### Запрещено

Изменение UX/UI, IPC/Rust, thumbnail pipeline, семантики ФС/избранного, force push, пользовательские каталоги/боевая БД.

### Внутренний порядок фаз

1. 020, 021, 006 → 2. 007–010 → 3. 015, 017, 016 → 4. 011, 012, 018 → 5. 014, 013, 019

## 3. Business invariants

- [x] События старой сессии галереи не меняют состояние новой (`directorySession`)
- [x] Порядок и группировка фото — текущая семантика (`galleryOrder`, `folderOrder`)
- [x] Оптимистичное избранное и batch unfavorite
- [x] Файловые операции без ложного успеха в UI
- [x] Приоритеты очереди миниатюр без изменений

Дополнительно: тесты и smoke только fixture/temp; без операций на пользовательских фото и боевой SQLite.

## 4. Acceptance criteria

### Должно измениться

- `GalleryPage.tsx` — преимущественно композиция (цель ≤1500 строк без god-hooks)
- Сценарии в `features/*` / `widgets/gallery-shell/*`; IPC через adapters

### Должно остаться неизменным

- Поведение приложения, IPC контракты, Rust, алгоритмы миниатюр/сортировки

### Автоматические проверки

- `npm run typecheck`, `npm test`

### Ручная проверка (smoke)

- [ ] Быстрое переключение папок
- [ ] Сортировка
- [ ] Скролл и миниатюры
- [ ] Избранное
- [ ] Delete/move только выбранное

## 5. Rollback

`git restore --source=<base_commit> --` по затронутым путям; без `reset --hard` без явной просьбы.

## 6. Отчёт

`docs/refactoring/GALLERY_FSD_MAJOR_REFACTOR_REPORT.md` по завершении umbrella.
