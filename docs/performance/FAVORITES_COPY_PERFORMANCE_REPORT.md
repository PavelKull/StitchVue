# Favorites copy performance (StitchVue)

Статус документа: **P0 закрыт**; **P1 — реализован, ожидает проверки производительности (B06 на HDD)**. Commit P1 — после зафиксированных замеров.

## 1. Карта pipeline (ADD)

| Слой | Точка входа | Следующий шаг |
|------|-------------|----------------|
| UI | Звезда сетки, `ImageViewer`, `SelectionActions` | `toggleFavoriteFile` / `runFileAction('copy_to_local_favorites')` |
| Очередь | `tryQueueFavoriteAdds` при `conflictForDirectory === busy` | intent `queued` → `drainFavoriteAddQueue` после FS-сессии |
| Optimistic | overlay + `beginFileOperation` | мгновенная звезда |
| IPC | `invoke('run_file_operation', { paths })` | `commands::run_file_operation` → `Pipeline::execute_file_operation` |
| Rust | `try_lock_paths` → journal `insert_pending_op` | `file_ops::execute` → `copy_one` (temp + `copy_bytes` + SHA256) |
| SQLite | `record_favorite_copy`, `finish_op` | `reconcile_favorites_scope` (все snapshots в scope) |
| UI confirm | `setFavoritePaths`, снятие overlay | без `favorite_origin_paths` на happy path |

Контекстное меню папок **не** добавляет в избранное (только grid / viewer / selection).

## 2. Три крупнейших источника задержки (аудит, до оптимизаций)

1. **Побайтовое копирование + SHA256 + `sync_all`** — `file_ops/mod.rs` (`copy_bytes`, `copy_one`). Доминирует на больших RAW/HDD.
2. **`DiskGate::wait_visible`** — yield при скролле/приоритете превью (`pipeline/mod.rs`). ADD может стоять во время активного скролла.
3. **`reconcile_favorites_scope` после каждого `run_file_operation`** — полный проход snapshots + FS probe (`reconcile.rs`).

Дополнительно (очередь / IPC):

- После mass unfavorite ADD ждёт `coordinatorFinishFilesystemSession`, а не только Rust locks (`favoritesOperationCoordinator` + `GalleryPage`).
- Очередь при конфликте: **1 IPC на фото** (`executeQueuedFavoriteAdd` с `paths: [one]`).
- Batch ADD IPC **отсутствует** (есть только `remove_favorite_copies_batch`).

## 3. Baseline (B01–B08)

Замеры **не заполнены** — требуются три прогона на машине пользователя (HDD/SSD по возможности).

### Как снимать

**Frontend (dev-сборка):**

- DevTools → Console: фильтр `stitchvue:favorite-perf`.
- Или `window.__stitchvueFavoritePerf()` — последние записи (без путей к файлам).

**Rust (терминал `tauri dev`):**

```powershell
$env:STITCHVUE_FAV_PERF = "1"
# опционально детальные счётчики:
$env:STITCHVUE_FAV_METRICS = "1"
npm run tauri dev
```

Строки `[stitchvue:favorite-perf] rust …` дают `lock_ms`, `journal_ms`, `copy_ms`, `links_ms`, `reconcile_ms`, `total_ms`.

**Rust bench (fixture, temp):**

```powershell
$env:STITCHVUE_FAV_METRICS = "1"
cargo test --manifest-path src-tauri/Cargo.toml favorites_bench -- --ignored --nocapture
```

### Таблица сценариев

| ID | Сценарий | Файлов | Медиана total_ms (×3) | MB/s | Примечание |
|----|----------|-------:|----------------------:|-----:|------------|
| B01 | JPG, одно ADD | 1 | — | — | |
| B02 | CR2, одно ADD | 1 | — | — | |
| B03 | JPG, подряд | 10 | — | — | |
| B04 | CR2, подряд | 10 | — | — | |
| B05 | JPG/RAW mix | 100 | — | — | |
| B06 | После mass unfavorite | 10 | — | — | `queue_wait_ms` ↓; `ipc_ms` ≈; **нет мерцания звёзд** (см. §3.1) |
| B07 | Уже есть копии | 10 | — | — | |
| B08 | Из ImageViewer | 10 | — | — | |

### 3.1 B06 — производительность и мерцание (P1 gate)

