import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";

export type AvailableUpdate = {
  version: string;
  body: string;
  raw: Update;
};

export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  const update = await check();
  if (!update) {
    return null;
  }
  return {
    version: update.version,
    body: update.body?.trim() ?? "",
    raw: update,
  };
}

export async function downloadUpdateWithProgress(
  update: Update,
  onProgress: (percent: number) => void,
): Promise<void> {
  let downloaded = 0;
  let contentLength = 0;
  await update.download((event: DownloadEvent) => {
    switch (event.event) {
      case "Started":
        contentLength = event.data.contentLength ?? 0;
        downloaded = 0;
        onProgress(0);
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        if (contentLength > 0) {
          onProgress(Math.min(99, Math.floor((downloaded / contentLength) * 100)));
        }
        break;
      case "Finished":
        onProgress(100);
        break;
      default:
        break;
    }
  });
}

/** Windows: install() launches NSIS and exits the app. */
export async function installUpdate(update: Update): Promise<void> {
  await update.install();
}
