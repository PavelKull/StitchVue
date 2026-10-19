# Разработка StitchVue

Команды и структура репозитория. Архитектура: [`ARCHITECTURE.md`](ARCHITECTURE.md). Безопасный рефакторинг: [`refactoring/TASK_HANDOFF.md`](refactoring/TASK_HANDOFF.md), шаблон [`refactoring/TASK_TEMPLATE.md`](refactoring/TASK_TEMPLATE.md).

## Git: один каталог, много веток

Канон для агентов и людей: [`.cursor/rules/git-branch-workflow.mdc`](../.cursor/rules/git-branch-workflow.mdc).

- Рабочий checkout: `C:\Users\Pavel\Desktop\ImageGrid`. Задачи — в обычных ветках (`feat/*`, `fix/*`, `refactor/*`, `chore/*`, `docs/*`).
- Не создавать `git worktree`, дополнительные папки рядом с `ImageGrid` или клоны «для изоляции» без явного разрешения владельца.
- Spec-Kit и рефакторинг выполняются в текущем checkout; крупный рефакторинг — та же папка, отдельная ветка.
- Перед сменой ветки: чистый `git status` или согласование владельца (без auto-stash / worktree как обхода dirty tree).

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
| `npm test` | Все frontend unit-тесты из `package.json` → `scripts.test` |
| `npm run i18n-check` | Согласованность локалей |
| `npm run task-check -- <path/to/TASK.md>` | Lint / гейты задачи рефакторинга |
| `npm run task-check-test` | Тесты скрипта `refactor-task-check` |
| `npm run build` | `tsc` + Vite production build |

Rust (из `src-tauri/`, пример): `cargo test`, `cargo check` — точечно по модулю задачи.

## Адресные тесты

Полный `npm test` гоняет фиксированный список файлов. Для одного файла:

```text
node --experimental-strip-types --test path/to/file.test.ts
```

или (если runner принимает путь через npm test argv в вашей среде):

```text
npm test -- src/features/gallery/directorySession.test.ts
```

Примеры критичных тестов: `directorySession.test.ts`, `galleryOrder.test.ts`, `folderOrder.test.ts`, `favoriteOptimistic*.test.ts`, `removeFavoritesBatch.test.ts`.

Гейты задачи: `node scripts/refactor-task-check.mjs docs/refactoring/tasks/TASK-….md --preflight` / `--auth` / `--strict` / `--seal` — см. HANDOFF.

## Структура каталогов

```text
src/                 React (app, pages, widgets, features, entities, shared)
src-tauri/src/       Rust (lib, commands, pipeline, thumbnail, cache, scanner, file_ops, …)
docs/                Техническая документация (этот каталог)
docs/refactoring/    Процесс задач агентов
.cursor/rules/       Always-on правила агентов (в т.ч. git-branch-workflow)
.cursor/agents/      Специализированные агенты
.cursor/skills/      Skills (в т.ч. docs-sync)
scripts/             node-утилиты (task-check, i18n-check)
```

## Документация

| Файл | Содержание |
|------|------------|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Модули и потоки |
| [`INVARIANTS.md`](INVARIANTS.md) | Бизнес-инварианты |
| [`IPC.md`](IPC.md) | Команды и события |
| [`DEVELOPMENT.md`](DEVELOPMENT.md) | Этот файл |
| [`refactoring/TASK_HANDOFF.md`](refactoring/TASK_HANDOFF.md) | Маршруты агентов / гейты |

После архитектурных изменений обновлять docs через skill `docs-sync` (пути в `.cursor/skills/docs-sync/SKILL.md`).
