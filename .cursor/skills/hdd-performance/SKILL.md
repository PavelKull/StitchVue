---
name: hdd-performance
description: Reviews StitchVue disk access for HDD and SSD storage profiles. Use when changing the scanner, thumbnail scheduler, metadata reader, storage detection, cache, file watcher, or any code that reads many image files.
---

# Storage performance

Question to answer: can this code make an HDD seek across many files at once?

Default to the HDD profile. Higher read parallelism is allowed only when the volume was detected as SSD (`документация-проекта/PROJECT_SPEC.md` §7).

## Pipeline

```text
limited sequential reads → RAM → parallel decode → resize → one cache writer
```

HDD profile: 1–2 read workers, sequential order by position in the folder, group neighboring files.

SSD profile: 4–8 read workers, order by viewport priority, random reads fine.

Decode workers scale with CPU cores in both profiles. Thumbnail writes stay at one worker.

Dimensions are read from file headers in a fast pass over the whole folder before thumbnail generation: layout geometry needs aspect ratios, and header reads are a few KB per file instead of a full decode. One pass only — do not reread a path whose size and mtime are already in SQLite.

## Storage detection

- Profile is per volume, not per app. The photo folder and the cache can sit on different drives
- Detection result is cached for the session, not queried per file
- Unknown, network, or removable volumes fall back to the HDD profile
- Settings keeps a manual `Auto / HDD / SSD` override
- The profile changes read parallelism and traversal order only. Visible thumbnails still outrank prefetch and background work on every profile

## Look for

- More than a couple of concurrent reads of different originals
- Unbounded read-ahead or unbounded worker pools
- Duplicate reads of the same path in one pass
- Metadata reads that stat or open files already stored in SQLite
- Full-file hashes (identity is `path + size + mtime` only)
- Rereading a thumbnail that is already cached
- Original bytes loaded for the gallery, zoom, or layout
- Cache cleanup or directory walks during active scrolling
- Writes into the user's photo folder (cache belongs under `%LOCALAPPDATA%\StitchVue\`)

## Result

```text
Seek risk: low | high
Sites:
Why:
Change:
```

High means random or duplicate multi-file reads on the hot path. Do not "fix" it by raising worker counts.
