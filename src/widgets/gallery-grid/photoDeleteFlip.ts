import { pathKey } from "../../features/selection/lib/selection.ts";

export const PHOTO_FLIP_MS = 240;
export const PHOTO_FLIP_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
export const PHOTO_FLIP_ATTR = "data-photo-flip";
export const PHOTO_FLIP_MAX_MOVES = 64;
export const PHOTO_FLIP_SCROLL_ABORT_PX = 80;
const SCALE_PLAY_MIN = 0.82;
const SCALE_PLAY_MAX = 1.22;
const NOOP_PX = 0.5;
const NOOP_SCALE = 0.01;

export type PhotoRect = {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

export type PhotoFlipMove = {
  id: string;
  dx: number;
  dy: number;
  sx: number;
  sy: number;
};

export type PhotoFlipRequest = {
  generation: number;
  operationId: string;
  directoryKey: string | null;
  layoutMode: string;
  rowsPerScreen: number;
  scrollTop: number;
  first: PhotoRect[];
};

export type PhotoFlipSession = {
  generation: number;
  animations: Animation[];
};

export function createPhotoFlipSession(): PhotoFlipSession {
  return { generation: 0, animations: [] };
}

export function shouldStartPhotoFlip(input: {
  action: string;
  requestedCount: number;
  movedCount: number;
  rustFailed: boolean;
}): boolean {
  return (
    !input.rustFailed &&
    input.action === "move_to_local_trash" &&
    input.requestedCount === 1 &&
    input.movedCount === 1
  );
}

export function skipUnchangedTiles(moves: readonly PhotoFlipMove[]): PhotoFlipMove[] {
  return moves.filter((move) => {
    if (Math.abs(move.dx) >= NOOP_PX || Math.abs(move.dy) >= NOOP_PX) {
      return true;
    }
    return Math.abs(move.sx - 1) >= NOOP_SCALE || Math.abs(move.sy - 1) >= NOOP_SCALE;
  });
}

export function computePhotoFlipMoves(first: readonly PhotoRect[], last: readonly PhotoRect[]): PhotoFlipMove[] {
  const lastById = new Map(last.map((tile) => [tile.id, tile]));
  const moves: PhotoFlipMove[] = [];
  for (const origin of first) {
    const next = lastById.get(origin.id);
    if (!next || next.width < 1 || next.height < 1) {
      continue;
    }
    moves.push({
      id: origin.id,
      dx: origin.left - next.left,
      dy: origin.top - next.top,
      sx: origin.width / next.width,
      sy: origin.height / next.height,
    });
  }
  return skipUnchangedTiles(moves);
}

export function flipScaleForPlay(
  sx: number,
  sy: number,
  innerHasTransform: boolean,
): { sx: number; sy: number } {
  if (innerHasTransform) {
    return { sx: 1, sy: 1 };
  }
  if (sx < SCALE_PLAY_MIN || sx > SCALE_PLAY_MAX || sy < SCALE_PLAY_MIN || sy > SCALE_PLAY_MAX) {
    return { sx: 1, sy: 1 };
  }
  return { sx, sy };
}

export function shouldAbortPhotoFlip(input: {
  motionEnabled: boolean;
  generation: number;
  sessionGeneration: number;
  directoryUnchanged: boolean;
  layoutModeUnchanged: boolean;
  zoomUnchanged: boolean;
  scrollDelta: number;
  moveCount: number;
}): string | null {
  if (!input.motionEnabled) {
    return "reduced-motion";
  }
  if (input.generation < input.sessionGeneration) {
    return "stale-generation";
  }
  if (!input.directoryUnchanged) {
    return "directory";
  }
  if (!input.layoutModeUnchanged || !input.zoomUnchanged) {
    return "layout-version";
  }
  if (Math.abs(input.scrollDelta) > PHOTO_FLIP_SCROLL_ABORT_PX) {
    return "scroll";
  }
  if (input.moveCount === 0) {
    return "noop";
  }
  if (input.moveCount > PHOTO_FLIP_MAX_MOVES) {
    return "too-many";
  }
  return null;
}

export function cancelPhotoFlip(session: PhotoFlipSession): void {
  for (const animation of session.animations) {
    try {
      animation.cancel();
    } catch {
      /* already finished */
    }
  }
  session.animations = [];
}

export function captureVisiblePhotoRects(viewport: HTMLElement | null): PhotoRect[] {
  if (!viewport) {
    return [];
  }
  const originNode = viewport.querySelector<HTMLElement>("[data-gallery-spacer]") ?? viewport;
  const origin = originNode.getBoundingClientRect();
  const tiles: PhotoRect[] = [];
  const nodes = viewport.querySelectorAll<HTMLElement>("[data-photo-key]");
  for (const node of nodes) {
    const id = node.dataset.photoKey;
    if (!id) {
      continue;
    }
    const box = node.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) {
      continue;
    }
    tiles.push({
      id,
      left: box.left - origin.left,
      top: box.top - origin.top,
      width: box.width,
      height: box.height,
    });
  }
  return tiles;
}

