# Переписывание локальной Git-истории (2026-10-16)

Документ фиксирует переписывание **сообщений** 13 локальных коммитов над опубликованной веткой `origin/main`. Содержимое деревьев (файлы проекта), авторы и даты авторства **не менялись**.

## Причина

Из сообщений коммитов удалены AI attribution trailers (в частности `Co-authored-by: Cursor <cursoragent@cursor.com>`). Обычные упоминания Cursor в тексте проекта и в теле коммитов (например, в описании инфраструктуры рефакторинга) **не** удалялись.

## Граница опубликованной истории

| Ref | SHA (полный) | Роль |
|-----|----------------|------|
| `origin/main` | `15680b2582a554a9387ec4b1530f2beb390220ce` | Последний коммит на GitHub; предок переписанной линии |
| `main` (после миграции) | `e5bdc319859fa227a7c9220ce2f2f917eae47eb0` | Очищенная локальная линия (13 коммитов над `origin/main`) |

Переписывание затрагивало только диапазон `origin/main..main` (локально). `origin/main` не изменялся.

## Соответствие коммитов (13)

Порядок: от старого к новому (первый коммит над `origin/main` → tip).

| # | Старый SHA | Новый SHA | Subject (без изменений) |
|---|------------|-----------|-------------------------|
| 1 | `639587028ce40df4b9c5867b0abd955cc02c2065` | `91a0396c87e60193e2457b9af3e18ecfb1b5950a` | chore: add refactoring docs, agents, and task-check gates |
| 2 | `1f35b7689dfe3cac8e5bbf7e30928b9e57ea1e17` | `6ab42b90518a5203861d47a893bb0a43cdcf9803` | chore: fix task approval gates and approve pilot 001 |
| 3 | `e0a3b5ec97dedd58e958aa61202d82294ac3e9de` | `1db126dda0ff1551c528bc6554993510272350b0` | fix: isolate refactor strict gate from commit history |
| 4 | `a44ed7e65f70bd84e0c73c0d41c5bd0e2bcb260a` | `d07a61ed45c6d90c0ba1044ae37da321c182abf8` | refactor(gallery): extract ttl preset helper |
| 5 | `081673c2913ddc4df2e0846cb03280fd151b3790` | `7482d1959f1a9a7dd2c9fe14fdf4a5c157eed853` | style(gallery): normalize ttl preset line endings |
| 6 | `77645d38041c10b2c1d8fc4671953dcf07085bd0` | `6f16d1fe77af8d9dec8f96c80c7a8374c94e448a` | docs: complete TASK-2026-001 |
| 7 | `0c3a16b8c85b8676d3fd6e7c68dcb3671e2aef3f` | `cd81d7af4d0144901202162843a877330999f75d` | docs: approve refactoring task 002 |
| 8 | `e8e6fa9c6c7fcbd85ad9a9ccf7c525d1028573e0` | `0a1582e8f897d202266d8e4199177ac2edf8dc3c` | refactor(gallery): extract indexing path equality helpers |
| 9 | `88f0fc5a34df776c70001c4ad9bc5a58385e5f9b` | `a1045104ddf89963b1c61ada134b9b97cc9d8111` | docs: complete TASK-2026-002 |
| 10 | `7db8a14525c1020ebc277435fad6f071f473f7da` | `7d79bedcd583b2c0e0261c11537c3651b0e98676` | docs: approve TASK-2026-003 gallery chrome peek extraction |
| 11 | `cbbac26d605f585f8160a98603a125a73af2a551` | `4aa5d6a921bb75164f98c29410b08e10d2249c45` | refactor(gallery): extract chrome peek geometry and panel peek hook |
| 12 | `1854fb1fdf46887b9ff47e456974da90e2ce8d68` | `39d19ef0b903f7428f71bb3fe2c900eda3e01d14` | docs: complete TASK-2026-003 gallery chrome peek extraction |
| 13 | `b3eef1cf71218b9bc768d9bc8c704bea5168168a` | `e5bdc319859fa227a7c9220ce2f2f917eae47eb0` | chore: configure git commit attribution rules |

### Идентичность деревьев

Для каждой строки таблицы `git rev-parse <старый>^{tree}` и `git rev-parse <новый>^{tree}` дают **одинаковый** tree SHA. Переписывание затрагивало только commit object (сообщение / hash коммита), не snapshot файлов.

