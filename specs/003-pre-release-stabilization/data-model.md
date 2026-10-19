# Data model: 003-pre-release-stabilization

No new SQLite tables in the first sealed tasks. This feature mostly retunes existing frontend state.

## NeighborWindow (C-006)

Conceptual, lives in `viewerPreloadLogic` / `viewerPreload` memory.

| Field | Meaning |
|-------|---------|
| `index` | Open photo index N |
| `direction` | `1` or `-1` from actual navigation |
| `p0` | Current path (loaded by ImageViewer, not neighbor queue) |
| `p1` | One path: N+direction |
| `p2` | Up to four paths: +2…+5 along direction |
| `p3` | Up to two paths: opposite direction |
| `kept` | Warm HTMLImage / src, cap `MAX_KEPT=8` until measured |
| `active` | In-flight neighbor jobs, cap `MAX_ACTIVE=2` |
| `generation` | Invalidates stale completions without wiping `kept` |

Validation: P3 jobs MUST NOT start while P1/P2 remain in queue/active. Fast pace MUST still populate P1.

## FavoriteOverlay (C-005, existing)

`FavoriteOverlayEntry`: `operationId`, `status`, `desired`, `generation`.  
Listing for Favorites MUST exclude paths with pending `desired: false`.  
`optimisticHiddenFolderKeys` MAY hide the service folder when the batch equals the known listing even if `listingReady` was the previous gate.

## ThumbnailIdentity (B-005, existing)

`identity_hash(source_path, size, mtime)` → `{hash}-{tier}.jpg` plus `thumbnail_cache` row.  
Share: second row (copy path) pointing at the same `thumbnail_path` when size matches (prefer sha256 from `favorite_snapshot_for_copy`). Do not share if sizes differ.

## GalleryEmptyKind (C-001)

Extend beyond `'none' | 'emptyFolder' | 'noSupportedFiles'` to include loading, error, subfolders-only, empty favorites, empty trash — still one visual template.

## ScrollEndIntent (B-001)

`pendingScrollToEnd: boolean` on the jump hook. Cleared on ready+at-bottom, manual scroll, up-jump, folder change.

## PublishedGeometry (B-003)

Per-index trusted aspect in mosaic/columns `usedAspects`. Changing `rotationQuarters` thaws **that** index only.
