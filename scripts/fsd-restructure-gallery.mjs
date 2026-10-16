/**
 * One-off: gallery FSD folder restructure. Run from repo root.
 * Usage: node scripts/fsd-restructure-gallery.mjs [--mv-only] [--fix-imports-only]
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const gallery = path.join(root, "src/features/gallery");

/** @type {Record<string, string>} basename (no ext) -> path under gallery/ */
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

const SKIP = new Set(["useGalleryThumbProgress"]);

function gitMv(from, to) {
  const dir = path.dirname(to);
  fs.mkdirSync(dir, { recursive: true });
  execSync(`git mv "${from}" "${to}"`, { cwd: root, stdio: "inherit" });
}

function runMoves() {
  for (const [base, destRel] of Object.entries(MOVES)) {
    if (SKIP.has(base)) continue;
    for (const ext of [".ts", ".tsx"]) {
      const from = path.join(gallery, `${base}${ext}`);
      if (!fs.existsSync(from)) continue;
      const to = path.join(gallery, `${destRel}${ext}`);
      gitMv(from, to);
    }
  }
}

/** @type {Map<string, string>} resolved absolute path -> gallery-relative dir/file without ext */
function buildModuleIndex() {
  const index = new Map();
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(ent.name) && !ent.name.endsWith(".d.ts")) {
        const base = ent.name.replace(/\.(ts|tsx)$/, "");
        const rel = path.relative(gallery, p).replace(/\\/g, "/").replace(/\.(ts|tsx)$/, "");
        index.set(base, rel);
      }
    }
  }
  walk(gallery);
  return index;
}

function posixRelative(fromFile, toModuleRel) {
  const fromDir = path.dirname(fromFile).replace(/\\/g, "/");
  const toPath = toModuleRel.replace(/\\/g, "/");
  const rel = path.posix.relative(fromDir, toPath);
  return rel.startsWith(".") ? rel : `./${rel}`;
}

function fixImportsInRepo() {
  const moduleIndex = buildModuleIndex();
  const srcRoot = path.join(root, "src");

  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules") continue;
        walk(p);
      } else if (/\.(ts|tsx)$/.test(ent.name)) {
        fixFile(p, moduleIndex);
      }
    }
  }
  walk(srcRoot);
}

function fixFile(filePath, moduleIndex) {
  let content = fs.readFileSync(filePath, "utf8");
  let changed = false;
  const filePosix = filePath.replace(/\\/g, "/");

  // features/gallery/oldPath -> features/gallery/newPath
  for (const [base, destRel] of Object.entries(MOVES)) {
    if (SKIP.has(base)) continue;
    const patterns = [
      new RegExp(`(features/gallery/)${base}(\\.ts)?(?=['"])`, "g"),
      new RegExp(`(features/gallery/)${base}/`, "g"),
    ];
    for (const re of patterns) {
      const next = content.replace(re, `$1${destRel}`);
      if (next !== content) {
        content = next;
        changed = true;
      }
    }
  }

  // Relative ./module and ../module (strip .ts)
  content = content.replace(
    /from\s+(['"])(\.[^'"]+)(['"])/g,
    (match, q1, imp, q2) => {
      const clean = imp.replace(/\.ts$/, "").replace(/\.tsx$/, "");
      const base = path.posix.basename(clean);
      if (!moduleIndex.has(base)) return match;
      const targetRel = moduleIndex.get(base);
      const resolved = path.posix.normalize(
        path.posix.join(path.posix.dirname(filePosix.replace(/.*\/src\//, "src/")), clean),
      );
      // Only rewrite gallery-internal imports or imports that resolve to a moved gallery module
      if (!filePosix.includes("/features/gallery/") && !targetRel) return match;
      const fromDir = path.dirname(filePosix).replace(/\\/g, "/");
      if (!fromDir.includes("/features/gallery/") && !imp.includes("features/gallery")) {
        // External file importing gallery via relative? rare
      }
      const newRel = posixRelative(fromDir, path.join("src/features/gallery", targetRel));
      if (newRel === clean || newRel === imp) return match;
      // Avoid rewriting node_modules / entities paths
      if (clean.includes("entities/") || clean.includes("widgets/")) return match;
      const newImp = imp.endsWith(".ts") ? `${newRel}.ts` : imp.endsWith(".tsx") ? `${newRel}.tsx` : newRel;
      changed = true;
      return `from ${q1}${newImp}${q2}`;
    },
  );

  if (changed) fs.writeFileSync(filePath, content);
}

const args = new Set(process.argv.slice(2));
if (!args.has("--fix-imports-only")) runMoves();
if (!args.has("--mv-only")) fixImportsInRepo();

console.log("Done.");
