---
name: gallery-layout-review
description: Reviews StitchVue justified gallery layout, orientation mode, zoom, and virtualization math. Use when changing the gallery, virtual grid, justified rows, zoom, or folder-order vs orientation-optimized layout.
---

# Gallery layout review

## Invariants

- Gap 0, padding 0, no tile borders. No empty space between photos in a row
- Row height is not a free parameter. With zero gaps, `h = W / Σaᵢ` (spec §16.1). Full width with no crop and no distortion is therefore always achievable; the only lever is where the row breaks
- Row breaking is DP, not greedy: minimize `Σ ln(h / h_target)²` over the gallery, `k_max` about 12–16 (§16.2). Hard limits: row no taller than the viewport, no shorter than ~50% of target, no single photo wider than ~60% of the row
- An empty row tail is allowed only in the last row of the gallery. Never in the middle, in any mode
- Fit defaults to 0% (no crop). Values above 0 are voluntary row evening, never a way to fill width (§15.1)
- Mode A keeps folder order and that outranks density. Never reorder files. The price of order is row-height variance, not holes or crops
- Mode B is post-MVP. If present, it needs an explicit visual-index → file mapping
- Zoom is rows per screen, `h_target = viewport_height / rows_per_screen` (§19.1). Not a fixed pixel list
- Any relayout (zoom, resize, Fit change, metadata arrival) restores position by anchor index + fractional offset, never by `scrollTop` (§19.3)
- Switching Fit or zoom recomputes layout only. It must not read or decode originals
- DOM count follows viewport + overscan, roughly 50–150 tiles even at 25 000 images. Overscan is measured in viewport heights, not tile counts
- Layout math uses cached post-rotation width, height, and orientation
- Placeholders have a stable aspect slot before metadata arrives, then correct without reloading originals
- Recalculating layout does not run per thumbnail decode if geometry did not change

## Check

- Aspect ratio preserved. The only `object-fit: cover` is the sub-pixel rounding remainder, or an explicit alignment above 0%
- Widths come from cumulative integer offsets so they sum exactly to `W`; no hairline seams at DPR 1.25 / 1.5
- Container width comes from `ResizeObserver`, not `window.innerWidth`; scrollbar appearance cannot feed back into row heights
- Thumbnail tier matches displayed size × DPR; upgrades swap `src` only after `img.decode()`
- Overscan is bounded and does not mount the full folder
- Scroll offset stays valid after zoom, resize, Fit change, and mode switch
- Orientation mode does not break keyboard/viewer index mapping; document how the visual index maps back to the file

## Result

```text
Order preserved:
Empty tails outside last row:
Aspect exact:
Anchor restored:
Zoom rereads originals:
DOM bound:
Layout cost:
```
