import fs from 'fs/promises';

type RouteEntry = {
  fromLoc: string;
  fromName: string;
  toLoc: string;
  toName: string;
  weighting: number;
  route: { distance: { value: number }; duration: { value: number } };
};

const PHOTO_TIME = 3 * 60; // 3 mins in seconds
const FUEL_RANGE = 240_000; // 240km in meters
const FUEL_STOP_TIME = 15 * 60; // 15 mins in seconds
const TIME_BUDGET = 11.5 * 60 * 60; // 11.5 hours in seconds
const MAX_TIME = TIME_BUDGET; // hard cap, no overtime

const ITERATIONS = 10000000;
const RCL_SIZE = 5;
const DIVERSITY_THRESHOLD = 0.3; // min Jaccard distance for "diverse"

const COMBO_BONUSES: { a: string; b: string; bonus: number }[] = [
  { a: '020', b: '024', bonus: 2000 },
  { a: '038', b: '083', bonus: 1900 },
  { a: '025', b: '037', bonus: 1500 },
  { a: '071', b: '090', bonus: 1600 },
];

// Location 118 tunnel challenge: extra 2000pts for +15 mins
const TUNNEL_LOCATION = '118';
const TUNNEL_BONUS = 2000;
const TUNNEL_TIME = 15 * 60; // 15 mins in seconds

type Solution = { route: number[]; startIdx: number; score: number; rawPoints: number; time: number; distance: number; doTunnel: boolean };

