# Архитектура StitchVue

Краткая карта модулей и потоков данных. Поведение — только то, что подтверждено кодом. Портфолио-обзор на английском: [`ENGINEERING.md`](ENGINEERING.md). Детали IPC: [`IPC.md`](IPC.md). Инварианты: [`INVARIANTS.md`](INVARIANTS.md). Процесс рефакторинга: [`refactoring/TASK_HANDOFF.md`](refactoring/TASK_HANDOFF.md).

## Стек и вход

- Desktop: Tauri 2 + Rust backend + React/TypeScript frontend (Windows).
- Frontend entry: `src/main.tsx` → `src/app/App.tsx` → `src/pages/gallery/GalleryPage.tsx`.
- Backend entry: `src-tauri/src/lib.rs` (`run`): открывает SQLite (`database::open`), обслуживает кэш (`cache::maintain`), стартует `pipeline::Pipeline`, регистрирует команды.

## Карта React (FSD-подобная)

| Слой | Путь | Ответственность |
|------|------|-----------------|
| page | `src/pages/gallery/` | Главный UI и оркестрация сессии каталога (`GalleryPage.tsx`) |
| widgets | `src/widgets/` | Сетка (`gallery-grid`), viewer, sidebar, dialogs, selection UI |
| features | `src/features/` | gallery (сессия, pipeline events, порядок), favorites (optimistic), selection/file ops, settings, folder |
| entities | `src/entities/` | Типы folder/image, layoutMode, serviceFolder |
| shared | `src/shared/` | i18n, hooks, styles, config |

## Карта Rust / Tauri

| Модуль | Путь | Ответственность |
|--------|------|-----------------|
| commands | `src-tauri/src/commands/mod.rs` | Тонкие IPC-обёртки |
| pipeline | `src-tauri/src/pipeline/` | Сессия каталога, индексация, очередь миниатюр, watcher, viewer/hover |
| thumbnail | `src-tauri/src/thumbnail/` | Декод/генерация превью |
| cache | `src-tauri/src/cache/mod.rs` | SQLite thumbnail cache (`thumbnail_cache`) |
| scanner | `src-tauri/src/scanner/` | Обход каталога (`browse` / listing) |
| file_ops | `src-tauri/src/file_ops/` | copy/move в избранное и локальную корзину, favorites lifecycle, recycle |
| database / library / metadata / storage | соответствующие `mod.rs` | БД, библиотека папок, EXIF/свойства, HDD/SSD профиль |

## Поток открытия каталога

Подтверждено в `GalleryPage.tsx` (~1504–1587) и `selectFolder.ts`:

1. UI увеличивает `requestId` (сессия) и сбрасывает локальное состояние выбора/viewer.
2. `invoke('begin_directory_session', { session, folder })` → `Pipeline::begin_session` (`pipeline/mod.rs`): отклоняет `session <= board.session`, отменяет hover/viewer, очищает board, включает watcher.
3. `browseDirectory(path, session)` → `browse_directory` (`commands/mod.rs`): `scanner::list_directory_with`; при совпадении `pipeline.session() == session` эмитит `images-batch`.
4. После полного listing UI вызывает `start_indexing` с `files` и `session` → `Pipeline::index` (игнорирует `session < board.session`).
5. Viewport сообщает `set_visible_range` / `set_geometry_range` / `set_scrolling` для приоритетов очереди.

Хелперы listing/sort: `src/features/gallery/galleryListing.ts`, `galleryOrder.ts`.

## Сессии и устаревшие события

- Frontend: `eventSessionIsCurrent` / `keepCurrentSession` — `src/features/gallery/directorySession.ts` (+ тесты).
- Подписки: `useGalleryPipelineEvents` (`galleryPipelineEvents.ts`) фильтрует события по `refs.requestId.current`.
- Backend: события несут поле `session` (`MetaEvent`, `ThumbEvent`, `FailEvent`, `FolderChanged` в `pipeline/mod.rs`). `begin_session` не откатывает номер сессии назад.

## Миниатюры и кэш

- Генерация и приоритеты: `pipeline/mod.rs` (workers, `priority`, `pick_index` / produce / emit).
- События UI: `metadata-batch`, `thumbnail-ready`, `thumbnail-failed` (`pipeline/mod.rs` ~3159–3175).
- Frontend батчит decode превью: `flushThumbnailBatch` в `galleryPipelineEvents.ts`.
- Диск/БД кэша: `cache/mod.rs` (`thumbs_for_sources`, таблица `thumbnail_cache`); корень кэша — `database::app_dir().join("cache")` в `lib.rs`.

**UNVERIFIED:** точная матрица приоритетов tier↔viewport без отдельного разбора scheduler; при изменении — см. [`INVARIANTS.md`](INVARIANTS.md).

## Файловые операции

- Команда: `run_file_operation` / `cancel_file_operation` (`commands/mod.rs`).
- Действия: `Action::MoveToLocalTrash` | `CopyToLocalFavorites` (`file_ops/mod.rs`); строки `"move_to_local_trash"` / `"copy_to_local_favorites"`.
- Идемпотентность claim: `claim` → `Replay` | `Busy` | `Start`; успех → `complete`, ошибка → `abandon`.
- Прогресс: emit `file-operation-progress` во время `pipeline.execute_file_operation`.
- Frontend типы: `src/features/selection/fileOperation.ts`.
- Избранное (копии/undo/batch): `file_ops/favorites.rs`, `favorites_batch.rs`; UI optimistic — `src/features/favorites/*`.

Сервисные имена папок (константы): `LOCAL_TRASH` / `LOCAL_FAVORITES` в `file_ops/mod.rs`.

## Что не дублировать здесь

- Полный индекс команд и DTO → [`IPC.md`](IPC.md).
- Таблица бизнес-инвариантов → [`INVARIANTS.md`](INVARIANTS.md).
- Команды npm / структура каталогов → [`DEVELOPMENT.md`](DEVELOPMENT.md).
