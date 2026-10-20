# IPC StitchVue (Tauri)

Индекс команд и событий. Регистрация: `src-tauri/src/lib.rs` (`invoke_handler`). Реализации: `src-tauri/src/commands/mod.rs`. Потоки: [`ARCHITECTURE.md`](ARCHITECTURE.md).

Не копировать тела функций сюда — править код, затем этот индекс.

## Команды по группам

### Каталог и сессия

| Команда | Назначение (по сигнатуре) |
|---------|---------------------------|
| `browse_directory` | Listing каталога; эмит `images-batch` при живой сессии |
| `begin_directory_session` | `Pipeline::begin_session` |
| `start_indexing` | Индексация файлов сессии |
| `reorder_indexing` | Переупорядочить board files |
| `set_visible_range` | Viewport + focus + tier |
| `set_geometry_range` | Окно геометрии/метаданных |
| `set_scrolling` | Режим скролла / ahead |
| `directory_accessible` | Доступность пути |

### Кэш и storage

| Команда | Назначение |
|---------|------------|
| `clear_cache` / `cache_usage` | Очистка / usage |
| `set_cache_limit` / `set_cache_ttl` | Лимиты TTL |
| `set_storage_profile` | HDD/SSD → `StorageChoice` |
| `pipeline_stats` | `PipelineStats` |

### Папки / библиотека UI

| Команда | Назначение |
|---------|------------|
| `list_subfolders` / `list_drives` | Навигация |
| `remember_folder` / `recent_folders` | Недавние |
| `toggle_favorite` / `favorite_folders` | Закладки папок (не copy-избранное фото) |
| `folder_menu_options` / `rename_folder` | Контекстное меню |
| `open_in_explorer` | Открыть папку в Проводнике |
| `remove_empty_service_folder` / `cleanup_empty_service_folder` | Сервисные папки |

### Prefetch / viewer

| Команда | Назначение |
|---------|------------|
| `prefetch_folder` / `cancel_folder_prefetch` | Prefetch папки |
| `prefetch_photo` / `cancel_photo_prefetch` | Prefetch фото |
| `set_viewer` / `viewer_source` / `viewer_frame` | Viewer |
| `image_properties` | Свойства файла |
| `rotate_display_clockwise` / `list_display_rotations` | Поворот отображения |

### Избранное (копии) и корзина

| Команда | Назначение |
|---------|------------|
| `favorite_origin_paths` / `favorite_origins_for_copies` | Связи origin↔copy |
| `preview_remove_favorite_copy(s)` / `remove_favorite_copy` / `remove_favorite_copies_batch` | Снятие копий |
| `undo_favorite_removal` / `discard_favorite_undo` | Undo |
| `restore_local_trash` / `recycle_local_trash_file` / `recycle_local_trash_folder` | Локальная корзина |
| `describe_local_trash_folder` / `trash_entry_origin` | Метаданные trash |

### Файловые операции (batch)

| Команда | Назначение |
|---------|------------|
| `run_file_operation` | `Action` + paths; progress emit |
| `cancel_file_operation` | Отмена по `operation_id` |

### Прочее

| Команда | Назначение |
|---------|------------|
| `resolve_external_drop` | Drop → `ExternalDropTarget` |
| `open_external_link` | Внешние ссылки |
| `prototype_window_anim` | Прототип анимации окна |

Frontend invoke-обёртки (фрагмент): `src/features/select-folder/selectFolder.ts` (`browseDirectory`), массовые `invoke` в `GalleryPage.tsx`.

## События (emit → listen)

| Событие | Emit | Listen / типы |
|---------|------|----------------|
| `images-batch` | `browse_directory` (`commands/mod.rs`) | `galleryPipelineEvents.ts`; тип `ImagesBatchEvent` — `imagesBatch.ts` |
| `metadata-batch` | `pipeline/mod.rs` | `MetaEvent[]` в `galleryPipelineEvents.ts` |
| `thumbnail-ready` | `pipeline/mod.rs` | `ThumbEvent` |
| `thumbnail-failed` | `pipeline/mod.rs` | `FailEvent` |
| `folder-changed` | watcher в `pipeline/mod.rs` | `{ folder, session }` |
| `file-operation-progress` | `run_file_operation` | `FileOperationProgress` — `fileOperation.ts` |
| `window-anim-sample` | window anim path | `prototypeWindowAnim.ts` |

## Ключевые DTO (ссылки)

| Контракт | Где |
|----------|-----|
| `SourceFile` | `pipeline/mod.rs` (path, size, modifiedAt) |
| `DirectoryView` / listing | frontend `entities/folder/types`; backend scanner return of `browse_directory` |
| `FileOperationResult` / `FileOutcome` | Rust `file_ops/mod.rs`; TS `fileOperation.ts` |
| `Action` strings | `"move_to_local_trash"` \| `"copy_to_local_favorites"` |
| `FavoriteBatchRemoveItemDto` | `commands/mod.rs` |
| `PipelineStats` / `ViewerSource` | `pipeline/mod.rs` |
| `StorageChoice` | `commands/mod.rs` |
| `CacheUsage` | `cache/mod.rs` |

**UNVERIFIED:** полный JSON schema каждого DTO без чтения всех `Serialize` полей — при смене контракта сверять оба конца (Rust + TS), не только этот индекс.
