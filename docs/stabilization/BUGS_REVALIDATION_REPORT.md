# Ревалидация BUGS.md после backend/FSD/favorites

Дата: 2026-10-19. Только документация; код приложения не менялся.

Агенты (read-only): [architecture-coordinator](91e66550-b2aa-4fd8-9144-2a96c43f5186), [backend-decomposition](a1418e7a-ff18-4105-9402-2d1f73297c62), [frontend-decomposition](b36b11e4-80db-49a8-9dfb-70033ba901df). Addendum C-006: [frontend-decomposition](5026be71-1997-4803-830b-a93be16320cd), [backend-decomposition](286ef2d9-406c-4c3b-a600-3c149b020fb7). Расхождения сверены с текущим кодом (истина — реализация, не отчёт).

## 1. Git baseline

| | |
|---|---|
| Checkout | локальный клон репозитория StitchVue |
| Ветка задачи | `docs/revalidate-bugs` |
| База | `main` `2b709cd70ffecc482347ffeb19eef3e329809cf5` |
| Сообщение HEAD | `docs(git): enforce one-checkout branches-only policy` |
| Worktree / clone | не создавались |
| Push / merge | не выполнялись |

На старте дерево было чистое; ветка создана от `main` в том же каталоге.

## 2. Что изменилось в архитектуре

**Rust.** По-прежнему hub `src-tauri/src/pipeline/mod.rs` + `pipeline/viewer.rs` / `hover.rs`. Тиры: `thumbnail::bitmap_for_tier` → внутренний `finish` + `apply_orientation` → `encode_jpeg` (RGB, без EXIF). Кэш: `identity_hash(path, size, mtime)` / `cached_thumb`. Избранное P0–P6: `file_ops/favorites.rs`, `favorites_batch.rs`, `reconcile.rs`; снимок `database::favorite_snapshot_for_copy` есть для lifecycle/IPC (`favorite_origins_for_copies`), **не** для шаринга JPEG тиров.

**React FSD.** Оркестрация всё ещё `src/pages/gallery/GalleryPage.tsx`. Срез `src/features/gallery/{lib,model,api}/` (viewport, listing, pipeline, viewer). Сетка: `src/widgets/gallery-grid/`. Viewer: `src/widgets/image-viewer/`. Отчёт `GALLERY_FSD_MAJOR_REFACTOR_REPORT.md` описывает промежуточную ветку `refactor/gallery-fsd-major`, не карту этой `main`. `docs/ARCHITECTURE.md` частично отстаёт (плоские `galleryListing.ts`).

**Favorites.** Overlay, batch, journal, reconcile в коде и `INVARIANTS.md`. `favoriteDisplayOn` **уже** гасит pending `desired: false` даже в папке избранного — формулировка BUGS.md «всегда on» устарела. Сетка по overlay не фильтруется.

**Spec-Kit.** `001` интегрирован. `002` — draft, UI/plugin нет. `003` как product-спеки нет (`TASK-2026-003` — peek chrome, не баг-журнал). Neighbor preload уже в `viewerPreload*`; C-006 — сужение окна и качества, не новая подсистема.

## 3. Таблица замечаний (B-001…B-011, C-001…C-006)

| ID | Статус | Старый подход | Актуальный подход | Deps |
|----|--------|---------------|-------------------|------|
| B-001 | CONFIRMED | `pendingScrollToEnd` | тот же, хук `useGalleryScrollJump.ts`; не спейсер всей папки | B-011 |
| B-002 | LIKELY | bake EXIF до emit | bake **уже есть**; сначала различить placeholder / поля в JPEG / heuristic | B-004 |
| B-003 | CONFIRMED | thaw слота, не `fill` | жив: `geometryKey` без `metaVersion` + `freezeUsedAspects` + `tilePhotoStyle` fill; JPEG не трогать | не B-002 |
| B-004 | LIKELY | не emit с Orientation ≠ 1 | не «тег в cache JPEG»; `embedded_orientation` + два тира | B-002, B-009 |
| B-005 | CONFIRMED | alias тиров origin→copy | snapshot есть, lookup тиров нет; hardlink/`cached_thumb` origin; без новой схемы | C-005 (время add) |
| B-006 | UNVERIFIED | не invert viewport-first | `pick_index` подтверждён; чинить только после замера P4 vs P5 | после B-007 |
| B-007 | LIKELY | склеить hover/open | цепочка жива (`hoverPrefetch`, `prefetch_photo`, `peekPreloaded`); не cancel path, Join | B-006, B-009, C-006 |
| B-008 | LIKELY | не disable zoom n=1 | last-row `placeRow`; freeze сбрасывается на settling; замерить боксы | не B-009 |
| B-009 | LIKELY | frame от display-aspect | `aspectFromMeta` = 1 без размеров; contain; ориентация — B-002/4 | B-002/4, B-007, C-006 |
| B-010 | CONFIRMED | height шелла | `SettingsDialog.module.scss` `.dialog { height: auto }` | C-002 скрины |
| B-011 | LIKELY | не HDD, не virt off | FastScrolling thumbs не прячет; 3-way: virt / unpublished / rAF batch | B-001 |
| C-001 | CONFIRMED | один empty-каркас | `resolveGalleryEmptyKind` узкий; `serviceRole` → `'none'` | C-002 |
| C-002 | CONFIRMED | карта toast/modal/empty | `OperationNoticeView` + N× `useAnimatedModal`; `ui-catalog/` нет | C-001, C-003 |
| C-003 | CONFIRMED | mock `features/app-update/` | среза нет; spec 002; без plugin | C-002, spec 002 |
| C-004 | CONFIRMED | star + иконки | `SupportPanel`: CloudTips/Boosty, GitHub только в About | C-002 |
| C-005 | CHANGED | дожать overlay | звезда pending-off уже гаснет; дыры: фильтр listing, hide ждёт `listingReady` | I4/I5; не B-005 |
| C-006 | CONFIRMED | — (новое) | дожать `preloadViewerNeighbors` / `buildNeighborJobs`: P1 N+dir, P2 +2…+5, P3 назад spare; не scheduler | после B-007; с B-009 |

