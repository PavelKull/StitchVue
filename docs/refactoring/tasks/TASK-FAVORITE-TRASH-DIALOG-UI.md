---
task_id: TASK-FAVORITE-TRASH-DIALOG-UI
title: UI — модалка «убрать из избранного» при оригинале в корзине
status: approved
risk: medium
responsible_agent: frontend-executor
base_commit: "7aaa92dee3d8b4ed221246fab546534fd8e73a77"
depends_on:
  - TASK-FAVORITES-TRASH-LIFECYCLE
allowed_paths:
  - src/widgets/favorites-trash-unfavorite-dialog/**
  - src/widgets/selection-actions/SelectionActions.tsx
  - src/widgets/selection-actions/SelectionActions.module.scss
  - src/pages/gallery/GalleryPage.tsx
  - src/shared/i18n/locales/en.json
  - src/shared/i18n/locales/ru.json
  - src/shared/i18n/locales/de.json
  - src/shared/i18n/locales/zh-Hans.json
  - docs/refactoring/tasks/TASK-FAVORITE-TRASH-DIALOG-UI.md
forbidden_paths:
  - src-tauri/**
  - src/features/selection/lib/fileOperation.ts
tests:
  - npm run typecheck
  - node --experimental-strip-types --test src/shared/i18n/__tests__/i18n-check.test.ts
---

# TASK-FAVORITE-TRASH-DIALOG-UI

Переработка **только UI/UX** диалога, который открывается при снятии звезды с копии в «Избранном», когда оригинал в локальной папке «Удалённое» (`confirm_kind: origin_in_local_trash`). Бизнес-логика и IPC **не меняются**.

## 1. Контекст

Реализация в `FavoriteTrashUnfavoriteDialog` (`SelectionActions.tsx`) — временная: три кнопки в одном ряду `dialogActions`, заголовок через `dialogText`, пояснение через `dialogDetail` (контейнер со скроллом и `max-height`), нет состояния загрузки, нет явного Escape, визуальная иерархия действий слабая. На узкой ширине кнопки сжимаются и выглядят «сломанными».

Сценарий и тексты зафиксированы в TASK-FAVORITES-TRASH-LIFECYCLE (сценарий D). Эта задача — **полировка под дизайн-систему StitchVue**.

## 2. Scope

### 2.1. В scope

- Вынести диалог в отдельный виджет FSD: `src/widgets/favorites-trash-unfavorite-dialog/` (`ui/`, при необходимости `model/` для busy-state).
- Визуальная структура по образцу зрелых модалок проекта:
  - `TrashFolderDeleteDialog` — заголовок + `dialogSubtext`, список при необходимости, фокус на cancel, disabled при операции.
  - `SupportReminderDialog` — отдельный `*.module.scss`, `h2.title`, вторичный текст, вертикальная группировка действий, Escape на `window` (capture).
- Переиспользовать **общие** примитивы там, где уместно:
  - `useAnimatedModal`, `modal-motion`, `floating-panel-surface` (как у `.backdrop` / `.dialog`).
  - Можно импортировать backdrop/dialog из `SelectionActions.module.scss` **или** продублировать токены через `@use` в новом scss (предпочтительно — один источник: shared modal tokens / импорт существующих классов backdrop+dialog).
- Иерархия действий (смысл из продуктового ТЗ, не менять порядок смысла):
  1. **Отмена** — безопасное действие по умолчанию (фокус при открытии).
  2. **Убрать из избранного** — деструктивное для копии, но обратимое в рамках корзины оригинала; визуально secondary/destructive-neutral (не primary accent).
  3. **Восстановить оригинал** — позитивное восстановление; допустим **primary** (`dialogPrimary` или эквивалент), если визуально не конкурирует с отменой.
- Рекомендуемая раскладка: **вертикальный стек кнопок** на узких окнах и на desktop (как donate/secondary rows в SupportReminder), либо cancel слева внизу + column stack справа — на усмотрение исполнителя при сохранении читаемости.
- Состояние **busy**: проп `busy?: boolean` от `GalleryPage` (`resolveTrashUnfavorite` уже держит `markBusy`); при busy — disable всех action-кнопок, опционально короткий label «…» / `common.loading` на активной кнопке; не закрывать диалог до старта (закрытие при клике остаётся на родителе).
- **Escape** — закрыть без изменений (как SupportReminder).
- **a11y**: `role="dialog"`, `aria-modal`, `aria-labelledby` + `aria-describedby` для body; не дублировать title в description.
- Локализация: существующие ключи `selection.favoriteTrash*`; при необходимости добавить короткие подписи-подсказки под кнопками (новые ключи во **всех** shipped locales: en, ru, de, zh-Hans).
- Удалить или свести к re-export `FavoriteTrashUnfavoriteDialog` из `SelectionActions.tsx`; импорт в `GalleryPage` — из нового виджета.

### 2.2. Вне scope

- Backend, IPC, `remove_favorite_copy`, batch unfavorite.
- Другие confirm-диалоги (`ConfirmMoveDialog`, unknown_origin).
- Переработка `GalleryPage` вне прокидывания `busy` / импорта.
- TASK-017, массовый FSD GalleryPage.

## 3. Критерии приёмки

- [ ] Диалог визуально согласован с StitchVue (типографика заголовка/тела, отступы, радиусы, цвета `--pg-*`).
- [ ] Нет трёх длинных подписей в одной горизонтальной строке на типичной ширине окна (min ~360px).
- [ ] Заголовок и описание не используют `dialogDetail` для статического короткого текста.
- [ ] Escape и клик по backdrop отменяют без FS-операций (поведение как сейчас).
- [ ] При `busy` нельзя дважды запустить `recycle_copy` / `restore_origin`.
- [ ] `npm run typecheck` и i18n-check проходят.
- [ ] Ручной smoke: fav → delete original → unfavorite copy → диалог читаем; все три действия работают как до редизайна.

## 4. Референсы в коде

| Файл | Что смотреть |
|------|----------------|
| `SelectionActions.tsx` | Текущий `FavoriteTrashUnfavoriteDialog` |
| `SelectionActions.module.scss` | `.backdrop`, `.dialog`, `.dialogSubtext`, `.dialogActions` |
| `TrashFolderDeleteDialog.tsx` | Заголовок, subtext, loading, disabled confirm |
| `SupportReminderDialog.tsx` + `.module.scss` | Структура, Escape, вертикальные группы кнопок |
| `GalleryPage.tsx` | `favoriteTrashUnfavorite`, `resolveTrashUnfavorite` |

## 5. Rollback

Удалить виджет, вернуть inline-диалог в `SelectionActions.tsx`.

## 6. Smoke (пользователь)

- [ ] Открытие диалога — фокус на отмене, читаемый текст.
- [ ] Отмена / Escape — звезда как до клика.
- [ ] Оба действия — прежний результат операций.
- [ ] Узкое окно — без обрезания кнопок.
