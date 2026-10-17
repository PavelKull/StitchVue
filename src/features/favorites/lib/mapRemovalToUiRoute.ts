import type { RemoveFavoriteConfirmKind } from "../../selection/lib/fileOperation.ts";

/** CL-P03 UI dialog route for a single removal preview/result (no IPC). */
export type RemovalUiRoute =
  | "fr11"
  | "standardConfirm"
  | "originInTrash"
  | "ready";

/**
 * Minimal routing input. Optional `fr11Required` matches planned DTO hint (T023);
 * `originPresence` covers missing/inaccessible/unverified without GalleryPage wiring.
 */
export type RemovalUiRouteInput = {
  status: "ready" | "needs_confirm" | "failed" | "skipped" | string;
  confirmKind?: RemoveFavoriteConfirmKind | null;
  fr11Required?: boolean | null;
  /** When set, overrides confirmKind for unverified / missing / inaccessible origins. */
  originPresence?: "verified" | "unverified" | "missing" | "inaccessible" | null;
};

/** Map preview/removal classification to CL-P03 UI route (FR-11 vs confirm vs trash vs ready). */
export function mapRemovalToUiRoute(input: RemovalUiRouteInput): RemovalUiRoute {
  if (input.fr11Required === true) {
    return "fr11";
  }

  const presence = input.originPresence;
  if (
    presence === "unverified" ||
    presence === "missing" ||
    presence === "inaccessible"
  ) {
    return "fr11";
  }

  if (input.status === "ready") {
    return "ready";
  }

  if (input.status === "needs_confirm") {
    const kind = input.confirmKind ?? "unknown_origin";
    if (kind === "unknown_origin") {
      return "fr11";
    }
    if (kind === "origin_in_local_trash") {
      return "originInTrash";
    }
    // origin_changed / copy_changed / ambiguous_origin — verified-safe standard confirm
    return "standardConfirm";
  }

  // Unknown / failed preview shapes stay on the safe FR-11 path (not silent standardConfirm).
  return "fr11";
}

/** Alias used by some SpecKit wording (`ready` / `proceed`). */
export function mapRemovalToUiRouteOrProceed(
  input: RemovalUiRouteInput,
): RemovalUiRoute | "proceed" {
  const route = mapRemovalToUiRoute(input);
  return route === "ready" ? "proceed" : route;
}
