---
task_id: TASK-2026-FAV-P4-FE-FR11
title: "P4 Safe Favorites — FR-11 UI A–D + wiring (T034–T037, T039)"
status: approved
risk: medium
responsible_agent: frontend-executor
base_commit: "1fe4775ae2e3a87ffdb68785ed9a2221fa151f1a"
approval_hash: 152b337e4a9b195937bbe569baeaf07c1d3da31491c58c1940d164000aef9426
allowed_paths:
  - src/features/favorites/lib/mapRemovalToUiRoute.ts
  - src/features/favorites/lib/mapRemovalToUiRoute.test.ts
  - src/features/favorites/lib/unfavoriteGate.ts
  - src/features/favorites/lib/unfavoriteGate.test.ts
  - src/features/selection/lib/unfavoriteGate.ts
  - src/features/selection/lib/unfavoriteGate.test.ts
  - src/widgets/favorites-missing-origin-dialog/**
  - src/pages/gallery/GalleryPage.tsx
  - src/shared/i18n/locales/en.json
  - src/shared/i18n/locales/ru.json
  - src/shared/i18n/locales/de.json
  - src/shared/i18n/locales/zh-Hans.json
  - docs/refactoring/tasks/TASK-2026-FAV-P4-FE-FR11.md
forbidden_paths:
  - src-tauri/**
  - specs/001-safe-favorites-lifecycle/spec.md
  - specs/001-safe-favorites-lifecycle/tasks.md
tests:
  - npm run typecheck
  - npm test -- src/features/favorites/lib/mapRemovalToUiRoute.test.ts
  - npm test -- src/features/favorites/lib/unfavoriteGate.test.ts
  - npm test -- src/features/selection/lib/unfavoriteGate.test.ts
---

# Задача: P4 FE — FR-11 dialog A–D + GalleryPage wiring

Includes **P4b action B** (folder picker) — mandatory for release.

## 1. Метаданные

| Поле | Значение |
|------|----------|
| ID | TASK-2026-FAV-P4-FE-FR11 |
| Статус | draft |
| Риск | medium |
| Ответственный | frontend-executor |
| SpecKit | T034, T035, T036, T037, T039 |

## 2. Scope

### Разрешённые файлы

- `mapRemovalToUiRoute.ts` (+test) — ensure FR-11 vs standardConfirm routing (T034)
- `FavoriteMissingOriginDialog` widget (new under `src/widgets/favorites-missing-origin-dialog/`) — FR-11 **A–D**: A return-to-source, **B choose folder** (picker like trash restore), C keep/cancel, D recycle_copy if applicable (T035 + P4b)
- `GalleryPage.tsx` — wire dialog; pass resolution strings matching backend: `return_to_source`, `choose_folder` (+ chosen path if IPC supports), `cancel`/`keep_copy`, `recycle_copy` (T036)
- `unfavoriteGate` — in-flight token (existing selection lib or favorites lib) (T037)
- locales — FR-11 labels
- T039 routing/cancel tests

### Backend resolution contract (from P4a §7)

- A: `return_to_source`
- B: `choose_folder` (may need chosenDirectory — reuse trash picker pattern; if BE stub, UI still presents B and documents gap)
- C: `cancel` / `keep_copy`
- None → must not confirm-as-relocate

### Запрещено

- Changing Rust dispatch (done in P4a)
- Mass GalleryPage refactor

## 3. Business invariants

- [x] No false success; FR-11 before destructive missing-origin
- [x] directorySession / unfavoriteGate in-flight

## 4. Acceptance criteria

| ID | Criterion |
|----|-----------|
| T034 | mapRemoval routes unverified → fr11 |
| T035 | Dialog A–D including B folder picker |
| T036 | GalleryPage wires FR-11 |
| T037 | in-flight gate token |
| T039 | cancel / identity conflict routing tests |

### Автоматические проверки

frontmatter tests + typecheck

### Стоп

- BE cannot accept B without new IPC — stop and report; still ship A/C/D UI

## 5. Rollback

restore from base_commit

## 6. Маршрут

frontend-executor → guardian → strict

## 7. Отчёт исполнителя

(пусто)
