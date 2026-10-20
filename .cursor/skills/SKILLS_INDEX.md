# Индекс project skills (StitchVue)

Skills подключаются по описанию в Cursor; **не** вызывать несколько review-skills на одну задачу.

## Ежедневные

| Skill | Когда | Не использовать |
|-------|--------|-----------------|
| `refactor-safely` | Перенос/разбиение без смены поведения | Новые фичи |
| `bug-investigation` | Симптом → минимальная причина | Массовый аудит |
| `pre-commit-review` | Перед коммитом / закрытием этапа | Вместо guardian на medium/high TASK |

## Узкий review (один на задачу)

| Skill | Область |
|-------|---------|
| `react-review` | React, hooks, gallery UI |
| `rust-review` | `src-tauri`, blocking, concurrency |
| `cache-review` | Thumbnail cache, SQLite eviction |
| `gallery-layout-review` | Justified layout, zoom, virtualization |
| `security-review` | Paths, capabilities, SQL (или subagent Security Review по запросу) |

## Специализированные

| Skill | Когда |
|-------|--------|
| `hdd-performance` | Scanner, scheduler, HDD-профиль |
| `performance-audit` | FPS, память, 50k images |
| `dependency-evaluator` | Новая npm/Cargo зависимость |
| `implement-feature` | Вертикальный срез фичи по spec |
| `docs-sync` | Синхрон ARCHITECTURE / INVARIANTS / IPC |
| `release-windows` | Stage 16, installer |

## SpecKit (только lifecycle `specs/`)

**Не использовать** для обычного TASK из `docs/refactoring/tasks/`.

| Skill | Этап |
|-------|------|
| `speckit-specify` | Спека из идеи |
| `speckit-clarify` | Уточнения |
| `speckit-plan` | План |
| `speckit-tasks` | tasks.md |
| `speckit-analyze` | Согласованность артефактов |
| `speckit-checklist` | Чеклист |
| `speckit-constitution` | Constitution |
| `speckit-converge` | Добивка tasks |
| `speckit-implement` | Реализация по tasks.md |
| `speckit-taskstoissues` | Issues (deprecated path) |

TASK-рефакторинг: `TASK_HANDOFF.md` + sealed TASK, без SpecKit pipeline.
