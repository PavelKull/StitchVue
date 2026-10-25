use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::pipeline::{Pipeline, SourceFile};
use crate::scanner::{self, DirectoryView, FolderShortcut};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageChoice {
    profile: String,
}

#[tauri::command]
pub async fn browse_directory(
    app: AppHandle,
    pipeline: State<'_, Pipeline>,
    path: Option<String>,
    session: u64,
) -> Result<DirectoryView, String> {
    let pipeline = (*pipeline).clone();
    tauri::async_runtime::spawn_blocking(move || match path.as_deref() {
        None => scanner::browse(None),
        Some(folder) => {
            let folder_path = std::path::Path::new(folder).to_path_buf();
            scanner::list_directory_with(&folder_path, &mut |batch| {
                if pipeline.session() != session {
                    return;
                }
                let mut batch = batch.clone();
                batch.session = session;
                let _ = app.emit("images-batch", batch);
            })
        }
    })
    .await
    .map_err(|err| format!("browse task failed: {err}"))?
}

#[tauri::command]
pub fn begin_directory_session(pipeline: State<Pipeline>, session: u64, folder: Option<String>) {
    pipeline.begin_session(session, folder);
}

#[tauri::command]
pub fn start_indexing(
    pipeline: State<Pipeline>,
    folder: String,
    files: Vec<SourceFile>,
    session: u64,
) {
    pipeline.index(folder, files, session);
}

#[tauri::command]
pub fn set_visible_range(
    pipeline: State<Pipeline>,
    start: usize,
    end: usize,
    focus_start: usize,
    focus_end: usize,
    tier: u32,
) {
    pipeline.set_visible(start, end, focus_start, focus_end, tier);
}

#[tauri::command]
pub fn set_geometry_range(pipeline: State<Pipeline>, start: usize, end: usize) {
    pipeline.set_geometry(start, end);
}

#[tauri::command]
pub fn set_scrolling(pipeline: State<Pipeline>, mode: String, ahead: i32) {
    pipeline.set_scrolling(&mode, ahead);
}

#[tauri::command]
pub fn reorder_indexing(pipeline: State<Pipeline>, files: Vec<SourceFile>) {
    pipeline.order(files);
}

#[tauri::command]
pub fn set_storage_profile(pipeline: State<Pipeline>, mode: String) -> StorageChoice {
    let profile = pipeline.set_profile(&mode);
    StorageChoice {
        profile: match profile {
            crate::storage::StorageProfile::Hdd => "hdd".to_string(),
            crate::storage::StorageProfile::Ssd => "ssd".to_string(),
        },
    }
}

#[tauri::command]
pub fn clear_cache(pipeline: State<Pipeline>) -> Result<(), String> {
    pipeline.clear_cache()
}

#[tauri::command]
pub fn cache_usage(pipeline: State<Pipeline>) -> Result<crate::cache::CacheUsage, String> {
    pipeline.usage()
}

#[tauri::command]
pub fn set_cache_limit(
    pipeline: State<Pipeline>,
    bytes: i64,
) -> Result<crate::cache::CacheUsage, String> {
    pipeline.set_cache_limit(bytes)
}

#[tauri::command]
pub fn set_cache_ttl(
    pipeline: State<Pipeline>,
    preset: String,
) -> Result<crate::cache::CacheUsage, String> {
    pipeline.set_cache_ttl(&preset)
}

#[tauri::command]
pub async fn list_subfolders(path: String) -> Result<Vec<FolderShortcut>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        scanner::list_subfolders(std::path::Path::new(&path))
    })
    .await
    .map_err(|err| format!("list folders task failed: {err}"))?
}

#[tauri::command]
pub async fn list_drives() -> Result<Vec<FolderShortcut>, String> {
    tauri::async_runtime::spawn_blocking(scanner::list_drives)
        .await
        .map_err(|err| format!("list drives task failed: {err}"))?
}

#[tauri::command]
pub fn remember_folder(
    pipeline: State<Pipeline>,
    path: String,
    name: String,
) -> Result<(), String> {
    pipeline.remember_folder(&path, &name)
}

