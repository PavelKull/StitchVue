# Baseline: расход контекста AI-инфраструктуры StitchVue

Дата замера: 2026-10-20 (до оптимизации по ТЗ «Оптимизация расхода токенов»).

## AlwaysApply rules (`.cursor/rules/`)

| Файл | alwaysApply (до) | Строк (до) |
|------|------------------|------------|
| `token-efficiency.mdc` | true | 17 |
| `safe-refactoring.mdc` | true | 21 |
| `business-invariants.mdc` | true | 27 |
| `git-branch-workflow.mdc` | true | 79 |
| `git-commits.mdc` | true | 52 |
| `code-comments.mdc` | true + globs | 40 |
| `fsd-decomposition.mdc` | true | 24 |
| `rust-backend-architecture.mdc` | false (globs `src-tauri/**/*.rs`) | 77 |

**Итого alwaysApply (до):** 7 файлов, **~261 строка** в каждом чате.

**Дублирование:** гейты TASK (`--preflight` / `--auth` / `--strict`), маршруты риска, запрет worktree, лимиты поиска и отчётов — в `safe-refactoring`, `token-efficiency`, `TASK_HANDOFF.md` и промптах всех executors.

## Агенты (`.cursor/agents/`)

| Агент | Размер (символы, оценка) | Стартовое чтение (до) |
|-------|--------------------------|------------------------|
| architecture-coordinator | ~5.5k | docs/audit/, HANDOFF по ссылке |
| frontend-decomposition | ~4k | HANDOFF, правила |
| backend-decomposition | ~4k | HANDOFF, rust-architecture |
| frontend-executor | ~6.5k | **7 rule-файлов** + TASK + HANDOFF |
| backend-executor | ~6k | **6 rule-файлов** + TASK + HANDOFF |
| code-auditor | ~4k | модуль по запросу |
| regression-guardian | ~4k | diff + отчёт executor |

**Семь ролей**, ~32 KB суммарно в файлах (не весь контекст каждый раз).

## Skills (`.cursor/skills/`)

| Категория | Кол-во | Примечание |
|-----------|--------|------------|
| Всего `SKILL.md` | 24 | ~166 KB на диске |
| Speckit | 10 | Полный lifecycle `specs/`; не нужен для обычного TASK |
| Ежедневные | 3–4 | refactor-safely, bug-investigation, pre-commit-review |
| Узкий review | 5 | react, rust, cache, gallery-layout, security |
| Прочие | 5+ | implement-feature, docs-sync, release, performance, hdd, dependency |

Описания skills попадают в каталог Cursor (system prompt). Speckit и review частично дублируют subagents.

## Документация рефакторинга (`docs/refactoring/`)

| Тип | Файлов (оценка) | Объём |
|-----|-----------------|-------|
| Операционные | HANDOFF, TEMPLATE, VERIFICATION, `tasks/*` | обязательны |
| Исторические отчёты | 8+ (*_REPORT, *_PLAN, HISTORY_*) | ~150+ KB, риск полного чтения |

Агентам не нужен полный архив для типовой TASK.

## Проверки по риску (`TASK_HANDOFF.md`)

| Риск | Маршрут |
|------|---------|
| low | executor + адресные тесты; guardian опционален |
| medium | decomposition (при необходимости) → executor → guardian |
| high | auditor/decomposition → executor → guardian → ручной smoke |

Гейты: `scripts/refactor-task-check.mjs` (`--seal`, `--preflight`, `--auth`, `--strict`, `--run-tests`).

## Frontend-тесты (`package.json`)

| Показатель | Значение (до) |
|------------|---------------|
| Файлов `*.test.ts` в `src/` | 73 |
| Путей в `npm test` (явный список) | ~68 |
| Дубликат в списке | `galleryEmptyState.test.ts` ×2 |
| **Вне `npm test`** | `favoritesDiskTruthAfterIpc.test.ts`, `favoritesReconcile.test.ts`, `mapRemovalToUiRoute.test.ts`, `useGallerySelectionCoordinator.test.ts`, `settingsDialogHeight.test.ts` |

Rust: inline `#[cfg(test)]` в ~27 модулях `src-tauri/` (отдельный `cargo test`).

## Кандидаты на оптимизацию (P1–P6)

1. Сократить alwaysApply до одного ядра + контекстные rules по globs.
2. Убрать обязательное перечитывание всех rules в executors.
3. `SKILLS_INDEX.md` + пометки Speckit «не для TASK».
4. `docs/refactoring/INDEX.md` + архив отчётов со stub-ссылками.
5. Discovery тестов через `scripts/run-frontend-tests.mjs`; `test:critical` / `test:full`.
6. Шаблоны промптов в `docs/ai-optimization/PROMPT_TEMPLATES.md`.

## Метрики «после»

См. [`RESULTS.md`](RESULTS.md) после завершения P1–P7.
