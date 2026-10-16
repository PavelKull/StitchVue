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
  externalDrop: "lib/directory/externalDrop",
  galleryBootStartPath: "lib/boot/galleryBootStartPath",
  galleryIndexPayload: "lib/indexing/galleryIndexPayload",
  indexingPathEquality: "lib/indexing/indexingPathEquality",
  galleryScrollJump: "lib/viewport/galleryScrollJump",
  scrollLoadMode: "lib/viewport/scrollLoadMode",
  bottomScrollPad: "lib/viewport/bottomScrollPad",
  galleryGeometryGate: "lib/viewport/galleryGeometryGate",
  galleryOrder: "lib/listing/galleryOrder",
  galleryListing: "lib/listing/galleryListing",
  imagesBatch: "lib/listing/imagesBatch",
  folderThumbnailsPending: "lib/thumbnails/folderThumbnailsPending",
  pipelineStats: "api/pipelineStats",
  metaBatch: "lib/pipeline/metaBatch",
  hoverPrefetch: "lib/pipeline/hoverPrefetch",
  nativeWarm: "lib/pipeline/nativeWarm",
  viewerNav: "lib/viewer/viewerNav",
  viewerPace: "lib/viewer/viewerPace",
  viewerPreload: "lib/viewer/viewerPreload",
  viewerPreloadLogic: "lib/viewer/viewerPreloadLogic",
  displayRotation: "lib/viewer/displayRotation",
  galleryHover: "lib/viewer/galleryHover",
  panelMemory: "lib/chrome/panelMemory",
  topNavDock: "lib/chrome/topNavDock",
  toolbarPeekGeometry: "lib/chrome/toolbarPeekGeometry",
  topNavPeekGeometry: "lib/chrome/topNavPeekGeometry",
  driveIcon: "lib/chrome/driveIcon",
  folderHotCache: "lib/cache/folderHotCache",
  galleryPipelineEvents: "model/pipeline/galleryPipelineEvents",
  useGalleryScrollActivity: "model/viewport/useGalleryScrollActivity",
  useGalleryScrollJump: "model/viewport/useGalleryScrollJump",
  useGalleryBottomOverlayReserve: "model/viewport/useGalleryBottomOverlayReserve",
  useGalleryPanelPeek: "model/chrome/useGalleryPanelPeek",
  useGalleryBoot: "model/boot/useGalleryBoot",
  useGalleryDrives: "model/directory/useGalleryDrives",
  useGalleryFolderHistory: "model/directory/useGalleryFolderHistory",
  useGalleryIndexingSync: "model/indexing/useGalleryIndexingSync",
};

function buildModuleIndex() {
  const index = new Map();
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(ent.name)) {
        const base = ent.name.replace(/\.(ts|tsx)$/, "");
        const rel = path.relative(gallery, p).replace(/\\/g, "/").replace(/\.(ts|tsx)$/, "");
        index.set(base, rel);
      }
    }
  }
  walk(gallery);
  return index;
}

function posixRel(fromFile, toRelNoExt) {
  const fromDir = path.dirname(fromFile).replace(/\\/g, "/");
  const toPath = path.join(gallery, toRelNoExt).replace(/\\/g, "/");
  let rel = path.posix.relative(fromDir, toPath);
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

function replaceGalleryAbsolute(content) {
  let out = content;
  const bases = Object.keys(MOVES).sort((a, b) => b.length - a.length);
  for (const base of bases) {
    const dest = MOVES[base];
    out = out.replaceAll(`features/gallery/${base}.ts`, `features/gallery/${dest}.ts`);
    out = out.replaceAll(`features/gallery/${base}`, `features/gallery/${dest}`);
  }
  return out;
}

function fixRelativeGalleryImports(filePath, content, moduleIndex) {
  const filePosix = filePath.replace(/\\/g, "/");
  if (!filePosix.includes("/src/features/gallery/")) return content;

  return content.replace(
    /(from|import)\s+(['"])(\.[^'"]+)(['"])/g,
    (full, kw, q1, imp, q2) => {
      const hadTs = imp.endsWith(".ts") || imp.endsWith(".tsx");
      const clean = imp.replace(/\.tsx?$/, "");
      const base = path.posix.basename(clean);
      const target = moduleIndex.get(base);
      if (!target) return full;
      const newBase = posixRel(filePath, target);
      const newImp = hadTs ? `${newBase}${imp.endsWith(".tsx") ? ".tsx" : ".ts"}` : newBase;
      if (newImp === imp) return full;
      return `${kw} ${q1}${newImp}${q2}`;
    },
  );
}

function galleryNestingDepth(filePath) {
  const filePosix = filePath.replace(/\\/g, "/");
  const tail = filePosix.split("/features/gallery/")[1];
  if (!tail) return 0;
  return tail.split("/").length - 1;
}

function fixCrossLayerFromGallery(filePath, content) {
  const depth = galleryNestingDepth(filePath);
  if (depth <= 0) return content;
  const toSrc = "../".repeat(2 + depth);
  let out = content;
  out = out.replace(/from (['"])\.\.\/\.\.\/entities\//g, `from $1${toSrc}entities/`);
  out = out.replace(/from (['"])\.\.\/\.\.\/shared\//g, `from $1${toSrc}shared/`);
  out = out.replace(/from (['"])\.\.\/\.\.\/widgets\//g, `from $1${toSrc}widgets/`);
  out = out.replace(/from (['"])\.\.\/selection\//g, `from $1${"../".repeat(1 + depth)}selection/`);
  out = out.replace(/from (['"])\.\.\/\.\.\/selection\//g, `from $1${"../".repeat(2 + depth)}selection/`);
  const toFeatures = "../".repeat(1 + depth);
  out = out.replace(/from (['"])\.\.\/settings\//g, `from $1${toFeatures}settings/`);
  out = out.replace(/from (['"])\.\.\/folder\//g, `from $1${toFeatures}folder/`);
  return out;
}

function walk(dir, moduleIndex) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules") continue;
      walk(p, moduleIndex);
    } else if (/\.(ts|tsx)$/.test(ent.name)) {
      let c = fs.readFileSync(p, "utf8");
      const n1 = replaceGalleryAbsolute(c);
      let n2 = fixRelativeGalleryImports(p, n1, moduleIndex);
      n2 = fixCrossLayerFromGallery(p, n2);
      if (n2 !== c) fs.writeFileSync(p, n2);
    }
  }
}

const moduleIndex = buildModuleIndex();
walk(path.join(root, "src"), moduleIndex);
console.log("Import fix complete.");
