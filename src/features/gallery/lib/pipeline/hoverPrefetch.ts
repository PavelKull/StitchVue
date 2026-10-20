export const FOLDER_DELAY_MS = 180;
export const PHOTO_DELAY_MS = 100;
export const LEAVE_GRACE_MS = 140;

const FIRST_CAP = 48;
const WINDOW_CAP = 96;

export type HoverEffect =
  | { type: "prefetch-folder"; path: string; order: string; first: number; extra: number }
  | { type: "cancel-folder" }
  | { type: "prefetch-photo"; path: string; size: number; modifiedAt: number; longEdge: number }
  | { type: "cancel-photo" };

export type HoverContext = {
  order: string;
  first: number;
  extra: number;
  longEdge: number;
  openPath: string | null;
};

export type PhotoIdentity = {
  path: string;
  size: number;
  modifiedAt: number;
};

export type HoverState = HoverContext & {
  folderTarget: string | null;
  folderDue: number | null;
  folderSent: string | null;
  folderCancelDue: number | null;
  photoTarget: string | null;
  photoSize: number;
  photoModified: number;
  photoDue: number | null;
  photoSent: string | null;
  photoCancelDue: number | null;
  /** Просмотрщик открывает этот кадр — не отменять prefetch при leave. */
  reservedPhotoPath: string | null;
};

export type HoverEvent =
  | { type: "context"; context: HoverContext }
  | { type: "enter-folder"; path: string }
  | { type: "leave-folder"; path: string }
  | { type: "enter-photo"; path: string; size: number; modifiedAt: number }
  | { type: "leave-photo"; path: string }
  | { type: "reserve-photo-open"; path: string; size: number; modifiedAt: number }
  | { type: "tick" };

export function hoverWindow(rowsPerScreen: number): { first: number; extra: number } {
  const per = Math.min(FIRST_CAP, Math.max(8, Math.round(rowsPerScreen * 6)));
  return { first: per, extra: Math.min(WINDOW_CAP - per, per * 2) };
}

export function initialHoverState(context: HoverContext = defaultContext()): HoverState {
  return {
    ...context,
    folderTarget: null,
    folderDue: null,
    folderSent: null,
    folderCancelDue: null,
    photoTarget: null,
    photoSize: 0,
    photoModified: 0,
    photoDue: null,
    photoSent: null,
    photoCancelDue: null,
    reservedPhotoPath: null,
  };
}

export function reduceHover(state: HoverState, event: HoverEvent, now: number): { state: HoverState; effects: HoverEffect[] } {
  if (event.type === "context") {
    return {
      state: { ...state, ...event.context, reservedPhotoPath: null },
      effects: [],
    };
  }
  if (event.type === "tick") {
    return tick(state, now);
  }
  if (event.type === "enter-folder") {
    return enterFolder(state, event.path, now);
  }
  if (event.type === "leave-folder") {
    return leaveFolder(state, event.path, now);
  }
  if (event.type === "enter-photo") {
    return enterPhoto(state, event, now);
  }
  if (event.type === "reserve-photo-open") {
    return reservePhotoOpen(state, event, now);
  }
  return leavePhoto(state, event.path, now);
}

export function nextWait(state: HoverState, now: number): number | null {
  const due = [state.folderDue, state.folderCancelDue, state.photoDue, state.photoCancelDue].filter(
    (time): time is number => time != null,
  );
  if (due.length === 0) {
    return null;
  }
  return Math.max(0, Math.min(...due) - now);
}

export type HoverController = {
  setContext(context: HoverContext): void;
  enterFolder(path: string): void;
  leaveFolder(path?: string): void;
  enterPhoto(file: { path: string; size: number; modifiedAt: number }): void;
  leavePhoto(path?: string): void;
  reservePhotoForOpen(file: PhotoIdentity): void;
  dispose(): void;
};

export function createHoverController(
  run: (effect: HoverEffect) => void,
  now: () => number = () => Date.now(),
  schedule: (ms: number, fn: () => void) => number = (ms, fn) => window.setTimeout(fn, ms),
  clear: (id: number) => void = (id) => window.clearTimeout(id),
): HoverController {
  let state = initialHoverState();
  let timer: number | null = null;
  const arm = () => {
    if (timer != null) {
      clear(timer);
      timer = null;
    }
    const wait = nextWait(state, now());
    if (wait == null) {
      return;
    }
    timer = schedule(wait, () => {
      timer = null;
      dispatch({ type: "tick" });
    });
  };
  const dispatch = (event: HoverEvent) => {
    const next = reduceHover(state, event, now());
    state = next.state;
    for (const effect of next.effects) {
      run(effect);
    }
    arm();
  };
  return {
    setContext(context) {
      dispatch({ type: "context", context });
    },
    enterFolder(path) {
      dispatch({ type: "enter-folder", path });
    },
    leaveFolder(path) {
      const target = path || state.folderTarget;
      if (target) {
        dispatch({ type: "leave-folder", path: target });
      }
    },
    enterPhoto(file) {
      dispatch({ type: "enter-photo", path: file.path, size: file.size, modifiedAt: file.modifiedAt });
    },
    leavePhoto(path) {
      const target = path || state.photoTarget;
      if (target) {
        dispatch({ type: "leave-photo", path: target });
      }
    },
    reservePhotoForOpen(file) {
      dispatch({
        type: "reserve-photo-open",
        path: file.path,
        size: file.size,
        modifiedAt: file.modifiedAt,
      });
    },
    dispose() {
      if (timer != null) {
        clear(timer);
      }
    },
  };
}

