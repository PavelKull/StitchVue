---
task_id: TASK-2026-FAV-P6-RELEASE
title: "P6 Safe Favorites — integration docs, EC trace, smoke checklist (T047–T053)"
status: approved
risk: low
responsible_agent: frontend-executor
base_commit: "fa618d2a8303518914ed21f1d6a77628e0f51258"
approval_hash: c2e354ec10cabb111941b34420ca099e1d2f77cf6e6ed6998b4355bd1267959b
allowed_paths:
  - specs/001-safe-favorites-lifecycle/quickstart.md
  - docs/INVARIANTS.md
  - src/features/gallery/lib/directory/directorySession.ts
  - src/features/gallery/lib/directory/directorySession.test.ts
  - src/pages/gallery/GalleryPage.tsx
  - docs/refactoring/tasks/TASK-2026-FAV-P6-RELEASE.md
forbidden_paths:
  - src-tauri/src/file_ops/**
  - specs/001-safe-favorites-lifecycle/spec.md
  - specs/001-safe-favorites-lifecycle/tasks.md
tests:
  - npm run typecheck
  - npm test -- src/features/gallery/lib/directory/directorySession.test.ts
  - cargo test --manifest-path src-tauri/Cargo.toml favorites_copy_recovery --
  - cargo test --manifest-path src-tauri/Cargo.toml p0_safe_favorites --
---

# Задача: P6 — release gate docs & supplemental VERIFY

## 1. Метаданные

| Поле | Значение |
|------|----------|
| SpecKit | T047–T053 |

## 2. Scope

- T047/T048 VERIFY-COND: if coverage exists, **cite** in quickstart T051 table (favorites_copy_recovery / reconcile_on_boot) — no new Rust unless gap found
- T049: FE stale session test in directorySession.test.ts (EC-16)
- T050: FR-006 undo messaging note in GalleryPage if missing (minimal)
- T051: EC-01–EC-22 trace table in quickstart.md
- T052: update docs/INVARIANTS.md only if confirmed behavior changed
- T053: manual smoke checklist section in quickstart (SC-010 additive)

## 3. Business invariants

- [x] Docs accurate; no false claims

## 4. Acceptance criteria

EC trace complete; T001 green cited; baselines cited; smoke checklist present; directorySession EC-16 covered.

## 5. Rollback

restore base_commit

## 6. Маршрут

seal → executor → strict (guardian optional low)

## 7. Отчёт исполнителя

(пусто)
