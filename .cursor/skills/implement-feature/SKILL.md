---
name: implement-feature
description: Implements one StitchVue feature as a small vertical slice. Use when adding or changing app functionality, starting a development stage, or when the user asks to implement a gallery, cache, scanner, thumbnail, sidebar, viewer, or settings feature.
---

# Implement feature

One task, one independently testable slice. Do not implement the whole app, the next stage, or unrelated files.

## Scope limits

- Source of truth order: `документация-проекта/PROJECT_SPEC.md` → `документация-проекта/ARCHITECTURE.md` / ADR → `документация-проекта/TODO.md` → skills → rules. Never silently override a higher level; name the conflict instead
- Do not implement post-MVP functionality (§16.4, §18, §31) because a library makes it easy
- No abstraction "for later": no generic repository, service layer, event bus, plugin system, universal image pipeline, queue framework, `BaseManager` / `BaseService`, or universal React wrappers. Concrete implementation first; abstract only after real repetition
- A spec performance target is not automatically an acceptance test for this task. A benchmark blocks only when its stage is implemented, a reproducible benchmark exists, and the spec requires that number for this path

## Workflow

1. Read the matching section of `документация-проекта/PROJECT_SPEC.md` only. Read the full spec when starting a new stage or changing architecture.
2. Read `документация-проекта/TODO.md` if it exists. Search the repo for the symbol, filename, and existing call sites before opening files.
3. List the minimum files. Rust owns filesystem, scan, metadata, decode, thumbnails, cache, SQLite, and background jobs. React renders.
4. If the work is non-trivial, follow `dependency-evaluator` before new code or installs.
5. Write a short plan: behavior, files, dependency decision. Do not write an essay.
6. Implement the smallest version that completes the slice: command → bridge → minimal UI → check. Gallery must not load original images.
7. Run the checks that exist. If `package.json` or `src-tauri/Cargo.toml` is missing, say so. Do not invent a test framework inside the feature.
8. Review `git diff`. Revert accidental edits.
9. Update `документация-проекта/TODO.md` if it exists: Done, Current, Next, Last verified.

## Checks

Run what the repo actually has:

```text
npm run typecheck
npm test
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

Skip a command when its manifest or script is absent. Report the skip.

## Compile failure

Read the error, find the source, make one small fix, rerun. After three failed attempts on the same error, stop. Record Observed, Tried, Result, Hypothesis. Do not keep changing random files.

## Done reply

```text
Implemented:
Changed:
Verified:
Next:
```

Do not paste the new code back to the user. Commit only when the user asks.
