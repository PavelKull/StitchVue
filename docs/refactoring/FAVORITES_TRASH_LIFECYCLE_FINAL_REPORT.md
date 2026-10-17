# FAVORITES_TRASH_LIFECYCLE_FINAL — отчёт независимой проверки

Дата проверки: 2026-10-16. Задача: `TASK-FAVORITES-TRASH-LIFECYCLE-FINAL` (`approved`, без `--seal` / `approval_hash`).

## Вердикт

| Роль | Итог | Комментарий |
|------|------|-------------|
| Автоматические тесты (in-scope) | **PASS** | См. таблицу прогонов ниже |
| Reconcile + journal (код + CP) | **PASS** | Обе ветки `reconcile_one` покрыты fault-injection |
| TASK `--strict` gate | **FAIL** | Нет печати; dirty tree (~85 файлов вне scope); шаблон задачи без §1–§5 |
| regression-guardian (ожидается) | **FAIL** (ограничение среды) | Dirty tree + forbidden_paths в рабочей копии |
| Ручной smoke | **не выполнен** | PASS только по подтверждению пользователя |

## Жизненный цикл (подтверждено по коду)

### `recycle_copy` (origin в локальной корзине)

1. **Plan** — `dispatch_origin_in_trash_*` перепланирует (`load_removal_context` + `plan_removal`), ветка `recycle_copy` → `recycle_copy_only_on_conn`.
2. **Journal** — `begin_recycle_op` → `OP_REMOVE_FROM_FAVORITES`, `source_path` = копия.
3. **FS** — `recycle_path(copy)` (корзина Windows); оригинал в `Удалённое` не трогается.
4. **SQLite** — `delete_favorite_copy_path` при успехе recycle.
5. **Finish** — `finish_recycle_op` → `ST_COMPLETED` / `ST_FAILED` / `ST_NEEDS_RECONCILIATION`.
6. **Reconcile** — `reconcile.rs`: копия на диске → `ST_FAILED`; копии нет → `delete_favorite_copy_path` + `ST_COMPLETED` (origin в trash не удаляется).

### `restore_origin`

1. **Plan** — `restore_origin` + `Plan::OriginInTrash` → `restore_origin_keep_favorite_on_conn`.
2. **Journal** — `begin_restore_origin_keep_favorite_op` → `OP_RESTORE_FROM_LOCAL_TRASH`, `source` = trash, `destination` = origin.
3. **FS** — `restore_recorded_file(trash → origin)`; копия в избранном не удаляется.
4. **SQLite** — `delete_trash` по trash-пути.
5. **Finish** — `finish_op` → `ST_COMPLETED`.
6. **Reconcile** — trash нет, origin на месте → `delete_trash` + `ST_COMPLETED`; trash ещё есть → `ST_FAILED`. Связь favorite copy сохраняется (тесты CP2/CP3).

Сценарий **C** (доступный оригинал, штатный recycle) — не менялся; `favorites_copy_recovery` 10/10.

## Таблица CP1–CP4 (fault-injection)

Симуляция: in-memory SQLite + temp-каталог (`favorites_trash_lifecycle_final::fault_injection_cp`).  
CP1 = pending до FS; CP2 = FS выполнен, SQLite ещё нет; CP3 = SQLite обновлён, journal pending; CP4 = повторный `reconcile_on_boot`.

| CP | `recycle_copy` (`OP_REMOVE_FROM_FAVORITES`) | Ожидание | Тест | Результат |
|----|---------------------------------------------|----------|------|-----------|
| CP1 | Journal есть, копия на диске | `ST_FAILED`, копия и связь, origin в trash | `recycle_copy_cp1_pending_before_fs_leaves_copy_and_origin_in_trash` | PASS |
| CP2 | Копия удалена (recycle), связь в БД | `ST_COMPLETED`, связь снята, trash origin цел | `recycle_copy_cp2_after_fs_before_sqlite_finishes_link` | PASS |
| CP3 | Копия и связь уже сняты, journal pending | `ST_COMPLETED` (идемпотентный delete) | `recycle_copy_cp3_after_sqlite_before_finish_is_idempotent` | PASS |
| CP4 | Повторный boot-reconcile | Без повторного вреда | `recycle_copy_cp4_second_reconcile_boot_is_noop` | PASS |

| CP | `restore_origin` (`OP_RESTORE_FROM_LOCAL_TRASH`) | Ожидание | Тест | Результат |
|----|--------------------------------------------------|----------|------|-----------|
| CP1 | Journal есть, trash на диске, origin пуст | `ST_FAILED`, копия+связь, trash остаётся | `restore_origin_cp1_pending_before_fs_fails_while_trash_remains` | PASS |
| CP2 | Файл в origin, trash row в БД | `ST_COMPLETED`, trash row снят, копия+связь | `restore_origin_cp2_after_fs_before_sqlite_clears_trash_row` | PASS |
| CP3 | FS + `delete_trash`, journal pending | `ST_COMPLETED` | `restore_origin_cp3_after_sqlite_before_finish_completes_journal` | PASS |
| CP4 | Двойной `reconcile_on_boot` | Идемпотентно | `restore_origin_cp4_double_reconcile_boot_is_idempotent` | PASS |

**Конфликт пути:** origin уже существует, trash ещё на диске → `ST_FAILED` (`restore_origin_conflict_origin_already_present_fails_reconcile`). Orphan trash при «origin на месте, trash исчез без journal» → `ST_NEEDS_RECONCILIATION` (ветка `else` в reconcile) — **остаточный риск**, отдельного auto-теста нет.

## Batch, идемпотентность, сессия

