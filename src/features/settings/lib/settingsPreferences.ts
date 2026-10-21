import { normalizeLayoutMode, type LayoutMode } from "../../../entities/gallery/layoutMode.ts";
import {
  readSystemLanguages,
  resolveLocale,
  type UserFacingLocale,
} from "../../../shared/i18n/config.ts";
import type { MoveConfirm } from "../../selection/lib/fileOperation.ts";
import {
  loadGallerySessionMemory,
  saveGallerySessionMemory,
  validateLayoutMode,
  validateRowsPerScreen,
} from "./gallerySessionMemory.ts";

export type SettingsTab = "gallery" | "interface" | "performance" | "support" | "about";

export type AppPreferences = {
  defaultLayoutMode: LayoutMode;
  rememberLayoutMode: boolean;
  rememberZoom: boolean;
  rememberLastFolder: boolean;
  confirmMove: MoveConfirm;
  panelsPeekOnEdge: boolean;
  rememberPanelsPinned: boolean;
  animationsEnabled: boolean;
  /** Overlay mtime labels on gallery tiles. Default off. */
  showPhotoDates: boolean;
  /** UI language: `ru` | `en` | `de` | `zh-Hans`. */
  locale: UserFacingLocale;
};

type LegacyV1 = Partial<AppPreferences> & {
  sidebarPeekOnEdge?: boolean;
  topNavPeekOnEdge?: boolean;
  toolbarPeekOnEdge?: boolean;
  rememberSidebarPinned?: boolean;
  rememberTopNavPinned?: boolean;
  rememberToolbarPinned?: boolean;
  confirmLargeMove?: boolean;
  storageOptimization?: string;
  showSortButtons?: boolean;
  showDateSort?: boolean;
  showNameSort?: boolean;
  showPhotoDates?: boolean;
};

const STORAGE_KEY_V2 = "stitchvue.preferences.v2";
const STORAGE_KEY_V1 = "stitchvue.preferences.v1";

export const DEFAULT_PREFERENCES: AppPreferences = {
  defaultLayoutMode: "mosaic",
  rememberLayoutMode: true,
  rememberZoom: true,
  rememberLastFolder: false,
  confirmMove: "mass",
  panelsPeekOnEdge: true,
  rememberPanelsPinned: true,
  animationsEnabled: true,
  showPhotoDates: false,
  // Сброс настроек и продуктовый дефолт; первый запуск без storage — тоже en.
  locale: "en",
};

function normalizeMoveConfirm(parsed: { confirmMove?: MoveConfirm; confirmLargeMove?: boolean }): MoveConfirm {
  if (parsed.confirmMove === "always" || parsed.confirmMove === "mass" || parsed.confirmMove === "never") {
    return parsed.confirmMove;
  }
  if (parsed.confirmLargeMove === false) {
    return "never";
  }
  return "mass";
}

function normalizePreferences(
  parsed: Partial<AppPreferences>,
  options: { hasExistingPreferences: boolean },
): AppPreferences {
  return {
    defaultLayoutMode: validateLayoutMode(parsed.defaultLayoutMode, DEFAULT_PREFERENCES.defaultLayoutMode),
    rememberLayoutMode: parsed.rememberLayoutMode !== false,
    rememberZoom: parsed.rememberZoom !== false,
    // Opt-in: default startup is This PC; missing field stays false.
    rememberLastFolder: parsed.rememberLastFolder === true,
    confirmMove: normalizeMoveConfirm(parsed),
    panelsPeekOnEdge: parsed.panelsPeekOnEdge !== false,
    rememberPanelsPinned: parsed.rememberPanelsPinned !== false,
    animationsEnabled: parsed.animationsEnabled !== false,
    // Opt-in: missing field in v2 stays false without touching other keys.
    showPhotoDates: parsed.showPhotoDates === true,
    locale: resolveLocale({
      saved: parsed.locale,
      hasExistingPreferences: options.hasExistingPreferences,
      systemLanguages: readSystemLanguages(),
    }),
  };
}

