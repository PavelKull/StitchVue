const modules = import.meta.glob<string>("./*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
});

const icons = Object.fromEntries(
  Object.entries(modules).map(([filePath, svg]) => {
    const name = filePath.replace(/^\.\//, "").replace(/\.svg$/, "");
    return [name, svg];
  }),
) as Record<string, string>;

export type StitchVueIconName = keyof typeof icons;

export function getStitchVueIcon(name: StitchVueIconName): string {
  const svg = icons[name];
  if (!svg) {
    throw new Error(`Unknown StitchVue icon: ${name}`);
  }
  return svg;
}

export const stitchVueIconNames = Object.keys(icons) as StitchVueIconName[];
