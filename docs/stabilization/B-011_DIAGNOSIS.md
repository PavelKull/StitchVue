# B-011 — диагностика (US11 / T035)

**Дата:** 2026-03-20  
**Статус:** кодовый разбор выполнен; ручная 3-way в DevTools — **обязательна** перед T036.  
**Связи:** B-001 (хвост mosaic / `pendingScrollToEnd`), FR-D05.

## Симптом (из BUGS.md)

Тёплая папка (лоудер вниз/вверх погас), быстрый скролл или прыжок в конец: пустые слоты или «пустой» viewport, затем миниатюры появляются **пачкой**.

## Три ветки (обязательное различение)

| Ветка | Что видит пользователь | Что проверять в DevTools |
|-------|------------------------|---------------------------|
| **A — Map miss** | Плитка есть, **placeholder** (иконка + имя / «загрузка») | `thumbsRef` / React: для `data-photo-key` нет записи с `tier >= 256` и нет `failed` |
| **B — Layout hole** | Пустое место **без** `.photo` (только spacer) | `rowsCovering` не отдаёт ряд для индекса; `publishedEnd < index` или `trustedAspect === null` |
| **C — Blank `<img>`** | Плитка есть, **`<img src=…>`** без картинки (naturalWidth 0) | `thumbs.get(path)` есть, в DOM `<img>` с `src`, decode/paint WebView2 |
| **D — Batch re-paint** | Картинки были/не были; **все** обновляются в один кадр | Всплеск `thumbnail-ready` → один rAF → `flushThumbnailBatch` → `setThumbVersion` |

Ветки **не взаимоисключающие** (например A на краю overscan + D после остановки скролла).

## Карта кода

### Виртуализация и слоты

- Окно рядов: `photoScrollTop - layoutHeight` … `photoScrollTop + layoutHeight * 2` (≈3 высоты viewport), не «−1vh» из старой заметки в BUGS.md.

```820:826:src/widgets/gallery-grid/StitchVueGrid.tsx
  const visibleRows =
    paintedLayout.segments.length === 0
      ? []
      : rowsCovering(
          paintedLayout,
          Math.max(0, photoScrollTop - layoutHeight),
          photoScrollTop + layoutHeight * 2,
        );
```

- Рендер: `thumb ? <img src={convertFileSrc(...)} /> : <placeholder />` — ветка A однозначна по DOM.

```1079:1098:src/widgets/gallery-grid/StitchVueGrid.tsx
                {thumb ? (
                  <img
                    src={convertFileSrc(thumb.thumbnailPath)}
                    ...
                  />
                ) : (
                  <span className={styles.placeholder}>
```

- `thumbs` приходит как `thumbsRef.current` из `GalleryPage`; обновление UI после IPC — через `thumbVersion` / `paintVersion` на spacer (`data-paint`). **Скролл** перерисовывает сетку через локальный `scrollTop` без нового `thumbVersion`; для уже записанных в Map путей плитка должна сразу брать `thumb` (ветка C, не A).

### Mosaic «дыры» (ветка B)

- `GEOMETRY_FIRST` + mosaic/columns: `layoutMosaicPublished` публикует ряды только до `commitUntil`; хвост — `estimateUniformTail` **без** тайлов (`publishedEnd` < `files.length`).

```385:388:src/widgets/gallery-grid/layout.ts
 * Mosaic rows from trusted sizes only. Unknown files contribute estimated
 * scrollbar height and are not turned into tiles.
```

- Условия B: `listingComplete === false`, или `trustedAspect(file) === null` (нет meta height), или прыжок в конец при растущем `scrollHeight` (B-001) до догонки layout.

- При **погасшем** лоудере: `folderThumbnailsPending` false ⇒ у каждого файла в listing есть base tier или fail (`folderThumbnailsPending.ts`). Это **не гарантирует** `publishedEnd === files.length`, если meta дырявая при `listingComplete`.

### Пакетное появление (ветка D)

```130:162:src/features/gallery/model/pipeline/galleryPipelineEvents.ts
    const unlistenThumb = listen<ThumbEvent>("thumbnail-ready", (event) => {
      ...
      pending.set(event.payload.path, { ... });
      ...
      thumbFrame = window.requestAnimationFrame(() => {
        thumbFrame = 0;
        void flushThumbnailBatch(pending, refs.thumbsRef.current, afterFlush, onBaseReady);
      });
```