function migrateLegacySessionToGalleryMemory() {
  try {
    const layoutRaw = sessionStorage.getItem("gallery.layoutMode");
    const zoomRaw = sessionStorage.getItem("zoom.rowsPerScreen");
    const patch: ReturnType<typeof loadGallerySessionMemory> = {};
    if (layoutRaw) {
      const mode = normalizeLayoutMode(JSON.parse(layoutRaw));
      if (mode) {
        patch.lastLayoutMode = mode;
      }
    }
    if (zoomRaw) {
      patch.lastRowsPerScreen = validateRowsPerScreen(JSON.parse(zoomRaw));
    }
    if (Object.keys(patch).length > 0) {
      saveGallerySessionMemory(patch);
    }
  } catch {
    /* ignore */
  }
}

function migrateV1ToV2(raw: LegacyV1): AppPreferences {
  const peek =
    raw.sidebarPeekOnEdge !== false &&
    raw.topNavPeekOnEdge !== false &&
    raw.toolbarPeekOnEdge !== false;
  const rememberPinned =
    raw.rememberSidebarPinned !== false &&
    raw.rememberTopNavPinned !== false &&
    raw.rememberToolbarPinned !== false;

  return normalizePreferences(
    {
      defaultLayoutMode: normalizeLayoutMode(raw.defaultLayoutMode) ?? DEFAULT_PREFERENCES.defaultLayoutMode,
      rememberLayoutMode: raw.rememberLayoutMode,
      rememberZoom: raw.rememberZoom,
      rememberLastFolder: raw.rememberLastFolder,
      confirmMove: normalizeMoveConfirm(raw),
      panelsPeekOnEdge: raw.panelsPeekOnEdge ?? peek,
      rememberPanelsPinned: raw.rememberPanelsPinned ?? rememberPinned,
      animationsEnabled: raw.animationsEnabled,
      showPhotoDates: raw.showPhotoDates === true,
      locale: raw.locale,
    },
    { hasExistingPreferences: true },
  );
}

function persistV2(preferences: AppPreferences): boolean {
  try {
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}

export function loadPreferences(): AppPreferences {
  try {
    const v2 = localStorage.getItem(STORAGE_KEY_V2);
    if (v2) {
      const parsed = JSON.parse(v2) as Partial<AppPreferences>;
      const hadLocale = Object.prototype.hasOwnProperty.call(parsed, "locale");
      const normalized = normalizePreferences(parsed, { hasExistingPreferences: true });
      // Дописываем locale существующим пользователям (миграция без сброса прочих полей).
      if (!hadLocale) {
        persistV2(normalized);
      }
      return normalized;
    }

    const v1 = localStorage.getItem(STORAGE_KEY_V1);
    if (v1) {
      const migrated = migrateV1ToV2(JSON.parse(v1) as LegacyV1);
      persistV2(migrated);
      migrateLegacySessionToGalleryMemory();
      return migrated;
    }

    // Первый запуск: продуктовые дефолты + locale с ОС (поле locale из DEFAULT не подставляем).
    return {
      ...DEFAULT_PREFERENCES,
      locale: resolveLocale({
        saved: undefined,
        hasExistingPreferences: false,
        systemLanguages: readSystemLanguages(),
      }),
    };
  } catch {
    return {
      ...DEFAULT_PREFERENCES,
      locale: resolveLocale({
        saved: undefined,
        hasExistingPreferences: false,
        systemLanguages: readSystemLanguages(),
      }),
    };
  }
}

export function savePreferences(patch: Partial<AppPreferences>): AppPreferences {
  const next = normalizePreferences(
    { ...loadPreferences(), ...patch },
    { hasExistingPreferences: true },
  );
  persistV2(next);
  return next;
}

export function resetPreferencesToDefaults(): AppPreferences {
  const next = { ...DEFAULT_PREFERENCES };
  persistV2(next);
  return next;
}

/** @deprecated Use gallerySessionMemory; kept for tests migrating off sessionStorage. */
export function loadSessionValue<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}


