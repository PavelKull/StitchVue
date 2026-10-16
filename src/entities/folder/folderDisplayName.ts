/**
 * Локализованное отображаемое имя папки/места/диска.
 * Пути и метки томов ОС не переводятся.
 */

import i18n from "../../shared/i18n/i18n.ts";

const PLACE_LABEL_KEYS: Record<string, string> = {
  desktop: "places.desktop",
  downloads: "places.downloads",
  documents: "places.documents",
  pictures: "places.pictures",
  videos: "places.videos",
  music: "places.music",
  "this-pc": "places.thisComputer",
};

type DisplayFolder = {
  name: string;
  placeCode?: string | null;
  driveLetter?: string | null;
  driveKind?: string | null;
};

export function folderDisplayName(folder: DisplayFolder): string {
  const code = folder.placeCode;
  if (code === "drive") {
    const letter = (folder.driveLetter ?? "").toUpperCase();
    const kind = folder.driveKind ?? "fixed";
    const kindKey =
      kind === "removable" || kind === "remote" || kind === "optical" ? kind : "fixed";
    const volume = folder.name.trim();
    if (volume) {
      return letter ? `${volume} (${letter}:)` : volume;
    }
    return i18n.t(`places.drive.${kindKey}`, { letter: letter || "?" });
  }
  if (code && PLACE_LABEL_KEYS[code]) {
    return i18n.t(PLACE_LABEL_KEYS[code]);
  }
  return folder.name;
}

/** Заголовок DirectoryView: this-pc или обычное имя. */
export function directoryTitle(
  view: { title: string; path: string | null; placeCode?: string | null },
): string {
  if (view.path === null || view.placeCode === "this-pc") {
    return i18n.t("places.thisComputer");
  }
  return view.title;
}
