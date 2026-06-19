import fs from 'fs/promises';

/**
 * CALIBRATED maximiser — what is the highest NET score a motorcycle could
 * actually achieve under the Shamrock 2026 rules, and how do the real
 * finishers' scores compare to that frontier?
 *
 * Inputs:
 *   - POINT VALUES from shamrock/regs-points.json (transcribed from the
 *     official rules PDF — the authoritative source; supersedes the GPX and
 *     output.json, which each have a few wrong values).
 *   - ROAD TIMES & DISTANCES from shamrock/output.json (real Google routing
 *     between every pair of locations).
 *
 * Calibration (validated against a known actual run: Rob Fenlon, 16,481 pts,
 * 17 stops + tunnel, finished ~11h):
 *   - 2 min per control (dismount, photo, restart GPS)
 *   - 450 km fuel range (GS Adventure), 15 min per fuel/rest stop
 *   - real moving pace ≈ 1.1x Google's leg-duration estimates
 *
 * Rules modelled (all of them — confirmed complete from the PDF):
 *   score = Σ location points + Σ completed combo bonuses
 *         + 2000 if the 118 tunnel selfie challenge is done
 *         − 1000 per started 15-min block finished after 19:00 (DNF past 20:00)
 *   On-time wall = 12h (07:00→19:00). Late grace to 13h (20:00) at the penalty.
 *
 * Optimiser: GRASP (randomised-greedy construction by points-per-time
 * efficiency) + local search (2-opt, or-opt, insert/remove), maximising NET
 * score. Driving durations are scaled by a SPEED_FACTOR to model speeding;
 * photo and fuel times are fixed. The late-finish decision is folded into the
 * net-score evaluation: extending past 19:00 only helps if the extra points
 * beat the penalty.
 */

const REG_POINTS = './shamrock/regs-points.json';
const ROAD = './shamrock/output.json';

// Sweep these speed factors; for each, report the best net score found.
const SPEED_FACTORS = [1.0, 1.1, 1.15, 1.25, 1.4];

// Real finishers, for comparison against the computed frontier.
const FINISHERS: { pos: string; name: string; score: number }[] = [
  { pos: '1st', name: 'Robert Koeber', score: 24199 },
  { pos: '2nd', name: 'Arjen Steiner', score: 20525 },
  { pos: '3rd', name: 'Eamon Phelan', score: 20021 },
  { pos: '4th', name: 'Joe Fisher', score: 19707 },
  { pos: '5th', name: 'Gerd Heinzmann', score: 19599 },
  { pos: '6th', name: 'Rob Fenlon', score: 16481 },
];

// Rules
const PHOTO_TIME = 2 * 60;
const FUEL_RANGE = 450_000;
const FUEL_STOP_TIME = 15 * 60;
const ON_TIME = 12 * 60 * 60;
const MAX_WALL = 13 * 60 * 60;          // hard DNF cutoff (20:00)
const LATE_BLOCK = 15 * 60;
const LATE_PENALTY = 1000;

const COMBO_BONUSES = [
  { a: '20', b: '24', bonus: 2000 },
  { a: '38', b: '83', bonus: 1900 },
  { a: '25', b: '37', bonus: 1500 },
  { a: '71', b: '90', bonus: 1600 },
];
const TUNNEL = '118';
const TUNNEL_BONUS = 2000;
const TUNNEL_TIME = 15 * 60;

// Search effort
const ITERATIONS = 4000;

function pad(n: string) {
  return n.startsWith('Start') || n === 'Finish' ? n : String(+n).padStart(3, '0');
}

