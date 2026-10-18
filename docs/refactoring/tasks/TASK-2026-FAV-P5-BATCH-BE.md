---
task_id: TASK-2026-FAV-P5-BATCH-BE
title: "P5 Safe Favorites — batch buckets & per-item dispatch (T040–T041, T045)"
status: approved
risk: high
responsible_agent: backend-executor
base_commit: "ef1cc543897bf7cbd6465124abb33e49e0142b61"
approval_hash: 6ea5fc42c2c5f1a2a5f1d7cfad91ac02267f2261c000c8fcf49039d6db162c9d
allowed_paths:
  - src-tauri/src/file_ops/favorites_batch.rs
  - src-tauri/src/file_ops/favorites.rs
  - src-tauri/src/file_ops/p5_batch.rs
  - src-tauri/src/file_ops/mod.rs
  - docs/refactoring/tasks/TASK-2026-FAV-P5-BATCH-BE.md
forbidden_paths:
  - src/**
  - src-tauri/src/pipeline/**
  - src-tauri/src/commands/**
  - specs/**
tests:
  - cargo test --manifest-path src-tauri/Cargo.toml favorites_copy_recovery --
  - cargo test --manifest-path src-tauri/Cargo.toml p0_safe_favorites --
  - cargo test --manifest-path src-tauri/Cargo.toml p4_dispatch --
  - cargo test --manifest-path src-tauri/Cargo.toml p5_batch --
---

# Задача: P5 BE — preview buckets + batch dispatch

## 1. Метаданные

| Поле | Значение |
|------|----------|
| ID | TASK-2026-FAV-P5-BATCH-BE |
| Риск | high |
| SpecKit | T040, T041, T045 |

## 2. Scope

- `favorites_batch.rs` — T040: preview buckets `fr11Required` / `standardConfirm` / `ready` (DTO or classify debug). T041: per-item dispatch in `remove_favorite_copies_batch` with per-path resolution; no auto-delete FR-11 bucket without resolution.
- `favorites.rs` — only if shared classify helpers needed
- `p5_batch.rs` — VERIFY T045 mixed missing-origin batch
- temp fixtures only; no user photos

## 3. Business invariants

- [x] Per-file FR-11 safety in batch; no false batch success

## 4. Acceptance criteria

| ID | Criterion |
|----|-----------|
| T040 | Preview exposes fr11Required vs standardConfirm vs ready |
| T041 | Batch executes per-item with resolutions |
| T045 | Mixed missing-origin batch test PASS |

Keep T001/p4 green.

## 5. Rollback

restore base_commit

## 6. Маршрут

seal → backend-executor → guardian → strict

## 7. Отчёт исполнителя

(пусто)
