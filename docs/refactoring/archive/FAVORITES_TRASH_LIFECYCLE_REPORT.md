# FAVORITES_TRASH_LIFECYCLE — отчёт

## Прежняя логика

При снятии звезды с копии в «Избранном» классификатор видел отсутствующий оригинал и планировал `Relocate` (перенос копии в родительский альбом). Повторная валидация плана отклоняла `Relocate` → ошибка «План исключения устарел» вместо предсказуемого UX. Оригинал в локальной корзине StitchVue не отличался от «просто пропавшего» файла на этапе первого клика.

## Причина

Связь favorite↔origin не учитывала запись `trash_entries` при классификации. Отсутствие файла по `origin_path` сразу вело к relocate-пути, несовместимому с независимым жизненным циклом копии и оригинала в корзине.

## Изменения

### Backend (Rust)

- `database::trash_path_for_origin` — read-only поиск файла в локальной корзине по исходному пути.
- `RemovalContext.origin_trash_path`, план `Plan::OriginInTrash`, `ConfirmKind::OriginInLocalTrash`.
- Классификация: origin missing + достоверная запись trash + совпадение файла → `OriginInTrash`; иначе прежний `UnknownOrigin` / recycle при доступном оригинале.
- `remove_favorite_copy` / batch: опциональный `resolution`: `recycle_copy` | `restore_origin`.
- Статус результата `restored_origin`; в preview — `trashPath` при `origin_in_local_trash`.
- Тесты: `favorites_trash_lifecycle` (T4, T5, T6).

### Frontend

- Типы IPC в `fileOperation.ts`.
- `FavoriteTrashUnfavoriteDialog` (3 действия + отмена).
- `GalleryPage`: ветка `origin_in_local_trash`, `resolveTrashUnfavorite`, обновление звёзд при `restored_origin`.
- i18n: en, ru (+ de, zh-Hans для parity `i18n-check`).

### Вне `allowed_paths` (только сборка / parity)

- `favorites_bench.rs`: поле `resolution: None` в DTO.
- `de.json`, `zh-Hans.json`: те же ключи строк.

## Новая последовательность (сценарий D)

1. Клик по звезде на копии → preview `needs_confirm` + `origin_in_local_trash`.
2. Диалог: убрать копию / восстановить оригинал / отмена.
3. `recycle_copy` → штатный recycle копии, origin остаётся в корзине.
4. `restore_origin` → `restore_recorded_file`, связь и копия сохраняются, UI обновляет звёзды у оригинала.

Сценарий C (оригинал на месте) — без изменений (`Plan::Recycle`).

## IPC (добавления)

| Команда | Поле | Значения |
|---------|------|----------|
| `remove_favorite_copy` | `resolution?` | `recycle_copy`, `restore_origin` |
| `remove_favorite_copies_batch` | `items[].resolution?` | то же |
| Ответ | `status` | + `restored_origin` |
| Ответ | `confirmKind` | + `origin_in_local_trash` |
| Ответ | `trashPath?` | путь в корзине |

`docs/IPC.md` не обновлялся (не в `allowed_paths` задачи).

## Проверки

| Проверка | Результат |
|----------|-----------|
| `cargo test favorites_trash_lifecycle --` | PASS (3) |
| `cargo test favorites_copy_recovery --` | PASS (10) |
| `npm run typecheck` | PASS |
| `npm test` (полный) | i18n-check PASS после de/zh |
| regression-guardian | не запускался в этой сессии |
| Ручной smoke | **не подтверждён пользователем** |

## Остаточные риски

- Массовое снятие звёзд при `origin_in_local_trash` по-прежнему требует поштучного диалога (batch не автоматизирует выбор).
- Переименование папки избранного — без изменений (сценарий G).

## Ручной smoke (чеклист)

1. Добавить фото в избранное.
2. Удалить оригинал (локальная корзина).
3. Убедиться, что копия в «Избранном» на месте.
4. Снять звезду с копии → диалог из трёх действий.
5. «Восстановить оригинал» → оригинал и копия, звёзды согласованы.
6. Повторить с «Убрать из избранного» → копия убрана, оригинал в корзине.
7. Сценарий с доступным оригиналом — прежнее снятие звезды без нового диалога.
8. Перезапуск приложения — состояние без дублей.
9. Отмена в диалоге — без изменений FS/SQLite.
10. Быстрое переключение папок во время операции — без «залипших» звёзд.
