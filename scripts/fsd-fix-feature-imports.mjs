import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const mapPath = path.join(root, "scripts/.fsd-feature-moves.json");
const globalMoves = JSON.parse(fs.readFileSync(mapPath, "utf8"));

function replacePaths(content) {
  let out = content;
  const keys = Object.keys(globalMoves).sort((a, b) => b.length - a.length);
  for (const oldP of keys) {
    const newP = globalMoves[oldP];
    out = out.replaceAll(`${oldP}.ts`, `${newP}.ts`);
    out = out.replaceAll(`${oldP}.tsx`, `${newP}.tsx`);
    out = out.replaceAll(oldP, newP);
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
      const n = replacePaths(c);
      if (n !== c) fs.writeFileSync(p, n);
    }
  }
}

walk(path.join(root, "src"));
console.log("Feature import paths updated.");
