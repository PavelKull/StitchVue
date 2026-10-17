export type FolderThumbLoaderSnapshot = {
  session: number;
  listingBusy: boolean;
  imageCount: number;
  settledCount: number;
  pipelinePass: string | null;
  cacheCapped: boolean;
};

export type CometFinishMode = "close" | "fade" | "abort";

export function emptyFolderThumbLoaderSnapshot(): FolderThumbLoaderSnapshot {
  return {
    session: 0,
    listingBusy: false,
    imageCount: 0,
    settledCount: 0,
    pipelinePass: null,
    cacheCapped: false,
  };
}

export function cometProgressRatio(
  snapshot: FolderThumbLoaderSnapshot,
): number | null {
  if (snapshot.listingBusy || snapshot.imageCount <= 0) {
    return null;
  }
  return Math.min(1, Math.max(0, snapshot.settledCount / snapshot.imageCount));
}

export function cometFinishMode(
  snapshot: FolderThumbLoaderSnapshot,
): CometFinishMode {
  if (snapshot.pipelinePass === "cancelled") {
    return "abort";
  }
  if (snapshot.imageCount <= 0) {
    return "abort";
  }
  if (snapshot.settledCount >= snapshot.imageCount) {
    return "close";
  }
  return "fade";
}
