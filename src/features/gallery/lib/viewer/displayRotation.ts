import type { CSSProperties } from "react";
import type { ImageMeta } from "../../../../entities/image/types";

export function rotationQuarters(meta: ImageMeta | undefined): number {
  return meta?.rotationQuarters ?? 0;
}

export function displayAspect(width: number, height: number, quarters: number): number {
  if (width <= 0 || height <= 0) {
    return 1;
  }
  if (quarters % 2 === 1) {
    return height / width;
  }
  return width / height;
}

export function rotationDegrees(quarters: number): number {
  return (quarters % 4) * 90;
}

/** Sizes the thumbnail bitmap before CSS rotation so it fills the grid tile. */
export function tilePhotoStyle(
  tileWidth: number,
  tileHeight: number,
  quarters: number,
): CSSProperties | undefined {
  const q = ((quarters % 4) + 4) % 4;
  if (q === 0) {
    return undefined;
  }
  const spin = rotationDegrees(q);
  if (q % 2 === 1) {
    return {
      inset: "auto",
      top: "50%",
      left: "50%",
      width: tileHeight,
      height: tileWidth,
      maxWidth: "none",
      maxHeight: "none",
      objectFit: "fill",
      transform: `translate(-50%, -50%) rotate(${spin}deg)`,
    };
  }
  return { transform: `rotate(${spin}deg)` };
}

/** Sizes the bitmap before CSS rotation so it fills the viewer frame in «По экрану». */
export function viewerPhotoStyle(
  frameWidth: number,
  frameHeight: number,
  quarters: number,
): CSSProperties | undefined {
  const q = ((quarters % 4) + 4) % 4;
  if (q === 0) {
    return undefined;
  }
  const spin = rotationDegrees(q);
  if (q % 2 === 1) {
    return {
      width: frameHeight,
      height: frameWidth,
      maxWidth: "none",
      maxHeight: "none",
      objectFit: "fill",
      transform: `rotate(${spin}deg)`,
    };
  }
  return { objectFit: "fill", transform: `rotate(${spin}deg)` };
}
