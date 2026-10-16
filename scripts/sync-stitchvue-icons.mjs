import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(
  process.env.HOME || process.env.USERPROFILE,
  "Downloads/stitchvue-icons-final-svg/stitchvue-icons",
);
const dest = path.join(__dirname, "../src/shared/icons/stitchvue-icons");

function prepareSvg(svg) {
  return svg.replace(/\s(width|height)="24"/g, "");
}

if (!fs.existsSync(src)) {
  console.error("Source not found:", src);
  process.exit(1);
}

if (fs.existsSync(dest)) {
  fs.rmSync(dest, { recursive: true, force: true });
}
fs.mkdirSync(dest, { recursive: true });

for (const f of fs.readdirSync(src)) {
  const from = path.join(src, f);
  if (f.endsWith(".svg")) {
    fs.writeFileSync(path.join(dest, f), prepareSvg(fs.readFileSync(from, "utf8")));
  } else if (f === "README.md" || f === "manifest.json") {
    fs.copyFileSync(from, path.join(dest, f));
  }
}

const indexTs = `const modules = import.meta.glob<string>("./*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
});

const icons = Object.fromEntries(
  Object.entries(modules).map(([filePath, svg]) => {
    const name = filePath.replace(/^\\.\\//, "").replace(/\\.svg$/, "");
    return [name, svg];
  }),
) as Record<string, string>;

export type StitchVueIconName = keyof typeof icons;

export function getStitchVueIcon(name: StitchVueIconName): string {
  const svg = icons[name];
  if (!svg) {
    throw new Error(\`Unknown StitchVue icon: \${name}\`);
  }
  return svg;
}

export const stitchVueIconNames = Object.keys(icons) as StitchVueIconName[];
`;
fs.writeFileSync(path.join(dest, "index.ts"), indexTs);

const count = fs.readdirSync(dest).filter((f) => f.endsWith(".svg")).length;
console.log("synced", count, "SVG files to stitchvue-icons");