async function main() {
  const pts: Record<string, number> = JSON.parse(await fs.readFile(REG_POINTS, 'utf8'));
  const raw: { fromName: string; toName: string; route: { distance: { value: number }; duration: { value: number } } }[] =
    JSON.parse(await fs.readFile(ROAD, 'utf8'));

  const dur = new Map<string, number>();
  const dist = new Map<string, number>();
  const starts = new Set<string>();
  for (const r of raw) {
    dur.set(`${r.fromName}|${r.toName}`, r.route.duration.value);
    dist.set(`${r.fromName}|${r.toName}`, r.route.distance.value);
    if (r.fromName.startsWith('Start')) starts.add(r.fromName);
  }
  const D = (a: string, b: string) => dur.get(`${pad(a)}|${pad(b)}`) ?? Infinity;
  const KM = (a: string, b: string) => dist.get(`${pad(a)}|${pad(b)}`) ?? Infinity;
  const startNames = [...starts].sort();

  // Scoring locations: positive points only (46 is a penalty, nobody visits it).
  const wps = Object.keys(pts).filter(id => pts[id] > 0);
  const comboOf = (set: Set<string>) => {
    let b = 0;
    for (const c of COMBO_BONUSES) if (set.has(c.a) && set.has(c.b)) b += c.bonus;
    return b;
  };

  // Evaluate a route (ordered list of location ids) from a start, at speedFactor.
  // Returns net score and timing, choosing the late-finish that maximises net.
  function evaluate(start: string, route: string[], speed: number) {
    const set = new Set(route);
    let drive = 0, km = 0;
    let prev = start;
    for (const w of route) {
      const d = D(prev, w), m = KM(prev, w);
      if (!isFinite(d) || !isFinite(m)) return null;
      drive += d; km += m; prev = w;
    }
    const fd = D(prev, 'Finish'), fm = KM(prev, 'Finish');
    if (!isFinite(fd) || !isFinite(fm)) return null;
    drive += fd; km += fm;

    const doTunnel = set.has(TUNNEL);
    const photo = route.length * PHOTO_TIME + (doTunnel ? TUNNEL_TIME : 0);
    let fuelStops = 0, dd = km;
    while (dd > FUEL_RANGE) { fuelStops++; dd -= FUEL_RANGE; }
    const fuel = fuelStops * FUEL_STOP_TIME;

    const totalTime = drive / speed + photo + fuel;
    if (totalTime > MAX_WALL) return null; // DNF — past 20:00

    let gross = 0;
    for (const w of route) gross += pts[w];
    gross += comboOf(set);
    if (doTunnel) gross += TUNNEL_BONUS;

    // Late penalty: started 15-min blocks beyond 19:00.
    const lateSecs = Math.max(0, totalTime - ON_TIME);
    const lateBlocks = Math.ceil(lateSecs / LATE_BLOCK);
    const net = gross - lateBlocks * LATE_PENALTY;

    return { net, gross, lateBlocks, time: totalTime, km, stops: route.length, doTunnel };
  }

  // Randomised-greedy construction by efficiency (value per added time).
  function construct(start: string, speed: number, alpha: number): string[] {
    const visited = new Set<string>();
    const route: string[] = [];
    let prev = start, drive = 0, km = 0;
    for (;;) {
      const cands: { w: string; eff: number; d: number; m: number }[] = [];
      for (const w of wps) {
        if (visited.has(w)) continue;
        const d = D(prev, w), m = KM(prev, w);
        if (!isFinite(d)) continue;
        const df = D(w, 'Finish');
        if (!isFinite(df)) continue;
        // Feasibility projection: visiting w then finishing must stay under MAX_WALL.
        const km2 = km + m + KM(w, 'Finish');
        let fs = 0, dd = km2; while (dd > FUEL_RANGE) { fs++; dd -= FUEL_RANGE; }
        const photoSoFar = (route.length + 1) * PHOTO_TIME + ((visited.has(TUNNEL) || w === TUNNEL) ? TUNNEL_TIME : 0);
        const t = (drive + d + df) / speed + photoSoFar + fs * FUEL_STOP_TIME;
        if (t > MAX_WALL) continue;
        let val = pts[w];
        for (const c of COMBO_BONUSES) {
          if (w === c.a && visited.has(c.b)) val += c.bonus;
          if (w === c.b && visited.has(c.a)) val += c.bonus;
        }
        if (w === TUNNEL) val += TUNNEL_BONUS;
        const eff = val / (d / speed + PHOTO_TIME);
        cands.push({ w, eff, d, m });
      }
      if (!cands.length) break;
      cands.sort((x, y) => y.eff - x.eff);
      const rcl = Math.max(1, Math.ceil(cands.length * alpha));
      const pick = cands[Math.floor(Math.random() * Math.min(rcl, cands.length))];
      visited.add(pick.w); route.push(pick.w);
      drive += pick.d; km += pick.m; prev = pick.w;
    }
    return route;
  }

  // Local search: 2-opt, or-opt (relocate), remove, insert — keep if net improves.
  function localSearch(start: string, route: string[], speed: number): { route: string[]; net: number } {
    let best = route.slice();
    let bestEval = evaluate(start, best, speed);
    let bestNet = bestEval ? bestEval.net : -Infinity;
    let improved = true;
    while (improved) {
      improved = false;
      // 2-opt
      for (let i = 0; i < best.length - 1; i++) {
        for (let j = i + 1; j < best.length; j++) {
          const nr = best.slice();
          const seg = nr.splice(i, j - i + 1); seg.reverse(); nr.splice(i, 0, ...seg);
          const e = evaluate(start, nr, speed);
          if (e && e.net > bestNet) { best = nr; bestNet = e.net; improved = true; }
        }
      }
      // or-opt relocate
      for (let i = 0; i < best.length; i++) {
        for (let j = 0; j <= best.length; j++) {
          if (j === i || j === i + 1) continue;
          const nr = best.slice();
          const [node] = nr.splice(i, 1);
          nr.splice(j > i ? j - 1 : j, 0, node);
          const e = evaluate(start, nr, speed);
          if (e && e.net > bestNet) { best = nr; bestNet = e.net; improved = true; }
        }
      }
      // remove
      for (let i = 0; i < best.length; i++) {
        const nr = best.slice(); nr.splice(i, 1);
        const e = evaluate(start, nr, speed);
        if (e && e.net > bestNet) { best = nr; bestNet = e.net; improved = true; }
      }
      // insert unvisited
      const inRoute = new Set(best);
      for (const w of wps) {
        if (inRoute.has(w)) continue;
        for (let p = 0; p <= best.length; p++) {
          const nr = best.slice(); nr.splice(p, 0, w);
          const e = evaluate(start, nr, speed);
          if (e && e.net > bestNet) { best = nr; bestNet = e.net; improved = true; inRoute.add(w); break; }
        }
      }
    }
    return { route: best, net: bestNet };
  }

  console.log('Calibrated maximiser — authoritative reg point-values, validated bike params.');
  console.log(`Photo ${PHOTO_TIME / 60}min, fuel range ${FUEL_RANGE / 1000}km/${FUEL_STOP_TIME / 60}min, wall ${ON_TIME / 3600}h (late to ${MAX_WALL / 3600}h).`);
  console.log(`GRASP ${ITERATIONS} iters/speed across ${startNames.length} starts.\n`);

  const frontier: { speed: number; net: number; gross: number; stops: number; km: number; h: string; late: number; start: string; route: string[] }[] = [];

  for (const speed of SPEED_FACTORS) {
    let best: any = { net: -Infinity };
    for (let it = 0; it < ITERATIONS; it++) {
      const start = startNames[it % startNames.length];
      const alpha = 0.1 + Math.random() * 0.4;
      const constructed = construct(start, speed, alpha);
      const { route, net } = localSearch(start, constructed, speed);
      if (net > best.net) {
        const e = evaluate(start, route, speed)!;
        best = { net, gross: e.gross, stops: e.stops, km: (e.km / 1000) | 0, h: (e.time / 3600).toFixed(2), late: e.lateBlocks, start, route };
      }
    }
    frontier.push({ speed, ...best });
    console.log(`speed ${speed.toFixed(2)}x  ->  max NET ${best.net}  (gross ${best.gross}, ${best.stops} stops, ${best.km}km, ${best.h}h, late ${best.late} blk, ${best.start})`);
  }

  console.log('\nReal finishers vs computed frontier:');
  const ceilingAt = (s: number) => frontier.find(f => f.speed === s)!.net;
  for (const f of FINISHERS) {
    // smallest speed factor whose ceiling reaches this score
    const need = SPEED_FACTORS.find(s => ceilingAt(s) >= f.score);
    const tag = need ? `reachable at ~${need.toFixed(2)}x` : `ABOVE frontier even at ${SPEED_FACTORS[SPEED_FACTORS.length - 1].toFixed(2)}x`;
    console.log(`  ${f.pos.padEnd(4)} ${f.name.padEnd(16)} ${String(f.score).padStart(6)}  — ${tag}`);
  }

  // Save the best route per speed factor.
  const out = frontier.map(f => ({
    speedFactor: f.speed, netScore: f.net, grossScore: f.gross, stops: f.stops,
    distanceKm: f.km, hours: f.h, lateBlocks: f.late, start: f.start,
    route: [f.start, ...f.route.map(pad), 'Finish'],
  }));
  await fs.mkdir('./shamrock/analysis', { recursive: true });
  await fs.writeFile('./shamrock/analysis/max_score_frontier.json', JSON.stringify(out, null, 2));
  console.log('\nBest routes per speed factor written to ./shamrock/analysis/max_score_frontier.json');
}

main().catch(e => { console.error(e); process.exit(1); });