function defaultContext(): HoverContext {
  return { order: "date-desc", first: 24, extra: 48, longEdge: 256, openPath: null };
}

function enterFolder(state: HoverState, path: string, now: number): { state: HoverState; effects: HoverEffect[] } {
  if (!path || samePath(path, state.openPath)) {
    return leaveFolder(state, state.folderTarget ?? path, now);
  }
  if (state.folderSent === path || (state.folderTarget === path && state.folderDue != null)) {
    return { state: { ...state, folderTarget: path, folderDue: state.folderSent === path ? null : state.folderDue, folderCancelDue: null }, effects: [] };
  }
  return {
    state: {
      ...state,
      folderTarget: path,
      folderDue: now + FOLDER_DELAY_MS,
      folderCancelDue: null,
    },
    effects: [],
  };
}

function leaveFolder(state: HoverState, path: string, now: number): { state: HoverState; effects: HoverEffect[] } {
  if (state.folderTarget && path && !samePath(state.folderTarget, path)) {
    return { state, effects: [] };
  }
  const cancelDue = state.folderSent && samePath(state.folderSent, path) ? now + LEAVE_GRACE_MS : state.folderCancelDue;
  return {
    state: {
      ...state,
      folderTarget: null,
      folderDue: null,
      folderCancelDue: state.folderSent && samePath(state.folderSent, path) ? cancelDue : null,
    },
    effects: [],
  };
}

function enterPhoto(
  state: HoverState,
  event: { path: string; size: number; modifiedAt: number },
  now: number,
): { state: HoverState; effects: HoverEffect[] } {
  if (!event.path) {
    return { state, effects: [] };
  }
  if (state.photoSent === event.path || (state.photoTarget === event.path && state.photoDue != null)) {
    return {
      state: {
        ...state,
        photoTarget: event.path,
        photoDue: state.photoSent === event.path ? null : state.photoDue,
        photoCancelDue: null,
        photoSize: event.size,
        photoModified: event.modifiedAt,
      },
      effects: [],
    };
  }
  return {
    state: {
      ...state,
      photoTarget: event.path,
      photoSize: event.size,
      photoModified: event.modifiedAt,
      photoDue: now + PHOTO_DELAY_MS,
      photoCancelDue: null,
    },
    effects: [],
  };
}

function leavePhoto(state: HoverState, path: string, now: number): { state: HoverState; effects: HoverEffect[] } {
  if (state.photoTarget && path && state.photoTarget !== path) {
    return { state, effects: [] };
  }
  const reserved = state.reservedPhotoPath && samePath(state.reservedPhotoPath, path);
  const sent = state.photoSent && samePath(state.photoSent, path);
  return {
    state: {
      ...state,
      photoTarget: null,
      photoDue: null,
      photoCancelDue: reserved || !sent ? null : now + LEAVE_GRACE_MS,
    },
    effects: [],
  };
}

function reservePhotoOpen(
  state: HoverState,
  event: { path: string; size: number; modifiedAt: number },
  _now: number,
): { state: HoverState; effects: HoverEffect[] } {
  if (!event.path) {
    return { state, effects: [] };
  }
  const effects: HoverEffect[] = [];
  let next: HoverState = {
    ...state,
    reservedPhotoPath: event.path,
    photoTarget: event.path,
    photoSize: event.size,
    photoModified: event.modifiedAt,
    photoDue: null,
    photoCancelDue: null,
  };
  if (next.photoSent !== event.path) {
    effects.push({
      type: "prefetch-photo",
      path: event.path,
      size: event.size,
      modifiedAt: event.modifiedAt,
      longEdge: next.longEdge,
    });
    next = { ...next, photoSent: event.path };
  }
  return { state: next, effects };
}

function tick(state: HoverState, now: number): { state: HoverState; effects: HoverEffect[] } {
  const effects: HoverEffect[] = [];
  let next = state;
  if (next.folderCancelDue != null && next.folderCancelDue <= now) {
    effects.push({ type: "cancel-folder" });
    next = { ...next, folderSent: null, folderCancelDue: null };
  }
  if (next.photoCancelDue != null && next.photoCancelDue <= now) {
    const keepWarm =
      next.reservedPhotoPath &&
      next.photoSent &&
      samePath(next.reservedPhotoPath, next.photoSent);
    if (!keepWarm) {
      effects.push({ type: "cancel-photo" });
      next = { ...next, photoSent: null };
    }
    next = { ...next, photoCancelDue: null };
  }
  if (next.folderDue != null && next.folderDue <= now && next.folderTarget && !samePath(next.folderTarget, next.openPath)) {
    effects.push({
      type: "prefetch-folder",
      path: next.folderTarget,
      order: next.order,
      first: next.first,
      extra: next.extra,
    });
    next = { ...next, folderSent: next.folderTarget, folderDue: null, folderCancelDue: null };
  } else if (next.folderDue != null && next.folderDue <= now) {
    next = { ...next, folderDue: null };
  }
  if (next.photoDue != null && next.photoDue <= now && next.photoTarget) {
    if (next.photoSent !== next.photoTarget) {
      effects.push({
        type: "prefetch-photo",
        path: next.photoTarget,
        size: next.photoSize,
        modifiedAt: next.photoModified,
        longEdge: next.longEdge,
      });
    }
    next = { ...next, photoSent: next.photoTarget, photoDue: null, photoCancelDue: null };
  }
  return { state: next, effects };
}

function samePath(left: string | null, right: string | null): boolean {
  if (!left || !right) {
    return false;
  }
  return left.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase() === right.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}
