---
name: docs-sync
description: Updates StitchVue docs after an architectural change. Use when a stage changes architecture, cache policy, IPC, invariants, or development workflow, or when the user asks to sync ARCHITECTURE, INVARIANTS, IPC, or DEVELOPMENT.
---

# Docs sync

All project docs live under `docs/`. Update a document only when it is now false. Do not invent product rules. Do not duplicate `docs/refactoring/TASK_HANDOFF.md`.

| File | Touch it when |
| --- | --- |
| `docs/ARCHITECTURE.md` | Module boundaries, data flow (session, pipeline, file_ops, cache) |
| `docs/INVARIANTS.md` | Confirmed vs UNVERIFIED business invariants; keep in sync with `.cursor/rules/business-invariants.mdc` (rule stays a short pointer + summary table) |
| `docs/IPC.md` | Tauri commands, events, DTO locations |
| `docs/DEVELOPMENT.md` | Scripts, directory layout, how to run targeted tests |
| `docs/refactoring/TASK_HANDOFF.md` | Only if the agent handoff / gate process itself changes |
| `README.md` | Only if the docs entry links are wrong |

Do not resurrect `документация-проекта/`. Do not create `SESSION.md` as a second project-state file.

Source of truth order: `docs/INVARIANTS.md` (behavior claims) → `docs/ARCHITECTURE.md` / `docs/IPC.md` → `docs/refactoring/*` → skills → `.cursor/rules`. A lower level never silently overrides a higher one. If docs and code disagree, fix docs or mark UNVERIFIED — do not “fix” product behavior inside a docs-sync task unless the user asked for a code change.
