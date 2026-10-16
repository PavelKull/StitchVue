# StitchVue Icon System

Production SVG icon set for StitchVue.

## Rules
- Canvas/viewBox: 24×24
- Stroke: 1.7 px
- linecap/linejoin: round
- SVG uses `currentColor`; UI/CSS controls state color.
- Recommended colors: default `#E6EDF5`, hover `#FFFFFF`, active `#5AA7FF`, disabled `#8A94A6`.
- Active backgrounds/containers are UI styles and are intentionally NOT baked into SVG assets.

## Naming
Names describe semantic intent so Cursor IDE can select assets without inspecting the drawing:
- `navigation-*` — folder/history navigation
- `breadcrumb-*`, `chevron-*` — hierarchy/tree controls
- `sidebar-show`, `sidebar-hide` — left sidebar visibility
- `panel-show-bottom`, `panel-hide-bottom` — bottom control panel
- `pin`, `unpin` — attach/detach panel
- `layout-*` — gallery layouts
- `viewer-*`, `fullscreen-*` — image viewer
- `zoom-*` — image scaling
- `rotate-clockwise*` — поворот фото (варианты: базовый Lucide, `lucide` с хвостом, `refresh` как у `navigation-refresh`)
- `file-*` — file/media entities
- `file-restore` — ACTION «восстановить файл» (из «Удаленное» в исходную папку)
- `window-*` — native-like window controls

## Important distinctions
`folder.svg` is the folder entity.
`folder-open.svg` is the open-folder state.
`open-folder.svg` is the ACTION “open/select folder” and includes an arrow.

`pin.svg` means “pin/attach panel”.
`unpin.svg` means “unpin/detach panel” and has a slash.

`fullscreen-enter.svg` uses outward corner marks.
`fullscreen-exit.svg` uses inward corner marks.

`layout-grid`, `layout-horizontal`, `layout-vertical`, and `layout-masonry` use literal miniature layouts to remain understandable without labels.

## Example
```css
.icon { color: #E6EDF5; }
button:hover .icon { color: #FFFFFF; }
button[aria-pressed="true"] .icon { color: #5AA7FF; }
button:disabled .icon { color: #8A94A6; }
```