**Шаги:** mass unfavorite альбома → сразу 10 звёзд на те же origin (очередь) → наблюдать сетку во время копирования и параллельного relist/refresh.

**Метрики (×3 медиана):**

- `queue_wait_ms` — ожидается снижение относительно поведения до P1 (drain не ждёт cleanup/relist/refresh).
- `ipc_ms` — без ухудшения (копирование то же).

**Мерцание (обязательный критерий закрытия P1):**

Сценарий гонки: ADD (queued drain) **параллельно** `relistParentAfterFavoritesMassUnfavorite` + `fetchFavoriteOriginPaths`. Ответ `favorite_origin_paths` может прийти **до** появления файла в SQLite/листинге.

Ожидание: звезда не гаснет и не «дёргается».

**Существующая защита в коде (аудит, не замена B06):**

1. `resolveFavoritePathsFetch` применяет ответ только при валидном ticket (`requestId`, `revision`, открытая папка) — устаревший fetch не вызывает `setFavoritePaths`.
2. При apply merge через `diskConfirmedFavoritePaths` → `favoritePathsFromServerWithOverlay`: pending overlay с `desired: true` **добавляет** ключ даже при пустом server listing.
3. Отрисовка звезды в сетке опирается на `favoriteDisplayOn` (pending побеждает confirmed).

Ручной B06 подтверждает, что при P1-параллелизме эта цепочка достаточна; при провале — отдельный фикс (defer fetch / bump revision при queue), не откат P1 без анализа.

### 3.2 B06 lite — gate P1 без полной матрицы B01–B08

Один прогон на **HDD-альбоме** (~10 фото), dev-сборка (`npm run tauri dev`). Медианы ×3 — по желанию; для закрытия P1 достаточно качественной проверки + снимок perf.

| Шаг | Действие |
|-----|----------|
| 1 | Открыть альбом на HDD, mass unfavorite (все копии в «Избранное»). |
| 2 | Пока идёт batch / сразу после — **10 звёзд** на те же origin (очередь). |
| 3 | Смотреть сетку 30–60 с: звёзды **не мигают**, нет «зависшего» opening поверх сетки. |
| 4 | DevTools → `stitchvue:favorite-perf` или `copy(JSON.stringify(window.__stitchvueFavoritePerf(), null, 2))`. |
| 5 | Зафиксировать: PASS/FAIL мерцание; для 1–2 записей `channel:'queued'` — `queue_wait_ms`, `ipc_ms`. |

**Запись в отчёт (шаблон):**

```text
B06-lite (дата, диск HDD): flicker PASS|FAIL; queue_wait_ms: …; ipc_ms: …; заметки: …
```

После PASS → commit P1 → P2 FE-only (§8).

## 4. План оптимизаций (по приоритету ТЗ)

| Этап | Фокус | Ожидаемый эффект |
|------|--------|------------------|
| **P1** | Ранний `coordinatorFinishFilesystemSession` в `finishBackgroundMassUnfavorite` | ↓ `queue_wait_ms`; **код ✅, B06 ⏳** |
| **P2-audit** | §8 — coalesce на FE + существующий multi-path `run_file_operation` | ✅ аудит |
| **P2** | Batch IPC ADD (chunk 16) + меньше reconcile на группу | ✅ FE; замеры ⏳ |
| **P3** | Меньше лишних чтений (hash при copy, duplicate fast-path) | ↓ IO на дубликатах имён |
| **P3** | Инкрементальный reconcile вместо full scope scan | ↓ `reconcile_ms` при большом избранном |
| **P4** | Ограниченный параллелизм копий — только после замеров HDD/SSD | эксперимент |
| **P5–P6** | Reconcile/UI и статусы queued/copying | воспринимаемая скорость |

## 5. Изменённые файлы

**P0:** `favoritePerfDiag.ts`, `GalleryPage.tsx` (метрики), `favorite_perf.rs`, `pipeline/mod.rs`.

**P1:** `GalleryPage.tsx` — drain до `cleanupEmptyServiceFolder` / `relistParentAfterFavoritesMassUnfavorite` / `scheduleFolderRefresh`; тест T19.

**Пустая «Избранное» после add:** `favoritesEmptyFolderAfterAdds.ts` + `tryCleanupEmptyFavoritesFolderAfterQueuedAdds` после drain и отмены queued intent (только если нет активных intent и нет copy in-flight).

### Инварианты P1

