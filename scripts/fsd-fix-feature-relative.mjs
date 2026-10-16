import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

const SEGMENT_FEATURES = [
  "favorites",
  "selection",
  "app-fullscreen",
  "settings",
  "folder",
  "support-reminder",
  "select-folder",
];

function inFeatureSegment(filePath) {
  const posix = filePath.replace(/\\/g, "/");
  for (const f of SEGMENT_FEATURES) {
    const re = new RegExp(`/features/${f}/(lib|model|api|ui)/`);
    if (re.test(posix)) return true;
  }
  return false;
}

function fixContent(filePath, content) {
  let out = content;
  const posix = filePath.replace(/\\/g, "/");

  if (inFeatureSegment(filePath)) {
    out = out.replace(/from (['"])\.\.\/\.\.\/entities\//g, `from $1../../../entities/`);
    out = out.replace(/from (['"])\.\.\/\.\.\/shared\//g, `from $1../../../shared/`);
    out = out.replace(/from (['"])\.\.\/selection\//g, `from $1../../selection/lib/`);
    out = out.replace(/from (['"])\.\.\/settings\//g, `from $1../../settings/lib/`);
    out = out.replace(/from (['"])\.\.\/settings\/api\//g, `from $1../../settings/api/`);
    out = out.replace(/from (['"])\.\.\/folder\//g, `from $1../../folder/lib/`);
    out = out.replace(/from (['"])\.\.\/trash\//g, `from $1../../trash/`);
  }

  if (posix.includes("/features/app-fullscreen/model/")) {
    out = out.replace(/from (['"])\.\/appFullscreen/g, `from $1../lib/appFullscreen`);
    out = out.replace(/from (['"])\.\/waitForWindowSettle/g, `from $1../lib/waitForWindowSettle`);
  }

  if (posix.includes("/features/support-reminder/model/")) {
    out = out.replace(/from (['"])\.\/supportReminder/g, `from $1../lib/supportReminder`);
  }

  if (posix.includes("/features/selection/ui/")) {
    out = out.replace(/from (['"])\.\/selectionDiag/g, `from $1../lib/selectionDiag`);
  }

  if (posix.includes("/features/settings/lib/")) {
    out = out.replace(
      /from (['"])\.\.\/selection\/fileOperation/g,
      `from $1../../selection/lib/fileOperation`,
    );
  }

  // gallery cross-feature after selection/settings/folder moves
  if (posix.includes("/features/gallery/")) {
    out = out.replace(/from (['"])\.\.\/\.\.\/\.\.\/selection\//g, `from $1../../../selection/lib/`);
    out = out.replace(/from (['"])\.\.\/selection\//g, `from $1../selection/lib/`);
    out = out.replace(/from (['"])\.\.\/\.\.\/selection\//g, `from $1../../selection/lib/`);
    out = out.replace(/from (['"])\.\.\/\.\.\/\.\.\/settings\//g, `from $1../../../settings/lib/`);
    out = out.replace(/from (['"])\.\.\/\.\.\/\.\.\/folder\//g, `from $1../../../folder/lib/`);
  }

  return out;
}

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules") continue;
      walk(p);
    } else if (/\.(ts|tsx)$/.test(ent.name)) {
      const c = fs.readFileSync(p, "utf8");
      const n = fixContent(p, c);
      if (n !== c) fs.writeFileSync(p, n);
    }
  }
}

walk(path.join(root, "src"));
console.log("Relative feature paths fixed.");
