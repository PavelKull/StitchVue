# Аудит адаптивности UI StitchVue

Дата: 2026-10-29. Baseline-коммит (стабильная `main` до эксперимента): `40e42d1`.

## 1. Карта компонентов интерфейса

| Зона | Компонент / стили | Роль | Отношение к галерее |
|------|-------------------|------|---------------------|
| Корень | `GalleryPage.tsx`, `GalleryPage.module.scss` | Shell, data-атрибуты peek/pin, CSS-переменные сайдбара | Pinned: `left` / `padding-top` у `.galleryLayer` |
| Верх | `TopNavigationBar`, `Breadcrumbs` | Overlay dock (`topBarDock`), breadcrumbs с collapse через RO | Не меняет ширину layout; при listing — `padding-top: --pg-top-chrome` |
| Низ | `BottomControlBar`, `SelectionActions` | Dock + overflow «Ещё» (ResizeObserver) | `useGalleryBottomOverlayReserve` — padding снизу viewport |
| Сайдбар | `FolderSidebar` | Pinned (inset) / overlay (translateX) | Pinned: `--pg-gallery-inset-pinned` на shell |
| Галерея | `StitchVueGrid`, `layout.ts` | Виртуализация, justified/mosaic/columns | Ширина из viewport RO, не из панелей overlay |
| Скролл | `GalleryScrollbar`, `scrollbarGeometry.ts` | Полоса справа, peek-зоны | Константы `REVEAL_PX`, lane guard в TS |
| Peek | `useGalleryPanelPeek`, `topNavPeekGeometry.ts`, `toolbarPeekGeometry.ts` | Показ панелей у краёв | Жёсткие px, завязаны на высоту chrome |
| Модалки | `SettingsDialog`, `AnimatedModalFrame`, диалоги favorites/update | `z-index: modal` | Поверх всего, частично `@media (max-width: 560px)` |
| Прочее | `ContextMenu`, `Tooltip`, `ImageViewer` | Контекстное позиционирование через `getBoundingClientRect` | Не резервируют место в grid |

Слои: `shared/styles/_z-index.scss` — grid 0, toolbar 40, sidebar 50, top-nav 60, overflow-menu 80, modal 100.

## 2. Существующие механизмы адаптивности

**Дизайн-токены** (`src/shared/styles/_design-tokens.scss`): цвета, радиусы, `--pg-edge`, `--pg-top-nav-height`, `--pg-top-chrome`, дефолт `--pg-sidebar-width`, `--pg-gallery-inset-pinned`. Масштабирования viewport нет; `--pg-ui-scale` отсутствует.

**Runtime CSS на shell** (`GalleryPage.tsx`): `--pg-sidebar-width`, `--pg-gallery-inset-pinned` (= width + 32), `--pg-notice-bottom` от ResizeObserver dock.

**Сайдбар** (`panelMemory.ts`): `clampSidebarWidth(220 … min(600, 45% window))`; при resize окна — reclamp в GalleryPage.

**Нижняя панель**: ResizeObserver родителя + поэтапное скрытие блоков в overflow-меню; SCSS `@media (max-width: 960px)` скрывает подписи и сужает кнопки.

**Breadcrumbs**: ResizeObserver — collapse при `scrollWidth > clientWidth`.

**Настройки**: `@media (max-width: 560px)` — колонка вкладок.

**Галерея**: `container-type: size` в `StitchVueGrid.module.scss` для контейнерных расчётов плиток, не для chrome.

**Media queries в проекте**: в основном `prefers-reduced-motion`; ширинные — только 960px (toolbar) и 560px (settings). Container queries для chrome нет.

**rem / clamp / vw**: почти не используются для chrome; размеры в px.

## 3. Проблемные жёсткие размеры

| Область | Примеры | Риск |
|---------|---------|------|
| `_floating-panel.scss` | кнопки 40×40, toolbar 58×62, divider 44px | Не сжимаются при узком окне |
| `TopNavigationBar.module.scss` | `height: 54px`, иконки 22px | Дублирует токен `--pg-top-nav-height` |
| `BottomControlBar.module.scss` | bar 80px, controls 72px, zoom slider 100px | Переполнение до срабатывания overflow JS |
| `FolderSidebar.module.scss` | padding, `--tree-name-gutter: 72px` | На малых ширинах сайдбара — обрезка текста (ellipsis есть) |
| `topNavPeekGeometry.ts` | 36px, 32px frame, guard `REVEAL_PX + 72` | Рассинхрон с масштабированным chrome |
| `GalleryPage.module.scss` | folder tiles 168px | Сознательно не chrome; менять не планируется |
| `scrollbarGeometry.ts` | `REVEAL_PX = 64` | Связано со скроллом, не с панелями |

## 4. Зависимости панелей и галереи

1. **Pinned sidebar**: `.galleryLayer { left: var(--pg-gallery-inset-pinned) }` — уменьшает ширину viewport grid; значение синхронизировано с TS (`sidebarWidth + 2×edge`).
2. **Overlay sidebar**: absolute поверх grid; inset галереи не меняется.
3. **Top chrome**: при `data-topnav-chrome` — `padding-top` у galleryLayer; высота из `--pg-top-chrome` (= edge + nav + 12).
4. **Bottom reserve**: `bottomScrollPadNeeded(dockHeight, edge)` — зависит от фактической высоты dock (RO), edge из computed style — **масштаб edge автоматически подхватится**.
5. **Peek**: не меняет geometry grid; только visibility/transform dock.
6. **Mosaic/Columns/Grid** (`layout.ts`): вход — ширина viewport ref; **не читает** ширину toolbar напрямую.

## 5. Потенциальные регрессии

- Изменение `--pg-top-chrome` без обновления peek-констант → ложное срабатывание / не срабатывание peek.
- Уменьшение min sidebar 220px → слишком узкое дерево папок.
- Слишком агрессивный scale → touch targets < 32px.
- Анимация pin/unpin sidebar (`--pg-gallery-inset-pinned`) при scale edge → кратковременный mismatch (уже есть freeze/morph).
- Overflow toolbar: порядок скрытия блоков — не ломать при изменении ширин кнопок.

## 6. Что менять / что оставить

**Менять:** централизовать масштаб chrome через `--pg-ui-scale` на shell; производные токены для edge, nav height, toolbar, mixins `_floating-panel`; при необходимости — формула peek в TS, согласованная с scale.

**Оставить:** алгоритмы layout галереи, виртуализацию, zoom steps пользователя, clamp сайдбара (220/45%), overflow-логику BottomControlBar, overlay vs pinned семантику, folder grid 168px.

## 7. Приоритет переработки

1. `_design-tokens.scss` + scale на `.shell` (эталон width 1920 → scale 1).
2. `_floating-panel.scss`, TopNavigationBar, BottomControlBar SCSS.
3. `FolderSidebar` (padding, nav buttons — через mixins).
4. `topNavPeekGeometry.ts` / guard константы.
5. SelectionActions, модалки (умеренно — max-width уже есть).
6. Settings 560px breakpoint — опционально выровнять с scale.

## Препятствие Git (этап 3)

На момент аудита в рабочем дереве **незакоммиченные** изменения (gallery order, UpdateDialog) — **не** часть адаптивности. Baseline SHA: **`40e42d1`**. Эксперимент ведётся в ветке `feature/adaptive-ui-panels` без смешивания этих правок в коммиты adaptive-ui.
