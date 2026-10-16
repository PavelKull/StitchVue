import i18n from "../../shared/i18n/i18n.ts";

export type LayoutMode = "grid" | "mosaic" | "columns";

export const LAYOUT_MODES: LayoutMode[] = ["mosaic", "grid", "columns"];

/** Reactive label for the active UI language. */
export function layoutModeLabel(mode: LayoutMode): string {
  return i18n.t(`gallery.layout.${mode}`);
}

/** @deprecated Prefer layoutModeLabel(); kept for any residual callers. */
export const LAYOUT_MODE_LABELS: Record<LayoutMode, string> = {
  get grid() {
    return layoutModeLabel("grid");
  },
  get mosaic() {
    return layoutModeLabel("mosaic");
  },
  get columns() {
    return layoutModeLabel("columns");
  },
};

/** Old session values: «Микс» is mosaic. Horizontal and vertical modes are gone. */
export function normalizeLayoutMode(value: unknown): LayoutMode | null {
  if (value === "grid" || value === "mosaic" || value === "columns") {
    return value;
  }
  if (value === "mixed") {
    return "mosaic";
  }
  return null;
}