#[tauri::command]
pub fn toggle_favorite(
    pipeline: State<Pipeline>,
    path: String,
    name: String,
) -> Result<bool, String> {
    pipeline.toggle_favorite(&path, &name)
}

#[tauri::command]
pub fn recent_folders(pipeline: State<Pipeline>) -> Result<Vec<FolderShortcut>, String> {
    pipeline.recent_folders()
}

#[tauri::command]
pub fn favorite_folders(pipeline: State<Pipeline>) -> Result<Vec<FolderShortcut>, String> {
    pipeline.favorite_folders()
}

#[tauri::command]
pub fn viewer_frame(
    pipeline: State<Pipeline>,
    path: String,
    size: u64,
    modified_at: i64,
    long_edge: u32,
) -> crate::pipeline::ViewerOffer {
    pipeline.viewer_frame(&path, size, modified_at, long_edge)
}

#[tauri::command]
pub fn viewer_source(
    pipeline: State<Pipeline>,
    path: String,
    size: u64,
    modified_at: i64,
    preview_only: Option<bool>,
) -> Result<crate::pipeline::ViewerSource, String> {
    pipeline.viewer_source(&path, size, modified_at, preview_only.unwrap_or(false))
}

#[tauri::command]
pub fn prefetch_folder(
    pipeline: State<Pipeline>,
    path: String,
    order: String,
    first_count: usize,
    extra_count: usize,
) {
    pipeline.prefetch_folder(path, order, first_count, extra_count);
}

#[tauri::command]
pub fn cancel_folder_prefetch(pipeline: State<Pipeline>) {
    pipeline.cancel_folder_prefetch();
}

#[tauri::command]
pub fn prefetch_photo(
    pipeline: State<Pipeline>,
    path: String,
    size: u64,
    modified_at: i64,
    long_edge: u32,
) -> crate::pipeline::ViewerOffer {
    pipeline.prefetch_photo(&path, size, modified_at, long_edge)
}

#[tauri::command]
pub fn cancel_photo_prefetch(pipeline: State<Pipeline>) {
    pipeline.cancel_photo_prefetch();
}

#[tauri::command]
pub fn set_viewer(
    pipeline: State<Pipeline>,
    path: Option<String>,
    ahead: Option<u32>,
    fast: Option<bool>,
    direction: Option<i32>,
) {
    pipeline.set_viewer(
        path,
        ahead.unwrap_or(5),
        fast.unwrap_or(false),
        direction.unwrap_or(0),
    );
}

#[tauri::command]
pub fn pipeline_stats(pipeline: State<Pipeline>) -> crate::pipeline::PipelineStats {
    pipeline.stats()
}

#[tauri::command]
pub fn favorite_origin_paths(
    pipeline: State<Pipeline>,
    directory: String,
) -> Result<Vec<String>, String> {
    pipeline.favorite_origins_in(&directory)
}

#[tauri::command]
pub fn folder_menu_options(
    pipeline: State<Pipeline>,
    parent_directory: String,
    folder_path: String,
) -> Result<crate::file_ops::FolderMenuOptions, String> {
    pipeline.folder_menu_options(&parent_directory, &folder_path)
}

#[tauri::command]
pub fn rename_folder(
    pipeline: State<Pipeline>,
    parent_directory: String,
    folder_path: String,
    new_name: String,
) -> Result<String, String> {
    pipeline.rename_folder(&parent_directory, &folder_path, &new_name)
}

#[tauri::command]
pub fn remove_empty_service_folder(
    pipeline: State<Pipeline>,
    parent_directory: String,
    folder_path: String,
) -> Result<crate::file_ops::ServiceFolderLocation, String> {
    pipeline.remove_empty_service_folder(&parent_directory, &folder_path)
}

#[tauri::command]
pub fn cleanup_empty_service_folder(
    pipeline: State<Pipeline>,
    parent_directory: String,
    folder_path: String,
) -> crate::file_ops::ServiceFolderCleanupResult {
    pipeline.cleanup_empty_service_folder(&parent_directory, &folder_path)
}