Проверка (пример для одной пары):

```bash
git rev-parse 639587028ce40df4b9c5867b0abd955cc02c2065^{tree}
git rev-parse 91a0396c87e60193e2457b9af3e18ecfb1b5950a^{tree}
```

## Резервные копии

| Артефакт | Назначение |
|----------|------------|
| Ветка `backup/main-before-ai-cleanup` | Указывает на tip **до** переписывания сообщений (`b3eef1cf71218b9bc768d9bc8c704bea5168168a`). Сохраняет достижимость старых SHA в истории refs. |
| Ветка `cleanup/remove-ai-signatures` | Рабочая ветка, на которой выполнялось переписывание; после принятия очищенной линии на `main` совпадает с `main` по tip. |
| Локальный Git bundle | До переписывания создан bundle со **всеми** refs (`git bundle create … --all`). Имя по шаблону `ImageGrid-refs-backup-before-ai-cleanup-YYYYMMDD-HHmmss.bundle`, хранится **вне** репозитория (не коммитится). Восстановление: `git clone bundle-file repo-dir`. |

Резервы не удалять, пока не подтверждены push на GitHub и работа с новыми TASK.

## TASK-2026-001 / 002 / 003 и исторические SHA

Файлы задач **`status: completed`** не обновлялись при миграции истории. В них по-прежнему указаны **старые** `base_commit` и короткие SHA в §7 (`COMMITS:`), соответствующие левому столбцу таблицы выше.

| Задача | `base_commit` в файле (старый) | Эквивалент на текущей `main` |
|--------|--------------------------------|------------------------------|
| TASK-2026-001 | `639587028ce40df4b9c5867b0abd955cc02c2065` | `91a0396c87e60193e2457b9af3e18ecfb1b5950a` |
| TASK-2026-002 | `77645d38041c10b2c1d8fc4671953dcf07085bd0` | `6f16d1fe77af8d9dec8f96c80c7a8374c94e448a` |
| TASK-2026-003 | `88f0fc5a34df776c70001c4ad9bc5a58385e5f9b` | `a1045104ddf89963b1c61ada134b9b97cc9d8111` |

Старые коммиты остаются объектами в локальном репозитории (через `backup/main-before-ai-cleanup` и bundle). На линии `main` они **не** являются предками HEAD, но `git cat-file -t <старый_sha>` и `git restore --source=<старый_sha> -- …` по-прежнему применимы, пока объекты не удалены сборщиком мусора.

**Новые задачи** (например TASK-2026-004) должны использовать `base_commit: $(git rev-parse HEAD)` на момент утверждения, а не копировать `base_commit` из завершённых пилотов.

## Расхождение `approval_hash` у TASK-2026-003

Переписывание истории **не** меняло файл `TASK-2026-003.md` и **не** являлось причиной предупреждения «печать устарела».

Причина зафиксирована отдельно:

1. На коммите approve (`7db8a14` / `7d79bed`) выполнен `--seal`: `approval_hash` соответствовал контракту (YAML scope + §2–§4).
2. На коммите complete (`1854fb1` / `39d19ef`) при закрытии задачи изменены **чекбоксы ручного smoke в §4** (`[ ]` → `[x]`). Разделы §2–§4 входят в расчёт `contractHash` в `scripts/refactor-task-check.mjs`.
3. `approval_hash` в frontmatter не пересчитывался (повторный `--seal` на `completed` не выполнялся и не предполагается для архивного контракта).

Итог: печать отражает **момент утверждения**; текущий HEAD файла задачи — артефакт закрытия с расхождением только в смысле lint/gate. TASK-001 и TASK-002 при закрытии не меняли §2–§4 в части, входящей в hash, поэтому печать у них остаётся согласованной.

Правило на будущее: после `--seal` не редактировать §2–§4; результаты smoke — в §7. См. [`TASK_HANDOFF.md`](TASK_HANDOFF.md) и [`TASK_TEMPLATE.md`](TASK_TEMPLATE.md).

## Связанные документы

- [`TASK_HANDOFF.md`](TASK_HANDOFF.md) — гейты `--seal` / `--preflight` / `--auth` / `--strict`
- [`VERIFICATION.md`](VERIFICATION.md) — проверка цепочки пилота