- `flushThumbnailBatch`: для **каждого** пути в пакете `new Image()` + `await image.decode()` **до** `target.set` и одного `setThumbVersion` в `done()`.
- Пока пакет в полёте, новые пути в кадре остаются на **placeholder** (A), даже если JPEG уже на диске в Rust.
- После остановки скролла режим уходит с `fastScrolling` → снова возможен P4 upgrade (`pipeline/mod.rs`); всплеск `thumbnail-ready` даёт типичную «пачку» (D), не обязательно пустой viewport.

### Rust (исключено как «стёрли Map»)

- `LoadMode::FastScrolling`: нет P4, есть P2/P3 overscan — **не очищает** frontend `thumbsRef`.
- Очистка Map только при смене папки / hot-cache в `GalleryPage.tsx`.

## Сценарии и ожидаемая доминирующая ветка

| Сценарий | Вероятная ветка | Примечание |
|----------|-----------------|------------|
| Быстрый wheel, лоудер погас, placeholder на новых плитках | **A → D** | Map ещё не обновлён до decode пакета; маловероятно для «все уже 256» |
| Тот же, но `<img>` с src, серый прямоугольник | **C** | Virt remount + WebView2; кэш Map уже есть |
| Прыжок «вниз» до `listingComplete` / без meta | **B** (+ B-001) | Spacer без `.photo` |
| Прыжок «вниз», лоудер погас, пустой низ без плиток | **B** или **B-001** | Проверить `publishedEnd`, `listingComplete`, meta по последним индексам |
| Стоим внизу после рывка — всё вспыхнуло разом | **D** | Смотреть Performance: один rAF + много decode; tier 512/1024 |
| Вся лента исчезла (нет плиток вообще) | layout / `paintedLayout.segments` | Не B-011 классика; отдельный баг |

## Протокол ручной проверки (5–10 мин)

1. Большая папка, mosaic, дождаться погасания лоудера на кнопке прыжка.
2. **Fast wheel** по середине списка: на 2–3 остановках открыть DevTools → Elements, выбрать `.photo` в viewport.
3. Для каждой плитки заполнить таблицу:

   - Есть ли `.photo`? (да/нет)  
   - Есть ли `<img>` или `.placeholder`?  
   - Если img: `naturalWidth` / `complete`  
   - В консоли (временный хук): есть ли thumb tier ≥ 256 для `file.path` — *или* breakpoint на `flushThumbnailBatch` / счётчик `thumbnail-ready` за 200 ms.

4. Повторить **прыжок вниз** (кнопка) сразу после погасания лоудера и через 30 с простоя.
5. Записать, какая ветка **чаще** (A/B/C/D). Без этого T036 не открывать.

### Подсказка для консоли (одноразово в dev)

В `GalleryPage` при отладке можно логировать только при `performance.now()` окне после wheel — не обязательно коммитить.

## Кандидаты на T036 (только после подтверждения ветки)

| Подтверждено | Минимальное направление | Не делать |
|--------------|-------------------------|-----------|
| **C** | Держать src в окне (pool / не размонтировать img за пределами 3×viewport), или синхронный src без ожидания decode в batch для tier уже в Map | Отключать virt |
| **A** (тёплый кэш) | Запись в Map до `image.decode()` для повторного пути / sync read из disk cache | Поднимать HDD parallelism |
| **D** | Разбить `flushThumbnailBatch`: commit Map сразу, decode опционально; или лимит размера пакета + несколько rAF | Слепо расширять overscan |
| **B** | Дожим B-001 / meta для хвоста, не thumb pipeline | Blame Rust FastScrolling |

## Чистая классификация (unit)

См. `src/features/gallery/lib/diagnosis/b011SlotKind.ts` — только слой данных React (без DOM). `blank-img` остаётся ручной проверкой.

## Итог кодового разбора

- **Rust / FastScrolling** не объясняет исчезновение уже записанных thumbs.  
- **Наиболее правдоподобно для «тёплой» папки:** **C** (remount + paint) и/или **D** (пакетный flush + один `thumbVersion`).  
- **Для прыжка в конец:** сначала исключить **B** и связку с **B-001**.  
- **T036 заблокирован** до одной строки в протоколе: «доминирует ветка X на сценарии Y».
