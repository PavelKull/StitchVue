# Бизнес-инварианты StitchVue

Канон для задач и review. Краткий указатель для агентов: [`.cursor/rules/business-invariants.mdc`](../.cursor/rules/business-invariants.mdc) (не дублировать таблицу). Процесс риска: [`refactoring/TASK_HANDOFF.md`](refactoring/TASK_HANDOFF.md).

Статусы:

- **confirmed** — есть код и/или автотест.
- **UNVERIFIED** — в rules или логике намечено, но нет отдельного регрессионного доказательства для всего контура; перед high-risk задачей подтвердить.

При смене инварианта — отдельное продуктовое ТЗ, не задача на рефакторинг.

## Таблица

| ID | Инвариант | Статус | Опора |
|----|-----------|--------|-------|
| I1 | События/результаты старой сессии каталога не применяются к новой | confirmed | `directorySession.ts` (`eventSessionIsCurrent`, `keepCurrentSession`); `directorySession.test.ts`; фильтр в `galleryPipelineEvents.ts`; `Pipeline::begin_session` / `index` в `pipeline/mod.rs` |
| I2 | Порядок и группировка фото — семантика `galleryOrder` | confirmed | `galleryOrder.ts`, `galleryOrder.test.ts`; публикация через `galleryListing.ts` (`publishedListing` + `sortPhotos`) |
| I3 | Порядок папок — семантика `folderOrder` | confirmed | `src/features/folder/folderOrder.test.ts` (+ модуль рядом) |
| I4 | Оптимистичное избранное и откат не теряют несвязанные пути | confirmed | `favoriteOptimisticOverlay.ts` и `*Optimistic*.test.ts`; `favoritePathsServerSync.ts` + `.test.ts` |
| I5 | Пакетное снятие избранного и UI-гейты согласованы | confirmed | `removeFavoritesBatch.ts` + `.test.ts`; `unfavoriteGate.test.ts` |
| I6 | `run_file_operation` использует claim/complete/abandon; Busy/Replay не маскируют параллельный успех | confirmed (механизм) | `commands::run_file_operation`; `file_ops::{claim,complete,abandon,Action}` |
| I7 | Ошибки файловых операций не дают ложный успех в UI/БД по всем сценариям | UNVERIFIED | Требует подтверждения по затронутому модулю `src-tauri/src/file_ops/` на каждой high-risk задаче |
| I8 | Оригиналы фото не удаляются/не перезаписываются вне явной user-операции | UNVERIFIED | `Action` сейчас: move→локальная корзина, copy→избранное (`file_ops/mod.rs`); полное «не трогать оригинал при copy» — подтверждать тестами задачи / `favorites_lifecycle.rs` |
| I9 | Очередь и приоритеты миниатюр сохраняют продуктовую семантику | UNVERIFIED | Реализация в `pipeline/mod.rs` (priority / workers); при изменении scheduler/prefetch — доказать сохранность |
| I10 | Copy в избранное — копия, не удаление источника (намерение Action) | confirmed (тип действия) | `Action::CopyToLocalFavorites` / `"copy_to_local_favorites"`; frontend `FileAction` в `fileOperation.ts`. Полный ФС-контракт при коллизиях — см. I7/I8 |

## Сессии (деталь I1)

- Frontend номер сессии: `requestId` в `GalleryPage.tsx`; инкремент перед `begin_directory_session`.
- Backend: `begin_session` игнорирует `session <= board.session`.
- События с `session` отбрасываются на UI, если не равны текущему `requestId`.

## Избранное и файлы (деталь I4–I8)

- UI overlay: generation-based clear (`clearFavoriteOverlayIfGeneration` и др.).
- Backend batch/remove: `remove_favorite_copies_batch`, `remove_favorite_copy`, undo-команды в `lib.rs` / `commands/mod.rs`.
- Локальные имена сервисных папок: `LOCAL_FAVORITES`, `LOCAL_TRASH` в `file_ops/mod.rs`.

## Сортировка (деталь I2)

- Ключи: `date` | `name`, направление, `grouped` — `GallerySort` в `galleryOrder.ts`.
- Публикация списка только когда `listingReadyForSort` (`galleryListing.ts`).

## Smoke (ручной)

Не автотест. Канон списка: rules / HANDOFF. Обязателен для high, серии этапов и релиза; не после каждого low.
