# План реализации адаптивных панелей StitchVue

Согласовано с [AUDIT.md](./AUDIT.md). Baseline: `40e42d1`.

## Архитектура

**Выбранный подход:** один коэффициент `--pg-ui-scale` на элементе `.shell`, эталон **1920px** CSS viewport (= scale `1`). Ниже — `clamp(0.72, 100vw / 1920, 1)`.

**Почему не transform: scale() на приложении:** искажает hit-testing, blur, ломает согласованность со скроллбаром и peek.

**Почему не массовая замена px → %:** галерея и сайдбар-resize уже имеют свою модель; chrome масштабируется через **существующие токены** и mixins.

**Производные:** `--pg-edge`, `--pg-top-nav-height`, `--pg-top-chrome`, `--pg-panel-gap`, радиусы chrome, размеры из `_floating-panel.scss`, высота bottom bar и ширина toolbar controls — через `calc(Npx * var(--pg-ui-scale))`.

**DPI Windows:** Tauri webview использует CSS px; `100vw` отражает клиентскую область окна при любом системном масштабе — отдельные media под 125%/150% не требуются.

**Overlay vs pinned:** inset pinned sidebar через `calc(var(--pg-sidebar-width) + 2 * var(--pg-edge))` в SCSS; `--pg-ui-scale` на `:root` (модалки и порталы).

## Статус (2026-10-29)

| Этап | Статус |
|------|--------|
| Токены + `:root` scale | ✅ |
| Top / bottom bar | ✅ |
| Sidebar + peek TS | ✅ |
| SelectionActions, notices | ✅ |
| Context menu, tooltip, scroll jump | ✅ |
| Modals (AnimatedModalFrame, Settings, favorites, update, rename, photo props, support) | ✅ |
| Image viewer nav overlay | ✅ |
| Gallery layout / zoom | не изменялось (by design) |

Все пункты плана внедрения закрыты; детали — [`COMPLETION.md`](./COMPLETION.md).

## Файлы

| Файл | Изменение |
|------|-----------|
| `_design-tokens.scss` | `--pg-ui-*`, scale-aware layout tokens |
| `GalleryPage.module.scss` | `--pg-ui-scale` на `.shell` |
| `_floating-panel.scss` | mixins через scale |
| `TopNavigationBar.module.scss` | высота/иконки от токенов |
| `BottomControlBar.module.scss` | bar/control от токенов |
| `FolderSidebar.module.scss` | gutter/padding через scale где уместно |
| `adaptiveUiScale.ts` | общая формула для peek TS |
| `topNavPeekGeometry.ts` | scaled constants |
| `docs/adaptive-ui/*` | AUDIT, PLAN, ROLLBACK |

**Не трогаем:** `layout.ts`, `StitchVueGrid` layout pipeline, `clampSidebarWidth` (кроме возможного будущего min на <900px).

## Порядок внедрения

1. Токены + shell scale (коммит 1).
2. floating-panel + top + bottom bar (коммит 2).
3. Sidebar SCSS + peek geometry (коммит 3).
4. Документация ROLLBACK + typecheck/tests (коммит 4).

## Правила расчёта

- Эталон: окно **1920×1080** (или фактический монитор разработчика при width ≥1920) — визуально как до изменений.
- Min scale **0.72** (~1382px width) — дальше не сжимаем (компактность через существующий overflow toolbar и 960px labels-off).
- Sidebar user width: не умножать на scale (уже clamp по окну).

## Тестирование

Автоматически: `npm run typecheck`, адресные тесты gallery chrome (`galleryOrder.test.ts`, peek/unit если есть).

Ручно (не выполнено агентом без GUI): таблица разрешений из ТЗ, pin/unpin sidebar, peek панелей, zoom пользователя, scroll jump.

## Откат

См. [ROLLBACK.md](./ROLLBACK.md). Baseline `40e42d1`, ветка эксперимента `feature/adaptive-ui-panels`.
