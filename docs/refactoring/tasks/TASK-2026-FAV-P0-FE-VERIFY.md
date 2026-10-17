---
task_id: TASK-2026-FAV-P0-FE-VERIFY
title: "P0 Safe Favorites — Frontend VERIFY (T005–T006)"
status: verification
risk: medium
responsible_agent: frontend-executor
base_commit: "6db721cf99c737ffccc410795153ce2a7c59a383"
approval_hash: cee47d2ce408338fef87ca5bbb8eef6d6057c335c44c52f3c6e458d50a0987e6
allowed_paths:
  - src/features/favorites/lib/mapRemovalToUiRoute.ts
  - src/features/favorites/lib/mapRemovalToUiRoute.test.ts
  - src/features/selection/lib/removeFavoritesBatch.ts
  - src/features/selection/lib/removeFavoritesBatch.test.ts
  - docs/refactoring/tasks/TASK-2026-FAV-P0-FE-VERIFY.md
forbidden_paths:
  - src-tauri/**
  - src/pages/**
  - src/widgets/**
  - specs/**
tests:
  - npm run typecheck
  - npm test -- src/features/favorites/lib/mapRemovalToUiRoute.test.ts
  - npm test -- src/features/selection/lib/removeFavoritesBatch.test.ts
---

# Задача: P0 Safe Favorites — Frontend VERIFY (T005–T006)

SpecKit T005–T006. **TDD:** сначала тесты (и минимальный `mapRemovalToUiRoute.ts` если модуля нет); production UI (`GalleryPage`) **не трогать**.

## 1. Метаданные

| Поле | Значение |
|------|----------|
| ID | TASK-2026-FAV-P0-FE-VERIFY |
| Статус | verification |
| Риск | medium — новый routing lib + batch test expectations |
| Ответственный | frontend-executor |
| SpecKit | T005, T006 |

## 2. Scope

### Разрешённые файлы

- `src/features/favorites/lib/mapRemovalToUiRoute.ts` — **новый** чистый маршрутизатор CL-P03 (без IPC)
- `src/features/favorites/lib/mapRemovalToUiRoute.test.ts` — T005
- `src/features/selection/lib/removeFavoritesBatch.test.ts` — T006 extensions
- `src/features/selection/lib/removeFavoritesBatch.ts` — **только** если нужны экспортируемые pure helpers для тестов (без изменения runtime batch IPC)

### Запрещено

- `GalleryPage.tsx`, widgets, Tauri invoke, изменение `removeFavoritesBatch` execution path без отдельного согласования
- Ослабление существующих batch-тестов

### Зависимости

- Блокируется: нет (может идти параллельно с TASK-2026-FAV-P0-RUST-VERIFY)
- Блокирует: нет (T034 P4 переиспользует `mapRemovalToUiRoute`)
- Coordinator: нет

## 3. Business invariants

- [x] copy/move/delete без ложного UI-success — routing only
- [ ] directorySession — не затрагивается

Дополнительно: CL-P03, EC-10 (preview bucket contract).

## 4. Acceptance criteria

### Должно измениться

- **T005:** unverified / `fr11Required` → route `fr11`, не `standardConfirm`
- **T006:** preview bucketing ожидает `fr11Required` (mock/stub входов; без реального IPC)

### Должно остаться неизменным

- Поведение массового unfavorite в приложении до P4/P5
- Существующие зелёные тесты `removeFavoritesBatch` (кроме явно расширенных кейсов)

### Автоматические проверки

- `npm run typecheck`
- `npm test -- src/features/favorites/lib/mapRemovalToUiRoute.test.ts`
- `npm test -- src/features/selection/lib/removeFavoritesBatch.test.ts`

Тесты T005 могут **падать** до реализации полного `mapRemovalToUiRoute` — допустимо для P0, если assert описывают целевой контракт; предпочтительно минимальная реализация, чтобы тесты были зелёными **без** GalleryPage.

### Ручная smoke

- [x] N/A

### Защита данных

- Нет ФС; только unit-тесты.

### Стоп

- Изменение IPC / Rust
- Подключение routing в `GalleryPage` (это P4)

## 5. Rollback

`git restore --source=<base_commit> -- <allowed_paths>`

## 6. Маршрут

| Шаг | Действие |
|-----|----------|
| 1 | frontend-decomposition (опционально) |
| 2 | Владелец: `approved` + **`--seal`** |
| 3 | **frontend-executor**: preflight → auth → tests → strict |
| 4 | **regression-guardian** |

## 7. Отчёт исполнителя

**Worktree:** `C:\Users\Pavel\Desktop\ImageGrid-fav-lifecycle` / `feat/safe-favorites-lifecycle`  
**HEAD до правок:** `3dcc575` (seal); `base_commit` 6db721c — WARN only.

| Пункт | Результат |
|-------|-----------|
| T005 | `mapRemovalToUiRoute.ts` + `.test.ts`: unverified/missing/inaccessible/`unknown_origin`/`fr11Required` → `fr11`; verified confirms → `standardConfirm`; trash → `originInTrash`; ready → `ready`/`proceed` |
| T006 | `partitionFr11RequiredFromOtherConfirm` поверх `otherConfirm`; existing `bucketUnfavoritePreviewTargets` trash/ready/other **без изменений поведения** |
| GalleryPage / IPC | не трогались |

**Проверки:**
- `npm run typecheck` → PASS
- `npm test -- src/features/favorites/lib/mapRemovalToUiRoute.test.ts` → PASS (431; новый файл appended)
- `npm test -- src/features/selection/lib/removeFavoritesBatch.test.ts` → PASS (426)
- Targeted: mapRemoval 5/5; removeFavoritesBatch 21/21

**GATES:** `--auth` OK; `--strict` OK (код до правки §7).  
**NEXT:** regression-guardian (risk medium).