async function main() {
  const raw: RouteEntry[] = JSON.parse(await fs.readFile('./shamrock/output.json', 'utf8'));

  // Build location indices
  const starts: string[] = [];
  const waypoints: string[] = [];
  const allNames: string[] = [];

  const nameSet = new Set<string>();
  for (const r of raw) {
    nameSet.add(r.fromName);
    nameSet.add(r.toName);
  }

  const DISABLED_STARTS = new Set(['Start B', 'Start G']);
  for (const n of nameSet) {
    if (n.startsWith('Start') && !DISABLED_STARTS.has(n)) starts.push(n);
    else if (n !== 'Finish' && /^\d+$/.test(n)) waypoints.push(n);
  }
  starts.sort();
  waypoints.sort();

  // Index: starts first, then waypoints, then Finish
  allNames.push(...starts, ...waypoints, 'Finish');
  const nameToIdx = new Map<string, number>();
  allNames.forEach((n, i) => nameToIdx.set(n, i));

  const N = allNames.length;
  const FINISH_IDX = nameToIdx.get('Finish')!;
  const startIndices = starts.map(s => nameToIdx.get(s)!);
  const waypointIndices = waypoints.map(w => nameToIdx.get(w)!);

  // Resolve combo bonus pairs to indices
  const comboBonusIndices = COMBO_BONUSES.map(cb => ({
    a: nameToIdx.get(cb.a)!,
    b: nameToIdx.get(cb.b)!,
    bonus: cb.bonus,
  }));

  function calcComboBonuses(route: number[]): number {
    const inRoute = new Set(route);
    let bonus = 0;
    for (const cb of comboBonusIndices) {
      if (inRoute.has(cb.a) && inRoute.has(cb.b)) bonus += cb.bonus;
    }
    return bonus;
  }

  const TUNNEL_IDX = nameToIdx.get(TUNNEL_LOCATION)!;

  // Build edge matrix
  const duration: number[][] = Array.from({ length: N }, () => new Array(N).fill(Infinity));
  const distance: number[][] = Array.from({ length: N }, () => new Array(N).fill(Infinity));
  const weight: number[] = new Array(N).fill(0);

  // Build coordinate map (lat, lon) per location
  const coords: { lat: number; lon: number }[] = new Array(N);
  for (const r of raw) {
    const fromIdx = nameToIdx.get(r.fromName);
    const toIdx = nameToIdx.get(r.toName);
    if (fromIdx !== undefined && !coords[fromIdx]) {
      const [lat, lon] = r.fromLoc.split(',').map(s => parseFloat(s.trim()));
      coords[fromIdx] = { lat, lon };
    }
    if (toIdx !== undefined && !coords[toIdx]) {
      const [lat, lon] = r.toLoc.split(',').map(s => parseFloat(s.trim()));
      coords[toIdx] = { lat, lon };
    }
  }

  for (const r of raw) {
    const from = nameToIdx.get(r.fromName);
    const to = nameToIdx.get(r.toName);
    if (from === undefined || to === undefined) continue;
    duration[from][to] = r.route.duration.value;
    distance[from][to] = r.route.distance.value;
    if (/^\d+$/.test(r.toName)) {
      weight[to] = r.weighting;
    }
  }

  function isOverTime(timeSeconds: number): boolean {
    return timeSeconds > MAX_TIME;
  }

  function evaluateRoute(startIdx: number, route: number[], doTunnel: boolean = false): { time: number; dist: number; rawPoints: number; score: number } {
    let time = 0;
    let dist = 0;
    let rawPoints = 0;
    let distSinceFuel = 0;

    let prev = startIdx;
    for (const wp of route) {
      const legDist = distance[prev][wp];
      const legDur = duration[prev][wp];
      if (legDist === Infinity || legDur === Infinity) return { time: Infinity, dist: Infinity, rawPoints: 0, score: -Infinity };

      dist += legDist;
      distSinceFuel += legDist;
      time += legDur + PHOTO_TIME;
      rawPoints += weight[wp];

      if (doTunnel && wp === TUNNEL_IDX) {
        time += TUNNEL_TIME;
        rawPoints += TUNNEL_BONUS;
      }

      // Fuel stops
      while (distSinceFuel > FUEL_RANGE) {
        time += FUEL_STOP_TIME;
        distSinceFuel -= FUEL_RANGE;
      }

      prev = wp;
    }

    // Travel to finish
    const finDist = distance[prev][FINISH_IDX];
    const finDur = duration[prev][FINISH_IDX];
    if (finDist === Infinity || finDur === Infinity) return { time: Infinity, dist: Infinity, rawPoints: 0, score: -Infinity };

    dist += finDist;
    distSinceFuel += finDist;
    time += finDur;

    while (distSinceFuel > FUEL_RANGE) {
      time += FUEL_STOP_TIME;
      distSinceFuel -= FUEL_RANGE;
    }

    if (isOverTime(time)) return { time: Infinity, dist: Infinity, rawPoints: 0, score: -Infinity };

    const comboBonus = calcComboBonuses(route);
    rawPoints += comboBonus;
    const score = rawPoints;
    return { time, dist, rawPoints, score };
  }

  function greedyConstruct(startIdx: number, alpha: number): number[] {
    const visited = new Set<number>();
    const route: number[] = [];
    let prev = startIdx;
    let time = 0;
    let distSinceFuel = 0;

    while (true) {
      // Build candidate list
      type Candidate = { idx: number; score: number; dur: number; dist: number };
      const candidates: Candidate[] = [];

      for (const wp of waypointIndices) {
        if (visited.has(wp)) continue;
        if (weight[wp] === 0) continue;

        const legDur = duration[prev][wp];
        const legDist = distance[prev][wp];
        if (legDur === Infinity) continue;

        // Estimate time to visit this waypoint and then reach finish
        const toFinishDur = duration[wp][FINISH_IDX];
        if (toFinishDur === Infinity) continue;

        let extraFuel = 0;
        let testDistSinceFuel = distSinceFuel + legDist;
        while (testDistSinceFuel > FUEL_RANGE) {
          extraFuel += FUEL_STOP_TIME;
          testDistSinceFuel -= FUEL_RANGE;
        }
        const toFinishDist = distance[wp][FINISH_IDX];
        let finFuel = 0;
        let testFinDist = testDistSinceFuel + toFinishDist;
        while (testFinDist > FUEL_RANGE) {
          finFuel += FUEL_STOP_TIME;
          testFinDist -= FUEL_RANGE;
        }

        const totalTimeIfVisit = time + legDur + PHOTO_TIME + extraFuel + toFinishDur + finFuel;

        if (totalTimeIfVisit > MAX_TIME) continue;

        const timeCost = legDur + PHOTO_TIME + extraFuel;
        // Boost effective weight if this completes a combo pair
        let effectiveWeight = weight[wp];
        for (const cb of comboBonusIndices) {
          if (wp === cb.a && visited.has(cb.b)) effectiveWeight += cb.bonus;
          if (wp === cb.b && visited.has(cb.a)) effectiveWeight += cb.bonus;
        }
        const efficiency = effectiveWeight / (timeCost / 60);
        candidates.push({ idx: wp, score: efficiency, dur: legDur, dist: legDist });
      }

      if (candidates.length === 0) break;

      // RCL selection
      candidates.sort((a, b) => b.score - a.score);
      const rclEnd = Math.max(1, Math.min(RCL_SIZE, Math.ceil(candidates.length * alpha)));
      const pick = candidates[Math.floor(Math.random() * rclEnd)];

      visited.add(pick.idx);
      route.push(pick.idx);
      time += pick.dur + PHOTO_TIME;
      distSinceFuel += pick.dist;

      while (distSinceFuel > FUEL_RANGE) {
        time += FUEL_STOP_TIME;
        distSinceFuel -= FUEL_RANGE;
      }

      prev = pick.idx;
    }

    return route;
  }

  // Local search operators
  function localSearch(startIdx: number, route: number[]): number[] {
    let best = route.slice();
    let bestScore = evaluateRoute(startIdx, best).score;
    let improved = true;

    while (improved) {
      improved = false;

      // 2-opt
      for (let i = 0; i < best.length - 1; i++) {
        for (let j = i + 1; j < best.length; j++) {
          const newRoute = best.slice();
          const segment = newRoute.splice(i, j - i + 1);
          segment.reverse();
          newRoute.splice(i, 0, ...segment);
          const s = evaluateRoute(startIdx, newRoute).score;
          if (s > bestScore) {
            best = newRoute;
            bestScore = s;
            improved = true;
          }
        }
      }

      // Or-opt (relocate single node)
      for (let i = 0; i < best.length; i++) {
        for (let j = 0; j < best.length; j++) {
          if (j === i || j === i - 1) continue;
          const newRoute = best.slice();
          const [node] = newRoute.splice(i, 1);
          const insertPos = j > i ? j - 1 : j;
          newRoute.splice(insertPos, 0, node);
          const s = evaluateRoute(startIdx, newRoute).score;
          if (s > bestScore) {
            best = newRoute;
            bestScore = s;
            improved = true;
          }
        }
      }

      // Remove low-value nodes
      for (let i = 0; i < best.length; i++) {
        const newRoute = best.slice();
        newRoute.splice(i, 1);
        const s = evaluateRoute(startIdx, newRoute).score;
        if (s > bestScore) {
          best = newRoute;
          bestScore = s;
          improved = true;
        }
      }

      // Insert unvisited nodes
      const inRoute = new Set(best);
      for (const wp of waypointIndices) {
        if (inRoute.has(wp) || weight[wp] === 0) continue;
        for (let pos = 0; pos <= best.length; pos++) {
          const newRoute = best.slice();
          newRoute.splice(pos, 0, wp);
          const s = evaluateRoute(startIdx, newRoute).score;
          if (s > bestScore) {
            best = newRoute;
            bestScore = s;
            improved = true;
            inRoute.add(wp);
            break; // found a good spot for this node, move on
          }
        }
      }
    }

    return best;
  }

  function jaccard(a: number[], b: number[]): number {
    const setA = new Set(a);
    const setB = new Set(b);
    let intersection = 0;
    for (const x of setA) if (setB.has(x)) intersection++;
    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : 1 - intersection / union;
  }

  // Main GRASP loop
  const topSolutions: Solution[] = [];

  function tryInsertSolution(sol: Solution) {
    // Check diversity against existing solutions
    for (const existing of topSolutions) {
      if (jaccard(sol.route, existing.route) < DIVERSITY_THRESHOLD && sol.startIdx === existing.startIdx) {
        // Too similar - only keep if better
        if (sol.score > existing.score) {
          const idx = topSolutions.indexOf(existing);
          topSolutions[idx] = sol;
          topSolutions.sort((a, b) => b.score - a.score);
        }
        return;
      }
    }
    topSolutions.push(sol);
    topSolutions.sort((a, b) => b.score - a.score);
    if (topSolutions.length > 20) topSolutions.pop();
  }

  console.log(`Starting GRASP solver: ${ITERATIONS} iterations, ${waypoints.length} waypoints, ${starts.length} starts`);
  const solverStart = Date.now();

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const startIdx = startIndices[Math.floor(Math.random() * startIndices.length)];
    const alpha = 0.1 + Math.random() * 0.4; // randomize greediness

    const constructed = greedyConstruct(startIdx, alpha);
    const improved = localSearch(startIdx, constructed);

    // Try both with and without tunnel challenge
    const hasTunnelLoc = improved.includes(TUNNEL_IDX);
    for (const doTunnel of hasTunnelLoc ? [false, true] : [false]) {
      const eval_ = evaluateRoute(startIdx, improved, doTunnel);
      if (eval_.score > -Infinity) {
        tryInsertSolution({
          route: improved,
          startIdx,
          score: eval_.score,
          rawPoints: eval_.rawPoints,
          time: eval_.time,
          distance: eval_.dist,
          doTunnel,
        });
      }
    }

    if ((iter + 1) % 100 === 0) {
      const elapsed = ((Date.now() - solverStart) / 1000).toFixed(1);
      const bestScore = topSolutions.length > 0 ? topSolutions[0].score : 'n/a';
      process.stdout.write(`\r[iter ${iter + 1}/${ITERATIONS}] elapsed=${elapsed}s best=${bestScore} solutions=${topSolutions.length}`);
    }
  }

  console.log(`\n\nDone! Writing ${topSolutions.length} routes to ./shamrock/results/\n`);

  const resultsDir = './shamrock/results';
  await fs.mkdir(resultsDir, { recursive: true });

  // Summary CSV
  const summaryRows: string[] = ['Route,Score,Waypoint Pts,Bonuses,Start,Time (h),Distance (km),Stops,Margin (min),Combos,Tunnel,Waypoints'];

  for (let i = 0; i < topSolutions.length; i++) {
    const sol = topSolutions[i];
    const startName = allNames[sol.startIdx];
    const routeNames = sol.route.map(idx => allNames[idx]);

    const comboBonus = calcComboBonuses(sol.route);
    const tunnelBonus = sol.doTunnel ? TUNNEL_BONUS : 0;
    const totalBonuses = comboBonus + tunnelBonus;
    const combosEarned = COMBO_BONUSES.filter(cb => {
      const routeSet = new Set(sol.route);
      return routeSet.has(nameToIdx.get(cb.a)!) && routeSet.has(nameToIdx.get(cb.b)!);
    });
    const comboStr = combosEarned.map(cb => cb.a + '&' + cb.b).join('; ');
    const margin = ((MAX_TIME - sol.time) / 60).toFixed(0);

    // Summary row
    summaryRows.push([
      i + 1,
      sol.score,
      sol.rawPoints - totalBonuses,
      totalBonuses,
      startName,
      (sol.time / 3600).toFixed(2),
      (sol.distance / 1000).toFixed(1),
      sol.route.length,
      margin,
      comboStr || 'none',
      sol.doTunnel ? 'YES' : 'no',
      startName + ' > ' + routeNames.join(' > ') + ' > Finish',
    ].join(','));

    // Per-route detail CSV
    const detailRows: string[] = ['Step,Location,Points,Drive (min),Photo (min),Extra (min),Cumulative Time (h),Cumulative Dist (km),Notes'];
    let prev = sol.startIdx;
    let cumTime = 0;
    let cumDist = 0;
    let distSinceFuel = 0;

    // Start row
    detailRows.push(`1,${startName},0,0,0,0,0.00,0,START`);

    let step = 2;
    for (const wp of sol.route) {
      const d = distance[prev][wp];
      const t = duration[prev][wp];
      cumDist += d;
      distSinceFuel += d;
      cumTime += t + PHOTO_TIME;
      const isTunnel = sol.doTunnel && wp === TUNNEL_IDX;
      let extra = 0;
      if (isTunnel) { cumTime += TUNNEL_TIME; extra += TUNNEL_TIME; }
      let fuelStopsHere = 0;
      while (distSinceFuel > FUEL_RANGE) {
        cumTime += FUEL_STOP_TIME;
        distSinceFuel -= FUEL_RANGE;
        extra += FUEL_STOP_TIME;
        fuelStopsHere++;
      }
      const notes: string[] = [];
      if (fuelStopsHere > 0) notes.push(`fuel stop`);
      if (isTunnel) notes.push(`tunnel +${TUNNEL_BONUS}pts`);
      detailRows.push([
        step,
        allNames[wp],
        weight[wp],
        (t / 60).toFixed(0),
        (PHOTO_TIME / 60).toFixed(0),
        (extra / 60).toFixed(0),
        (cumTime / 3600).toFixed(2),
        (cumDist / 1000).toFixed(1),
        notes.join('; ') || '',
      ].join(','));
      prev = wp;
      step++;
    }

    // Finish
    const fd = distance[prev][FINISH_IDX];
    const ft = duration[prev][FINISH_IDX];
    cumDist += fd;
    distSinceFuel += fd;
    cumTime += ft;
    let extraFinish = 0;
    while (distSinceFuel > FUEL_RANGE) {
      cumTime += FUEL_STOP_TIME;
      distSinceFuel -= FUEL_RANGE;
      extraFinish += FUEL_STOP_TIME;
    }
    detailRows.push([
      step,
      'Finish',
      0,
      (ft / 60).toFixed(0),
      0,
      (extraFinish / 60).toFixed(0),
      (cumTime / 3600).toFixed(2),
      (cumDist / 1000).toFixed(1),
      'FINISH',
    ].join(','));

    await fs.writeFile(`${resultsDir}/route_${String(i + 1).padStart(2, '0')}.csv`, detailRows.join('\n'));

    // GPX file — waypoints in route order
    const gpxWaypoints: string[] = [];
    const allStops = [sol.startIdx, ...sol.route, FINISH_IDX];
    for (let j = 0; j < allStops.length; j++) {
      const idx = allStops[j];
      const c = coords[idx];
      const name = allNames[idx];
      gpxWaypoints.push(`  <wpt lat="${c.lat}" lon="${c.lon}">
    <name>${name}</name>
    <desc>${j === 0 ? 'START' : j === allStops.length - 1 ? 'FINISH' : 'Stop ' + j + ' (' + weight[idx] + 'pts)'}</desc>
  </wpt>`);
    }

    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="shamrock-solver"
  xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>Route #${i + 1} - ${sol.score}pts</name>
  </metadata>
${gpxWaypoints.join('\n')}
</gpx>`;

    await fs.writeFile(`${resultsDir}/route_${String(i + 1).padStart(2, '0')}.gpx`, gpx);

    // Console summary
    console.log(`  Route #${String(i + 1).padStart(2, '0')}: ${sol.score} pts | ${(sol.time / 3600).toFixed(2)}h | ${(sol.distance / 1000).toFixed(0)}km | ${sol.route.length} stops | ${margin}min spare | ${startName}${sol.doTunnel ? ' [tunnel]' : ''}`);
  }

  await fs.writeFile(`${resultsDir}/summary.csv`, summaryRows.join('\n'));
  console.log(`\nFiles written to ${resultsDir}/`);
}

main().catch(e => { console.error(e); process.exit(1); });
