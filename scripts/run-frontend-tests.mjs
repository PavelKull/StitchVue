#!/usr/bin/env node
// Запуск frontend unit-тестов (node:test) с обходом src на .test.ts; Windows: явные пути.
import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const srcRoot = join(root, "src");

/** I1–I8 и ключевые контракты из docs/INVARIANTS.md */
const CRITICAL_REL = [
  "features/gallery/lib/directory/directorySession.test.ts",
  "features/gallery/model/pipeline/galleryPipelineEvents.test.ts",
  "features/gallery/lib/listing/galleryOrder.test.ts",
  "features/gallery/lib/listing/galleryListing.test.ts",
  "features/folder/lib/folderOrder.test.ts",
  "features/favorites/lib/favoriteOptimisticOverlay.test.ts",
  "features/favorites/lib/favoriteOptimisticLifecycle.test.ts",
  "features/favorites/lib/favoriteMassUnfavoriteOptimistic.test.ts",
  "features/favorites/lib/favoritePathsServerSync.test.ts",
  "features/favorites/lib/favoritesCollectionLifecycle.test.ts",
  "features/favorites/lib/favoritesDiskTruthAfterIpc.test.ts",
  "features/favorites/lib/favoritesReconcile.test.ts",
  "features/favorites/lib/mapRemovalToUiRoute.test.ts",
  "features/selection/lib/removeFavoritesBatch.test.ts",
  "features/selection/lib/unfavoriteGate.test.ts",
];

function collectTestFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      out.push(...collectTestFiles(abs));
    } else if (name.endsWith(".test.ts")) {
      out.push(abs);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function toPosix(p) {
  return p.split("\\").join("/");
}

const mode = process.argv.includes("--critical") ? "critical" : "full";
const all = collectTestFiles(srcRoot);

let files;
if (mode === "critical") {
  files = CRITICAL_REL.map((rel) => resolve(srcRoot, ...rel.split("/")));
  for (const f of files) {
    if (!all.includes(f)) {
      console.error(`ERR: критический тест не найден: ${relative(root, f)}`);
      process.exit(1);
    }
  }
} else {
  files = all;
}

if (files.length === 0) {
  console.error("ERR: тестовые файлы не найдены");
  process.exit(1);
}

const relPaths = files.map((f) => toPosix(relative(root, f)));
console.log(`${mode === "critical" ? "test:critical" : "test:full"} — ${files.length} file(s)`);

const args = ["--experimental-strip-types", "--test", ...relPaths];
const r = spawnSync(process.execPath, args, {
  cwd: root,
  stdio: "inherit",
  shell: false,
});

process.exit(r.status === null ? 1 : r.status);
