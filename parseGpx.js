const gpxParser = require('gpxparser');
const fs = require('fs/promises');

const apiKey = process.env.GOOGLE_MAPS_API_KEY;

if (!apiKey) {
  console.error('Missing GOOGLE_MAPS_API_KEY environment variable.');
  process.exit(1);
}

const endpoint = 'https://maps.googleapis.com/maps/api/directions/json';

const getName = name => name.split('-')[0].trim();
const getWeighting = name => (name.split('-')[1] || '0').trim();

async function parseGpxFile(filePath) {
  const gpxText = await fs.readFile(filePath + '/route.gpx', 'utf8');
  const parser = new gpxParser();
  parser.parse(gpxText);

  console.log('GPX parsed successfully');
  console.log(`Found ${parser.waypoints.length} waypoints`);

  const queries = [];
  for (const fromWaypoint of parser.waypoints) {
    const fromLoc = `${fromWaypoint.lat}, ${fromWaypoint.lon}`;
    const fromName = getName(fromWaypoint.name);

    for (const toWaypoint of parser.waypoints) {
      const toName = getName(toWaypoint.name);

      if (fromWaypoint === toWaypoint)
        continue;

      if (fromName === 'Finish' || toName.startsWith('Start'))
        continue;

      const toLoc = `${toWaypoint.lat}, ${toWaypoint.lon}`;
      const weighting = parseInt(getWeighting(toWaypoint.name)) || 0;
      queries.push({ fromLoc, fromName, toLoc, toName, weighting });
    }
  }
  return queries;
}

async function sendDirectionsRequest(from, to) {
  const params = new URLSearchParams({
    destination: to,
    origin: from,
    key: apiKey,
  });

  let retries = 0;
  let data = null;

  while (retries < 10) {
    try
    {
      const response = await fetch(`${endpoint}?${params.toString()}`);

      if (!response.ok) {
        console.error(`Request failed (${from} to ${to}):`, response.status, response.statusText);
        retries++;
        await sleep(60 * 1000);
        continue;
      }
      
      data = await response.json();
      break;
    }
    catch(e) {
      console.error(`Request failed (${from} to ${to}):`, e);
      retries++;
    }
  }

  if (data === null){
    console.error('10 requests failed in a row');
    process.exit(1);
  }

  return { distance: data.routes[0].legs[0].distance, duration: data.routes[0].legs[0].duration };
}

function sleep(millis) {
  return new Promise(resolve => setTimeout(resolve, millis));
}

async function main() {
  const args = process.argv.slice(2);
  const gpxFlagIndex = args.indexOf('--gpx');
  let gpxFilePath;

  if (gpxFlagIndex === -1) {
    console.error('Usage: node index.js --gpx path/to/file.gpx');
    process.exit(1);
  }

  gpxFilePath = args[gpxFlagIndex + 1];

  if (!gpxFilePath || gpxFilePath.startsWith('--')) {
    console.error('Usage: node index.js --gpx path/to/file.gpx');
    process.exit(1);
  }

  const queries = await parseGpxFile(gpxFilePath);
  const totalQueries = queries.length;

  if (totalQueries === 0) {
    console.log('No queries to process.');
  }

  for (let i = 0; i < totalQueries; i++) {
    const { fromLoc, toLoc } = queries[i];
    const route = await sendDirectionsRequest(fromLoc, toLoc);
    queries[i].route = route;

    const completed = i + 1;
    const percentage = Math.round((completed / totalQueries) * 100);
    process.stdout.write(`\rProgress: ${completed}/${totalQueries} (${percentage}%)`);

    if (i > 0 && i % 1000 === 0) {
      // Pause for 1 minute after every 1000 requests to avoid hitting rate limits
      //await sleep(60 * 1000);
    }
  }

  if (totalQueries > 0) {
    process.stdout.write('\n');
  }

  const outputFilePath = `output-${Date.now()}.json`;
  await fs.writeFile(outputFilePath, JSON.stringify(queries, null, 2), 'utf8');
  console.log(`Results saved to ${outputFilePath}`);
}

main().catch((error) => {
  console.error('Unexpected error:', error.message);
  process.exit(1);
});