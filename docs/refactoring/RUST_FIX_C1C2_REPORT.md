# FIX-C1C2 — отчёт о реализации

**Задача:** `TASK-RUST-FIX-C1C2`  
**Ветка:** `fix/rust-fix-c1c2`  
**База:** `464ac686c709ba57c661921c8fa3711c2df48947`  
**Дата:** 2026-10-16

## Участие агентов

| Агент | Фактическое участие |
|-------|---------------------|
| architecture-coordinator | Границы: только journal/reconcile/link; без R6/R7 (в рамках сессии исполнителя) |
| backend-decomposition | Минимальный diff: `execute` + journal, `update_pending_destination`, reconcile helper |
| code-auditor | Подтверждение C1/C2 по коду до правок; пост-проверка через тесты T1–T11 |
| backend-executor | Реализация и тесты |
| regression-guardian | Read-only чеклист ниже; полный `--strict` на чистом дереве — пользователю после изоляции diff |

Отдельные субагент-сессии в этом прогоне не запускались; логика согласована с [`RUST_ARCHITECTURE_AUDIT.md`](RUST_ARCHITECTURE_AUDIT.md).

## Первопричины

### C1

`Pipeline::execute_file_operation` создавал `file_op_log` для `OP_ADD_TO_FAVORITES` с `destination_path: None`. Итоговый путь выбирается в `copy_one` (`claim_free`) **после** pending. При сбое после копирования reconcile не мог восстановить связь по journal.

### C2

При ошибке `record_favorite_link` операция переводилась в `ST_FAILED`, а `FileOutcome.status` — в `failed`, хотя копия на диске уже существовала. Записи со `ST_FAILED` не попадают в `unfinished_ops`, восстановление на boot не выполнялось.

## Изменённые файлы

| Файл | Изменение |
|------|-----------|
| `database/mod.rs` | `update_pending_destination` |
| `file_ops/mod.rs` | `file_op_log_id`, journal hook в `execute`/`copy_one`, сигнатура `execute(..., journal)` |
| `pipeline/mod.rs` | Journal для favorites; C2: `ST_NEEDS_RECONCILIATION`, outcome остаётся `copied`/`already_exists` |
| `file_ops/reconcile.rs` | `reconcile_add_to_favorites`: SHA-256 match, идемпотентность, неоднозначность → `ST_NEEDS_RECONCILIATION` |
| `file_ops/favorites_copy_recovery.rs` | Тесты T1–T11 (+ boot reconcile) |
| `file_ops/favorites_lifecycle.rs`, `favorites_bench.rs` | `execute(..., None)` |

IPC/commands **не менялись**.

## Последовательность FS / SQLite

### До

1. `insert_pending_op` (dest = None)  
2. `copy_one` → файл на диске  
3. `record_favorite_link` / `finish_op`  
4. Сбой между 2–3 → reconcile без dest

### После

1. `insert_pending_op` (dest = None, как раньше — путь ещё не выбран)  
2. `claim_free` → **`update_pending_destination`** (до temp/copy)  
3. Копирование  
4. `record_favorite_link` → `ST_COMPLETED` или **`ST_NEEDS_RECONCILIATION`** (копия сохраняется, outcome не `failed`)  
5. Boot: `reconcile_on_boot` → `reconcile_add_to_favorites` по dest + hash

## Восстановление и неоднозначность

- Есть dest в journal и копия совпадает с origin по SHA-256 → `record_favorite_copy`, `ST_COMPLETED`.  
- Связь уже есть для того же origin → `ST_COMPLETED` (идемпотентность).  
- Файл на dest не совпадает с origin → `ST_NEEDS_RECONCILIATION`, файл не удаляется.  
- Нет dest / нет копии / нет origin для проверки → `ST_NEEDS_RECONCILIATION` или безопасный отказ без удаления.

## Тесты

Модуль `favorites_copy_recovery` + существующие `reconcile::tests`:

| ID | Покрытие |
|----|----------|
| T1 | journal + успешное копирование |
| T2 | дубликат pending insert |
| T4/T4-boot | reconcile / boot |
| T5 | NEEDS_RECONCILIATION → recover |
| T6 | двойной reconcile |
| T7 | повторное добавление, `already_exists` |
| T8–T9, T11 | origin/copy/ambiguous |

T3, T10, T12 — частично покрыты существующими `file_ops`/`reconcile` тестами; при необходимости — отдельный этап.

## Результаты проверок

| Проверка | Результат |
|----------|-----------|
| `cargo fmt --check` | OK |
| `cargo test favorites_copy_recovery --` | 10/10 OK |
| `cargo test reconcile --` | OK |
| `cargo test --lib` | 172 pass; 1 fail `scanner::listing_cache::tests::invalidation_during_inflight_prevents_stale_cache_store` (вне scope, не связан с FIX-C1C2) |
| `node scripts/refactor-task-check.mjs … --seal` | FAIL на грязном дереве (посторонний diff); после добавления §1 — повторить на изолированной ветке |
| IPC | Без изменений |

## Guardian / инварианты I1–I10

| Инвариант | Статус |
|-----------|--------|
| I1–I3, I7 | Сохранены (тесты + логика) |
| I4 | Явно: FS и SQLite не атомарны |
| I5–I6 | Reconcile идемпотентен (T6) |
| I8–I9 | Без перезаписи; ambiguous → NEEDS_RECONCILIATION |
| I10 | UI звёзд не менялся |

## Локальные коммиты

Не создавались (по инструкции).

## Оставшиеся риски

- Pending всё ещё создаётся с `destination_path: None` до `claim_free`; journal обновляет строку сразу после резервирования имени (до temp). Если сбой между insert и journal — поведение как раньше (редкий узкий интервал).  
- `update_pending_destination` игнорирует ошибки в journal closure (`let _ =`); сбой SQLite при journal не останавливает копирование — отдельное улучшение.  
- Полный `cargo test --lib` на CI должен учитывать flaky `listing_cache` тест.

## Ручной smoke (для пользователя)

1. Добавить несколько фотографий в избранное.  
2. Проверить копии в папке «Избранное».  
3. Проверить звёзды у оригиналов.  
4. Удалить одну копию штатным способом; оригинал на месте.  
5. Повторно добавить ту же фотографию.  
6. Перезапустить приложение.  
7. Связи и звёзды должны совпадать с ожиданием.

**Smoke не отмечен выполненным** — требуется подтверждение пользователя.

## Следующий шаг

После smoke: `--seal` / `--preflight` / `--strict` на чистом diff, guardian, коммит по запросу. **R1–R7 не начинать** без отдельной задачи.
