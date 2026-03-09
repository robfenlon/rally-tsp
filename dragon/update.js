const fs = require('fs/promises');

async function main() {
  const gpxText = await fs.readFile('./output.json', 'utf8');
  const pointsText = await fs.readFile('./points.json', 'utf8');
  const points = JSON.parse(pointsText);
  const gpx = Array.from(JSON.parse(gpxText));

  gpx.forEach((route, i) => {
    route.weighting = points[i];
  });

  await fs.writeFile('./output.json', JSON.stringify(gpx, null, 2), 'utf8');
}

main().catch((error) => {
  console.error('Unexpected error:', error.message);
  process.exit(1);
});