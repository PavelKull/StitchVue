import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { viewerNeededEdge } from "../../widgets/image-viewer/viewerZoom";
import { createHoverController, type HoverController, type HoverEffect } from "./hoverPrefetch";
import {
  beginPhotoWarm,
  cancelPhotoWarm,
  photoWarmEpoch,
  rememberPreloaded,
} from "./viewerPreload";
import { pickHoverWarmSource, shouldAcceptHoverFrame } from "./viewerPreloadLogic";

function hoverAsset(path: string): string {
  if (typeof window === "undefined" || !(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    return `asset://localhost/${encodeURIComponent(path)}`;
  }
  return convertFileSrc(path);
}

type ViewerOffer = {
  previewPath: string;
  previewEdge: number;
  nativePath: string;
  sharpPath: string;
  sharpEdge: number;
  token: number;
};

type ViewerFrameEvent = {
  path: string;
  framePath: string;
  longEdge: number;
  token: number;
  session?: number;
};

type PendingHover = {
  path: string;
  epoch: number;
  token: number;
  startedAt: number;
  folderSession: number;
};

let pendingHover: PendingHover | null = null;
let folderSession = 0;

export function createGalleryHover(): HoverController {
  let stopListen: (() => void) | null = null;
  void listen<ViewerFrameEvent>("viewer-frame-ready", (event) => {
    acceptHoverFrame(event.payload);
  }).then((stop) => {
    stopListen = stop;
  });

  const controller = createHoverController((effect) => {
    void applyHoverEffect(effect);
  });

  return {
    setContext(context) {
      controller.setContext(context);
    },
    enterFolder(path) {
      controller.enterFolder(path);
    },
    leaveFolder(path) {
      controller.leaveFolder(path);
    },
    enterPhoto(file) {
      controller.enterPhoto(file);
    },
    leavePhoto(path) {
      controller.leavePhoto(path);
    },
    dispose() {
      controller.dispose();
      pendingHover = null;
      stopListen?.();
      stopListen = null;
    },
  };
}

/** Bumped on each folder open so late frames from a previous directory are ignored. */
export function setHoverFolderSession(session: number) {
  folderSession = session;
  pendingHover = null;
}

export function viewerEdge(): number {
  if (typeof window === "undefined") {
    return 256;
  }
  return viewerNeededEdge(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
}

export function acceptHoverFrame(payload: ViewerFrameEvent): boolean {
  const pending = pendingHover;
  if (!pending) {
    return false;
  }
  const accepted = shouldAcceptHoverFrame({
    path: payload.path,
    token: payload.token,
    epoch: photoWarmEpoch(),
    pendingPath: pending.path,
    pendingToken: pending.token,
    pendingEpoch: pending.epoch,
    pendingFolderSession: pending.folderSession,
    folderSession,
    eventSession: payload.session ?? folderSession,
  });
  if (!accepted) {
    return false;
  }
  if (!payload.framePath) {
    return false;
  }
  pendingHover = null;
  rememberPreloaded(payload.path, hoverAsset(payload.framePath), false, {
    hoverStartedAt: pending.startedAt,
  });
  return true;
}

async function applyHoverEffect(effect: HoverEffect) {
  if (effect.type === "prefetch-folder") {
    await invoke("prefetch_folder", {
      path: effect.path,
      order: effect.order,
      firstCount: effect.first,
      extraCount: effect.extra,
    });
    return;
  }
  if (effect.type === "cancel-folder") {
    await invoke("cancel_folder_prefetch");
    return;
  }
  if (effect.type === "cancel-photo") {
    pendingHover = null;
    cancelPhotoWarm();
    await invoke("cancel_photo_prefetch");
    return;
  }
  const startedAt = performance.now();
  const epoch = beginPhotoWarm();
  const session = folderSession;
  pendingHover = {
    path: effect.path,
    epoch,
    token: 0,
    startedAt,
    folderSession: session,
  };
  let offer: ViewerOffer;
  try {
    offer = await invoke<ViewerOffer>("prefetch_photo", {
      path: effect.path,
      size: effect.size,
      modifiedAt: effect.modifiedAt,
      longEdge: effect.longEdge,
    });
  } catch {
    if (pendingHover?.epoch === epoch) {
      pendingHover = null;
    }
    return;
  }
  if (epoch !== photoWarmEpoch() || pendingHover?.epoch !== epoch) {
    return;
  }
  if (session !== folderSession) {
    pendingHover = null;
    return;
  }
  pendingHover = {
    path: effect.path,
    epoch,
    token: offer.token,
    startedAt,
    folderSession: session,
  };
  const warmSource = pickHoverWarmSource(offer);
  if (warmSource) {
    rememberPreloaded(effect.path, hoverAsset(warmSource.path), warmSource.native, {
      hoverStartedAt: startedAt,
    });
    if (warmSource.native) {
      pendingHover = null;
    }
  }
}

