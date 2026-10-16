# GalleryPage FSD major refactor — отчёт (промежуточный)

**Статус:** **в работе** (критерии §14 ТЗ не выполнены полностью).  
**Ветка:** `refactor/gallery-fsd-major` (база `c5e2d420990ceaafe30edb2a63224a468e0ed79b`, включает TASK-004 + TASK-005).  
**Umbrella:** `TASK-2026-GALLERY-FSD-MAJOR` (`approval_hash` `286801b8…`).  
**Push / merge в `main`:** не выполнялись.

## Сравнение GalleryPage

| Метрика | До major (после TASK-005) | Сейчас |
|---------|---------------------------|--------|
| Строки `GalleryPage.tsx` | 4814 | **~4540** |
| Прямые `invoke(` в page | ~20 | **~11** (viewer, favorites undo, file ops, remember_folder) |
| Цель ТЗ | ≤1500, композиция | **не достигнута** |

## Выполненные внутренние фазы (фаза 1, частично)

| Этап roadmap | Коммит | Результат |
|--------------|--------|-----------|
| TASK-021 `insertServiceFolder` | `685049b` | `features/folder/insertServiceFolder.ts` + тесты |
| TASK-006 folder history | `5c6e622` | `galleryFolderHistory.ts`, `useGalleryFolderHistory.ts` |
| TASK-020 tile SCSS | `4e80a33` | `FolderViewTile.module.scss`, без импорта `pages/**` |
| Umbrella contract | `ebe694f` | `TASK-2026-GALLERY-FSD-MAJOR.md` + `--seal` |
| TASK-007 drives + boot | `3631310` | `useGalleryDrives`, `useGalleryBoot`, `galleryBootStartPath` |
| TASK-008 IPC adapters | (см. git log) | `features/gallery/api/*` — session, indexing, geometry, cache |
| Interim report | `a1a563a` | этот файл (v1) |

## Перенесённые ответственности (накопительно с TASK-001–005)

- Pure helpers: `indexPayload`, `createEmptyView`, `withLocalizedDirectory`, `restorePromptText` (TASK-005)
- Scroll/peek chrome (TASK-003–004)
- Service folder insert (TASK-021)
- Folder back/forward history (TASK-006)

## Остаётся в GalleryPage (крупные блоки)

- `load()` / `refreshFolder()` / session `requestId`
- Indexing effects + geometry nudge + `reorder_indexing`
- Favorites mass-unfavorite (~850 строк) + overlay
- `runFileAction` + file progress
- Viewer + `set_viewer`
- Bootstrap / drives
- Selection + global keyboard
- Shell pointer routing / JSX composition
- Cache settings (`setLimit`, `setTtl`), оставшиеся `invoke`

## FSD / зависимости

- Widget `FolderViewTile` больше не импортирует `GalleryPage.module.scss`.
- `features/gallery` → `entities` / `shared`; циклов не добавлено.

## Тесты

- `npm run typecheck`: **PASS**
- `npm test`: **336 pass** (на момент прогона)
- Новые: `insertServiceFolder.test.ts`, `galleryFolderHistory.test.ts`

## Gates

- Umbrella `--seal`: OK
- `--auth`: OK
- `--preflight`: **FAIL** (ожидаемо после коммитов: `HEAD ≠ base_commit` — для umbrella нужен режим «работа на ветке после auth», не повторный preflight на каждый коммит)

## Git (локально)

```
4e80a33 refactor(widgets): colocate FolderViewTile styles
5c6e622 refactor(gallery): extract folder history hook from GalleryPage
685049b refactor(folder): extract insertServiceFolder from GalleryPage
ebe694f docs(refactoring): umbrella contract for GalleryPage FSD major decomposition
c5e2d42 refactor(gallery): extract pure view and index helpers from GalleryPage
…
```

`main` fast-forward до `8f36c9f` (TASK-004 + plan); **TASK-005 и major — только на `refactor/gallery-fsd-major`**.

## Субагенты

По ТЗ: **не вызывались** (делегирование недоступно без имитации; работа выполнена executor-ом напрямую).

## Ручной smoke (ещё не выполнен)

- [ ] Быстрое переключение папок (I1)
- [ ] Сортировка
- [ ] Scroll / миниатюры
- [ ] Избранное / batch unfavorite
- [ ] Delete/move selection only
- [ ] Back/forward history (после TASK-006)

## Следующие автономные шаги (фаза 2+)

1. ~~TASK-007 boot/drives~~  
2. ~~TASK-008 IPC adapters (`features/gallery/api/*`)~~  
3. TASK-009 thumb progress  
4. TASK-010 indexing sync  
5. TASK-015 → 017 → 016 → **011** → 012 → 018  
6. TASK-014, 013, 019  

## Архитектурные проблемы (открытые)

- `GalleryPage` всё ещё god-orchestrator.
- Dual order `view.images` vs `orderedImages` (F-02) — исправить при TASK-016.
- `viewer-frame-ready` duplicate listeners — отдельное ТЗ.

---

*Обновлять этот файл по завершении umbrella или при остановке по §2 ТЗ.*
