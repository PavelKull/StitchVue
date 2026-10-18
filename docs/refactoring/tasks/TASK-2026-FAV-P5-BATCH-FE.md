---
task_id: TASK-2026-FAV-P5-BATCH-FE
title: "P5 Safe Favorites — FE batch buckets, disk-truth, GalleryPage (T042–T044b, T046)"
status: approved
risk: medium
responsible_agent: frontend-executor
base_commit: "119820593435d88dc3f5645911ed47be3579aab6"
approval_hash: 783902a0b7e1c7948844d1e9bffbee8e88028de2d602841f7112c4a98b30571c
allowed_paths:
  - src/features/selection/lib/removeFavoritesBatch.ts
  - src/features/selection/lib/removeFavoritesBatch.test.ts
  - src/features/favorites/lib/favoritesDiskTruthAfterIpc.ts
  - src/features/favorites/lib/favoritesDiskTruthAfterIpc.test.ts
  - src/pages/gallery/GalleryPage.tsx
  - docs/refactoring/tasks/TASK-2026-FAV-P5-BATCH-FE.md
forbidden_paths:
  - src-tauri/**
  - specs/001-safe-favorites-lifecycle/spec.md
  - specs/001-safe-favorites-lifecycle/tasks.md
tests:
  - npm run typecheck
  - npm test -- src/features/selection/lib/removeFavoritesBatch.test.ts
  - npm test -- src/features/favorites/lib/favoritesDiskTruthAfterIpc.test.ts
---

# Задача: P5 FE — batch UI + disk-truth

## 1. Метаданные

| Поле | Значение |
|------|----------|
| SpecKit | T042, T043, T044a, T044b, T046 |

## 2. Scope

- `removeFavoritesBatch.ts` — T042 bucketing fr11Required/standardConfirm/ready (extend partition helpers)
- `favoritesDiskTruthAfterIpc.ts` — T044a read-only recovery after IPC failure (favorite_origin_paths refetch; document Claim::Replay only when same operationId)
- `GalleryPage.tsx` — T043 mass unfavorite UI buckets; T044b use disk-truth on catch (no «all failed» without disk truth)
- T046 FE partial batch tests

## 3. Business invariants

- [x] No false full failure/success without disk check
- [x] directorySession on refetch

## 4. Acceptance criteria

T042–T044b, T046 as SpecKit. typecheck + tests PASS.

## 5. Rollback

restore base_commit

## 6. Маршрут

seal → frontend-executor → guardian → strict

## 7. Отчёт исполнителя

(пусто)
