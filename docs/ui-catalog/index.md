# UI catalog (C-002)

Живой код — источник правды; здесь — карта каналов и места для PNG-фикстур (без Storybook).

## Три канала

| Канал | Когда | Хост в коде |
|-------|--------|-------------|
| **Toast** | Короткий итог, undo, boot (недоступная папка) | `OperationNoticeView` в `GalleryPage` (`fileNotice`) |
| **Modal** | Нужно решение пользователя | `useAnimatedModal` + backdrop в виджете диалога |
| **Empty** | Нет контента / загрузка / ошибка открытия папки | `emptyGallery` в `galleryLayer` (C-001) |

Полная таблица примеров: `src/shared/ui/noticeChannels.ts` → `NOTICE_CHANNEL_MAP`.

## Модалки (modal channel)

- `SettingsDialog`
- `ConfirmMoveDialog` (`SelectionActions`)
- `RenameFolderDialog`, `TrashFolderDeleteDialog`
- `FavoriteTrashUnfavoriteDialog`, `FavoriteMissingOriginDialog`
- `PhotoPropertiesDialog`, `SupportReminderDialog`
- `UpdateDialog` — C-003 mock, `AnimatedModalFrame`, `src/features/app-update/` (см. `modals/README.md`)

Не добавлять отдельные `<p class="bootNotice">` и прочие полосы — только toast/modal/empty.

## Скриншоты (по мере съёмки)

```
ui-catalog/
  toasts/     # file op, boot toast
  modals/     # settings, confirm, update mock
  empty/      # C-001 kinds
```

PNG в git или gitignore — решение при первом коммите каталога.

## Ошибки

- Коды IPC → `localizeErrorCode` / `formatInvokeError` в тостах и модалках.
- `openError` в empty — живой текст в description (до полной i18n-обёртки).
