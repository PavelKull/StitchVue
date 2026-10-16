import { useCallback, useEffect, useState } from "react";
import { copyToClipboard } from "../lib/copyToClipboard";

export function usePathCopyFeedback(path: string | null) {
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  useEffect(() => {
    if (copiedPath !== null && copiedPath !== path) {
      setCopiedPath(null);
    }
  }, [path, copiedPath]);

  const pathCopied = path !== null && copiedPath === path;

  const copyPath = useCallback(() => {
    if (!path) {
      return;
    }
    void copyToClipboard(path).then((ok) => {
      if (ok) {
        setCopiedPath(path);
      }
    });
  }, [path]);

  return { pathCopied, copyPath };
}
