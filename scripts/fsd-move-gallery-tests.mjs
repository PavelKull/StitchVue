import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const gallery = path.join(root, "src/features/gallery");

const MOVES = {
  directorySession: "lib/directory/directorySession",
  galleryDirectoryView: "lib/directory/galleryDirectoryView",
  galleryFolderHistory: "lib/directory/galleryFolderHistory",
  folderRefresh: "lib/directory/folderRefresh",
  restorePromptText: "lib/directory/restorePromptText",
  galleryBootStartPath: "lib/boot/galleryBootStartPath",
  galleryIndexPayload: "lib/indexing/galleryIndexPayload",
  indexingPathEquality: "lib/indexing/indexingPathEquality",
  galleryScrollJump: "lib/viewport/galleryScrollJump",
  scrollLoadMode: "lib/viewport/scrollLoadMode",
  bottomScrollPad: "lib/viewport/bottomScrollPad",
  galleryGeometryGate: "lib/viewport/galleryGeometryGate",
  galleryOrder: "lib/listing/galleryOrder",
  galleryListing: "lib/listing/galleryListing",
  folderThumbnailsPending: "lib/thumbnails/folderThumbnailsPending",
  hoverPrefetch: "lib/pipeline/hoverPrefetch",
  nativeWarm: "lib/pipeline/nativeWarm",
  viewerPreloadLogic: "lib/viewer/viewerPreloadLogic",
  viewerPace: "lib/viewer/viewerPace",
  toolbarPeekGeometry: "lib/chrome/toolbarPeekGeometry",
  topNavPeekGeometry: "lib/chrome/topNavPeekGeometry",
  folderHotCache: "lib/cache/folderHotCache",
  galleryPipelineEvents: "model/pipeline/galleryPipelineEvents",
  useGalleryScrollActivity: "model/viewport/useGalleryScrollActivity",
  useGalleryScrollJump: "model/viewport/useGalleryScrollJump",
  useGalleryPanelPeek: "model/chrome/useGalleryPanelPeek",
};

const SKIP = new Set(["useGalleryThumbProgress"]);

for (const [base, destRel] of Object.entries(MOVES)) {
  if (SKIP.has(base)) continue;
  const from = path.join(gallery, `${base}.test.ts`);
  if (!fs.existsSync(from)) continue;
  const to = path.join(gallery, `${destRel}.test.ts`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  execSync(`git mv "${from}" "${to}"`, { cwd: root, stdio: "inherit" });
}
console.log("Test moves done.");
