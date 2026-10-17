# Favorites — edge case matrix

Columns: **Status** = VERIFIED | CODE-SUPPORTED | PARTIAL | MISSING | UNVERIFIED.

Product “expected” filled only where [`docs/INVARIANTS.md`](../../INVARIANTS.md) or obvious copy semantics apply; else **UNVERIFIED**.

## Add (copy to favorites)

| ID | Scenario | Preconditions | Action | Actual behavior | Expected (if known) | Risk | Tests | Status |
|----|----------|---------------|--------|-----------------|---------------------|------|-------|--------|
| EC-A01 | Re-add same file (identical bytes) | Copy already in `Избранное` | Add favorite | `already_exists`, link (re)recorded | Star on | Low duplicate IO | `copy_one` tests | VERIFIED |
| EC-A02 | Re-add after origin edited | Same path, size/mtime changed | Add | New PK dimension → new row; old row may remain until key collision rules | **UNVERIFIED** product | Stale duplicate rows | lifecycle partial | PARTIAL |
| EC-A03 | Name collision different content | Same basename, different bytes | Add | Suffix ` (n)` up to MAX_SUFFIX | Both copies exist | Medium clutter | mod tests | VERIFIED |
| EC-A04 | MAX_SUFFIX exhausted | 10k names taken | Add | Error fail outcome | **UNVERIFIED** | Add fails | CODE-SUPPORTED | CODE-SUPPORTED |
| EC-A05 | Add inside service folder | Role trash/favorites | Add | Error «Недоступно в служебной папке» | Blocked | Low | execute guard | VERIFIED |
| EC-A06 | Duplicate paths in one batch | Same path twice | Add | Deduped in execute | Single copy | Low | seen HashSet | CODE-SUPPORTED |
| EC-A07 | Parallel add same path | Two ops | Add | Second lock or overlay block | One succeeds | Medium | locks + UI overlay | PARTIAL |
| EC-A08 | Cancel mid-batch | Cancel flag set | Add | `cancelled` outcomes | Partial | Low | execute | CODE-SUPPORTED |
| EC-A09 | Destination is reparse/junction | Junction as `Избранное` | Add | Error, reparse blocked | Blocked | High wrong target | prepare_destination | CODE-SUPPORTED |
| EC-A10 | Disk full during copy | Temp write fails | Add | `failed` per file | No false star | High partial file | **UNVERIFIED** sim | PARTIAL |
| EC-A11 | Read-only origin | Cannot read source | Add | failed outcome | No star | Low | io errors | CODE-SUPPORTED |
| EC-A12 | Read-only destination dir | Cannot write | Add | failed | No star | Medium | io errors | CODE-SUPPORTED |
| EC-A13 | SQLite link fails after copy | DB error post-copy | Add | `favorite_link` + NEEDS_RECONCILIATION | Star may be wrong until reconcile | High | copy_recovery | VERIFIED |
| EC-A14 | Crash after copy before link | Pending log + dest journal | Restart | reconcile_add_to_favorites | Eventual link or NEEDS_RECONCILIATION | High | copy_recovery | VERIFIED |
| EC-A15 | Replay same operation_id | Retry IPC | Add | Replay cached result | Idempotent UI | Low | claim | CODE-SUPPORTED |
| EC-A16 | Busy operation_id | Concurrent same id | Add | Busy error | **UNVERIFIED** UI | Low | claim | CODE-SUPPORTED |
| EC-A17 | Unicode filenames | Non-ASCII names | Add | UTF-8 paths preserved | Works | Low | lifecycle fixtures | CODE-SUPPORTED |
| EC-A18 | Long paths (>260) | Windows MAX_PATH edge | Add | **UNVERIFIED** without fixture | **UNVERIFIED** | Medium | MISSING | UNVERIFIED |
| EC-A19 | Symlink as source | Symlink file | Add | Reparse rejected or fail | **UNVERIFIED** | Medium | is_reparse | PARTIAL |
| EC-A20 | Identical content different paths | Two origins, same hash | Add | Separate rows | Independent stars | Low | hash in record | CODE-SUPPORTED |

## Stars / listing

| ID | Scenario | Preconditions | Action | Actual behavior | Expected | Risk | Tests | Status |
|----|----------|---------------|--------|-----------------|--------|------|-------|--------|
| EC-L01 | Copy missing on disk | DB row exists | Open album | Origin not in `favorite_origin_paths` | No star | Low orphan DB | active_favorite_origins_in | CODE-SUPPORTED |
| EC-L02 | Copy in inactive renamed folder | Historical `Избранное` | Open album | No star | No star | Low | favorites_lifecycle | VERIFIED |
| EC-L03 | Stale IPC listing | User switched folder fast | Fetch returns | Dropped by sync guard | No wrong stars | Medium | favoritePathsServerSync | VERIFIED |
| EC-L04 | External delete of copy | Explorer deletes copy | Refresh | Star off after refetch | Star off | Medium | MISSING E2E | PARTIAL |
| EC-L05 | External add file into favorites | Foreign copy not in DB | Browse favorites | Shown as file, not origin star in parent | **UNVERIFIED** | Low | MISSING | UNVERIFIED |

## Remove / unfavorite

