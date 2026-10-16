import i18n from "../../shared/i18n/i18n.ts";
import type { StitchVueIconName } from "../../shared/icons/stitchvue-icons";

export type ServiceRole = "favorites" | "trash";

/**
 * Physical folder names on disk. Never localize — product filesystem contract.
 * Matches Rust LOCAL_FAVORITES / LOCAL_TRASH.
 */
export const DISK_SERVICE_FOLDER_LEAF: Record<ServiceRole, string> = {
  favorites: "Избранное",
  trash: "Удаленное",
};

/** Canonical on-disk names for an active favorites folder. Matches Rust `is_favorites_folder_name`. */
export function isFavoritesFolderName(name: string): boolean {
  const folded = name.toLowerCase();
  return folded === "избранное" || folded === "избранная";
}

export function serviceFolderIcon(role: ServiceRole | null | undefined): StitchVueIconName | null {
  if (role === "trash") {
    return "trash";
  }
  if (role === "favorites") {
    return "favorite";
  }
  return null;
}

export function serviceFolderHint(role: ServiceRole | null | undefined): string | null {
  if (role === "favorites") {
    return i18n.t("sidebar.favoritesHint");
  }
  if (role === "trash") {
    return i18n.t("sidebar.trashHint");
  }
  return null;
}
