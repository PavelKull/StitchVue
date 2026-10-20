# Favorites operation coordination — technical report

## Источники конфликтов (подтверждено)

| Источник | Механизм |
|----------|----------|
| Фоновый `remove_favorite_copies_batch` | `try_lock_paths` на копиях и связанных путях |
| `run_file_operation` (copy to favorites) | lock альбома + папки «Избранное» |
| Пересечение ancestor/descendant | `locks.rs` → «Конфликтующая файловая операция…» |
| Разрозненные FE gates | `unfavoriteBusy` не блокировал звёзды сетки/viewer |

## Исправленные точки входа

| Точка | Поведение |
|-------|-----------|
| `removeSelectedFromFavorites` | `beginMassUnfavorite` на координаторе |
| `finishBackgroundMassUnfavorite` | phase `finalizing` → `coordinatorFinishFilesystemSession` + drain |
| `releaseUnfavoriteGate` | drain только если batch не в фоне и не `load` |
| `runFileAction` copy | очередь или IPC + `beginFileOperation` |
| `runFileAction` trash | блок с понятным сообщением при busy |
| `copyToFavoritesFromViewer` | очередь при конфликте |
| `toggleFavoriteFile` | очередь на add; отмена queued на повторный клик |

## Архитектура

- **`favoritesOperationCoordinator.ts`**: учёт FS-сессий (`mass-unfavorite`, `file-operation`), conflict по дереву путей, очередь add-intent с coalescing `desired`, FIFO drain, один retry на временный conflict.
- **GalleryPage**: optimistic overlay сразу; IPC add после drain; без нового global store.

## Файлы

- `src/features/favorites/lib/favoritesOperationCoordinator.ts` (+ test)
- `src/pages/gallery/GalleryPage.tsx` (интеграция)
- Связано с `massUnfavoriteNavigation.ts` (flicker fix)

## Тесты

| Команда | Результат |
|---------|-----------|
| `npm run typecheck` | PASS (после фикса) |
| `npm test` (coordinator + suite) | PASS |

## Риски

| Риск | Влияние |
|------|---------|
| Ручной smoke (100+ фото) не выполнен | Среднее |
| Очередь только для add, не trash/move | По ТЗ |
| Drain при смене альбома опирается на `intent.albumDirectory` | Низкое |

## Сохранность файлов

Rust FS/SQLite не менялись; блокировки `try_lock_paths` сохранены.

## Итог

**PARTIAL** — автотесты координатора PASS; нужен ручной прогон §12 ТЗ и проверка сценария «снять всё → сразу 5 звёзд».
