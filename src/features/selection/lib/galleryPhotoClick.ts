export type GalleryPhotoClickIntent = "open" | "toggle" | "extend" | "trash-blocked";

/** Intent from a gallery tile click — mirrors StitchVueGrid hit handling. */
export function resolveGalleryPhotoClick(input: {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  selectionMode: boolean;
  inTrash: boolean;
}): GalleryPhotoClickIntent {
  const multi = input.shiftKey || input.ctrlKey || input.metaKey;
  if (input.inTrash && multi) {
    return "trash-blocked";
  }
  if (input.shiftKey) {
    return "extend";
  }
  if (input.ctrlKey || input.metaKey || input.selectionMode) {
    return "toggle";
  }
  return "open";
}

/**
 * Ctrl/Shift/Meta must not start WebView2 text/image selection.
 * Handle those gestures on mousedown with preventDefault, then skip the cancelled click.
 * Plain clicks (no modifiers) stay on click so buttons keep working.
 */
export function shouldSuppressNativeSelection(input: {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  return input.shiftKey || input.ctrlKey || input.metaKey;
}

/** Block browser/WebView2 selectstart inside the gallery viewport (does not cancel click). */
export function suppressGalleryNativeSelectStart(event: Event): void {
  event.preventDefault();
}
