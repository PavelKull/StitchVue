# Индекс документации рефакторинга

Читать **этот файл** перед историческими отчётами. Не загружать `archive/` целиком.

## Операционные (актуальны)

| Документ | Назначение | Когда читать |
|----------|------------|--------------|
| [`TASK_HANDOFF.md`](TASK_HANDOFF.md) | Маршруты low/medium/high, гейты, smoke | Любая TASK-задача |
| [`TASK_TEMPLATE.md`](TASK_TEMPLATE.md) | Шаблон новой задачи | Создание TASK |
| [`VERIFICATION.md`](VERIFICATION.md) | Ручная проверка инфраструктуры агентов | Изменения `.cursor/` или `refactor-task-check` |
| [`tasks/`](tasks/) | Утверждённые и черновые TASK | Конкретная задача по пути |
| [`../INVARIANTS.md`](../INVARIANTS.md) | I1–I10, опора на тесты | Medium/high, избранное, сессии, ФС |

## AI-оптимизация

| Документ | Назначение |
|----------|------------|
| [`../ai-optimization/BASELINE.md`](../ai-optimization/BASELINE.md) | Baseline контекста (до/после) |
| [`../ai-optimization/RESULTS.md`](../ai-optimization/RESULTS.md) | Итоги оптимизации |
| [`../ai-optimization/PROMPT_TEMPLATES.md`](../ai-optimization/PROMPT_TEMPLATES.md) | Короткие промпты пользователя |

## Исторические (только по необходимости)

Статус: **архив**. Открывать **один** файл по ссылке, не весь каталог.

| Документ | Назначение |
|----------|------------|
| [`archive/GALLERY_FSD_DECOMPOSITION_PLAN.md`](archive/GALLERY_FSD_DECOMPOSITION_PLAN.md) | План декомпозиции Gallery FSD |
| [`archive/GALLERY_FSD_MAJOR_REFACTOR_REPORT.md`](archive/GALLERY_FSD_MAJOR_REFACTOR_REPORT.md) | Отчёт major refactor галереи |
| [`archive/FSD_FOLDER_RESTRUCTURE_REPORT.md`](archive/FSD_FOLDER_RESTRUCTURE_REPORT.md) | Отчёт реструктуризации folder |
| [`archive/RUST_ARCHITECTURE_AUDIT.md`](archive/RUST_ARCHITECTURE_AUDIT.md) | Аудит Rust-архитектуры |
| [`archive/RUST_FIX_C1C2_REPORT.md`](archive/RUST_FIX_C1C2_REPORT.md) | Отчёт FIX-C1C2 |
| [`archive/FAVORITES_TRASH_LIFECYCLE_REPORT.md`](archive/FAVORITES_TRASH_LIFECYCLE_REPORT.md) | Промежуточный отчёт favorites/trash |
| [`archive/FAVORITES_TRASH_LIFECYCLE_FINAL_REPORT.md`](archive/FAVORITES_TRASH_LIFECYCLE_FINAL_REPORT.md) | Финальный отчёт favorites/trash |
| [`archive/HISTORY_REWRITE_2026-10-16.md`](archive/HISTORY_REWRITE_2026-10-16.md) | Инцидент TASK-2026-003 / hash |

Устаревшие пути в корне `docs/refactoring/*.md` (без `archive/`) — stub-перенаправления на `archive/`.
