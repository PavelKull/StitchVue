---
task_id: TASK-2026-FAV-P4B-CHOOSE-FOLDER
title: "P4b Safe Favorites — FR-11 action B choose_folder (T035 B)"
status: verification
risk: high
responsible_agent: backend-executor
base_commit: "6d17a6e66b286c89833a9e3ac1427ed9645aa063"
approval_hash: 2486fbd2d669c8eb6210f91e60dbe856898fdd8b8cf9c8769c9d8880f2bd97fa
allowed_paths:
  - src-tauri/src/file_ops/favorites.rs
  - src-tauri/src/file_ops/p4_dispatch.rs
  - docs/refactoring/tasks/TASK-2026-FAV-P4B-CHOOSE-FOLDER.md
forbidden_paths:
  - src/**
  - src-tauri/src/commands/**
  - src-tauri/src/pipeline/**
  - specs/**
tests:
  - cargo test --manifest-path src-tauri/Cargo.toml p0_safe_favorites --
  - cargo test --manifest-path src-tauri/Cargo.toml p4_dispatch --
  - cargo test --manifest-path src-tauri/Cargo.toml p1_identity --
---

# Задача: P4b — FR-11 B choose_folder

Implement backend execution for resolution `choose_folder` / `choose_folder:<absolutePath>` from FE picker. Identity gate; no overwrite; no mkdir of missing unrelated trees beyond target folder existence check.

## 1. Метаданные

| Поле | Значение |
|------|----------|
| ID | TASK-2026-FAV-P4B-CHOOSE-FOLDER |
| Риск | high |
| SpecKit | T035 B |

## 2. Scope

- `favorites.rs` — replace stub: parse `choose_folder` or `choose_folder:<path>`; relocate copy into chosen directory with identity gate (same as return_to_source but target parent = chosen); reject if target missing / reparse / occupied without content match
- `p4_dispatch.rs` — VERIFY test for B success + conflict

### Запрещено

- FE changes; weaken T001; user paths in tests

## 3. Business invariants

- [x] No overwrite unrelated; content proof; temp only

## 4. Acceptance criteria

- B relocates into existing chosen folder without overwrite
- Conflict → Err, copy kept
- T001 stays GREEN; p4_dispatch includes B test PASS

## 5. Rollback

restore from base_commit

## 6. Маршрут

seal → backend-executor → guardian → strict

## 7. Отчёт исполнителя

**STATUS:** verification — T035 B done; T001 GREEN; p1_identity GREEN.

### FR-11 B

| String | Behavior |
|--------|----------|
| `choose_folder` | Err — нужен абсолютный путь |
| `choose_folder:<absPath>` | Relocate в существующую папку; `prepare_relocate_parent` (нет mkdir дерева, reject reparse/junction/non-dir); identity gate как у A |
| Conflict (target не каталог / missing / reparse) | Err, копия в «Избранное» сохраняется |

### Changed
- `favorites.rs` — `parse_choose_folder_target`; stub B → `execute_relocate` / `relocate_distributed` с chosen parent
- `p4_dispatch.rs` — B success, occupied conflict, bare-path Err

### Tests
- `p4_dispatch` PASS (7)
- `p0_safe_favorites` PASS (T001 GREEN)
- `p1_identity` PASS

### NEXT
guardian + ручной smoke (high); temp fixtures only.
