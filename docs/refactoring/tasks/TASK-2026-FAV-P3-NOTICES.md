---
task_id: TASK-2026-FAV-P3-NOTICES
title: "P3 Safe Favorites — notices & no false success (T023–T029)"
status: approved
risk: medium
responsible_agent: frontend-executor
base_commit: "a5ea1c0c99d51ec99e0a4e2a6102ac1073e46df7"
approval_hash: 8af7c7086e24e5c3d86cefa7bb60eac0cdc74df82c2436b42e4a95a00fef99d8
allowed_paths:
  - src-tauri/src/file_ops/favorites.rs
  - src-tauri/src/file_ops/favorites_batch.rs
  - src/features/favorites/lib/favoritePathsServerSync.ts
  - src/features/favorites/lib/favoritePathsServerSync.test.ts
  - src/features/favorites/lib/favoriteOptimisticOverlay.ts
  - src/features/favorites/lib/favoriteOptimisticOverlay.test.ts
  - src/features/favorites/lib/favoriteOptimisticLifecycle.test.ts
  - src/pages/gallery/GalleryPage.tsx
  - src/shared/i18n/locales/en.json
  - src/shared/i18n/locales/ru.json
  - src/shared/i18n/locales/de.json
  - src/shared/i18n/locales/zh-Hans.json
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

- `favorites.rs` — optional serde fields `reconcileSuggested` / `fr11Required` on `RemoveFavoriteCopyResult` (T023); set when classify warrants; backward compatible; `failed` / `needs_reconciliation` constructors
- `favorites_batch.rs` — only keep `RemoveFavoriteCopyResult` constructors in sync with new DTO fields
- `favoritePathsServerSync.ts` (+test) — disk-confirmed apply; **no full-success** when journal incomplete / needs reconciliation (T026, T029)
- `favoriteOptimisticOverlay.ts` (+tests) — rollback optimistic stars on indeterminate link (T027)
- `GalleryPage.tsx` — map `ST_NEEDS_RECONCILIATION` / incomplete journal to needs-review notice (T025); sequential only
- `src/shared/i18n/locales/{en,ru,de,zh-Hans}.json` — needs-review / partial success keys (T028; all locales for parity)
- `fileOperation.ts` — DTO optional fields for CL-P05
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

**STATUS: blocked** (strict FAIL — нужен re-seal)

### Сделано в working tree (не закоммичено)

| ID | Результат |
|----|-----------|
| T023 | `reconcileSuggested` / `fr11Required` на `RemoveFavoriteCopyResult`; `fr11` для UnknownOrigin/Ambiguous; `needs_reconciliation` при Ambiguous recycle |
| T024 | quickstart: defer `favorites_reconcile_status` |
| T025 | GalleryPage: needs-review / partial на `favorite_link` и `reconcileSuggested` |
| T026/T029 | `diskConfirmedFavoritePaths` + `shouldAnnounceFullFavoriteSuccess`; тест T029 |
| T027 | `rollbackIndeterminateFavoriteOverlay` + тест |
| T028 | i18n keys en/ru (+ de/zh для parity) |

### Проверки

- `npm run typecheck` → OK
- targeted favorites tests + full suite 429 → OK (после de/zh keys)
- `p0_safe_favorites_t001` → **RED** (ожидаемо)

### Blockers (strict)

Вне `allowed_paths`, но **обязательны** для сборки/parity:

1. `src-tauri/src/file_ops/favorites_batch.rs` — литерал `RemoveFavoriteCopyResult` без новых полей не компилируется; заменён на `::failed()`
2. `src/shared/i18n/locales/de.json`, `zh-Hans.json` — i18n-check требует parity всех shipped locales

**Нужен re-seal** с этими тремя путями, затем `--strict` + commit `feat(favorites): P3 notices and disk-confirmed stars`.

### HEAD

seal/re-seal: `a5ea1c0` (base_commit в YAML всё ещё `d6e1d2b`)
