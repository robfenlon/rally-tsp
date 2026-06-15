const gpxParser = require('gpxparser');
const fs = require('fs/promises');

const apiKey = process.env.GOOGLE_MAPS_API_KEY;

if (!apiKey) {
  console.error('Missing GOOGLE_MAPS_API_KEY environment variable.');
  process.exit(1);
}

const endpoint = 'https://maps.googleapis.com/maps/api/directions/json';

function decodePolyline(encoded) {
  const points = [];
  let index = 0, lat = 0, lng = 0;

  while (index < encoded.length) {
    let shift = 0, result = 0, byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    shift = 0; result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    points.push({ lat: lat / 1e5, lon: lng / 1e5 });
  }
  return points;
}

function sleep(millis) {
  return new Promise(resolve => setTimeout(resolve, millis));
}

async function getRoute(from, to) {
  const params = new URLSearchParams({
    origin: `${from.lat},${from.lon}`,
    destination: `${to.lat},${to.lon}`,
    key: apiKey,
  });

  let retries = 0;
  while (retries < 10) {
    try {
      const response = await fetch(`${endpoint}?${params.toString()}`);
      if (!response.ok) {
        console.error(`Request failed: ${response.status}`);
        retries++;
        await sleep(60 * 1000);
        continue;
      }
      const data = await response.json();
      if (data.status !== 'OK') {
        console.error(`Directions API error: ${data.status}`);
        retries++;
        await sleep(5000);
        continue;
      }
      return data.routes[0].overview_polyline.points;
    } catch (e) {
      console.error(`Request error:`, e.message);
      retries++;
      await sleep(5000);
    }
  }
  console.error('10 retries exhausted');
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const gpxFlagIndex = args.indexOf('--gpx');

  if (gpxFlagIndex === -1 || !args[gpxFlagIndex + 1]) {
    console.error('Usage: node addRouteToGpx.js --gpx path/to/folder');
    process.exit(1);
  }

  const folder = args[gpxFlagIndex + 1];
  const gpxPath = `${folder}/route.gpx`;
  const gpxText = await fs.readFile(gpxPath, 'utf8');

  const parser = new gpxParser();
  parser.parse(gpxText);

  const waypoints = parser.waypoints;
  console.log(`Found ${waypoints.length} waypoints`);

  const allPoints = [];

  for (let i = 0; i < waypoints.length - 1; i++) {
    const from = waypoints[i];
    const to = waypoints[i + 1];
    console.log(`Fetching route: ${from.name} -> ${to.name} (${i + 1}/${waypoints.length - 1})`);

    const polylineEncoded = await getRoute(from, to);
    const points = decodePolyline(polylineEncoded);
    allPoints.push(...points);

    if (i < waypoints.length - 2) {
      await sleep(200);
    }
  }

  console.log(`Total track points: ${allPoints.length}`);

  const trkpts = allPoints.map(p => `      <trkpt lat="${p.lat}" lon="${p.lon}"></trkpt>`).join('\n');

  const trkXml = `  <trk>\n    <name>Driving Route</name>\n    <trkseg>\n${trkpts}\n    </trkseg>\n  </trk>`;

  const updatedGpx = gpxText.replace('</gpx>', `${trkXml}\n</gpx>`);
  await fs.writeFile(gpxPath, updatedGpx, 'utf8');
  console.log(`Updated ${gpxPath} with driving track`);
}

main().catch((error) => {
  console.error('Unexpected error:', error.message);
  process.exit(1);
});
