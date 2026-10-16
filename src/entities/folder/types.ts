import type { ImageFile } from "../image/types";
import type { ServiceRole } from "./serviceFolder";

export type FolderKind = "place" | "folder" | "drive";

export type DriveMedia =
  | "ssd"
  | "hdd"
  | "removable"
  | "unknown"
  | "nas"
  | "optical"
  | "camera"
  | "mobile"
  | "sd"
  | "bluetooth";

export type DriveKind = "fixed" | "removable" | "remote" | "optical";

export type PlaceCode =
  | "desktop"
  | "downloads"
  | "documents"
  | "pictures"
  | "videos"
  | "music"
  | "this-pc"
  | "drive";

export type FolderShortcut = {
  name: string;
  path: string;
  kind: FolderKind;
  media?: DriveMedia | null;
  serviceRole?: ServiceRole | null;
  /** Stable place id from Rust; UI label via folderDisplayName. */
  placeCode?: PlaceCode | string | null;
  driveLetter?: string | null;
  driveKind?: DriveKind | string | null;
};

export type DirectoryView = {
  title: string;
  path: string | null;
  parent: string | null;
  folders: FolderShortcut[];
  images: ImageFile[];
  serviceRole?: ServiceRole | null;
  placeCode?: PlaceCode | string | null;
};
