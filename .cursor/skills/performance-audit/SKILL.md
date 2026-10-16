---
name: performance-audit
description: Audits StitchVue scroll, memory, thumbnail queue, and startup against the spec targets. Use when the user asks for a performance check, profiling, FPS, memory, 50k images, or before calling a stage fast enough.
---

# Performance audit

Measure, then change. Do not speculative-optimize.

Priority: visible viewport, then prefetch, then background. Scrolling stays responsive while background work runs.

## Targets

From `документация-проекта/PROJECT_SPEC.md` §37–38:

- UI startup under 1 second on a normal PC
- First gallery placeholders before thumbnail generation finishes
- Reopening a cached folder feels immediate
- Scroll target 60 FPS during background indexing
- Full DP layout of 50 000 images under 10 ms (§38 target, unverified — measure before adding segmented recompute)
- Ctrl + Wheel zoom drops no frames while held
- At least 50 000 images without a DOM node per image
- Debug overlay only in dev: FPS, image count, visible, cached, queue, row count, DP time, rows per screen, per-tier counts, cache bytes, active disk reads, active decodes

## Check

- React renders of gallery rows and tiles
- DOM count versus viewport + overscan (expect on the order of 50–150 tiles, not tens of thousands); overscan measured in viewport heights
- Thumbnail tier versus displayed size × DPR; decoded-bitmap RAM of visible tiles (tier 512 is roughly 700 KB per tile, tier 256 roughly 180 KB)
- Thumbnail queue: visible jobs run before prefetch and background
- Disk concurrency stays bounded (start values: 1–2 read, 2–4 decode, 1 thumbnail write)
- Cache hit / miss and whether metadata or thumbnails are reread
- Decodes of images that are not visible, prefetched, or intentionally backgrounded
- Unbounded queues or unbounded in-memory caches
- Startup work that blocks the first frame

## Record

Append to `документация-проекта/PERFORMANCE.md` only when a measurement exists:

```text
Before:
After:
Dataset:
Hardware:
Bottleneck:
```

If there is no timer, counter, or trace, write `not measured` and name the probe to add. Do not invent numbers.
