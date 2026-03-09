import fs from 'fs/promises';
import { getNearestNeighbourJourney } from './nearestNeighbour.ts';
import { getNearestWeightedNeighbourJourney } from './nearestWeightedNeighbour.ts';
import { getBruteForceJourney } from './bruteForce.ts';
import type { JourneyLeg } from './types.ts';

async function main() {
  const args = process.argv.slice(2);

  const rallyDirPath = args[0];

  if (!rallyDirPath || rallyDirPath.startsWith('--')) {
    console.error('Usage: npm start .\\path');
    process.exit(1);
  }

  const routeText = await fs.readFile(rallyDirPath + '\\output.json', 'utf8');
  const routes = Array.from(JSON.parse(routeText)) as JourneyLeg[];

  // Nearest neighbour
  const journey = getBruteForceJourney(routes);

  journey.journeyLegs.push({
    to: '* start fuel @ 0 km',
    distance: 0,
    duration: 0,
    cumulativeTime: 0,
    cumulativeDistance: 0,
    cumulativeWeighting: 0,
    distanceText: '0 km',
    durationText: '0 mins',
    weighting: 0
  });

  journey.journeyLegs.reverse();

  let distanceSinceFuel = 0;
  journey.journeyLegs.forEach((leg) => {
    if (leg.to.startsWith('*') && distanceSinceFuel > 0) {
      leg.to = `* fuel @ ${distanceSinceFuel.toFixed(2)} km`;
      distanceSinceFuel = 0;
    } else {
      distanceSinceFuel += leg.distance / 1000;
    }
  });

  journey.journeyLegs.push({
    to: `* remaining fuel @ ${distanceSinceFuel.toFixed(2)} km`,
    distance: 0,
    duration: 0,
    cumulativeTime: 0,
    cumulativeDistance: 0,
    cumulativeWeighting: 0,
    distanceText: '0 km',
    durationText: '0 mins',
    weighting: 0
  });

  let runningCumulativeTime = 0;
  let runningCumulativeDistance = 0;
  let runningCumulativeWeighting = 0;
  journey.journeyLegs.forEach((leg) => {
    if (leg.from) {
      runningCumulativeTime += (5 * 60) + leg.duration;
      runningCumulativeDistance += leg.distance;
      runningCumulativeWeighting += leg.weighting;
    } else {
      runningCumulativeTime += leg.duration;
    }

    leg.cumulativeTime = runningCumulativeTime;
    leg.cumulativeDistance = runningCumulativeDistance;
    leg.cumulativeWeighting = runningCumulativeWeighting;
  });

  console.log(
    'Visited waypoints:',
    '\r\n',
    journey.journeyLegs.map(leg => leg.to).join('\r\n')
  );

  console.log('Total stops:', journey.journeyLegs.filter(j => !j.to.startsWith('*')).length);
  console.log('Total points scored:', journey.journeyLegs.reduce((sum, leg) => sum + leg.weighting, 0));
  console.log('Total distance:', ((journey.journeyLegs.reduce((sum, leg) => sum + leg.distance, 0)) / 1000).toFixed(2), 'km');
  console.log('Total road duration:', ((journey.journeyLegs.reduce((sum, leg) => sum + leg.duration, 0)) / 3600).toFixed(2), 'hours');
  console.log('Total time including stops and breaks:', (journey.cumulativeTime / 3600).toFixed(2), 'hours');
}

main().catch((error) => {
  console.error('Unexpected error:', error.message);
  process.exit(1);
});