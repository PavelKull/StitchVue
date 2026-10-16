export type ImageFile = {
  name: string;
  path: string;
  size: number;
  modifiedAt: number;
};

export type ImageMeta = {
  width: number;
  height: number;
  /** User rotation on top of baked EXIF, in 90° clockwise steps (0–3). */
  rotationQuarters?: number;
};

export type ThumbInfo = {
  tier: number;
  thumbnailPath: string;
};
