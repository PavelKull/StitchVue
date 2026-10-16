import { DEFAULT_GALLERY_SORT, type GallerySort, type SortDirection, type SortKey } from "../listing/galleryOrder.ts";

const STORAGE_KEY = "stitchvue.ui.v1";

export type PanelMemory = {
  sidebarPinned: boolean;
  topNavPinned: boolean;
  toolbarPinned: boolean;
  sidebarWidth: number;
  sort: GallerySort;
};

const DEFAULTS: PanelMemory = {
  sidebarPinned: true,
  topNavPinned: true,
  toolbarPinned: true,
  sidebarWidth: 280,
  sort: DEFAULT_GALLERY_SORT,
};

export function clampSidebarWidth(width: number, windowWidth: number): number {
  const max = Math.min(600, Math.max(220, windowWidth * 0.45));
  return Math.min(max, Math.max(220, Math.round(width)));
}

export function loadPanelMemory(): PanelMemory {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULTS, sort: { ...DEFAULTS.sort } };
    }
    const parsed = JSON.parse(raw) as Partial<PanelMemory> & { sort?: Partial<GallerySort> };
    return normalizeMemory(parsed);
  } catch {
    return { ...DEFAULTS, sort: { ...DEFAULTS.sort } };
  }
}

export function savePanelMemory(patch: Partial<PanelMemory> & { sort?: Partial<GallerySort> }): PanelMemory {
  const current = loadPanelMemory();
  const next = normalizeMemory({
    ...current,
    ...patch,
    sort: { ...current.sort, ...patch.sort },
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

function normalizeMemory(parsed: Partial<PanelMemory> & { sort?: Partial<GallerySort> }): PanelMemory {
  const sortKey: SortKey | null = parsed.sort?.key === "name" || parsed.sort?.key === "date" ? parsed.sort.key : null;
  const direction: SortDirection = parsed.sort?.direction === "asc" ? "asc" : "desc";
  return {
    sidebarPinned: parsed.sidebarPinned !== false,
    topNavPinned: parsed.topNavPinned !== false,
    toolbarPinned: parsed.toolbarPinned !== false,
    sidebarWidth: clampSidebarWidth(
      typeof parsed.sidebarWidth === "number" && Number.isFinite(parsed.sidebarWidth) ? parsed.sidebarWidth : 280,
      1920,
    ),
    sort: {
      key: sortKey,
      direction,
      grouped: parsed.sort?.grouped !== false,
    },
  };
}
