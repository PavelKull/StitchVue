# FSD folder restructure — отчёт

**Ветка:** `refactor/fsd-folder-structure`  
**База:** `refactor/gallery-fsd-major` @ `af9e4cc`  
**Дата:** 2026-10-16  
**Тип:** структурный рефакторинг frontend (без изменения поведения)

## Роли агентов (фактическое исполнение)

Субагенты **не запускались**. Работы выполнены одним исполнителем по их регламентам:

| Агент | Участие |
|--------|---------|
| architecture-coordinator | Карта сегментов `lib` / `model` / `api` / `ui`, порядок: gallery → остальные features → импорты → проверки |
| frontend-decomposition | Классификация модулей по ответственности (directory, viewport, listing, pipeline, …) |
| frontend-executor | `git mv`, правка импортов, `package.json` test paths |
| code-auditor | Сверка с `.cursor/rules/fsd-decomposition.mdc`; typecheck; нет новых циклов на уровне tsc |
| regression-guardian | `npm test` (398), `npm run typecheck`; scope только `src/` + `package.json` + `scripts/` |

## Исходная vs итоговая структура (кратко)

### Было

Плоские корни срезов: десятки `.ts` в `src/features/gallery/`, аналогично `favorites/`, `selection/`, `settings/`, `folder/`, `app-fullscreen/`, …

### Стало (gallery — эталон)

```text
src/features/gallery/
├── api/                    # IPC (включая pipelineStats)
├── lib/
│   ├── boot/
│   ├── cache/
│   ├── chrome/
│   ├── directory/
│   ├── indexing/
│   ├── listing/
│   ├── pipeline/
│   ├── thumbnails/
│   ├── viewer/
│   └── viewport/
├── model/
│   ├── boot/
│   ├── chrome/
│   ├── directory/
│   ├── indexing/
│   ├── pipeline/
│   └── viewport/
├── useGalleryThumbProgress.ts      # оставлен в корне (см. ниже)
├── useGalleryThumbProgress.test.ts
└── (без index.ts — прямые импорты)
```

### Другие срезы

| Срез | Сегменты |
|------|-----------|
| `favorites` | `lib/` |
| `selection` | `lib/`, `ui/SelectionDiagOverlay.tsx` |
| `settings` | `lib/`, `api/` (openExternalLink, reportProblem) |
| `folder` | `lib/` |
| `app-fullscreen` | `model/`, `lib/` |
| `support-reminder` | `model/`, `lib/` |
| `select-folder` | `lib/` |

**Не менялись:** `src/pages/gallery/GalleryPage.tsx` (только импорты), `src/widgets/*` (только импорты), `src/entities/*`, `src/shared/*` (кроме путей в потребителях), `src-tauri/`, `trash/` (один файл — импорт).

## Таблица перемещений (сводка)

Полный список — `git diff --name-status HEAD` по `src/features/`. Основные группы:

| Было | Стало |
|------|--------|
| `gallery/*.ts` (lib-логика) | `gallery/lib/<domain>/…` |
| `gallery/useGallery*.ts` (hooks) | `gallery/model/<domain>/…` |
| `gallery/galleryPipelineEvents.ts` | `gallery/model/pipeline/…` |
| `gallery/pipelineStats.ts` | `gallery/api/pipelineStats.ts` |
| `favorites/*.ts` | `favorites/lib/*.ts` |
| `selection/*.ts` | `selection/lib/*.ts` |
| `selection/SelectionDiagOverlay.tsx` | `selection/ui/…` |
| `settings/*` | `settings/lib/*` или `settings/api/*` |
| `folder/*` | `folder/lib/*` |
| `app-fullscreen/*` | `app-fullscreen/model/*` или `lib/*` |

**Оценка:** ~130+ переименований/перемещений (rename через `git mv`) в `src/features/`.

## Файлы без перемещения

| Файл | Причина |
|------|---------|
| `gallery/useGalleryThumbProgress.ts` (+ test) | Незакоммиченные локальные правки импортов (`.ts` суффиксы); по ТЗ не переносился. Обновлены только пути к `lib/thumbnails/` и `api/pipelineStats`. |
| `GalleryPage.tsx` | Только импорты; декомпозиция страницы вне scope |
| `widgets/*` | Уже сгрупированы по виджетам; нет разнотипного «плоского» корня |
| `entities/*`, `shared/*` | Уже соответствуют слою shared/entities |

## Публичные API

Отдельные `index.ts` на срезы **не добавлялись** (избежание barrel-циклов). Внешние потребители переведены на явные пути (`…/lib/…`, `…/model/…`).

## Проверки

| Проверка | Результат |
|----------|-----------|
| `npm run typecheck` | OK |
| `npm test` | **398** passed |
| `git diff --check` (src) | Предупреждения trailing whitespace на CRLF-строках после `git mv` (Windows); конфликт-маркеров нет |
| Циклические импорты | Отдельный анализатор не подключён; `tsc` без ошибок |
| Rust / IPC | Не затронуты |

## Вспомогательные скрипты

- `scripts/fsd-restructure-gallery.mjs`
- `scripts/fsd-move-gallery-tests.mjs`
- `scripts/fsd-fix-imports.mjs`
- `scripts/fsd-restructure-features.mjs`
- `scripts/fsd-fix-feature-imports.mjs`
- `scripts/fsd-fix-feature-relative.mjs`

## Замечания auditor / guardian

- **Плоский корень gallery** сведён к двум thumb-модулям + `api/`; после стабилизации `useGalleryThumbProgress` — перенос в `model/thumbnails/` отдельным этапом.
- **`trash/trashApi.ts`** — только обновление пути к `selection/lib/fileOperation`.
- **TASK-контракт:** массовый структурный рефакторинг выполнен по прямому автономному ТЗ пользователя; существующие утверждённые TASK не изменялись.
- **Незакоммиченные изменения:** `.cursor/agents/*`, `.cursor/rules/fsd-decomposition.mdc` — вне коммитов этой ветки.

## Коммиты

См. `git log refactor/fsd-folder-structure` после фиксации (ожидаются 2–3 атомарных коммита: gallery, остальные features, chore test script + отчёт).