| Проверка | Результат |
|----------|-----------|
| Смешанный batch: `restore_origin` на ready → `skipped`; trash → `restored_origin` | `b4_mixed_batch_restore_skips_ready_recycle` PASS |
| `recycle_copy` в batch | `b2_batch_recycle_copy_resolution` PASS |
| Частичный успех: ошибка одного item не рвёт весь batch | Исправление `favorites_batch.rs` + `batch_remove_reports_per_file_failure_without_aborting_batch` PASS |
| Frontend `status: failed` из batch | `interpretRemovalOutcome` + unit test PASS |
| Stale session при mass unfavorite | Код: `finishBackgroundMassUnfavorite` / `teardownMassUnfavoritePresentation` сравнивают `sessionId` — **code review**, автотеста F11 нет |

## Подтверждённые исправления (этот проход)

1. **`favorites_batch.rs`** — per-item `Err` → `RemoveFavoriteCopyResult { status: "failed" }` вместо `?` (устраняет ложный total-fail в UI при частичной ошибке).
2. **`removeFavoritesBatch.ts` / `fileOperation.ts`** — маппинг `failed` для batch UI.
3. **`favorites_trash_lifecycle_final.rs`** — CP1–CP4, F3/F6, retry после CP1; **`favorites.rs`** — F4 dispatch (`begin_*` → FS → `reconcile_on_boot`).
4. **`GalleryPage.tsx`** — при наличии `restored_origin` в batch finish используется `summarizeUnfavoriteBatchDetailed` (F1); при `restore_origin` в trash-диалоге rollback overlay для `readyFiles` (F2).

## Прогоны тестов

| Команда | Результат |
|---------|-----------|
| `cargo test favorites_trash_lifecycle --` | 14 passed |
| `cargo test favorites_trash_lifecycle_final --` | 14 passed (incl. F6, retry) |
| `cargo test f4_dispatch --` | 2 passed |
| `npm test` (suite) | 424 passed |
| `cargo test favorites_copy_recovery --` | 10 passed |
| `cargo test favorites_batch::` | 2 passed |
| `reconcile::tests::recycle_pending_does_not_delete_remaining_file` | (в составе `cargo test reconcile`) |
| `npm run typecheck` | PASS |
| `node --experimental-strip-types --test src/shared/i18n/__tests__/i18n-check.test.ts` | PASS |
| `refactor-task-check.mjs … --strict --allow-unrelated-dirty` | **FAIL** (нет seal; WARN вне allowed_paths; ERR шаблон задачи) |

## Остаточные риски

- **Dirty working tree** — изменения вне `allowed_paths` (thumbnail, pipeline, `recycle.rs`, FIX-C1C2) мешают изолированному guardian PASS.
- **Orphan / ambiguous trash** после сбоя restore — `ST_NEEDS_RECONCILIATION` или `ST_FAILED`; возможны «залипшие» `trash_entries` до ручной уборки.
- **TOCTOU** — смена копии/origin между preview и confirm (существующие гейты snapshot, не новый дефект).
- **Mass unfavorite + IPC total failure** — `catch` в `GalleryPage` по-прежнему помечает все `work` как failed (только при полном отказе invoke, не per-file).
- **F2** — исправлен rollback overlay для ready при restore-only; UI-autotеста нет.
- **F4** покрывает `begin_*` + FS без `finish_*` + reconcile; полный panic между шагами в одном `dispatch` не симулируется.
- **Ручной smoke** — не подтверждён.

## code-auditor / regression-guardian

- [code-auditor](1fa811d0-4a16-4c9f-85bb-65ca882bf0c9): journal/reconcile **OK**; F1–F6 и retry после `ST_FAILED` закрыты тестами (см. прогоны).
- [regression-guardian](227f7f1c-3c6d-4095-a7a9-3b3e87a00366): **FAIL** из-за dirty tree (~85 путей), forbidden thumbnail/pipeline, нет seal; in-scope логика batch/trash признана согласованной с ТЗ.

## Ручная приёмка (smoke — **не PASS**, 0/10)

- [ ] Одиночное: убрать копию, оригинал в корзине
- [ ] Одиночное: восстановить оригинал, копия в избранном
- [ ] Доступный оригинал — прежнее поведение (сценарий C)
- [ ] Mass: только доступные оригиналы
- [ ] Mixed batch → «Убрать из избранного»
- [ ] Mixed batch → «Восстановить оригиналы»
- [ ] Отмена mass-диалога
- [ ] Конфликт имени при restore
- [ ] После перезапуска — звёзды и дубли
- [ ] Смена папки во время mass unfavorite

## TASK gates

- `allowed_paths`: изменения верификации только в перечисленных путях задачи (+ этот отчёт).
- Коммиты / push / R1–R7 — не выполнялись.

## Рекомендуемый порядок закрытия (Git / приёмка)

Без `reset --hard` / `clean` — сохранить все текущие изменения.

1. Зафиксировать инвентаризацию: какие пути относятся к FIX-C1C2, lifecycle FINAL, TASK-015, прочим задачам.
2. Уточнить `base_commit` для FINAL (не полагаться на `7aaa92d`, если он привязан к другой ветке/задаче).
3. При необходимости — отдельный `git worktree` только с `allowed_paths` FINAL.
4. `--seal` → `--preflight` → `--auth` → `refactor-task-check --strict` на изолированном scope.
5. Повторный [regression-guardian](227f7f1c-3c6d-4095-a7a9-3b3e87a00366) на чистом срезе.
6. Ручной smoke (чеклист ниже) — **PASS только по вашему подтверждению**.
7. Коммит(ы) после пунктов 1–6.
