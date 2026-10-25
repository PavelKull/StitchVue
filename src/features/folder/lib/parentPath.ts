/** Keeps the path's own separator: `C:\a\b` → `C:\a`, `/a/b` → `/a`. */
export function parentDirectoryPath(folderPath: string): string {
  const sep = folderPath.startsWith("/") ? "/" : "\\";
  const normalized = folderPath.replace(/[\\/]/g, sep).replace(/[\\/]+$/, "");
  const index = normalized.lastIndexOf(sep);
  if (index <= 0) {
    return normalized;
  }
  return normalized.slice(0, index);
}
