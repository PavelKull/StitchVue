# Шаблоны экономных промптов

Правила и HANDOFF уже в проекте (`stitchvue-core`, TASK-файл). Не дублируйте длинные инструкции в чате.

## Небольшая задача (low)

```text
Выполни docs/refactoring/tasks/TASK-XXX.md по TASK_HANDOFF. Маршрут low, если задача это допускает. Без повторного аудита и без coordinator. Краткий отчёт (100–200 слов).
```

## Средняя задача (medium)

```text
Выполни docs/refactoring/tasks/TASK-XXX.md по TASK_HANDOFF. Соблюди гейты и guardian. Только нужный контекст; отчёт до 200 слов.
```

## High (Rust / file ops)

```text
Выполни docs/refactoring/tasks/TASK-XXX.md. High-risk: preflight/auth/strict, guardian, fixture-only. Не трогать пользовательские каталоги. Краткий отчёт + NEXT.
```

## Read-only аудит

```text
Read-only аудит <подсистема>. Код не менять. rg/glob, адресное чтение. Только подтверждённые находки. 300–500 слов.
```

## Исправление ошибки

```text
Симптом: <…>. Минимальная причина, минимальный diff, проверки из TASK или npm run test:critical + адресный тест. Без расширения scope.
```

## SpecKit feature (не TASK)

```text
Работа по specs/<feature>/: укажи этап (specify/plan/tasks/implement). SpecKit skills допустимы. TASK-рефакторинг не смешивать.
```

## AI-инфраструктура

```text
Изменения только в .cursor/, docs/ai-optimization/, scripts/run-frontend-tests.mjs, package.json test scripts. Без правок бизнес-логики приложения.
```
