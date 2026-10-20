---
task_id: TASK-2026-003-C004-support
title: Вкладка «Поддержать» — звезда GitHub и иконки кнопок (C-004)
status: approved
risk: medium
responsible_agent: frontend-executor
base_commit: "dac9720728fbf5ff50cb4da5cc110795d17766b6"
approval_hash: bd9f2aafd49ebab78f7087fa9cf93769ee597041b91d18992e192212702362b7
allowed_paths:
  - src/widgets/settings-dialog/SettingsDialog.tsx
  - src/widgets/settings-dialog/SettingsDialog.module.scss
  - src/shared/i18n/locales/ru.json
  - src/shared/i18n/locales/en.json
  - src/shared/i18n/locales/de.json
  - src/shared/i18n/locales/zh-Hans.json
forbidden_paths:
  - src-tauri/**
  - src/pages/gallery/**
  - src/features/gallery/**
  - src/features/app-update/**
  - src/shared/icons/**
tests:
  - npm run i18n-check
  - npm test -- src/shared/i18n/__tests__/catalog.test.ts
---

# Задача: Вкладка «Поддержать» — звезда GitHub и иконки кнопок (C-004)

Пакет US9 / T010–T011 из `specs/003-pre-release-stabilization/tasks.md`. Источник: `BUGS.md` C-004, spec US9.

Не вызывать GitHub Star API. Не менять About. Комментарии в изменённом коде — только на русском.

## 1. Метаданные

| Поле | Значение |
|------|----------|
| ID | `TASK-2026-003-C004-support` |
| Название | Вкладка «Поддержать» — звезда GitHub и иконки кнопок (C-004) |
| Статус | `approved` |
| Риск | `medium` — JSX `SupportPanel`, без IPC/ФС |
| Ответственный агент | `frontend-executor` |
| База Git | `dac9720728fbf5ff50cb4da5cc110795d17766b6` |
| Рабочий каталог | `C:\Users\Pavel\Desktop\ImageGrid` |
| Ветка исполнения | `feat/003-pre-release-stabilization` |
| Печать | `bd9f2aafd49ebab78f7087fa9cf93769ee597041b91d18992e192212702362b7` |

## 2. Scope

### Разрешённые файлы и каталоги

- `src/widgets/settings-dialog/SettingsDialog.tsx` — **только** `SupportPanel` и локальные хелперы внутри файла для кнопок вкладки support; не рефакторить About/другие панели.
- `src/widgets/settings-dialog/SettingsDialog.module.scss` — стили кнопок support (можно переиспользовать `.aboutAction*` + узкий модификатор ширины).
- `src/shared/i18n/locales/{ru,en,de,zh-Hans}.json` — ключи `settings.support.githubMeta`, `settings.support.githubStarButton` (и при необходимости заголовок карточки через i18n).

### Разрешённые типы изменений

- Третья карточка GitHub на вкладке support: действие «поставить звезду» открывает репозиторий через `openExternalLink("github_repo")` при наличии `GITHUB_REPO_URL`.
- Иконки `StitchVueIcon` на всех кнопках вкладки (CloudTips, Boosty, GitHub) — без сторонних логотипов.
- Чекбокс `hideReminders` и `setSupportReminderNeverShowAgain` без изменения поведения.
- Паритет 4 локалей (`i18n-check`).

### Запрещённые файлы и операции

- Новые иконки / правка `src/shared/icons/**`
- About panel, C-003 mock updater
- `ui-catalog/` (C-002)
- IPC, SQLite, `src-tauri`, галерея
- GitHub Star API
- Пользовательские фото / боевая БД
- `git worktree`, push, merge в `main`

### Зависимости задачи

- Блокируется: нет (B-010 закрыт)
- Следующий пакет после PASS: MVP B-001 или параллельный C-002 по плану

## 3. Business invariants

- [ ] Исходные фото не изменяются без явной операции пользователя
- [ ] Копирование в избранное не удаляет оригиналы
- [ ] Переименование папки избранного сохраняет согласованное UX
- [ ] copy/move/delete обрабатывают ошибки без ложного успеха в UI/БД
- [ ] События старой сессии галереи не меняют состояние новой (`directorySession`)
- [ ] Порядок и группировка фото — текущая семантика (`galleryOrder`, `folderOrder`)
- [ ] Приоритеты очереди миниатюр без изменений

## 4. Acceptance criteria

### Должно измениться

- На вкладке support есть карточка GitHub с действием star (открытие репо в браузере).
- У кнопок CloudTips, Boosty и GitHub есть `StitchVueIcon`.
- Новые строки i18n во всех 4 локалях.

### Должно остаться неизменным

- About → «Репозиторий на GitHub» как было.
- Чекбокс «Не показывать напоминания о поддержке».
- Остальные вкладки Настроек, галерея, IPC.

### Автоматические проверки

- `npm run i18n-check`
- `npm test -- src/shared/i18n/__tests__/catalog.test.ts`

### Ручная проверка (smoke)

- [x] N/A для канона (точечная проверка support в §7)
- [ ] Быстрое переключение папок не показывает фотографии предыдущей
- [ ] Сортировка сохраняет ожидаемый порядок
- [ ] Скролл и загрузка миниатюр не блокируют интерфейс
- [ ] Добавление в избранное не изменяет оригинал
- [ ] Удаление и перемещение не затрагивают файлы вне выбранного набора
- [ ] Переименование папки избранного соответствует утверждённой бизнес-логике

### Защита пользовательских данных

- Только UI/i18n. Пользовательские фото не трогать.

### Блокирующие условия

- `--preflight` FAIL; diff вне `allowed_paths`; новые иконки в manifest

## 5. Rollback

1. Не трогать чужие незакоммиченные файлы.
2. `git restore --source=dac9720728fbf5ff50cb4da5cc110795d17766b6 --` файлы из `allowed_paths`.
3. `git status` + тесты §4.
4. Не `reset --hard` / `git clean` без запроса владельца.

## 6. Уровень риска и проверки

medium: executor → i18n-check → `--strict` → code-auditor → regression-guardian.

## 7. Отчёт исполнителя (после работы)

(заполняет executor)
