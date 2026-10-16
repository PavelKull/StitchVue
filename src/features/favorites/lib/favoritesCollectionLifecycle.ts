import { isFavoritesFolderName, type ServiceRole } from "../../../entities/folder/serviceFolder.ts";

export type FavoritesActivityAfterRename =
  | "stays-active"
  | "deactivated"
  | "unchanged";

export function favoritesActivityAfterRename(
  previousRole: ServiceRole | null | undefined,
  newName: string,
): FavoritesActivityAfterRename {
  if (previousRole !== "favorites") {
    return "unchanged";
  }
  return isFavoritesFolderName(newName) ? "stays-active" : "deactivated";
}

export function browseErrorLooksLikeMissingFolder(error: unknown): boolean {
  const raw =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : error &&
            typeof error === "object" &&
            "message" in error &&
            typeof (error as { message: unknown }).message === "string"
          ? (error as { message: string }).message
          : String(error);
  return /not a directory/i.test(raw);
}
