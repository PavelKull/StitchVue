---
name: cache-review
description: Reviews the StitchVue thumbnail cache, SQLite records, eviction, and invalidation. Use when changing cache limits, TTL, LRU, thumbnail files, or the cache database.
---

# Cache review

Spec source: `документация-проекта/PROJECT_SPEC.md` §8–12 and §40. One eviction order: under the cap, delete nothing; over the cap, soft TTL first, then LRU down to ~85%.

## Policy

- Persistent thumbnails and `stitchvue.db` under `%LOCALAPPDATA%\StitchVue\`
- Never store cache beside the originals and never write into user folders
- Identity: `source_path + source_size + source_modified_at`. Do not hash the whole file. Record is unique per identity + tier
- Store post-rotation width and height, orientation, tier, thumbnail path, thumbnail size, `created_at`, `last_accessed_at`
- Default cap 1 GB (options 512 MB, 1 GB, 2 GB, 5 GB, custom), but the default is picked from the indexed library size: 50 000 images at tier 512 is about 2.5 GB, so a 1 GB cap silently breaks the "reopening is instant" target
- Soft TTL default 7 days (presets 3, 7, 30, Never). Size beats TTL: do not delete solely because an entry is old while under the cap
- Over cap: delete older-than-TTL first, then LRU, until about 85% of the cap (~850 MB at 1 GB)
- Within each eviction step, order by tier: 1024 first, then 512; tier 256 is pinned and goes last
- Cleanup at startup, when over the cap, and while idle. Not during active scrolling
- Tiers 256 and 512 are generated together in one decode pass; 1024 is generated on viewport demand only
- Thumbnails are written in sRGB with EXIF rotation baked into pixels
- Manual clear cache must exist before the feature is called done

## Check

- LRU uses `last_accessed_at`, updated when a thumbnail is shown
- TTL alone does not wipe a cache that is under the cap
- Eviction deletes the DB row and the thumbnail file, or recovers if one side is missing
- Writes of thumbnail files are atomic (temp file, then replace)
- A changed size or mtime invalidates that entry
- Corrupt or missing thumbnail files are treated as cache misses, not hard failures
- SQLite updates for one thumbnail are transactional
- In-memory mirrors of the cache have a bound

## Result

```text
Policy mismatch:
Invalidation:
Crash / partial write:
Eviction during scroll:
```
