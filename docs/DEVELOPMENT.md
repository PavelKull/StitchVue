# Разработка StitchVue

Команды и структура репозитория. Архитектура: [`ARCHITECTURE.md`](ARCHITECTURE.md). Краткий engineering overview (EN): [`ENGINEERING.md`](ENGINEERING.md). Безопасный рефакторинг: [`refactoring/TASK_HANDOFF.md`](refactoring/TASK_HANDOFF.md), шаблон [`refactoring/TASK_TEMPLATE.md`](refactoring/TASK_TEMPLATE.md).

## Git: один checkout, много веток

Рабочий процесс — один клон репозитория и обычные ветки (`feat/*`, `fix/*`, `refactor/*`, `chore/*`, `docs/*`), без дополнительных worktree/клонов «для изоляции». Перед сменой ветки — чистый `git status` или явное согласование незакоммиченных изменений. Внутренние правила для AI-агентов (если используете Cursor): [`.cursor/rules/`](../.cursor/rules/).

## Запуск

```text
npm install
npm run tauri dev
```

Первая сборка Rust может занять несколько минут. Только Vite (без Tauri): `npm run dev`.

## Проверки

| Команда | Назначение |
|---------|------------|
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` / `npm run test:full` | Все `src/**/*.test.ts` через `scripts/run-frontend-tests.mjs` |
| `npm run test:critical` | Инварианты I1–I8 (список в скрипте) |
| `npm run i18n-check` | Согласованность локалей |
| `npm run task-check -- <path/to/TASK.md>` | Lint / гейты задачи рефакторинга |
| `npm run task-check-test` | Тесты скрипта `refactor-task-check` |
| `npm run build` | `tsc` + Vite production build |

Rust (из `src-tauri/`, пример): `cargo test`, `cargo check` — точечно по модулю задачи.

## Адресные тесты

Полный `npm test` обнаруживает все `*.test.ts` под `src/`. Для одного файла:

```text
node --experimental-strip-types --test path/to/file.test.ts
```

```text
node --experimental-strip-types --test src/features/gallery/lib/directory/directorySession.test.ts
```

Примеры критичных тестов: `directorySession.test.ts`, `galleryOrder.test.ts`, `folderOrder.test.ts`, `favoriteOptimistic*.test.ts`, `removeFavoritesBatch.test.ts`.

Гейты задачи: `node scripts/refactor-task-check.mjs docs/refactoring/tasks/TASK-….md --preflight` / `--auth` / `--strict` / `--seal` — см. HANDOFF.

## Структура каталогов

```text
src/                 React (app, pages, widgets, features, entities, shared)
src-tauri/src/       Rust (lib, commands, pipeline, thumbnail, cache, scanner, file_ops, …)
docs/                Техническая документация (этот каталог)
docs/refactoring/    Процесс безопасного рефакторинга
docs/stabilization/  Журнал багов и smoke-заметки
.cursor/             Опционально: правила/skills для AI-ассистентов в Cursor
scripts/             node-утилиты (task-check, i18n-check)
```

## Документация

| Файл | Содержание |
|------|------------|
| [`ENGINEERING.md`](ENGINEERING.md) | Краткий case study (EN) |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Модули и потоки |
| [`INVARIANTS.md`](INVARIANTS.md) | Бизнес-инварианты |
| [`IPC.md`](IPC.md) | Команды и события |
| [`DEVELOPMENT.md`](DEVELOPMENT.md) | Этот файл |
| [`stabilization/BUGS.md`](stabilization/BUGS.md) | Maintainer bug journal |
| [`refactoring/TASK_HANDOFF.md`](refactoring/TASK_HANDOFF.md) | Гейты рефакторинга |

После архитектурных изменений обновлять docs через skill `docs-sync` (пути в `.cursor/skills/docs-sync/SKILL.md`).
