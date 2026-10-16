/** Ширина полосы градиента у края (синхронно с `$nav-edge-shade-width` в SCSS). */
export const NAV_EDGE_SHADE_PX = 120;

export type NavEdgeShadeTone = "backdrop" | "photo";

/**
 * backdrop — светло-серый градиент на тёмном фоне;
 * photo — тёмный градиент поверх кадра.
 */
export function navEdgeShadeTone(
  aspect: number,
  fillScreen: boolean,
  appFullscreen: boolean,
): NavEdgeShadeTone {
  const portrait = aspect < 1;
  if (portrait || !fillScreen || !appFullscreen) {
    return "backdrop";
  }
  return "photo";
}