- Rust batch unfavorite уже завершён до входа в `finishBackgroundMassUnfavorite`.
- `shouldPreserveFavoritePathDuringMassUnfavorite` учитывает queued add-intent до drain.
- При активных add-intent `cleanupEmptyServiceFolder` по-прежнему пропускается.
- Повторный `coordinatorFinishFilesystemSession` из `releaseUnfavoriteGate` — no-op (сессия уже снята).
- SHA256 / `sync_all` / `DiskGate` не менялись.

## 6. Оценка P1 (чеклист)

| Критерий | Статус |
|----------|--------|
| Устранение лишнего ожидания очереди | ✅ реализовано |
| TypeScript / автотесты (493 PASS, T01/T18/T19) | ✅ |
| Rust locks / FS copy / SHA256 / DiskGate | ✅ без изменений |
| Защита от повторного ADD | ✅ без изменений |
| Ускорение на реальном HDD | ⏳ B06 |
| Нет мерцания при параллельном fetch (§3.1) | ⏳ B06 |

**Статус этапа P1:** реализован, **ожидает проверки производительности** — не закрыт до B06.

## 7. Дорожная карта (после B06)

1. **B06** на HDD — `queue_wait_ms`, `ipc_ms`, мерцание звёзд.
2. При PASS → **commit P1** + обновлённый отчёт с медианами B06.
3. **P2-audit** — см. §8 (готово).
4. **P2-реализация** (после B06) + regression §8.5.
5. P3+ (DiskGate, hash/sync) — только после замеров, без ослабления целостности.

**P2-принцип:** сбой копирования одной фотографии не отменяет успех остальных и не искажает их звёзды.

---

## 8. P2-audit — пакетное ADD (2026-10-20)

Статус: **реализовано на FE** (chunk 16, §8.3–8.5).

### 8.1 Вывод в одну строку

**Отдельная Rust-команда `add_favorites_batch` для MVP не обязательна.** `run_file_operation` с `action: copy_to_local_favorites` и `paths: Vec<String>` уже выполняет **мультифайловое** копирование в одном IPC: общий `prepare_destination`, параллель до `copy_slots` (1–2), **per-file `FileOutcome`**, один `reconcile_favorites_scope` на вызов. Узкое место P2 — **frontend**: очередь вызывает `paths: [one]` и `await` в цикле (`drainQueuedAdds` → `executeQueuedFavoriteAdd`).

Эталон UX/частичного успеха на FE уже есть: **множественный выбор** → `runFileAction('copy_to_local_favorites', files)` (обработка `result.outcomes`, partial, journal incomplete, disk-truth после ошибки transport).

**Сейчас vs после P2 (пример, 32 фото в очереди, чанк 16):**

| | IPC | reconcile (Rust) | Физическое копирование |
|--|-----|------------------|-------------------------|
| Сейчас (queued) | 32 | 32 | 32 файла |
| После P2 | 2 (⌈32/16⌉) | 2 | 32 файла (без изменений) |

Сокращаются round-trips и повторная сверка scope, не объём IO на диске.

### 8.2 Сравнение с batch unfavorite

| | Remove batch | Add (текущий Rust) | Add (текущий queued FE) |
|--|--------------|-------------------|-------------------------|
| IPC | `remove_favorite_copies_batch` | `run_file_operation` (N paths) | N × `run_file_operation` (1 path) |
| Reconcile | per-path в removal pipeline | **1×** на IPC | **N×** reconcile |
| Ошибка одного файла | batch продолжается (`favorites_batch` test) | остальные jobs в `execute` дорабатываются | изолировано по вызову |
| Locks | DB + removal claims | `try_lock_paths` на все paths + album + dest | N раз подряд |

### 8.3 Предлагаемая форма P2 (минимальный diff)

**Слой coordinator / GalleryPage (без смены FS-семантики):**

