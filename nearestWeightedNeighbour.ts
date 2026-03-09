import type { JourneyEntry, JourneyLeg } from './types.ts';

function getNearestWeightedNeighbor(routes: JourneyLeg[], currentName: string, visitedNamesList: string[]): JourneyLeg {
  const availableRoutes = routes.filter(route => route.fromName === currentName && !visitedNamesList.includes(route.toName));
  const highestValueRoute = availableRoutes.reduce((prev, curr) => (prev.route.duration.value / prev.weighting) < (curr.route.duration.value / curr.weighting) ? prev : curr);
  return highestValueRoute;
}

export function getNearestWeightedNeighbourJourney(routes: JourneyLeg[]): { cumulativeTime: number; journeyLegs: JourneyEntry[] } {
  let currentName = 'Finish';
  const visitedNamesList: string[] = [];
  const journey: JourneyEntry[] = [];
  let cumulativeTime = 0;
  let cumulativeDistance = 0;
  let cumulativeWeighting = 0;
  let numberOfBreaks = 1;

  while (cumulativeTime < 11 * 60 * 60) { // 11 hours in seconds   
    visitedNamesList.push(currentName);
    const nextNearest = getNearestWeightedNeighbor(routes, currentName, visitedNamesList);
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

  journey.push({
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

  journey.reverse();

  let distanceSinceFuel = 0;
  journey.forEach((leg) => {
    if (leg.to.startsWith('*') && distanceSinceFuel > 0) {
      leg.to = `* fuel @ ${distanceSinceFuel.toFixed(2)} km`;
      distanceSinceFuel = 0;
    } else {
      distanceSinceFuel += leg.distance / 1000;
    }
  });

  journey.push({
    to: `* remaining fuel @ ${distanceSinceFuel.toFixed(2)} km`,
    distance: 0,
    duration: 0,
    cumulativeTime,
    cumulativeDistance,
    cumulativeWeighting,
    distanceText: '0 km',
    durationText: '0 mins',
    weighting: 0
  });

  let runningCumulativeTime = 0;
  let runningCumulativeDistance = 0;
  let runningCumulativeWeighting = 0;
  journey.forEach((leg) => {
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

  return { cumulativeTime, journeyLegs: journey };
}