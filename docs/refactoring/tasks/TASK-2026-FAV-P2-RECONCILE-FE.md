---
task_id: TASK-2026-FAV-P2-RECONCILE-FE
title: "P2 Safe Favorites — FE reconcile triggers (T017–T020)"
status: completed
risk: medium
responsible_agent: frontend-executor
base_commit: "73e3e36223ff2be3850081913569dd87e5e45784"
approval_hash: 344083e632d0a7b59ca64f1eb15395f31614c64c5f9dfd6e7ac13095e0570ae8
allowed_paths:
  - src/features/favorites/lib/favoritesReconcile.ts
  - src/features/favorites/lib/favoritesReconcile.test.ts
  - src/features/gallery/model/pipeline/galleryPipelineEvents.ts
  - src/pages/gallery/GalleryPage.tsx
  - src-tauri/src/commands/mod.rs
  - specs/001-safe-favorites-lifecycle/quickstart.md
  - docs/refactoring/tasks/TASK-2026-FAV-P2-RECONCILE-FE.md
forbidden_paths:
  - src-tauri/src/file_ops/**
  - src-tauri/src/pipeline/**
  - specs/001-safe-favorites-lifecycle/spec.md
  - specs/001-safe-favorites-lifecycle/tasks.md
tests:
  - npm run typecheck
  - npm test -- src/features/favorites/lib/favoritesReconcile.test.ts
---

# Задача: P2 Safe Favorites — FE reconcile triggers (T017–T020)

Close remove-gap via album-open + folder-changed refetch (CL-P01/CL-P02).

## 1. Метаданные

| Поле | Значение |
|------|----------|
| ID | TASK-2026-FAV-P2-RECONCILE-FE |
| Статус | verification |
| Риск | medium |
| Ответственный | frontend-executor |
| SpecKit | T017, T018, T019, T020 |

## 2. Scope

### Разрешённые файлы

- `favoritesReconcile.ts` (+ test) — debounced album-open reconcile helper (300–500ms; skip same directoryKey within 2s unless forced)
- `galleryPipelineEvents.ts` — on `folder-changed` matching session: existing refresh **plus** favorites refetch hook / callback for scoped reconcile + `favorite_origin_paths`
- `GalleryPage.tsx` — wire favoritesReconcile + favorite_origin_paths on album browse ready (**sequential** only this file in phase)
- `commands/mod.rs` — **only if** album-open cannot refetch without thin command; prefer zero IPC — document in quickstart (T017)
- `quickstart.md` — T017 architecture note: post-op BE in pipeline; FE album-open/folder-changed

### Запрещено

- Changing file_ops / pipeline BE logic
- Mass GalleryPage refactors unrelated to favorites reconcile wiring
- User photo operations

### Зависимости

- After P2 BE (T015/T016)
- Blocks P3 T025 (needs T020)

## 3. Business invariants

- [x] directorySession: folder-changed must respect session (stale ignored)
- [ ] FS originals — FE only refetch

## 4. Acceptance criteria

### Должно измениться

- T017: architecture note in quickstart
- T018: `favoritesReconcile` debounce helper + unit tests
- T019: folder-changed triggers favorites refetch path when session matches
- T020: GalleryPage wires on browse ready

### Должно остаться неизменным

- Non-favorites gallery event behavior
- IPC shapes unless thin command proven necessary (default: no new command)

### Автоматические проверки

- typecheck PASS
- favoritesReconcile.test.ts PASS

### Ручная smoke

- [ ] N/A automated debounce tests; optional folder-switch note in §7

### Стоп

- Need new IPC without documenting T017 justification
- Breaking directorySession stale guard

## 5. Rollback

restore allowed_paths from base_commit

## 6. Маршрут

frontend-executor → guardian → strict

## 7. Отчёт исполнителя

```
TASK: TASK-2026-FAV-P2-RECONCILE-FE
STATUS: verification
CHANGED:
  - specs/001-safe-favorites-lifecycle/quickstart.md (T017 KEEP)
  - src/features/favorites/lib/favoritesReconcile.ts (+test) T018
  - src/features/gallery/model/pipeline/galleryPipelineEvents.ts T019
  - src/pages/gallery/GalleryPage.tsx T020
INVARIANTS: сохранены (stale session ignore preserved; FE refetch only)
TESTS:
  - npm run typecheck → PASS
  - npm test -- src/features/favorites/lib/favoritesReconcile.test.ts → PASS (433)
GATES: preflight FAIL (ожидаемый dirty quickstart T017 KEEP); auth OK; strict → после commit
DIFF: в scope
SMOKE: N/A (debounce unit tests); folder-switch stars — optional manual
RISKS: medium — GalleryPage + pipeline folder-changed
NEXT: guardian
```
