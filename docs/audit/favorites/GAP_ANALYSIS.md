# Favorites — gap analysis

Risk: **Critical** / **High** / **Medium** / **Low**.  
Effort: **S** / **M** / **L**.  
New dependency: **No** preferred unless noted.

## Missing or weak tests

| Gap | Risk | Effort | Dep | Recommendation |
|-----|------|--------|-----|----------------|
| No IPC/integration test harness for full add→star→remove | High | L | Optional (tauri test) | Add focused Rust integration invoking `Pipeline` with temp dirs |
| GalleryPage favorites flows untested | Medium | L | No | Extract pure handlers (already partially in `removeFavoritesBatch`) |
| Long path / MAX_PATH | Medium | M | No | Windows fixture in `file_ops` tests |
| Explorer external edit sync | Medium | M | No | Spec behavior first; then watcher hook or periodic reconcile |
| `NEEDS_RECONCILIATION` user surfacing | Medium | S | No | Product decision + settings/diag UI |
| Mass unfavorite stale session (F11) | Medium | S | No | Unit test mirroring `finishBackgroundMassUnfavorite` guards |
| Orphan `favorite_copies` GC policy | Low | M | No | Background job or on-listing prune — product |
| Manual smoke not recorded | High (release) | S | No | Execute checklist in INVARIANTS before SpecKit implement |

## Architectural weak points

| Area | Issue | Risk |
|------|-------|------|
| Dual state (FS + SQLite) | No single transaction | High — mitigated by reconcile, not eliminated |
| `favorite_origin_paths` ignores orphan DB rows | Drift accumulates | Medium |
| Session not on file ops | Directory mismatch only | Medium |
| `undo_favorite_removal` stub | User expectation gap | Medium |
| Rename folder FS before DB | Comment accepts temporary inconsistency | Medium |
| Global in-process locks only | No multi-instance | Low |

## Observability gaps

| Gap | Benefit | Effort |
|-----|---------|--------|
| Structured logging for classify `ConfirmKind` | Debug unfavorite reports | S — diag exists (`unfavoriteClassifyDiag`, `removal_classify_debug`) |
| Metrics for `ST_NEEDS_RECONCILIATION` count | Ops health | S |
| User-visible reconcile banner | Trust | M |

## Tooling recommendations (no install required for audit)

| Tool | Use | New dep? |
|------|-----|----------|
| `cargo test favorites_*` | Regression before changes | No |
| `npm test -- removeFavoritesBatch.test.ts` etc. | UI logic | No |
| `node scripts/refactor-task-check.mjs` | Sealed implementation tasks | No |
| Temp-dir fault injection pattern | Extend CP tests for add-favorite | No |
| Future: Tauri WebDriver smoke | Release checklist | Optional |

## Suggested SpecKit input

Before `/speckit-specify`, product should answer questions in [`INVARIANTS.md`](INVARIANTS.md) and [`AUDIT_SUMMARY.md`](AUDIT_SUMMARY.md). Spec should treat **CODE-SUPPORTED** behaviors as default requirements unless explicitly changed.
