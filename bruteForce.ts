import type { JourneyEntry, JourneyLeg } from './types.ts';

export type BruteForceJourney = {
  cumulativeTime: number;
  cumulativeDistance: number;
  cumulativeWeighting: number;
  journeyLegs: JourneyEntry[];
};

function toJourneyEntry(route: JourneyLeg, cumulativeTime: number, cumulativeDistance: number, cumulativeWeighting: number): JourneyEntry {
  return {
    to: route.fromName,
    from: route.toName,
    distance: route.route.distance.value,
    duration: route.route.duration.value,
    cumulativeTime,
    cumulativeDistance,
    cumulativeWeighting,
    distanceText: route.route.distance.text,
    durationText: route.route.duration.text,
    weighting: route.weighting
  };
}

function createFuelStopEntry(fuelAtKm: number, cumulativeTime: number, cumulativeDistance: number, cumulativeWeighting: number): JourneyEntry {
  return {
    to: `* fuel @ ${fuelAtKm.toFixed(2)} km`,
    distance: 0,
    duration: 15 * 60,
    cumulativeTime,
    cumulativeDistance,
    cumulativeWeighting,
    distanceText: '0 km',
    durationText: '15 mins',
    weighting: 0
  };
}

function getRouteEfficiencyScore(route: JourneyLeg): number {
  if (route.weighting <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  return route.route.duration.value / route.weighting;
}

export function getBruteForceJourney(routes: JourneyLeg[], maxCumulativeTimeSeconds: number = 12 * 60 * 60): { cumulativeTime: number; journeyLegs: JourneyEntry[] } {
  const routesByFromName = new Map<string, JourneyLeg[]>();
  for (const route of routes) {
    const existingRoutes = routesByFromName.get(route.fromName) ?? [];
    existingRoutes.push(route);
    routesByFromName.set(route.fromName, existingRoutes);
  }

  routesByFromName.forEach((groupedRoutes) => {
    groupedRoutes.sort((routeA, routeB) => {
      const scoreA = getRouteEfficiencyScore(routeA);
      const scoreB = getRouteEfficiencyScore(routeB);

      if (scoreA !== scoreB) {
        return scoreA - scoreB;
      }

      return routeA.route.duration.value - routeB.route.duration.value;
    });
  });

  let completedJourneys = 0;
  let bestJourney: BruteForceJourney | undefined;
  const totalRootBranches = (routesByFromName.get('Finish') ?? []).length;
  let rootBranchesCompleted = 0;
  let rootBranchesTimedOut = 0;
  const startedAt = Date.now();
  const rootNoImprovementLimitMs = 120 * 1000;
  let activeRootNoImprovementDeadlineMs: number | undefined;
  let recursiveCalls = 0;
  let lastLoggedAt = startedAt;
  const logIntervalMs = 1000;

  function logProgress(force: boolean = false): void {
    const now = Date.now();
    if (!force && now - lastLoggedAt < logIntervalMs) {
      return;
    }

    lastLoggedAt = now;
    const elapsedSeconds = ((now - startedAt) / 1000).toFixed(1);
    const bestWeighting = bestJourney ? bestJourney.cumulativeWeighting : 'n/a';
    const bestWeightingTime = bestJourney ? bestJourney.cumulativeTime : 'n/a';
    process.stdout.write(`\r[bruteforce] elapsed=${elapsedSeconds}s branches completed/total=${rootBranchesCompleted}/${totalRootBranches} bestWeighting=${bestWeighting} bestTime=${bestWeightingTime}s`);
  }

  console.log(`[bruteforce] started: maxTime=${maxCumulativeTimeSeconds}s`);

  function captureJourney(
    cumulativeTime: number,
    cumulativeDistance: number,
    cumulativeWeighting: number,
    currentJourney: JourneyEntry[]
  ): void {
    completedJourneys++;
    if (!bestJourney || cumulativeWeighting > bestJourney.cumulativeWeighting || (cumulativeWeighting === bestJourney.cumulativeWeighting && cumulativeTime < bestJourney.cumulativeTime)) {
      bestJourney = {
        cumulativeTime,
        cumulativeDistance,
        cumulativeWeighting,
        journeyLegs: [...currentJourney]
      };

      if (activeRootNoImprovementDeadlineMs !== undefined) {
        activeRootNoImprovementDeadlineMs = Date.now() + rootNoImprovementLimitMs;
      }
    }
  }

  function explore(
    currentName: string,
    visitedNames: Set<string>,
    currentJourney: JourneyEntry[],
    cumulativeTime: number,
    cumulativeDistance: number,
    cumulativeWeighting: number,
    nextFuelThresholdKm: number
  ): void {
    recursiveCalls++;
    logProgress();

    if (activeRootNoImprovementDeadlineMs !== undefined && Date.now() > activeRootNoImprovementDeadlineMs) {
      return;
    }

    if (cumulativeTime >= maxCumulativeTimeSeconds) {
      captureJourney(cumulativeTime, cumulativeDistance, cumulativeWeighting, currentJourney);
      return;
    }

    const outgoingRoutes = (routesByFromName.get(currentName) ?? []).filter(
      route => !visitedNames.has(route.toName)
    );

    if (outgoingRoutes.length === 0) {
      captureJourney(cumulativeTime, cumulativeDistance, cumulativeWeighting, currentJourney);
      return;
    }

    let expandedBranch = false;

    for (const route of outgoingRoutes) {
      const isRootBranch = currentName === 'Finish';
      const nextVisitedNames = new Set(visitedNames);
      nextVisitedNames.add(route.toName);

      const routeCumulativeTime = cumulativeTime + (5 * 60) + route.route.duration.value;
      if (routeCumulativeTime > maxCumulativeTimeSeconds) {
        continue;
      }

      const nextCumulativeDistance = cumulativeDistance + route.route.distance.value;
      const nextCumulativeWeighting = cumulativeWeighting + route.weighting;
      const nextJourney = [...currentJourney, toJourneyEntry(route, routeCumulativeTime, nextCumulativeDistance, nextCumulativeWeighting)];
      let nextCumulativeTime = routeCumulativeTime;
      let updatedNextFuelThresholdKm = nextFuelThresholdKm;

      while (nextCumulativeDistance / 1000 > updatedNextFuelThresholdKm) {
        nextCumulativeTime += 15 * 60;
        if (nextCumulativeTime > maxCumulativeTimeSeconds) {
          break;
        }

        nextJourney.push(createFuelStopEntry(updatedNextFuelThresholdKm, nextCumulativeTime, nextCumulativeDistance, nextCumulativeWeighting));
        updatedNextFuelThresholdKm += 200;
      }

      if (nextCumulativeTime > maxCumulativeTimeSeconds) {
        continue;
      }

      expandedBranch = true;

      if (isRootBranch) {
        activeRootNoImprovementDeadlineMs = Date.now() + rootNoImprovementLimitMs;
      }

      explore(
        route.toName,
        nextVisitedNames,
        nextJourney,
        nextCumulativeTime,
        nextCumulativeDistance,
        nextCumulativeWeighting,
        updatedNextFuelThresholdKm
      );

      if (isRootBranch) {
        if (activeRootNoImprovementDeadlineMs !== undefined && Date.now() > activeRootNoImprovementDeadlineMs) {
          rootBranchesTimedOut++;
        }

        activeRootNoImprovementDeadlineMs = undefined;
        rootBranchesCompleted++;
      }
    }

    if (!expandedBranch) {
      captureJourney(cumulativeTime, cumulativeDistance, cumulativeWeighting, currentJourney);
    }
  }

  const initialVisitedNames = new Set<string>(['Finish']);
  explore('Finish', initialVisitedNames, [], 0, 0, 0, 200);

  logProgress(true);

  return bestJourney ?? { cumulativeTime: 0, journeyLegs: [] };
}