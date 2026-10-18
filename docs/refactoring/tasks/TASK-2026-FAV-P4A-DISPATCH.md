---
task_id: TASK-2026-FAV-P4A-DISPATCH
title: "P4a Safe Favorites — dispatch fix & FR-11 backend (T030–T033, T038)"
status: verification
risk: high
responsible_agent: backend-executor
base_commit: "aeefde1c95a400402d0390a509da17cba22490d1"
approval_hash: 04667fe60fe6a02594056c88f0630e01303eef3033901ec9533eb09610d4e0e3
allowed_paths:
  - src-tauri/src/file_ops/favorites.rs
  - src-tauri/src/file_ops/favorites_batch.rs
  - src-tauri/src/file_ops/locks.rs
  - src-tauri/src/file_ops/p0_safe_favorites.rs
  - src-tauri/src/file_ops/p4_dispatch.rs
  - src-tauri/src/file_ops/mod.rs
  - docs/refactoring/tasks/TASK-2026-FAV-P4A-DISPATCH.md
forbidden_paths:
  - src/**
  - src-tauri/src/commands/**
  - src-tauri/src/pipeline/**
  - src-tauri/src/thumbnail/**
  - specs/001-safe-favorites-lifecycle/spec.md
  - specs/001-safe-favorites-lifecycle/tasks.md
tests:
  - cargo test --manifest-path src-tauri/Cargo.toml favorites_copy_recovery --
  - cargo test --manifest-path src-tauri/Cargo.toml favorites_trash_lifecycle_final --
  - cargo test --manifest-path src-tauri/Cargo.toml p0_safe_favorites --
  - cargo test --manifest-path src-tauri/Cargo.toml p1_identity --
  - cargo test --manifest-path src-tauri/Cargo.toml p4_dispatch --
---

# Задача: P4a — dispatch + FR-11 backend (T030–T033, T038)

**HIGH.** Fix auto-relocate; FR-11 resolutions A/C (B = P4b); identity before destructive; in-flight guard. Temp/fixture only.

## 1. Метаданные

| Поле | Значение |
|------|----------|
| ID | TASK-2026-FAV-P4A-DISPATCH |
| Статус | verification |
| Риск | high |
| Ответственный | backend-executor |
| SpecKit | T030, T031, T032, T033, T038 |

## 2. Scope

### Разрешённые файлы

- `favorites.rs` — T030: `dispatch_removal_plan` / `_on_conn`: **no** `relocate_distributed` / `execute_relocate` for `NeedsConfirm`+`unknown_origin` (and unverified missing) when `confirmed` without FR-11 `resolution`; return needs_confirm / skipped. T031: resolutions A/C (and wire for B stub if needed) with content gate. T032: identity gate immediately before destructive remove/recycle. T033: duplicate IPC / in-flight removal guard (+ `locks.rs` if required).
- `favorites_batch.rs` — only if batch must pass resolution / in-flight
- `locks.rs` — in-flight guard helpers only
- `p0_safe_favorites.rs` — do **not** weaken T001; after T030, T001 must **PASS**
- `p4_dispatch.rs` — optional VERIFY T038 tests
- `mod.rs` — mod line only

### Запрещено

- FE / GalleryPage / dialog widget (P4 FE / P4b)
- T035 folder picker (P4b)
- weaken T001 asserts
- user photo paths / production SQLite
- schema migration

### Зависимости

- P1 identity gate complete; P1 T013 green
- Blocks P4 FE / P5 batch

## 3. Business invariants

- [x] No overwrite unrelated; content proof before destructive
- [x] No auto-relocate unverified origin (CL-P03 / FR-011b)
- [x] No delete last copy without FR-11 resolution
- Temp fixtures only

## 4. Acceptance criteria

| ID | Criterion |
|----|-----------|
| T030 | No auto-relocate unknown_origin without resolution |
| T031 | A/C resolutions with content gate at execute |
| T032 | Identity gate before destructive branch |
| T033 | Duplicate/in-flight removal guard |
| T038 | VERIFY: missing-origin never recycles without resolution |
| T001 | **PASS** after T030 |

Baselines recovery + p1_identity remain GREEN.

### Автоматические проверки

Listed in frontmatter tests.

### Ручная smoke

- [ ] N/A fixture; HANDOFF 4–5 via tests

### Стоп

- Need FE dialog to complete T031 A/C backend API — document resolution string contract in §7; still implement backend
- Expanding beyond allowed_paths

## 5. Rollback

restore from base_commit

## 6. Маршрут

code-auditor → seal → backend-executor → guardian → strict

## 7. Отчёт исполнителя

**STATUS:** verification — T030–T033, T038 done; T001 GREEN.

### FR-11 `resolution` contract (backend P4a)

| String | FR-11 | Behavior |
|--------|-------|----------|
| `return_to_source` | A | Relocate to stored parent; identity gate in `execute_relocate` / `relocate_distributed` |
| `choose_folder` / `choose_folder:<path>` | B | Stub → error «будет в P4b» (picker = P4b) |
| `cancel` / `keep_copy` | C | Non-destructive; `skipped` + `notice_code=cancelled`; copy stays |
| `recycle_copy` | explicit destructive | Recycle copy only if SQLite snapshot exists; orphan → Err (EC-21) |
| `None` + `confirmed` on UnknownOrigin/Ambiguous | — | `needs_confirm` / `fr11Required`; **no** auto-relocate/recycle |

Standard `origin_changed` / `copy_changed` confirm still relocates on `confirmed` without FR-11 resolution.

### Changed
- `favorites.rs` — dispatch FR-11 guard; A/C (+ B stub, recycle_copy); T032 revalidate before `execute_recycle`; missing file≠orphan
- `locks.rs` — `try_claim_favorite_removal` (T033)
- `p4_dispatch.rs` — T038 + A/C/B/T033 tests
- `p0_safe_favorites.rs` — T001 comment only
- `mod.rs` — mod line

### Tests
- `p0_safe_favorites` PASS (T001 GREEN)
- `p4_dispatch` PASS
- `p1_identity` PASS
- `favorites_copy_recovery` PASS
- `favorites_trash_lifecycle_final` PASS

### NEXT
guardian + manual smoke (high); FE wires resolution strings.
