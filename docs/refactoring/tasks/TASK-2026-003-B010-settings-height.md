---
task_id: TASK-2026-003-B010-settings-height
title: Стабильная высота диалога Настроек при смене языка (B-010)
status: approved
risk: low
responsible_agent: frontend-executor
base_commit: "5ca47fc2930ceb95d746eb4f8001e16173bebf16"
approval_hash: c1bd823e8981ec68afadaa9c01682bccc3112fcb8ab68411df4a36e43e451609
allowed_paths:
  - src/widgets/settings-dialog/SettingsDialog.module.scss
  - src/widgets/settings-dialog/settingsDialogHeight.test.ts
forbidden_paths:
  - src-tauri/**
  - src/pages/gallery/**
  - src/features/gallery/**
  - src/widgets/settings-dialog/SettingsDialog.tsx
  - src/shared/i18n/**
tests:
  - node --experimental-strip-types --test src/widgets/settings-dialog/settingsDialogHeight.test.ts
---

# Задача: Стабильная высота диалога Настроек при смене языка (B-010)

Пакет US8 / T009 из `specs/003-pre-release-stabilization/tasks.md`. Источник: `BUGS.md` B-010, spec FR-010.

Не менять TSX, IPC, i18n, другие модалки. Комментарии в изменённом коде — только на русском.

## 1. Метаданные

| Поле | Значение |
|------|----------|
| ID | `TASK-2026-003-B010-settings-height` |
| Название | Стабильная высота диалога Настроек при смене языка (B-010) |
| Статус | `approved` |
| Риск | `low` — CSS шелла, без React state / IPC / ФС |
| Ответственный агент | `frontend-executor` |
| База Git | `5ca47fc2930ceb95d746eb4f8001e16173bebf16` |
| Рабочий каталог | `C:\Users\Pavel\Desktop\ImageGrid` |
| Ветка исполнения | `feat/003-pre-release-stabilization` |
| Печать | `c1bd823e8981ec68afadaa9c01682bccc3112fcb8ab68411df4a36e43e451609` |

**Синхронизация:** YAML = таблица.

## 2. Scope

### Разрешённые файлы и каталоги

- `src/widgets/settings-dialog/SettingsDialog.module.scss` — **только** правило `.dialog` (сейчас `height: auto` + `max-height: min(80vh, calc(100dvh - 32px))`). Не трогать табы, pane scrollbar, support/about, motion.
- `src/widgets/settings-dialog/settingsDialogHeight.test.ts` — новый unit: `.dialog` не `height: auto`; высота шелла закреплена на текущем cap (`min(80vh, calc(100dvh - 32px))`); pane по-прежнему может скроллиться (`overflow-y: auto` у `.panelPane[data-active="true"]`).

Файл этой задачи разрешён неявно.

### Разрешённые типы изменений

- Заменить `height: auto` у `.dialog` на фиксированную высоту, равную уже существующему `max-height` (`min(80vh, calc(100dvh - 32px))`), либо эквивалент `height` + `min-height` = этому cap, чтобы оболочка не сжималась и не росла от длины строк.
- Контент остаётся в `.panelPane` со `overflow-y: auto`.
- Добавить targeted-тест, читающий SCSS (без запуска UI).
- Русский комментарий у `.dialog` только если иначе неочевидно, почему высота = cap.

### Запрещённые файлы и операции

- `SettingsDialog.tsx` (C-004 / C-003 вне scope)
- Другие диалоги с `height: auto` (Rename, PhotoProperties, …) — не этот пакет
- `ui-catalog/modals/` скрины — C-002
- i18n, IPC, SQLite, `src-tauri`, scheduler, `pick_index`
- Правка `package.json` test-списка
- Пользовательские фото / боевая БД
- `git worktree`, push, merge в `main`

### Зависимости задачи

- Блокируется: нет (T001–T004 закрыты; C-001 закрыт)
- Требует согласования coordinator: нет
- Следующий пакет после PASS: C-004 (`TASK` отдельный)

## 3. Business invariants

- [ ] Исходные фото не изменяются без явной операции пользователя
- [ ] Копирование в избранное не удаляет оригиналы
- [ ] Переименование папки избранного сохраняет согласованное UX
- [ ] copy/move/delete обрабатывают ошибки без ложного успеха в UI/БД
- [ ] События старой сессии галереи не меняют состояние новой (`directorySession`)
- [ ] Порядок и группировка фото — текущая семантика (`galleryOrder`, `folderOrder`)
- [ ] Приоритеты очереди миниатюр без изменений

Дополнительно: ширина `.dialog` и `max-height` cap не менять; вкладки и pane layout сохранить. Не смешивать с C-004.

## 4. Acceptance criteria

### Должно измениться

- Пока Настройки открыты, высота шелла `.dialog` не зависит от длины строк локали (ru/en/de/zh-Hans).
- `.dialog` больше не `height: auto`.

### Должно остаться неизменным

- TSX Настроек, вкладки, Support/About, i18n, остальные модалки.
- Скролл длинного pane внутри диалога.
- Галерея, избранное, IPC.

### Автоматические проверки

- `node --experimental-strip-types --test src/widgets/settings-dialog/settingsDialogHeight.test.ts`

### Ручная проверка (smoke)

- [x] N/A для этого этапа
- [ ] Быстрое переключение папок не показывает фотографии предыдущей
- [ ] Сортировка сохраняет ожидаемый порядок
- [ ] Скролл и загрузка миниатюр не блокируют интерфейс
- [ ] Добавление в избранное не изменяет оригинал
- [ ] Удаление и перемещение не затрагивают файлы вне выбранного набора
- [ ] Переименование папки избранного соответствует утверждённой бизнес-логике

### Защита пользовательских данных

- Только fixture/unit (чтение SCSS). Пользовательские фото не трогать.

### Блокирующие условия

- `--preflight` FAIL; diff вне `allowed_paths`; правка TSX/других модалок/i18n

## 5. Rollback

1. Не трогать чужие незакоммиченные файлы.
2. `git restore --source=5ca47fc2930ceb95d746eb4f8001e16173bebf16 --` файлы из `allowed_paths`.
3. `git status` + тесты §4.
4. Не `reset --hard` / `git clean` без запроса владельца.

## 6. Уровень риска и проверки

low: executor → targeted test → `--strict`. По мастер-задаче 003 всё равно: code-auditor + regression-guardian после PASS исполнителя. Smoke канона N/A.

## 7. Отчёт исполнителя (после работы)

(заполняет executor)