Ни одного **FIXED**. **NOT APPLICABLE** нет: B-001/B-011 не backend-баги, но симптомы живы на фронте.

## 4. Предыдущий vs актуальный фикс

Где код переехал, но механика та же: B-001, B-003, B-005, B-010, C-001–C-004 — старый минимальный фикс применим к новым путям.

Где старый фикс упрощается: B-002 не требует «начать печь JPEG» — печём уже; достаточно диагностики кадра + `image-orientation: none`. B-003 не требует перекодирования thumb. C-005 не требует нового store — фильтр `view.images` / ослабить `listingReady`. B-007 не новый preload. C-006 не новый кэш и не rewrite `pick_index` — правка `viewerPreloadLogic` / `pump` и опционально Join через `prefetch_photo`.

Где без замера нельзя: B-006, B-008, B-011.

## 5. Что можно упростить

- B-001: follow-max, не резерв высоты на весь listing.
- B-003: точечный thaw индекса + cover, не rebuild каталога.
- B-005: reuse `favorite_snapshot_for_copy` + существующий `cached_thumb`, не новая таблица.
- C-001: расширить kind, не новый empty-виджет.
- C-003: mock в запланированном `src/features/app-update/`, без updater crate.
- C-005: существующие `favoriteDisplayOn` / `optimisticHiddenFolderKeys` / `massUnfavoriteStartLandingKey`.
- C-006: `preloadViewerNeighbors`, `buildNeighborJobs`, `kept`/`generation`, `viewer_source`, `prefetch_photo` Join, `set_viewer` для 256 сетки. Не `ahead=12` native decode.

## 6. Устаревшие рекомендации

- Первый emit несёт EXIF Orientation, WebView крутит cache JPEG — для `encode_jpeg` из RGB не так.
- Перекодировать thumb после `rotate_display_clockwise`.
- Публичный API пайплайна = только `finish()` — обёртка `bitmap_for_tier` (внутренний `finish` жив).
- `favoriteDisplayOn` в избранном всегда on — pending overlay уже приоритетнее.
- «Кэш не знает origin» — snapshot есть, нет lookup тиров.
- Спейсер всей папки как первый фикс B-001.
- Переписать приоритеты «сначала вся папка».
- Новый hover-preload / вторая FSM избранного / второй viewer-кэш (C-006).
- Переписать `pick_index` ради окна соседей ImageViewer.
- Отключить виртуализацию или поднять параллелизм HDD для B-011.
- Реальный Tauri Updater и CI в рамках C-003.
- Playwright/Storybook как обязательный шаг C-002.
- Карта FSD-отчёта major-ветки как текущая `main`.

## 7. Нужна дополнительная диагностика

| ID | Зачем |
|----|--------|
| B-002 | placeholder vs поля в JPEG vs ориентация |
| B-004 | первый 256 embedded vs следующий тир |
| B-006 | idle-слоты P4 vs P5 |
| B-007 | клик быстрее 100 ms / leave cancel / `naturalWidth` |
| B-008 | `tile.width`/`row.height` FS vs окно |
| B-009 | frame aspect 1 vs display-aspect; thumb vs warm |
| B-011 | `thumbs.get` vs нет тайла vs blank img |
| C-005 | mass при `listingReady=false`; partial — тайлы при off-звезде |

## 8. Конфликты между исправлениями

- **B-002/B-004 bake vs B-003:** разные оси. Перекодирование кэша под EXIF сломает ручной quarter. B-003 = layout + CSS.
- **B-009 vs B-003:** `viewerPhotoStyle` `fill` для fillScreen ≠ squash тайла.
- **B-001 vs B-011:** follow-end без published тайлов = пустой хвост.
- **B-005 vs C-005:** строки кэша на copy-path; optimistic remove не ждёт eviction.
- **C-001 vs C-002:** empty-экран ≠ toast.
- **C-003 vs spec 002:** один продукт; этот этап только mock. Busy-gate file op/unfavorite общий.
- **C-006 vs B-007:** один `kept` и hover-слот Join. Сначала glue click/leave, иначе P1 neighbor + `cancel_photo_prefetch` снова рвут тёплый кадр.
- **C-006 vs B-009:** тёплый N+1 не заменяет frame от display-aspect и bake ориентации.
- **C-006 vs B-006:** лишние `viewer_source`/native (особенно ahead=12) конкурируют со слотами сетки. Держать `MAX_ACTIVE=2`, P3 spare, не трогать P0/P1 `pick_index`.

