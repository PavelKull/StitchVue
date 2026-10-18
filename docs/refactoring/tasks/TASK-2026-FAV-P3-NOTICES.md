---
task_id: TASK-2026-FAV-P3-NOTICES
title: "P3 Safe Favorites — notices & no false success (T023–T029)"
status: approved
risk: medium
responsible_agent: frontend-executor
base_commit: "d6e1d2b14f38e1cb6feadabc83619196dbba1e28"
approval_hash: 64f8e2b101fe739c41ea9481b12539be6783c72cd240371b6289ca6ab2c1f14b
allowed_paths:
  - src-tauri/src/file_ops/favorites.rs
  - src/features/favorites/lib/favoritePathsServerSync.ts
  - src/features/favorites/lib/favoritePathsServerSync.test.ts
  - src/features/favorites/lib/favoriteOptimisticOverlay.ts
  - src/features/favorites/lib/favoriteOptimisticOverlay.test.ts
  - src/features/favorites/lib/favoriteOptimisticLifecycle.test.ts
  - src/pages/gallery/GalleryPage.tsx
  - src/shared/i18n/locales/en.json
  - src/shared/i18n/locales/ru.json
  - src/features/selection/lib/fileOperation.ts
  - specs/001-safe-favorites-lifecycle/quickstart.md
  - docs/refactoring/tasks/TASK-2026-FAV-P3-NOTICES.md
forbidden_paths:
  - src-tauri/src/pipeline/**
  - src-tauri/src/commands/**
  - src-tauri/src/file_ops/reconcile.rs
  - specs/001-safe-favorites-lifecycle/spec.md
  - specs/001-safe-favorites-lifecycle/tasks.md
tests:
  - npm run typecheck
  - npm test -- src/features/favorites/lib/favoritePathsServerSync.test.ts
  - npm test -- src/features/favorites/lib/favoriteOptimisticOverlay.test.ts
  - cargo test --manifest-path src-tauri/Cargo.toml p0_safe_favorites_t001 --
---

# Задача: P3 Safe Favorites — CL-P05 notices (T023–T029)

Disk-confirmed stars; needs-review; no false full success. T024 deferred (no new IPC).

## 1. Метаданные

| Поле | Значение |
|------|----------|
| ID | TASK-2026-FAV-P3-NOTICES |
| Статус | approved |
| Риск | medium |
| Ответственный | frontend-executor (+ backend DTO fields in favorites.rs only) |
| SpecKit | T023, T024(defer), T025, T026, T027, T028, T029 |

## 2. Scope

### Разрешённые файлы

- `favorites.rs` — optional serde fields `reconcileSuggested` / `fr11Required` on `RemoveFavoriteCopyResult` (T023); set when classify warrants; backward compatible
- `favoritePathsServerSync.ts` (+test) — disk-confirmed apply; **no full-success** when journal incomplete / needs reconciliation (T026, T029)
- `favoriteOptimisticOverlay.ts` (+tests) — rollback optimistic stars on indeterminate link (T027)
- `GalleryPage.tsx` — map `ST_NEEDS_RECONCILIATION` / incomplete journal to needs-review notice (T025); sequential only
- `src/shared/i18n/locales/en.json` + `ru.json` — needs-review / partial success keys (T028)
- `fileOperation.ts` — only if notice tone helpers needed for CL-P05
- `quickstart.md` — T024 defer note: no `favorites_reconcile_status` IPC; DTO+refetch sufficient

### Запрещено

- New IPC command (T024 deferred)
- T030 dispatch fix
- reconcile.rs / pipeline changes
- User paths

### Зависимости

- After P2 T020
- Blocks P4 UI (T036)

## 3. Business invariants

- [x] copy/move/delete без ложного успеха в UI
- [x] optimistic overlay rollback without losing unrelated paths
- [ ] directorySession — preserve while editing GalleryPage notices

## 4. Acceptance criteria

| ID | Criterion |
|----|-----------|
| T023 | Optional DTO fields present; FE can read them |
| T024 | Documented deferred in quickstart |
| T025 | Needs-review notice when journal incomplete / ST_NEEDS_RECONCILIATION surfaced |
| T026 | Stars from disk-confirmed paths |
| T027 | Optimistic rollback on indeterminate |
| T028 | i18n keys |
| T029 | Test: no full-success when incomplete |

### Должно остаться неизменным

- Baseline recovery; T001 RED; identity gate; no GalleryPage mass refactor

### Автоматические проверки

- typecheck; favoritePathsServerSync + optimistic overlay tests
- `p0_safe_favorites_t001` still FAIL (RED)

### Ручная smoke

- [ ] N/A unit-covered; note in §7

### Стоп

- Need favorites_reconcile_status IPC to meet T025 — stop and report (do not invent IPC)

## 5. Rollback

restore from base_commit

## 6. Маршрут

executor → guardian → strict

## 7. Отчёт исполнителя

(пусто)