#[tauri::command]
pub async fn remove_favorite_copy(
    pipeline: State<'_, Pipeline>,
    path: String,
    confirmed: Option<bool>,
    resolution: Option<String>,
) -> Result<crate::file_ops::RemoveFavoriteCopyResult, String> {
    let pipeline = (*pipeline).clone();
    let confirmed = confirmed.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        pipeline.remove_favorite_copy(&path, confirmed, resolution.as_deref())
    })
        .await
        .map_err(|err| format!("remove favorite failed: {err}"))?
}

#[tauri::command]
pub async fn preview_remove_favorite_copy(
    pipeline: State<'_, Pipeline>,
    path: String,
) -> Result<crate::file_ops::RemoveFavoriteCopyResult, String> {
    let pipeline = (*pipeline).clone();
    tauri::async_runtime::spawn_blocking(move || pipeline.preview_remove_favorite_copy(&path))
        .await
        .map_err(|err| format!("preview remove favorite failed: {err}"))?
}

#[tauri::command]
pub fn favorite_origins_for_copies(
    pipeline: State<Pipeline>,
    paths: Vec<String>,
) -> Result<Vec<crate::file_ops::FavoriteCopyOrigin>, String> {
    pipeline.favorite_origins_for_copies(&paths)
}

#[tauri::command]
pub async fn preview_remove_favorite_copies(
    pipeline: State<'_, Pipeline>,
    paths: Vec<String>,
) -> Result<Vec<crate::file_ops::FavoriteBatchPathResult>, String> {
    let pipeline = (*pipeline).clone();
    tauri::async_runtime::spawn_blocking(move || pipeline.preview_remove_favorite_copies(paths))
        .await
        .map_err(|err| format!("preview remove favorites batch failed: {err}"))?
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteBatchRemoveItemDto {
    path: String,
    confirmed: bool,
    resolution: Option<String>,
}

#[tauri::command]
pub async fn remove_favorite_copies_batch(
    pipeline: State<'_, Pipeline>,
    items: Vec<FavoriteBatchRemoveItemDto>,
) -> Result<Vec<crate::file_ops::FavoriteBatchPathResult>, String> {
    let pipeline = (*pipeline).clone();
    let mapped = items
        .into_iter()
        .map(|item| crate::file_ops::FavoriteBatchRemoveItem {
            path: item.path,
            confirmed: item.confirmed,
            resolution: item.resolution,
        })
        .collect();
    tauri::async_runtime::spawn_blocking(move || pipeline.remove_favorite_copies_batch(mapped))
        .await
        .map_err(|err| format!("remove favorites batch failed: {err}"))?
}

#[tauri::command]
pub fn undo_favorite_removal(pipeline: State<Pipeline>, id: String) -> Result<(), String> {
    pipeline.undo_favorite_removal(&id)
}

#[tauri::command]
pub fn discard_favorite_undo(pipeline: State<Pipeline>, id: String) -> Result<(), String> {
    pipeline.discard_favorite_undo(&id)
}

#[tauri::command]
pub async fn restore_local_trash(
    pipeline: State<'_, Pipeline>,
    path: String,
    mode: String,
    chosen_directory: Option<String>,
) -> Result<crate::file_ops::RestoreTrashResult, String> {
    let pipeline = (*pipeline).clone();
    tauri::async_runtime::spawn_blocking(move || {
        pipeline.restore_trash(&path, &mode, chosen_directory.as_deref())
    })
    .await
    .map_err(|err| format!("restore failed: {err}"))?
}

#[tauri::command]
pub async fn recycle_local_trash_file(
    pipeline: State<'_, Pipeline>,
    path: String,
) -> Result<crate::file_ops::RecycleItemResult, String> {
    let pipeline = (*pipeline).clone();
    tauri::async_runtime::spawn_blocking(move || pipeline.recycle_trash_file(&path))
        .await
        .map_err(|err| format!("recycle file failed: {err}"))?
}

#[tauri::command]
pub async fn recycle_local_trash_folder(
    pipeline: State<'_, Pipeline>,
    path: String,
    state_token: String,
) -> Result<crate::file_ops::RecycleItemResult, String> {
    let pipeline = (*pipeline).clone();
    tauri::async_runtime::spawn_blocking(move || pipeline.recycle_trash_folder(&path, &state_token))
        .await
        .map_err(|err| format!("recycle folder failed: {err}"))?
}

#[tauri::command]
pub async fn describe_local_trash_folder(
    path: String,
) -> Result<crate::file_ops::LocalTrashFolderSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::file_ops::describe_local_trash_folder(&path)
    })
    .await
    .map_err(|err| format!("describe trash folder failed: {err}"))?
}

