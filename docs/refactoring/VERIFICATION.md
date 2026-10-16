# Сценарии верификации системы агентов

Ручная проверка после изменений инфраструктуры `.cursor/` и `scripts/refactor-task-check.mjs` (без правок кода приложения, кроме пилотного TASK).

Маршруты: [`TASK_HANDOFF.md`](TASK_HANDOFF.md). Риск — по инвариантам, не по числу файлов.

## 1. Low — чистый хелпер (пилот)

- Задача: перенос **чистой** функции/константы/типа из крупного модуля (не `directorySession`, не хуки с эффектами, не IPC).
- `risk: low`, `status: approved`, `base_commit` = HEAD, `allowed_paths` узкие.
- Пользователь: `approved` + `base_commit` + `--seal`; `--preflight` OK на чистом дереве; отказ при `draft` и при голом `in_progress`.
- Смена `allowed_paths` без нового `--seal` → `--auth` FAIL.
- **frontend-executor**: не вызывает `--seal`; `--strict` + параметризованные тесты; без guardian, если diff локальный.

Ожидание: отказ писать при `draft`; FAIL `--strict` при файле вне scope.

## 2. Medium — hooks / lifecycle

- **frontend-decomposition** (coordinator не обязателен, если нет IPC).
- Пример: узкий виджет в `src/widgets/gallery-grid/`, без смены контрактов.
- `risk: medium`, tests: typecheck + `*.test.ts`, smoke по затронутому инварианту.
- После diff — **regression-guardian**. Извлечение сессии/эффектов не маскировать как low.

## 3. High — Rust / ФС (сначала только анализ)

- **code-auditor** или **backend-decomposition** на модуль файловых операций: partial failure, fixture-only.
- `risk: high`, `status: draft` до явного `approved`.
- Executor не запускать без `--preflight` и запрета пользовательских каталогов.
- После кода: guardian + ручной smoke пунктов 4–5 из HANDOFF.

## 4. Гейты скрипта (без агента)

```bash
node --test scripts/refactor-task-check.test.mjs
node scripts/refactor-task-check.mjs docs/refactoring/tasks/TASK-EXAMPLE-000.md
node scripts/refactor-task-check.mjs docs/refactoring/tasks/TASK-VERIFY-LOW.md --seal
node scripts/refactor-task-check.mjs docs/refactoring/tasks/TASK-VERIFY-LOW.md --preflight
node scripts/refactor-task-check.mjs docs/refactoring/tasks/TASK-VERIFY-LOW.md --auth
node scripts/refactor-task-check.mjs docs/refactoring/tasks/TASK-VERIFY-LOW.md --strict
```

- `--preflight` при dirty `allowed_paths` → FAIL; при `in_progress` → FAIL.
- `--seal` при не-`approved` → FAIL.
- Чужой unstaged вне scope без `--allow-unrelated-dirty` → FAIL.
- `--strict` после записи вне scope → FAIL.
- `--auth` при `blocked`/`draft` или без/`битой` печати → FAIL.

## Критерий успеха

Агенты ссылаются на шаблон и HANDOFF, не запускают полную цепочку на low, останавливаются при scope/инварианте, отчёты ≤ 500 слов, пользовательские файлы не трогают.
