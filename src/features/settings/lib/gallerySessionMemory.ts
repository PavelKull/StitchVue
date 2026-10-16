import { normalizeLayoutMode, type LayoutMode } from "../../entities/gallery/layoutMode.ts";

/** Keep in sync with `ZOOM_STEPS` in `StitchVueGrid.tsx`. */
const ZOOM_STEPS = [8, 6, 4, 3, 2, 1.5, 1] as const;

export type GallerySessionMemory = {
  lastLayoutMode?: LayoutMode;
  lastRowsPerScreen?: number;
  lastFolderPath?: string;
};

const STORAGE_KEY = "stitchvue.galleryMemory.v1";

export const ZOOM_DEFAULT = 4;

export function validateLayoutMode(value: unknown, fallback: LayoutMode): LayoutMode {
  return normalizeLayoutMode(value) ?? fallback;
}

export function validateRowsPerScreen(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return ZOOM_DEFAULT;
  }
  if ((ZOOM_STEPS as readonly number[]).includes(value)) {
    return value;
  }
  const nearest = ZOOM_STEPS.reduce((best, step) =>
    Math.abs(step - value) < Math.abs(best - value) ? step : best,
  );
  return nearest;
}

export function loadGallerySessionMemory(): GallerySessionMemory {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as GallerySessionMemory;
    const memory: GallerySessionMemory = {};
    if (parsed.lastLayoutMode != null) {
      const mode = normalizeLayoutMode(parsed.lastLayoutMode);
      if (mode) {
        memory.lastLayoutMode = mode;
      }
    }
    if (parsed.lastRowsPerScreen != null) {
      memory.lastRowsPerScreen = validateRowsPerScreen(parsed.lastRowsPerScreen);
    }
    if (typeof parsed.lastFolderPath === "string" && parsed.lastFolderPath.length > 0) {
      memory.lastFolderPath = parsed.lastFolderPath;
    }
    return memory;
  } catch {
    return {};
  }
}

export function saveGallerySessionMemory(patch: Partial<GallerySessionMemory>): GallerySessionMemory {
  const next = { ...loadGallerySessionMemory(), ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    return next;
  }
  return next;
}

export function clearGallerySessionMemory() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function resolveInitialLayoutMode(
  preferences: { defaultLayoutMode: LayoutMode; rememberLayoutMode: boolean },
  memory: GallerySessionMemory,
): LayoutMode {
  if (preferences.rememberLayoutMode && memory.lastLayoutMode) {
    return validateLayoutMode(memory.lastLayoutMode, preferences.defaultLayoutMode);
  }
  return validateLayoutMode(preferences.defaultLayoutMode, "mosaic");
}

export function resolveInitialRowsPerScreen(
  preferences: { rememberZoom: boolean },
  memory: GallerySessionMemory,
): number {
  if (preferences.rememberZoom && memory.lastRowsPerScreen != null) {
    return validateRowsPerScreen(memory.lastRowsPerScreen);
  }
  return ZOOM_DEFAULT;
}
