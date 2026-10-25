/** Mirrors `Format::Video` in src-tauri/src/formats/mod.rs. */
const VIDEO_EXTENSIONS = new Set(["mov", "mp4", "m4v"]);

export function isVideoPath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  return dot >= 0 && VIDEO_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}
