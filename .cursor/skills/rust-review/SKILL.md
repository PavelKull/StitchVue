---
name: rust-review
description: Reviews StitchVue Rust/Tauri code for blocking commands, panics, concurrency, and filesystem errors. Use when changing src-tauri, commands, the scanner, decoder, thumbnail workers, cache, or SQLite.
---

# Rust review

Filesystem, metadata, decode, thumbnails, cache, SQLite, and background jobs belong here.

## Check

- Tauri commands return quickly; long work is spawned, not run on the UI command
- Worker pools are bounded (disk 1–2, decode 2–4, thumbnail writes 1, unless an ADR changed the numbers)
- No unbounded channels that accept every file before the consumer drains
- `unwrap` / `expect` / `panic` on missing files, permissions, or bad images — return a structured error
- Filesystem errors include the path and operation
- Clones and full-buffer allocations of original images on the hot path
- Shared state is `Send` and lock scope is short
- SQLite writes that must survive a crash are transactional
- User photo directories are never modified
- Cache paths stay under the app data directory

## Result

```text
Blocking:
Panic risk:
Concurrency:
Allocations:
Errors:
```

Fix only the items in the requested change. Do not restyle unrelated modules.
