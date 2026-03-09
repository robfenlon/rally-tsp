import type { JourneyEntry, JourneyLeg } from './types.ts';

function getNearestNeighbor(routes: JourneyLeg[], currentName: string, visitedNamesList: string[]): JourneyLeg {
  const availableRoutes = routes.filter(route => route.fromName === currentName && !visitedNamesList.includes(route.toName));
  const lowestCostRoute = availableRoutes.reduce((prev, curr) => prev.route.duration.value < curr.route.duration.value ? prev : curr);
  return lowestCostRoute;
}

export function getNearestNeighbourJourney(routes: JourneyLeg[]): { cumulativeTime: number; journeyLegs: JourneyEntry[] } {
  let currentName = 'Finish';
  const visitedNamesList: string[] = [];
  const journey: JourneyEntry[] = [];
  let cumulativeTime = 0;
  let cumulativeDistance = 0;
  let cumulativeWeighting = 0;
  let numberOfBreaks = 1;

  while (cumulativeTime < 11 * 60 * 60) { // 11 hours in seconds   
    visitedNamesList.push(currentName);
    const nextNearest = getNearestNeighbor(routes, currentName, visitedNamesList);
    cumulativeTime += 5 * 60; // Add 5 minutes for stop time at each waypoint
    cumulativeTime += nextNearest.route.duration.value;
    cumulativeDistance += nextNearest.route.distance.value;

    if ((cumulativeDistance / 1000) / 200 > numberOfBreaks) { // Add a 15-minute fuel break every 200 km
      journey.push({
        to: '* fuel @ ' + (cumulativeDistance / 1000).toFixed(2) + ' km',
        distance: 0,
        duration: 15 * 60,
        cumulativeTime,
        cumulativeDistance,
        cumulativeWeighting,
        distanceText: '0 km',
        durationText: '15 mins',
        weighting: 0
      });
      cumulativeTime += 15 * 60;
      numberOfBreaks++;
    }

    currentName = nextNearest.toName;
    cumulativeWeighting += nextNearest.weighting;
    journey.push({
      to: nextNearest.fromName,
      from: nextNearest.toName,
      distance: nextNearest.route.distance.value,
      distanceText: nextNearest.route.distance.text,
      duration: nextNearest.route.duration.value,
      cumulativeTime,
      cumulativeDistance,
      cumulativeWeighting,
      durationText: nextNearest.route.duration.text,
      weighting: nextNearest.weighting
    });
  }

  return { cumulativeTime, journeyLegs: journey };
}