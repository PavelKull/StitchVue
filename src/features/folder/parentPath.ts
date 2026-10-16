export function parentDirectoryPath(folderPath: string): string {
  const normalized = folderPath.replace(/\//g, "\\").replace(/\\+$/, "");
  const index = normalized.lastIndexOf("\\");
  if (index <= 0) {
    return normalized;
  }
  return normalized.slice(0, index);
}
