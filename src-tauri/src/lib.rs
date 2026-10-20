#[cfg(test)]
mod bench;
mod cache;
mod commands;
mod database;
mod file_ops;
#[cfg(test)]
mod fixtures;
mod formats;
mod library;
mod metadata;
mod pipeline;
mod scanner;
mod storage;
mod thumbnail;
mod window_anim;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let connection = database::open().map_err(std::io::Error::other)?;
            cache::maintain(&connection).map_err(std::io::Error::other)?;
            let root = database::app_dir().join("cache");
            let _ = app.asset_protocol_scope().allow_directory(&root, true);
            app.manage(pipeline::Pipeline::start(app.handle().clone(), connection));
            scanner::spawn_drive_monitor(app.handle().clone());
            app.manage(window_anim::WindowAnimState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::browse_directory,
            commands::begin_directory_session,
            commands::start_indexing,
            commands::reorder_indexing,
            commands::set_visible_range,
            commands::set_geometry_range,
            commands::set_scrolling,
            commands::set_storage_profile,
            commands::clear_cache,
            commands::cache_usage,
            commands::set_cache_limit,
            commands::set_cache_ttl,
            commands::list_subfolders,
            commands::list_drives,
            commands::remember_folder,
            commands::toggle_favorite,
            commands::recent_folders,
            commands::favorite_folders,
            commands::viewer_source,
            commands::viewer_frame,
            commands::prefetch_folder,
            commands::cancel_folder_prefetch,
            commands::prefetch_photo,
            commands::cancel_photo_prefetch,
            commands::set_viewer,
            commands::pipeline_stats,
            commands::favorite_origin_paths,
            commands::favorite_origins_for_copies,
            commands::folder_menu_options,
            commands::rename_folder,
            commands::remove_empty_service_folder,
            commands::cleanup_empty_service_folder,
            commands::remove_favorite_copy,
            commands::preview_remove_favorite_copy,
            commands::preview_remove_favorite_copies,
            commands::remove_favorite_copies_batch,
            commands::undo_favorite_removal,
            commands::discard_favorite_undo,
            commands::restore_local_trash,
            commands::recycle_local_trash_file,
            commands::recycle_local_trash_folder,
            commands::describe_local_trash_folder,
            commands::trash_entry_origin,
            commands::run_file_operation,
            commands::cancel_file_operation,
            commands::image_properties,
            commands::resolve_external_drop,
            commands::rotate_display_clockwise,
            commands::list_display_rotations,
            commands::open_in_explorer,
            commands::open_external_link,
            commands::directory_accessible,
            commands::prototype_window_anim
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
