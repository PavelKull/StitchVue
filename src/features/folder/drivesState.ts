import type { FolderShortcut } from "../../entities/folder/types";

export type DrivesStatus = "idle" | "loading" | "success" | "error";

export type DrivesState = {
  status: DrivesStatus;
  drives: FolderShortcut[];
  error: string | null;
  requestId: number;
};

export type DrivesResult =
  | { ok: true; drives: FolderShortcut[] }
  | { ok: false; error: string };

export function initialDrivesState(): DrivesState {
  return {
    status: "idle",
    drives: [],
    error: null,
    requestId: 0,
  };
}

/** Start a new request. Keeps the last successful list while loading. */
export function beginDrivesRequest(state: DrivesState): DrivesState {
  return {
    ...state,
    status: "loading",
    error: null,
    requestId: state.requestId + 1,
  };
}

/**
 * Apply a finished request. Stale ids (older than the live request) are ignored
 * so out-of-order replies cannot overwrite a newer result.
 */
export function finishDrivesRequest(
  state: DrivesState,
  requestId: number,
  result: DrivesResult,
): DrivesState {
  if (requestId !== state.requestId) {
    return state;
  }
  if (result.ok) {
    return {
      ...state,
      status: "success",
      drives: result.drives,
      error: null,
    };
  }
  return {
    ...state,
    status: "error",
    error: result.error,
  };
}

export function shouldRefreshDrives(state: DrivesState): boolean {
  return state.status !== "loading";
}

/** Apply a known drive list (e.g. from home browse) without tying to a request id. */
export function applyDrivesSnapshot(state: DrivesState, drives: FolderShortcut[]): DrivesState {
  return {
    ...state,
    status: "success",
    drives,
    error: null,
  };
}
