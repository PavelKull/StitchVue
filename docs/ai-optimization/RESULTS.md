# Результаты оптимизации AI-инфраструктуры (P1–P7)

Дата: 2026-10-20. Baseline: [`BASELINE.md`](BASELINE.md).

## Метрики

| Показатель | До | После |
|------------|-----|--------|
| Файлов rules с `alwaysApply: true` | 7 | **1** (`stitchvue-core.mdc`) |
| Строк alwaysApply (сумма) | ~261 | **46** |
| Дубли token/HANDOFF/safe в каждом чате | 3 полных копии | 1 ядро + контекстные rules |
| Frontend-тестов в `npm test` (discovery) | ~68 явных путей, 5 вне списка | **73 файла**, 461 test cases |
| `test:critical` | нет | **15 файлов**, 127 cases (I1–I8) |
| Индекс refactoring | нет | [`docs/refactoring/INDEX.md`](../refactoring/INDEX.md) |
| Архив отчётов | в корне `docs/refactoring/` | `docs/refactoring/archive/` + stub-редиректы |
| SpecKit skills помечены «не для TASK» | нет | 10/10 descriptions |
| Executors: «прочитай 7 rules» | да | TASK → HANDOFF; rules по glob / без перечитывания |

Точный % экономии токенов Cursor **не измерялся** (нет одинаковых контрольных чатов до/после в IDE). Сокращение alwaysApply ~**82% по строкам** — верхняя оценка постоянного налога на правила, не на весь prompt.

## Изменённые файлы инфраструктуры

### Rules (`.cursor/rules/`)

- **Добавлен:** `stitchvue-core.mdc` (единственный alwaysApply).
- **Контекстные:** `safe-refactoring`, `business-invariants`, `fsd-decomposition`, `code-comments` — `alwaysApply: false` + globs.
- **По запросу / сценарию:** `git-branch-workflow`, `git-commits`, `token-efficiency` (stub → core).

### Агенты (7 файлов)

- Единая политика контекста: TASK → HANDOFF → `allowed_paths`; `INDEX.md`; без перечитывания rules; без архива целиком.

### Skills

- [`SKILLS_INDEX.md`](../../.cursor/skills/SKILLS_INDEX.md).
- SpecKit: уточнённые `description` (только `specs/`, не TASK).
- `refactor-safely`: граница с TASK/SpecKit.

### Документация

- `docs/ai-optimization/BASELINE.md`, `RESULTS.md`, `PROMPT_TEMPLATES.md`.
- `docs/refactoring/INDEX.md`, `archive/*`, stub-файлы в корне refactoring.
- `TASK_HANDOFF.md`, `TASK_TEMPLATE.md` — ссылки на test scripts.

### Тесты

- `scripts/run-frontend-tests.mjs`
- `package.json`: `test`, `test:full`, `test:critical`

## Устранённые источники расхода

1. Семь alwaysApply rules → одно ядро безопасности и экономии.
2. Обязательное «прочитай все rules» у executors.
3. Явный хрупкий список тестов в package.json.
4. Отсутствие навигации по историческим отчётам (риск полного чтения).
5. Неявный запуск SpecKit там, где достаточно TASK.

## Маршруты агентов

Без изменения семантики HANDOFF: low / medium / high и guardian/auditor как раньше. Уточнено: не вызывать coordinator+auditor+guardian одновременно; не читать archive целиком.

## test:critical vs test:full

| Команда | Назначение |
|---------|------------|
| `npm run test:critical` | 15 файлов из `CRITICAL_REL` в `run-frontend-tests.mjs` (I1–I8 + reconcile/dispatch FE) |
| `npm run test:full` / `npm test` | Все `src/**/*.test.ts` (73 файла) |

Rust: без изменений; `cargo test` по процессу TASK.

## Проверки (выполнены)

| Проверка | Результат |
|----------|-----------|
| `npm run test:critical` | PASS (127) |
| `npm test` (full) | PASS (461) |
| `npm run task-check-test` | PASS (15) |

## Оставшиеся риски и ограничения

- **Git-правила** не в alwaysApply: при git-операциях без открытых файлов агент должен опираться на ядро и `git-branch-workflow.mdc` по необходимости.
- **I9** (миниатюры) по-прежнему UNVERIFIED; сокращение Rust-тестов не выполнялось.
- **Каталог skills** в system prompt Cursor по-прежнему содержит все descriptions; индекс снижает *чтение тел* skills, не размер каталога IDE.
- Процент экономии токенов на реальных задачах — замерить вручную по [`PROMPT_TEMPLATES.md`](PROMPT_TEMPLATES.md) и контрольным сценариям A–D из ТЗ.

## Контрольные сценарии (ручная верификация)

| Сценарий | Ожидание | Статус |
|----------|----------|--------|
| A Low UI | Нет полного аудита в промптах/правилах | Заложено в core + PROMPT_TEMPLATES |
| B Medium gallery | Guardian + тесты | HANDOFF без изменений |
| C High Rust | Гейты + guardian | HANDOFF без изменений |
| D SpecKit | Skills доступны с пометкой | descriptions обновлены |
