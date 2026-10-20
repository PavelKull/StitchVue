# Mass unfavorite flicker fix — technical report

## Подтверждённые причины

| Гипотеза | Статус |
|----------|--------|
| `releaseUnfavoriteGate()` в начале `load()` рвёт optimistic-сессию при переходе на родителя | **Подтверждена** — исправлена контекстным `shouldRetainMassUnfavoriteGateOnLoad` |
| `opening` поверх сетки при `folderListingBusy` при ненулевом listing | **Подтверждена** — изменён порядок в `resolveGalleryEmptyKind` |
| Stub родителя `images: []` + задержка 380 ms перед `load` | **Подтверждена** — instant parent path с hot cache |
| Hot cache без фильтра `optimisticHiddenFolderKeys` | **Подтверждена** — `filterFoldersForOptimisticServiceHide` в `load` и instant nav |
| Повторный `applyRemovedServiceFolder` после batch | **Подтверждена** — `shouldSkipPostBatchServiceFolderNavigation` |
| Отмена confirm оставляет parent stub | **Частично** — `clearOptimisticFavoritesFolderHide` перезагружает папку Избранное, если UI на родителе |
| `geometryPending` всегда блокирует empty overlay при фото | **Сохранено** — при `imageCount > 0` и `geometryPending` по-прежнему `opening` (T11) |

## Исправления

| Файл | Изменение |
|------|-----------|
| `massUnfavoriteNavigation.ts` | Gate retention, hot-folder filter, skip duplicate nav, instant-nav guard |
| `favoriteMassUnfavoriteDiag.ts` | DEV-only `console.debug` без путей |
| `galleryEmptyState.ts` | Busy refresh не перекрывает уже видимые фото; `visibleFolderCount` в GalleryPage |
| `GalleryPage.tsx` | Instant parent + hot seed; retain gate в `load`; skip exit animation; finish skip nav; confirm rollback reload |

## Тесты

| Команда | Результат |
|---------|-----------|
| `npm run typecheck` | PASS |
| `npm test` (targeted + full runner 477 tests) | PASS |

## Оставшиеся риски

| Риск | Влияние |
|------|---------|
| Ручной UI-прогон полного снятия избранного не выполнялся в этой сессии | Среднее — визуальное мерцание может остаться на краевых кейсах |
| `load()` всё ещё ставит `folderListingBusy` при reconcile — без фото возможен краткий `opening` | Низкое |
| Два параллельных batch (T10) — только косвенно через gate sessionId | Низкое |

## Итог

**PARTIAL** — код и автотесты PASS; финальный **PASS** после ручного прогона C-005 (T01–T04, T11, T14).
