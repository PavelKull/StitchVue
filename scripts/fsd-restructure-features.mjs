import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

/** @type {Array<{ feature: string; moves: Record<string, string> }>} */
const PLANS = [
  {
    feature: "favorites",
    moves: {
      favoriteOptimisticOverlay: "lib/favoriteOptimisticOverlay",
      favoritePathsServerSync: "lib/favoritePathsServerSync",
      favoritesCollectionLifecycle: "lib/favoritesCollectionLifecycle",
      favoriteMassUnfavoriteOptimistic: "lib/favoriteMassUnfavoriteOptimistic",
      favoriteOptimisticMemoryDiag: "lib/favoriteOptimisticMemoryDiag",
      favoriteOptimisticLifecycle: "lib/favoriteOptimisticLifecycle",
    },
  },
  {
    feature: "selection",
    moves: {
      selection: "lib/selection",
      fileOperation: "lib/fileOperation",
      removeFavoritesBatch: "lib/removeFavoritesBatch",
      selectionMode: "lib/selectionMode",
      selectionDiag: "lib/selectionDiag",
      unfavoriteClassifyDiag: "lib/unfavoriteClassifyDiag",
      unfavoriteGate: "lib/unfavoriteGate",
      galleryPhotoClick: "lib/galleryPhotoClick",
      pathKey: "lib/pathKey",
      SelectionDiagOverlay: "ui/SelectionDiagOverlay",
    },
  },
  {
    feature: "app-fullscreen",
    moves: {
      useAppFullscreen: "model/useAppFullscreen",
      appFullscreenController: "model/appFullscreenController",
      appFullscreenMotion: "lib/appFullscreenMotion",
      appFullscreenBridge: "lib/appFullscreenBridge",
      appFullscreenWindow: "lib/appFullscreenWindow",
      appFullscreenDiag: "lib/appFullscreenDiag",
      prototypeWindowAnim: "lib/prototypeWindowAnim",
      waitForWindowSettle: "lib/waitForWindowSettle",
    },
  },
  {
    feature: "settings",
    moves: {
      settingsPreferences: "lib/settingsPreferences",
      gallerySessionMemory: "lib/gallerySessionMemory",
      formatCacheSize: "lib/formatCacheSize",
      openExternalLink: "api/openExternalLink",
      reportProblem: "api/reportProblem",
    },
  },
  {
    feature: "folder",
    moves: {
      insertServiceFolder: "lib/insertServiceFolder",
      folderMenu: "lib/folderMenu",
      folderOrder: "lib/folderOrder",
      folderTileFlip: "lib/folderTileFlip",
      drivesState: "lib/drivesState",
      listDrives: "lib/listDrives",
      parentPath: "lib/parentPath",
    },
  },
  {
    feature: "support-reminder",
    moves: {
      useSupportReminder: "model/useSupportReminder",
      supportReminderLogic: "lib/supportReminderLogic",
      supportReminderState: "lib/supportReminderState",
      supportReminderTypes: "lib/supportReminderTypes",
    },
  },
  {
    feature: "select-folder",
    moves: {
      selectFolder: "lib/selectFolder",
    },
  },
];

function gitMv(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  execSync(`git mv "${from}" "${to}"`, { cwd: root, stdio: "inherit" });
}

const globalMoves = {};

for (const { feature, moves } of PLANS) {
  const baseDir = path.join(root, "src/features", feature);
  for (const [name, dest] of Object.entries(moves)) {
    globalMoves[`features/${feature}/${name}`] = `features/${feature}/${dest}`;
    for (const suffix of ["", ".test"]) {
      for (const ext of [".ts", ".tsx"]) {
        const file = `${name}${suffix}${ext}`;
        const from = path.join(baseDir, file);
        if (!fs.existsSync(from)) continue;
        const to = path.join(baseDir, `${dest}${suffix}${ext}`);
        gitMv(from, to);
      }
    }
  }
}

// Write map for import fixer
fs.writeFileSync(
  path.join(root, "scripts/.fsd-feature-moves.json"),
  JSON.stringify(globalMoves, null, 2),
);
console.log("Feature restructure moves done.");