export function readVisiblePhotoRects(viewport: HTMLElement): PhotoRect[] {
  return captureVisiblePhotoRects(viewport);
}

function layoutTranslate(node: HTMLElement): { x: number; y: number } {
  const x = Number(node.dataset.tileX);
  const y = Number(node.dataset.tileY);
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
  };
}

export function playPhotoFlipMoves(
  viewport: HTMLElement,
  moves: readonly PhotoFlipMove[],
  session: PhotoFlipSession,
  generation: number,
  onDone: () => void,
): void {
  cancelPhotoFlip(session);
  session.generation = generation;
  viewport.setAttribute(PHOTO_FLIP_ATTR, "true");
  const byId = new Map<string, HTMLElement>();
  for (const node of viewport.querySelectorAll<HTMLElement>("[data-photo-key]")) {
    const id = node.dataset.photoKey;
    if (id) {
      byId.set(id, node);
    }
  }
  const animations: Animation[] = [];
  const finish = () => {
    if (session.generation !== generation) {
      return;
    }
    viewport.removeAttribute(PHOTO_FLIP_ATTR);
    session.animations = [];
    onDone();
  };
  for (const move of moves) {
    const node = byId.get(move.id);
    if (!node) {
      continue;
    }
    const placed = layoutTranslate(node);
    const img = node.querySelector("img");
    const innerHasTransform = Boolean(img?.style.transform);
    const scale = flipScaleForPlay(move.sx, move.sy, innerHasTransform);
    const from = `translate(${placed.x}px, ${placed.y}px) translate(${move.dx}px, ${move.dy}px) scale(${scale.sx}, ${scale.sy})`;
    const to = `translate(${placed.x}px, ${placed.y}px)`;
    const animation = node.animate([{ transform: from }, { transform: to }], {
      duration: PHOTO_FLIP_MS,
      easing: PHOTO_FLIP_EASING,
      fill: "none",
    });
    animations.push(animation);
    if (img && (Math.abs(scale.sx - 1) >= NOOP_SCALE || Math.abs(scale.sy - 1) >= NOOP_SCALE)) {
      const previousOrigin = img.style.transformOrigin;
      img.style.transformOrigin = "0 0";
      const inner = img.animate(
        [{ transform: `scale(${1 / scale.sx}, ${1 / scale.sy})` }, { transform: "none" }],
        { duration: PHOTO_FLIP_MS, easing: PHOTO_FLIP_EASING, fill: "none" },
      );
      void inner.finished.catch(() => undefined).then(() => {
        if (img.style.transformOrigin === "0 0") {
          img.style.transformOrigin = previousOrigin;
        }
      });
      animations.push(inner);
    }
  }
  if (animations.length === 0) {
    finish();
    return;
  }
  session.animations = animations;
  void Promise.all(animations.map((animation) => animation.finished.catch(() => undefined))).then(finish);
}

export function photoFlipId(path: string): string {
  return pathKey(path);
}
