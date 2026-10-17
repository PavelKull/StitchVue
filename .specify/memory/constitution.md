# StitchVue Constitution

## Core Principles

### I. User Photo & Data Safety (NON-NEGOTIABLE)

Original user photos MUST NOT be deleted, overwritten, or mutated except through an
explicit user-initiated file operation. Copy-to-favorites MUST remain a copy of the
source, not a destructive move of the original. Automated tests MUST use fixture or
temp paths only; production photo libraries and live app databases MUST NOT be used
as test targets. File-operation errors MUST NOT be reported as success in UI or DB.

**Rationale:** StitchVue manages real photo collections; a false success or accidental
mutation is worse than a failed operation.

### II. Business Invariants Are Canonical

Confirmed business invariants in `docs/INVARIANTS.md` (and the agent pointer in
`.cursor/rules/business-invariants.mdc`) MUST be treated as product law for tasks and
reviews. Known defects MUST NOT be codified as desired behavior. Unproven behavior
MUST be marked UNVERIFIED and confirmed before high-risk work. Changing an invariant
REQUIRES a separate product specification — not a refactoring task.

**Rationale:** Refactors preserve behavior; product changes redefine it. Mixing the
two creates silent regressions.

### III. Directory Session Integrity

Only the current directory session MAY apply listing, metadata, thumbnail, and
pipeline results. Events and results from a stale session MUST be ignored on both
frontend and backend. Session advancement MUST NOT roll backward.

**Rationale:** Rapid folder switching otherwise corrupts gallery state with orphaned
batches and wrong thumbnails.

### IV. Scoped, Reversible Change

Every implementation stage MUST follow a single sealed task file under
`docs/refactoring/tasks/` with explicit `allowed_paths`, risk class, and acceptance
criteria. Diffs outside `allowed_paths` are a stop condition. Scope expansion after
seal REQUIRES re-approval and re-seal. Destructive git operations (`reset --hard`,
force push, mass history rewrite) are forbidden unless the user explicitly requests
them under a documented procedure.

**Rationale:** Incremental, reversible diffs keep gallery, IPC, and filesystem paths
auditable and rollback-safe.

### V. Evidence Before Claim

Behavior claims MUST be backed by code, automated tests, or documented smoke — not by
assumption. A green typecheck alone does NOT prove absence of regressions. Medium- and
high-risk stages MUST include the checks required by `docs/refactoring/TASK_HANDOFF.md`
(targeted tests; smoke when risk warrants). Frontend follows FSD layer boundaries;
Rust follows functional modularity without inventing FSD segments in `src-tauri/`.

**Rationale:** Gallery correctness (order, favorites, sessions, thumbnails) fails in
ways compilers do not catch.

## Architecture & Stack Constraints

StitchVue is a Windows desktop gallery: Tauri 2, Rust backend, React/TypeScript UI.

- Frontend layout follows the FSD-like map in `docs/ARCHITECTURE.md` (`pages` →
  `widgets` → `features` → `entities` → `shared`). New modules MUST land in the
  correct layer and segment (`ui` / `model` / `api` / `lib` / `config`) on first write.
- Backend modules (`commands`, `pipeline`, `thumbnail`, `cache`, `scanner`,
  `file_ops`, etc.) MUST keep thin IPC wrappers and isolate filesystem/SQLite work.
- IPC contracts and SQLite schemas MUST NOT change without an explicit product or
  architecture task; see `docs/IPC.md`.
- Performance work MUST respect HDD/SSD storage profiles and thumbnail queue
  semantics when those surfaces are touched.
- Documentation canon: `docs/ARCHITECTURE.md`, `docs/INVARIANTS.md`, `docs/IPC.md`,
  `docs/DEVELOPMENT.md`. Architectural changes MUST sync docs (docs-sync skill).

## Development Workflow & Quality Gates

- Prefer targeted verification: `npm run typecheck`, focused `npm test -- …` /
  `node --test`, and `cargo test` for the touched Rust module.
- Refactoring tasks use `node scripts/refactor-task-check.mjs` gates (`--preflight`,
  `--auth`, `--strict`, `--seal`) per `TASK_HANDOFF.md`.
- Risk class follows affected invariants (session/order/favorites UI ≥ medium; FS,
  SQLite, IPC, thumbnail scheduler = high), not file count.
- Commits use Conventional Commits; create commits only when the user asks; no
  AI co-author trailers.
- Do not launch specialized subagents without explicit user permission.
- Manual smoke (folder switch, sort, scroll/thumbs, favorites original safety,
  delete/move selection, favorites-folder rename) is mandatory for high-risk work,
  multi-stage series, and release — not after every low-risk local diff.

## Governance

This constitution supersedes conflicting informal habits and ad-hoc agent shortcuts.
Amendments MUST update `.specify/memory/constitution.md`, bump `CONSTITUTION_VERSION`
semantically (MAJOR: remove/redefine principles; MINOR: add/expand; PATCH: clarify),
set `Last Amended` to the amendment date, and record rationale in the temporary Sync
Impact Report comment (removed before commit).

Compliance review expectations:

- PRs and agent task reports MUST verify touched principles and listed invariants.
- Complexity and scope growth MUST be justified against Principle IV.
- Runtime guidance lives in `docs/INVARIANTS.md`, `docs/ARCHITECTURE.md`, and
  `docs/refactoring/TASK_HANDOFF.md`; the constitution does not duplicate full tables.

**Version**: 1.0.0 | **Ratified**: 2026-10-17 | **Last Amended**: 2026-10-17