## 9. Рекомендуемый порядок

1. C-001, B-010, C-004 — локальный FE/CSS/i18n.
2. B-001 `pendingScrollToEnd`.
3. B-003 thaw слота + убрать tile `fill`.
4. C-005 фильтр listing + hide без лишнего `listingReady`.
5. B-008 замер layout, затем точечный last-row.
6. B-007 glue click/leave/Join.
7. Диагноз B-002 / B-004 / B-009 (контракт первого JPEG + viewer frame).
8. C-006 окно соседей на существующем `viewerPreload*` (после B-007; частично маскирует B-009).
9. B-011 после 3-way различия слотов.
10. C-002 оболочка; C-003 mock `features/app-update/`.
11. B-005 шаринг тиров по snapshot.
12. B-006 только с цифрами слотов.

Не начинать с rewrite thumbnail pipeline, SQLite schema или file ops.

## 10. Reuse из Spec-Kit 001 / 002 → будущий 003

**001 (уже в коде):** overlay, `applyInstantMassUnfavoritePresentation`, `optimisticHiddenFolderKeys`, `massUnfavoriteStartLandingKey`, batch IPC, snapshots, инварианты оригинала. Для C-005 не копировать journal/reconcile.

**002 (ещё не в коде):** FSD `src/features/app-update/`, диалог Update/Later, gate на file op/unfavorite, i18n, один `check()` на старт. C-003 = mock этих поверхностей. Реальный plugin, `latest.json`, CI — только 002, не баг-журнал.

Неформального «плана 003» в `docs/release/` нет. Этот журнал + отчёт — основа для будущей spec 003 без повторного полного аудита.

### Анализ C-006 (addendum)

Окно соседей **уже есть**: `GalleryPage` → `preloadViewerNeighbors` + `set_viewer`. P0 текущего кадра — `viewer_frame`, не neighbor jobs. Разрыв: `near` = первые два вперёд (P1 слито с началом P2); при fast `near=[]` и N+1 падает на 256; far берёт любой thumb; назад не spare-gated; `VIEWER_AHEAD_FAST=12` шире C-006. Rust `pick_index` viewer_steps греет **grid thumbs**, не HiDPI кадр. Hover Join (`prefetch_photo`) — отдельный слот, соседи ходят в `viewer_source`. Память: `MAX_ACTIVE=2`, `MAX_KEPT=8`.

**Архитектурное решение (2026-10-19, канон для Spec-Kit 003):** не новая подсистема и не второй кэш; только существующие `preloadViewerNeighbors` / `buildNeighborJobs` / `viewerPreloadLogic.ts` / `viewerPreload.ts`; `pick_index` не трогать; порядок реализации **B-007 → C-006 → остаток B-009**; окно P1=N+1, P2=N+2…N+5, P3=N−1…N−2; fast не сбрасывает P1; направление = фактическая навигация, P0 всегда текущий кадр; P3 после high-pri; `MAX_ACTIVE=2` без измерений не менять; `MAX_KEPT=8` не поднимать безусловно (сначала стоимость памяти); без полного RAW/HEIC decode без нужды; viewport сетки важнее фона viewer; targeted-тесты на fast, direction, inflight join, memory cap.

### Минимальный пакет C-006 для Spec-Kit 003

Не scheduler, не новый кэш, не полный RAW/HEIC.

| Шаг | Файлы | Суть |
|-----|--------|------|
| 1 | `src/features/gallery/lib/viewer/viewerPreloadLogic.ts` + `.test.ts` | P1 = сосед по `direction`; P2 = +2…+5; P3 = две назад в хвосте; `near` только P1; fast не обнуляет near; decode-окно 5, не `VIEWER_AHEAD_FAST=12` |
| 2 | `src/features/gallery/lib/viewer/viewerPreload.ts` | `pump`: P3 после P1/P2; far `viewer_source` previewOnly если thumb ниже 1024; reuse `kept`; generation только при смене окна |
| 3 | опционально `galleryHover.ts` / P1 | `prefetch_photo` + `long_edge` для Join с B-007; не второй слот |
| 4 | не менять | `pick_index`, IPC DTO, `encode_viewer` контракт, `ImageViewer` `viewer_frame` для N, `MAX_ACTIVE=2` без нужды |

`GalleryPage` effect ~1760 оставить как wiring; `set_viewer` может по-прежнему греть 256 сетки.

## Сводка статусов

- **CONFIRMED (9):** B-001, B-003, B-005, B-010, C-001, C-002, C-003, C-004, C-006
- **CHANGED (1):** C-005
- **LIKELY (6):** B-002, B-004, B-007, B-008, B-009, B-011
- **UNVERIFIED (1):** B-006
- **FIXED / NOT APPLICABLE:** нет
