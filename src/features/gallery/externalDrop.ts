import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect } from "react";

export type ExternalDropTarget = {
  folder: string;
  image?: string;
};

type ResolvedDrop = {
  folder: string;
  image: string | null;
};

export function useExternalFileDrop(onDrop: (target: ExternalDropTarget) => void) {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") {
          return;
        }
        const paths = event.payload.paths;
        if (paths.length === 0) {
          return;
        }
        void invoke<ResolvedDrop | null>("resolve_external_drop", { paths }).then((target) => {
          if (!target) {
            return;
          }
          onDrop({
            folder: target.folder,
            image: target.image ?? undefined,
          });
        });
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      unlisten?.();
    };
  }, [onDrop]);
}
