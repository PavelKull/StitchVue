import { layoutGallery } from "../src/widgets/gallery-grid/layout.ts";

const counts = [100, 1_000, 10_000, 50_000];

for (const count of counts) {
  const aspects = Array.from({ length: count }, (_, index) => (index % 5 === 0 ? 0.67 : 1.5));
  const samples: number[] = [];
  let tiles = 0;
  let rows = 0;
  for (let run = 0; run < 5; run += 1) {
    const start = performance.now();
    const layout = layoutGallery(aspects, 1600, 900, 4, 0);
    samples.push(performance.now() - start);
    tiles = layout.rows.reduce((total, row) => total + row.tiles.length, 0);
    rows = layout.rows.length;
  }
  samples.sort((left, right) => left - right);
  const median = samples[2];
  console.log(`${count} images median ${median.toFixed(2)} ms rows ${rows} tiles ${tiles}`);
}
