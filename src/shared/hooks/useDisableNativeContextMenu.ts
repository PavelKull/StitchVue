import { useEffect } from "react";

/** Blocks the WebView2 / browser context menu without stopping event propagation. */
export function suppressNativeContextMenu(event: Event): void {
  event.preventDefault();
}

/**
 * Disables the native context menu for the whole window.
 * Custom StitchVue menus keep working: they listen on targets and must not rely on
 * the browser default. Do not call stopPropagation here.
 */
export function useDisableNativeContextMenu(): void {
  useEffect(() => {
    document.addEventListener("contextmenu", suppressNativeContextMenu);
    return () => {
      document.removeEventListener("contextmenu", suppressNativeContextMenu);
    };
  }, []);
}