1. **`coalesceQueuedIntents(queue, maxChunk)`** — FIFO по `sequence`; только `queued` + `desired`; **один `albumDirectory` на чанк** (совместимый каталог назначения); дедуп по `photoKey`. **`maxChunk = 16` в v1**; увеличивать только после замеров (RAW на HDD, отзывчивость).
2. **`executeQueuedFavoriteAddBatch(intents[])`** — один `operationId` на чанк, `paths: intents.map(photoPath)`, один `beginFileOperation` / `endFileOperation`, perf `file_count = N`.
3. **Разбор ответа** — ветка multi-file `copy_to_local_favorites` из `runFileAction`; per-file: `completed` | `failed` | `cancelled`; overlay по generation на файл.
4. **`drainQueuedAdds`** — цикл по чанкам: coalesce → executing → batch IPC → terminal по каждому intent.
5. **Ошибки IPC / locks (уточнение):**
   - **До старта** (invoke Err, conflict message, `Claim::Busy`) — чанк **не** считать выполненным; допустим fallback: пополам или по одному, **без** повторного blind copy уже успешных путей.
   - **После частичного Ok** (`result.outcomes` смешанные) — **не** re-run весь чанк; зафиксировать per-file, для неизвестных только disk-truth (`classifyAttemptedFavoriteAddsAgainstDisk` / `refetchFavoriteOriginPathsAfterIpcFailure`).
   - **Transport error без DTO** — сначала disk-truth по paths чанка, затем overlay rollback только для не подтверждённых; не `clearFavoriteOverlayForOperation` на весь batch id вслепую.
6. **Отзывчивость** — длинный batch держит `try_lock_paths` на все origins чанка; на HDD+RAW проверить скролл/превью вручную; при жалобах — уменьшить chunk (8) до смены DiskGate.

**Rust (опционально, не для MVP):**

- Чанкование locks внутри pipeline при очень больших N.
- Общий scan-cache как у `BatchRemovalScanCaches` — только если профилирование покажет лишний IO на duplicate-check между файлами в одном альбоме.

**Не делать в P2:** менять SHA256, `sync_all`, `DiskGate`, ослаблять `try_lock_paths`.

### 8.4 Инварианты и риски

| Инвариант | Как сохранить |
|-----------|----------------|
| Один файл — не два параллельных ADD | `isFavoriteOverlayBlockingAdd` + coordinator `executing`; в чанке дедуп keys |
| Unfavorite vs add | `conflictForDirectory` без изменений; drain только когда `free` |
| Optimistic звезда | pending до per-file success; rollback по generation как в multi-select |
| Stale listing / fetch | без изменений guard + overlay merge (§3.1) |
| Отмена звезды в очереди | `revision` / `cancelled` до `markExecuting` — файл выпадает из чанка |
| Ошибка файла A не трогает B | полагаться на Rust per-job outcomes; FE terminal `failed` только для A |
| Replay `file_ops::claim` | **один `operationId` на чанк** (не смешивать с per-intent overlay ids в claim) |

**Риски:**

- **Большой чанк** — дольше держит path locks на весь альбом + все origins; при unfavorite в соседней сессии — conflict. Меньший chunk снижает пик блокировки.
- **Transport error на batch** — откат overlay на весь `operationId` в catch сейчас; для batch нужен disk-truth по **списку paths чанка**, не `clearFavoriteOverlayForOperation` на один id.
- **Прогресс UI** — один progress stream на чанк (уже есть `file-operation-progress` с `total`/`processed`).

### 8.5 Тесты для P2-реализации

| ID | Смысл |
|----|--------|
| T20 | `coalesceQueuedIntents`: FIFO, дедуп, respect revision/cancelled |
| T21 | mock executor: один batch call на 3 intents |
| T22 | partial outcomes → completed/failed per intent |
| T23 | conflict **до** execute → fallback singles; partial Ok → без повторного batch |
| Regression | T01/T04/T03/T14/T18 + multi-select add tests |

### 8.6 Ожидаемый эффект (гипотеза до B06/P2-bench)

- **IPC:** 10 queued ADD → 1 (или ⌈10/chunk⌉) вместо 10.
- **`reconcile_ms` (Rust):** ~10× ↓ на серии (один reconcile на чанк).
- **`ipc_ms` wall:** ↓ за счёт round-trips; **полезный copy IO** тот же (по-прежнему 1–2 slots).
- **`queue_wait_ms`:** уже P1; P2 не заменяет.

### 8.7 Порядок работ (согласовано)

1. **B06 lite** (§3.2) → закрыть P1 → **отдельный commit P1** + отчёт.
2. **P2 FE-only** (`run_file_operation`, chunk 16) + T20–T23.
3. **Regression** (§8.5) + B03/B06 с `STITCHVUE_FAV_PERF=1` (сравнить число `rust …` / суммарный `reconcile_ms`).
4. Отдельный commit P2 после замеров — откат по этапам без смешения с P1.