#[tauri::command]
pub fn trash_entry_origin(path: String) -> Result<Option<String>, String> {
    crate::file_ops::trash_entry_origin(&path)
}

#[tauri::command]
pub async fn run_file_operation(
    app: AppHandle,
    pipeline: State<'_, Pipeline>,
    operation_id: String,
    current_directory: String,
    action: String,
    paths: Vec<String>,
) -> Result<crate::file_ops::FileOperationResult, String> {
    let action = crate::file_ops::Action::parse(&action)
        .ok_or_else(|| "Неизвестная операция".to_string())?;
    let cancel = match crate::file_ops::claim(&operation_id) {
        crate::file_ops::Claim::Replay(result) => return Ok(result),
        crate::file_ops::Claim::Busy => return Err("Операция уже выполняется".to_string()),
        crate::file_ops::Claim::Start(flag) => flag,
    };
    let pipeline = (*pipeline).clone();
    let gate = pipeline.disk_gate();
    let slots = gate.copy_slots(std::path::Path::new(&current_directory));
    let operation_key = operation_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let request = crate::file_ops::OperationRequest {
            operation_id: operation_id.clone(),
            directory: current_directory,
            action,
            paths,
        };
        let executed =
            pipeline.execute_file_operation(&gate, &request, slots, &cancel, &|progress| {
                let _ = app.emit("file-operation-progress", progress);
            });
        match &executed {
            Ok(value) => crate::file_ops::complete(&operation_id, value.clone()),
            Err(_) => crate::file_ops::abandon(&operation_id),
        }
        executed
    })
    .await
    .map_err(|err| {
        crate::file_ops::abandon(&operation_key);
        format!("file operation failed: {err}")
    })?;
    result
}

#[tauri::command]
pub fn cancel_file_operation(operation_id: String) -> bool {
    crate::file_ops::cancel(&operation_id)
}

#[tauri::command]
pub fn file_operation_in_progress() -> bool {
    crate::file_ops::any_file_operation_in_progress()
}

#[tauri::command]
pub fn begin_app_update_prepare() -> Result<(), String> {
    crate::file_ops::begin_app_update_prepare()
}

#[tauri::command]
pub fn end_app_update_prepare() {
    crate::file_ops::end_app_update_prepare()
}

#[tauri::command]
pub async fn image_properties(path: String) -> Result<crate::metadata::PhotoProperties, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::metadata::photo_properties(std::path::Path::new(&path))
    })
    .await
    .map_err(|err| format!("properties task failed: {err}"))?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalDropTarget {
    folder: String,
    image: Option<String>,
}

#[tauri::command]
pub fn rotate_display_clockwise(pipeline: State<Pipeline>, path: String) -> Result<u8, String> {
    pipeline.rotate_display_clockwise(&path)
}

#[tauri::command]
pub fn list_display_rotations(
    pipeline: State<Pipeline>,
    paths: Vec<String>,
) -> Result<Vec<crate::library::DisplayRotation>, String> {
    pipeline.list_display_rotations(&paths)
}

