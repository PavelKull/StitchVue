import { pathKey } from "../selection/selection.ts";
import {
  favoritePathsFromServerWithOverlay,
  type FavoriteOverlayMap,
} from "./favoriteOptimisticOverlay.ts";

/** Monotonic IPC ticket for `favorite_origin_paths`. */
export type FavoritePathsFetchTicket = {
  requestId: number;
  revisionAtStart: number;
  directoryKey: string;
};

export type FavoritePathsSyncCounters = {
  latestRequestId: number;
  revision: number;
};

export type FavoritePathsApplyGuardState = FavoritePathsSyncCounters & {
  openDirectoryKey: string | null;
};

export function nextFavoritePathsRequestId(latest: number): number {
  return latest + 1;
}

export function bumpFavoritePathsRevision(revision: number): number {
  return revision + 1;
}

export function buildFavoritePathsFetchTicket(
  requestId: number,
  revision: number,
  directory: string,
): FavoritePathsFetchTicket {
  return {
    requestId,
    revisionAtStart: revision,
    directoryKey: pathKey(directory),
  };
}

export function beginFavoritePathsFetch(
  counters: FavoritePathsSyncCounters,
  directory: string,
): FavoritePathsFetchTicket {
  counters.latestRequestId = nextFavoritePathsRequestId(
    counters.latestRequestId,
  );
  return buildFavoritePathsFetchTicket(
    counters.latestRequestId,
    counters.revision,
    directory,
  );
}

export function bumpFavoritePathsConfirmedRevision(
  counters: FavoritePathsSyncCounters,
): number {
  counters.revision = bumpFavoritePathsRevision(counters.revision);
  return counters.revision;
}

export function shouldApplyFavoritePathsFetch(
  ticket: FavoritePathsFetchTicket,
  state: FavoritePathsApplyGuardState,
): boolean {
  if (!state.openDirectoryKey) {
    return false;
  }
  if (ticket.directoryKey !== state.openDirectoryKey) {
    return false;
  }
  if (ticket.requestId !== state.latestRequestId) {
    return false;
  }
  if (ticket.revisionAtStart !== state.revision) {
    return false;
  }
  return true;
}

/** Merge server listing with overlay when the fetch ticket is still current. */
export function resolveFavoritePathsFetch(
  ticket: FavoritePathsFetchTicket,
  state: FavoritePathsApplyGuardState,
  serverPaths: readonly string[],
  overlay: FavoriteOverlayMap,
): { applied: boolean; confirmed: ReadonlySet<string> | null } {
  if (!shouldApplyFavoritePathsFetch(ticket, state)) {
    return { applied: false, confirmed: null };
  }
  return {
    applied: true,
    confirmed: favoritePathsFromServerWithOverlay(serverPaths, overlay),
  };
}

/**
 * After a stale reject, schedule another fetch only when this was the latest
 * request, the folder is still open, and revision did not advance (unexpected).
 */
export function needsFavoritePathsResyncAfterStaleReject(
  ticket: FavoritePathsFetchTicket,
  state: FavoritePathsApplyGuardState,
): boolean {
  if (!state.openDirectoryKey) {
    return false;
  }
  if (ticket.directoryKey !== state.openDirectoryKey) {
    return false;
  }
  if (ticket.requestId !== state.latestRequestId) {
    return false;
  }
  if (ticket.revisionAtStart !== state.revision) {
    return false;
  }
  return false;
}
