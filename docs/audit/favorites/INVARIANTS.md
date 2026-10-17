# Favorites — invariants mapping (audit)

Maps [`docs/INVARIANTS.md`](../../INVARIANTS.md) to favorites implementation. Status vocabulary matches canonical doc: **confirmed** / **UNVERIFIED**.

| ID | Invariant | Audit finding | Evidence status |
|----|-----------|---------------|-----------------|
| I1 | Stale directory session ignored | File ops use directory string match on result, not session id; pipeline thumb events use session | **PARTIAL** for favorites IPC |
| I2 | Gallery order | Orthogonal to favorites | n/a |
| I4 | Optimistic favorite overlay rollback | Generation-gated clear; batch mass unfavorite overlay | **VERIFIED** (frontend tests) |
| I5 | Batch unfavorite gates | `unfavoriteGate`, preview buckets, dialog | **VERIFIED** (unit tests) |
| I6 | `run_file_operation` claim/complete/abandon | `file_ops::claim`, `complete`, `abandon` | **VERIFIED** (code + file_ops tests) |
| I7 | File op errors ≠ false success | Per-outcome status; link failure sets error on outcome + reconciliation status | **PARTIAL** — UI may show star from overlay until fetch; add path clears overlay on fail |
| I8 | Originals not deleted by favorite add | `CopyToLocalFavorites` only copies | **VERIFIED** (action enum) |
| I9 | Thumbnail queue | Not favorites-specific | n/a |
| I10 | Copy to favorites is copy | `Action::CopyToLocalFavorites`, `copy_one` | **VERIFIED** |

## Implementation-specific rules (observed, not all in INVARIANTS.md)

| Rule | Status | Opora |
|------|--------|-------|
| Add favorite must not run inside service folder | **CODE-SUPPORTED** | `execute` guard |
| Stars only for copies in **active** favorites folder | **VERIFIED** | `active_favorite_origins_in` + lifecycle tests |
| Unfavorite must not delete origin when recycling copy | **VERIFIED** | `recycle_copy` tests / final report |
| `restore_origin` keeps favorite copy | **VERIFIED** | CP2/CP3 restore tests |
| Renamed non-canonical favorites folder → inactive | **VERIFIED** | `favorites_lifecycle.rs`, `favoritesCollectionLifecycle.ts` |
| Bulk OS recycle of originals without user intent | Not performed by add-favorite path | **CODE-SUPPORTED** |

## Confirm kinds (product-facing gates)

`ConfirmKind` in `favorites.rs`: `unknown_origin`, `origin_changed`, `copy_changed`, `ambiguous_origin`, `origin_in_local_trash`. UI labels via `unfavoriteConfirmKindLabel` (`removeFavoritesBatch.ts`).

**UNVERIFIED:** exact product copy for each dialog variant vs user expectations (i18n strings exist).

## Questions for product owner (invariant-level)

1. Should orphan `favorite_copies` rows (inactive folder / missing file) be auto-pruned or surfaced in UI?
2. Is `ST_NEEDS_RECONCILIATION` acceptable as silent state, or must user be notified?
3. Should `favorite_origin_paths` purge stale rows when copy file missing?
4. Is stub `undo_favorite_removal` permanent product decision?
5. Star off from parent album without opening `Избранное` — required UX path?