#[tauri::command]
pub fn resolve_external_drop(paths: Vec<String>) -> Result<Option<ExternalDropTarget>, String> {
    use std::path::Path;

    for raw in &paths {
        let path = Path::new(raw);
        if path.is_dir() {
            return Ok(Some(ExternalDropTarget {
                folder: raw.clone(),
                image: None,
            }));
        }
    }
    for raw in &paths {
        let path = Path::new(raw);
        if path.is_file() && crate::formats::listed_image(path) {
            let parent = path
                .parent()
                .filter(|item| item.is_dir())
                .ok_or_else(|| "у изображения нет родительской папки".to_string())?;
            return Ok(Some(ExternalDropTarget {
                folder: parent.to_string_lossy().into_owned(),
                image: Some(raw.clone()),
            }));
        }
    }
    Ok(None)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExternalLinkKind {
    Cloudtips,
    Boosty,
    GithubRepo,
    GithubIssues,
    SupportEmail,
}

/// Keep in sync with `src/shared/external-links.json`.
const EXTERNAL_LINKS_JSON: &str = include_str!("../../../src/shared/external-links.json");

fn external_link_field(field: &str) -> Result<String, String> {
    let key = format!("\"{field}\"");
    let key_pos = EXTERNAL_LINKS_JSON
        .find(&key)
        .ok_or_else(|| format!("external link `{field}` is missing from config"))?;
    let after_key = &EXTERNAL_LINKS_JSON[key_pos + key.len()..];
    let colon = after_key
        .find(':')
        .ok_or_else(|| format!("external link `{field}` is malformed"))?;
    let mut value = after_key[colon + 1..].trim_start();
    if !value.starts_with('"') {
        return Err(format!("external link `{field}` is malformed"));
    }
    value = &value[1..];
    let end = value
        .find('"')
        .ok_or_else(|| format!("external link `{field}` is malformed"))?;
    let url = value[..end].trim();
    if url.is_empty() {
        return Err(format!("external link `{field}` is not configured"));
    }
    Ok(url.to_string())
}

fn external_link_url(field: &str) -> Result<String, String> {
    let url = external_link_field(field)?;
    if !url.starts_with("https://") {
        return Err("unsupported url scheme".to_string());
    }
    Ok(url)
}

fn validate_support_mailto(url: &str) -> Result<(), String> {
    let email = external_link_field("supportEmail")?;
    let expected = format!("mailto:{email}");
    if url != expected && !url.starts_with(&format!("{expected}?")) {
        return Err("mailto address mismatch".to_string());
    }
    if url.chars().any(|c| c.is_control()) {
        return Err("unsupported mailto".to_string());
    }
    Ok(())
}

fn open_url_in_browser(url: &str) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("mailto:")) {
        return Err("unsupported url scheme".to_string());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        std::process::Command::new("cmd")
            .creation_flags(CREATE_NO_WINDOW)
            .args(["/C", "start", "", url])
            .spawn()
            .map_err(|err| format!("open browser: {err}"))?;
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        std::process::Command::new(opener)
            .arg(url)
            .spawn()
            .map_err(|err| format!("open browser: {err}"))?;
        Ok(())
    }
}

#[tauri::command]
pub fn open_in_explorer(path: String) -> Result<(), String> {
    crate::file_ops::open_folder_in_explorer(&path)
}

#[tauri::command]
pub fn open_external_link(kind: ExternalLinkKind, url: Option<String>) -> Result<(), String> {
    let resolved: String = match kind {
        ExternalLinkKind::Cloudtips => external_link_url("cloudtips")?,
        ExternalLinkKind::Boosty => external_link_url("boosty")?,
        ExternalLinkKind::GithubRepo => external_link_url("githubRepo")?,
        ExternalLinkKind::GithubIssues => {
            let base = external_link_url("githubRepo")?;
            let base = base.trim_end_matches('/');
            let prefix = format!("{base}/issues/new");
            if let Some(custom) = url {
                if !custom.starts_with("https://") || !custom.starts_with(&prefix) {
                    return Err("invalid issues url".to_string());
                }
                custom
            } else {
                prefix
            }
        }
        ExternalLinkKind::SupportEmail => {
            let mailto = url.ok_or_else(|| "mailto url is required".to_string())?;
            validate_support_mailto(&mailto)?;
            mailto
        }
    };
    open_url_in_browser(&resolved)
}

#[tauri::command]
pub fn directory_accessible(path: String) -> bool {
    let path = std::path::Path::new(&path);
    match std::fs::metadata(path) {
        Ok(meta) => meta.is_dir(),
        Err(_) => false,
    }
}

/// Experimental Windows window-geometry tween. Does not call `setFullscreen`.
#[tauri::command]
pub async fn prototype_window_anim(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, crate::window_anim::WindowAnimState>,
    request: crate::window_anim::PrototypeAnimRequest,
) -> Result<crate::window_anim::PrototypeAnimReport, String> {
    crate::window_anim::run_prototype(app, window, state, request).await
}
