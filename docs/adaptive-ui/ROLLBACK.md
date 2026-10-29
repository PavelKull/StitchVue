# Откат адаптивного UI (feature/adaptive-ui-panels)

## Baseline (стабильный интерфейс до эксперимента)

- **SHA:** `40e42d1` — `release: prepare StitchVue 0.1.6`
- **Ветка:** `main` (на момент старта работ)

## Экспериментальная ветка

- **Имя:** `feature/adaptive-ui-panels`
- **Итоговый SHA:** `29a6a98` (последний adaptive-ui; см. также `1db94d8` при откате по частям)

## Локальный откат (предпочтительно)

1. Сохранить или отложить посторонние незакоммиченные правки (например gallery order), если они ещё в дереве.
2. Переключиться на стабильную базу:

```powershell
git switch main
git log -1 --oneline 40e42d1
```

3. Убедиться, что нужное состояние — коммит `40e42d1`:

```powershell
git switch --detach 40e42d1
```

или создать ветку восстановления:

```powershell
git switch -c restore/pre-adaptive-ui 40e42d1
```

4. **Не использовать** `git reset --hard`, `git clean -fd`, force push.

## Если adaptive-ui уже влит в общую ветку

Откатить коммиты эксперимента через revert (сохраняет историю):

```powershell
git log --oneline main..feature/adaptive-ui-panels
git revert <sha-1> <sha-2> ...   # от новых к старым, или revert диапазона
```

## Что удаляет откат

- `--pg-ui-scale` на `.shell` и масштабируемые токены в `_design-tokens.scss`
- Обновления mixins `_floating-panel`, Top/Bottom bar, FolderSidebar
- `adaptiveUiScale.ts` и масштабирование peek-геометрии
- Документы `docs/adaptive-ui/*`

Галерея (layout, zoom, виртуализация) при корректном откате chrome возвращается к прежнему поведению.

## Незавершённые локальные изменения (на старте)

В дереве были **не связанные** с adaptive-ui правки в `galleryOrder.ts`, `GalleryPage.tsx`, `UpdateDialog.tsx`. Они **не входят** в коммиты adaptive-ui; перед merge на `main` их нужно оформить отдельно или убрать вручную.