| ID | Scenario | Preconditions | Action | Actual behavior | Expected | Risk | Tests | Status |
|----|----------|---------------|--------|-----------------|--------|------|-------|--------|
| EC-R01 | Standard remove copy | Snapshot matches | Unfavorite | Recycle copy, DB row removed | Origin kept | High if wrong | favorites tests | VERIFIED |
| EC-R02 | Origin in local trash | Trash row linked | Unfavorite | needs_confirm / restore flows | User choice | High | trash_lifecycle_final | VERIFIED |
| EC-R03 | Origin missing | Copy exists | Unfavorite | Relocate/confirm kinds | **UNVERIFIED** UX | Medium | classify tests | VERIFIED |
| EC-R04 | Origin changed (size/mtime) | Snapshot stale | Unfavorite | `origin_changed` confirm | Confirm | Medium | classify | VERIFIED |
| EC-R05 | Copy changed | Tampered copy | Unfavorite | `copy_changed` confirm | Confirm | Medium | classify | VERIFIED |
| EC-R06 | Ambiguous origin in parent | Multiple matches | Unfavorite | `ambiguous_origin` | Confirm | High wrong restore | classify | VERIFIED |
| EC-R07 | Unknown origin | No snapshot | Unfavorite | `unknown_origin` | Confirm | High | classify | VERIFIED |
| EC-R08 | Preview then TOCTOU | File changes between | Confirm remove | revalidate plans | Safe or re-confirm | Medium | revalidate_* | CODE-SUPPORTED |
| EC-R09 | Batch partial failure | One path invalid | Batch | Per-file failed, rest continue | Partial | Medium | favorites_batch | VERIFIED |
| EC-R10 | Batch IPC total error | invoke throws | Batch | All marked failed in catch | **UNVERIFIED** fair? | Medium | final report | CODE-SUPPORTED |
| EC-R11 | Remove copy already gone | Missing file | Unfavorite | skipped / reconcile paths | Idempotent | Low | removal tests | PARTIAL |
| EC-R12 | Empty favorites folder after batch | Last file removed | Unfavorite | cleanup may remove folder + purge DB prefix | Folder gone | Low | batch summaries | CODE-SUPPORTED |
| EC-R13 | restore_origin resolution | Origin in trash | User confirms restore | Restores origin, keeps copy | I10 | High | CP restore | VERIFIED |
| EC-R14 | recycle_copy resolution | Origin in trash | User confirms recycle copy only | Copy to Windows recycle, origin in trash untouched | Safe origin | High | CP recycle | VERIFIED |
| EC-R15 | Parallel unfavorite | Second click | Unfavorite | Gate blocks | One session | Low | unfavoriteGate | VERIFIED |

## Folder / path / environment

| ID | Scenario | Preconditions | Action | Actual behavior | Expected | Risk | Tests | Status |
|----|----------|---------------|--------|-----------------|--------|------|-------|--------|
| EC-F01 | Rename favorites folder (canonical) | Role preserved | Rename | DB paths rewritten, stays active | Stars work | Medium | lifecycle + DB test | VERIFIED |
| EC-F02 | Rename to non-canonical name | Was favorites | Rename | Deactivated; stars off | **UNVERIFIED** product | Medium | lifecycle | VERIFIED |
| EC-F03 | Move album folder | OS move | Open | **UNVERIFIED** path keys | **UNVERIFIED** | High | MISSING | UNVERIFIED |
| EC-F04 | Two favorites folders | User created duplicate names | Add | `active_favorites_folder` picks marked role | One active | Medium | active_favorites_folder | CODE-SUPPORTED |
| EC-F05 | App restart mid-op | Pending logs | Boot | reconcile_on_boot | Recovery | High | CP tests | VERIFIED |
| EC-F06 | Kill app during copy | Temp file left | Restart | reconcile / orphan temp | Cleanup | Medium | copy_recovery | PARTIAL |
| EC-F07 | Path normalization `\\?\` | Extended path | Lookup | key normalization tests | Match | Low | database test | VERIFIED |
| EC-F08 | Case-only path difference | Windows case | Star lookup | path_key lowercase in locks | Consistent | Low | locks | CODE-SUPPORTED |
| EC-F09 | folder-changed event | External mkdir | Watcher | Listing refresh; favorites refetch indirect | **UNVERIFIED** | Low | MISSING | PARTIAL |
| EC-F10 | SQLite corrupted | DB open fails | Any | App-level failure | **UNVERIFIED** | Critical | MISSING | UNVERIFIED |

## Security-focused

| ID | Scenario | Risk focus | Mitigation observed | Status |
|----|----------|------------|---------------------|--------|
| EC-S01 | Add deletes origin | Origin loss | Copy-only action | VERIFIED |
| EC-S02 | Unfavorite deletes origin | Origin loss | recycle copy path; restore separate | VERIFIED |
| EC-S03 | Wrong file restored to origin | Wrong content | classify + confirm + snapshot | PARTIAL |
| EC-S04 | Path traversal in IPC paths | Escape album | resolve_source under directory | CODE-SUPPORTED |
| EC-S05 | Double apply removal | Data loss | file_op_log + reconcile | VERIFIED |
| EC-S06 | Stale star after failed add | UX lie | Overlay cleared on fail | PARTIAL |
| EC-S07 | DB/FS desync exploited | Silent corruption | NEEDS_RECONCILIATION | PARTIAL |

## Status totals (48 scenarios)

| Status | Count |
|--------|------:|
| VERIFIED | 18 |
| CODE-SUPPORTED | 17 |
| PARTIAL | 9 |
| MISSING | 1 |
| UNVERIFIED | 3 |

*(EC-A18 MISSING; several UNVERIFIED product-expectation cells remain inside PARTIAL/ CODE-SUPPORTED rows — matrix counts primary status only.)*
