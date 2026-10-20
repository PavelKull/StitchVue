---
task_id: TASK-2026-003-B001-scroll-end
title: Прыжок в конец папки с follow-max (B-001)
status: completed
risk: medium
responsible_agent: frontend-executor
base_commit: "b4b77ebb1a99241a7b02a425ed735c092d074999"
approval_hash: aec74b029fc87369a0b5d6276f88cc6a2c228c588a5a272da78e459dbaa3b0ba
allowed_paths:
  - src/features/gallery/lib/viewport/galleryScrollJump.ts
  - src/features/gallery/model/viewport/useGalleryScrollJump.ts
  - src/features/gallery/model/viewport/useGalleryScrollJump.test.ts
  - src/pages/gallery/GalleryPage.tsx
forbidden_paths:
  - src-tauri/**
  - src/widgets/gallery-grid/layout.ts
  - src/widgets/gallery-grid/StitchVueGrid.tsx
  - src/features/favorites/**
tests:
  - npm test -- src/features/gallery/model/viewport/useGalleryScrollJump.test.ts
---

# Задача: Прыжок в конец папки с follow-max (B-001)

Пакет US1 / T012–T014. `BUGS.md` B-001, FR-001. Без спейсера на всю папку.

## 1. Метаданные

| Поле | Значение |
|------|----------|
| ID | `TASK-2026-003-B001-scroll-end` |
| Статус | `approved` |
| Риск | `medium` |
| База Git | `b4b77ebb1a99241a7b02a425ed735c092d074999` |
| Ветка | `feat/003-pre-release-stabilization` |

## 2. Scope

### Разрешённые файлы

- `galleryScrollJump.ts` — pure: pending lifecycle, at-bottom, cancel on scroll up
- `useGalleryScrollJump.ts` — `pendingScrollToEnd`, re-stick on `scrollHeight` growth, `behavior: 'auto'` while pending
- `useGalleryScrollJump.test.ts` — lifecycle unit tests
- `GalleryPage.tsx` — только: `listingComplete`, обёртка `onScrollActivity` для cancel pending, сброс при смене папки

### Запрещено

- Полный spacer на число файлов; `pick_index`; IPC/SQLite; массовый рефактор `GalleryPage`

### Критерии

- «Вниз» до ready: follow растущего `scrollHeight`
- «Вверх» сразу; ручной скролл вверх / смена папки снимает pending
- ready + низ → снять pending

## 3. Business invariants

directorySession / galleryOrder / thumbnails без изменений семантики.

## 4. Acceptance criteria

- T012–T014 выполнены; тесты § YAML
- Smoke: большая папка, «вниз» до ready — в конце

### Ручная проверка

- [x] N/A в §7 до smoke владельца

## 5. Rollback

restore allowed_paths from base_commit

## 6. Маршрут

frontend-executor → guardian → auditor

## 7. Отчёт

```
TASK: TASK-2026-003-B001-scroll-end
STATUS: completed
CHANGED: galleryScrollJump pending helpers; useGalleryScrollJump follow-max; GalleryPage listingComplete + scroll wrapper
TESTS: useGalleryScrollJump.test.ts 6 pass; typecheck OK
SMOKE: не выполнялся владельцем — не FIXED в BUGS
```
