mod folder;
mod listing_cache;
mod places;

pub use folder::{
    list_directory, list_directory_with, list_subfolders, DirectoryView, FolderKind, FolderShortcut,
};
pub use places::{browse, list_drives};

pub fn drop_listing_cache(folder: &std::path::Path) {
    listing_cache::drop_listing(folder);
}
