---
name: dependency-evaluator
description: Evaluates a proposed npm or Cargo dependency for StitchVue before install. Use when adding a library, choosing library vs custom code, or when the task involves virtualization, image metadata, SQLite, file watching, keyboard shortcuts, state, image decoding, EXIF, filesystem traversal, async queues, debouncing, icons, or any non-trivial dependency.
---

# Dependency evaluator

Product constraints live in `документация-проекта/PROJECT_SPEC.md`. Do not add a dependency until this decision is written in the reply.

## Already chosen

Do not re-evaluate or replace without an ADR in `документация-проекта/ARCHITECTURE.md`:

- Tauri 2, Rust, React, TypeScript, Vite, Zustand, SQLite, SCSS Modules

Do not add unless the spec is changed first: Electron, Redux Toolkit, RTK Query, MUI, Bootstrap, Tailwind.

TanStack Virtual is a candidate, not a locked choice.

## Gate

```text
TASK
  → trivial? (a few obvious lines, no tricky logic)
      YES → implement locally. Stop.
      NO  → suitable maintained library?
              YES → evaluate, then USE / AVOID / INVESTIGATE
              NO  → implement locally
```

A library existing is not by itself a reason to install it. To pass, it must do all four:

- actually close the task, not most of it
- not violate a `документация-проекта/PROJECT_SPEC.md` performance invariant
- be smaller or simpler than a reasonable local implementation
- not pull a disproportionate dependency tree

Local, do not install: `clamp`, `sleep`, `formatBytes`, `isLandscape`, array chunk, simple debounce, simple sort.

Do not hand-roll, unless a measured StitchVue bottleneck is recorded as an ADR: virtualization engine, SQLite abstraction, image decoder, EXIF parser, filesystem watcher, general state manager, general async runtime, complex animation engine.

## Already specified, not a library question

Justified row breaking is defined by the spec, not chosen here: §16.1–16.2 fix the formula, the DP cost function, `k_max`, and the hard limits. Do not substitute a gallery library for it, and do not treat the custom layout calculator as a case needing a measurement first. Virtualization of variable-height rows is still a normal library question.

Any library that crops or stretches photos violates §15.1 and RULE 11. Reject it without discussion.

Do not install a library to enable post-MVP functionality (§16.4, §18, §31). Ease of adding is not a reason to add.

## Evaluate

Answer in the reply before `npm install` or `cargo add`:

```text
Need:
Candidate:
Replaces:
Simpler option:
Size / deps:
Maintenance / license:
TS + Windows/Tauri:
Lighter alternative:
Decision: USE | AVOID | INVESTIGATE
```

Prefer the smaller library when both solve the StitchVue task. Equal behavior: 30 KB beats 400 KB.

`USE` — install and use it. `AVOID` — do not install; state the local or existing approach. `INVESTIGATE` — do not install yet; name the missing fact.

## Custom performance code

Beyond what the spec already specifies, custom code is allowed only when a generic library is measurably wrong for this app (example: gallery library cannot lay out 50 000 images). Record in `документация-проекта/ARCHITECTURE.md`:

```text
Decision:
Reason:
Measured problem:
Alternative considered:
Expected improvement:
```
