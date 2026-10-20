# Smoke checklist — 003 stabilization (T049)

Короткая ручная проверка после пакетов с высоким риском. Не заменяет полный release checklist.

## Favorites / cache (B-005, C-005)

- [ ] Альбом с прогретыми 512+ thumbs → add to favorites → открыть избранное: качество ≥ origin, без долгой «первой» 256.
- [ ] Mass unfavorite: звёзды off, плитки скрыты, пустая папка избранного исчезает без ожидания recycle.
- [ ] Откат IPC: overlay снимается, диск не трогали.

## Viewer chain (B-007, C-006, B-009)

- [ ] Hover ≥100 ms → open: без холодного спиннера на JPEG.
- [ ] Быстрый next ×5: соседи грузятся, без повторного decode готового кадра.
- [ ] Первый кадр fill-screen: без «марки» 1:1 (если repro — зафиксировать ветку B-009).

## Navigation / grid

- [ ] B-001: «вниз» до конца листинга; «вверх» сразу; ручной скролл снимает follow-end.
- [ ] B-011: **только после 3-way** из `B-011_DIAGNOSIS.md` — не чинить вслепую.

## Shell (C-001, C-002, C-003, B-010)

- [ ] Empty kinds: один каркас loading/error/favorites/trash/subfolders.
- [ ] Boot notice = нижний toast (file op style).
- [ ] Settings: смена ru/en/de/zh-Hans без скачка высоты диалога.
- [ ] About → проверить обновления: mock dialog; Update disabled во время copy/delete/unfavorite.

## Запись результата

Обновить `BUGS.md` (прогресс / FIXED только после явного smoke PASS по пункту).
