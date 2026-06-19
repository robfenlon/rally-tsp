import fs from 'fs/promises';

/**
 * Subset-sum + motorcycle feasibility.
 *
 * POINT VALUES come ENTIRELY from shamrock/route.gpx. Each waypoint name there
 * encodes its value, e.g. "001-1023", "004 - 250", "118-1380**" (** = tunnel).
 *
 * ROAD TIMES & DISTANCES come from shamrock/output.json — the GPX has no
 * leg times, and we need them to judge whether a set of points could actually
 * be ridden inside the wall-clock limit. (Point values still come from the GPX;
 * if the two disagree on a value, the GPX wins.)
 *
 * Score model:
 *   score = sum(point value of each visited location)
 *         + sum(combo bonus for each fully-completed pair present)
 *         + (TUNNEL_BONUS if location 118 is visited AND the challenge done)
 *
 * FEASIBILITY: this is a MOTORCYCLE event on open public roads with a 12h wall.
 * Competitors may speed — significantly, but nowhere near race pace. Google's
 * leg durations (in output.json) are ~legal-pace estimates, so we compute the
 * MINIMUM SPEED FACTOR each set needs to fit 12h (only driving time scales;
 * photo + fuel time are fixed) and keep the ones that look plausible for a bike.
 *   1.00 = legal/Google pace        1.15–1.30 = brisk real-world riding
 *   ~1.4 = hard, sustained pushing   > MAX_SPEED_FACTOR = implausible
 */

// The NET score we are trying to explain (after any late-finish penalty).
const NET_TARGET = 24199;

// On-time wall clock. The clock starts at 07:00 and "on time" is 19:00 = 12h.
const ON_TIME = 12 * 60 * 60;

// Late finish: you may finish up to 1 hour late. Each started 15-min block
// after 19:00 costs LATE_PENALTY points. Not stopped by 20:00 = DNF. So a late
// finisher had MORE riding time but a HIGHER gross score (net = gross − penalty).
const LATE_BLOCK = 15 * 60;       // 15 minutes
const LATE_PENALTY = 1000;        // points per started block after 19:00
const MAX_LATE_BLOCKS = 4;        // 4 × 15min = 1h, then DNF

// Plausible upper bound on sustained pace vs Google estimates for a motorcycle
// pushing hard on open roads. Sets needing more than this are flagged, not
// dropped — the required factor is always shown so you can judge.
const MAX_SPEED_FACTOR = 1.4;

// Per-stop and fuel overheads (motorcycle). These do NOT scale with speed.
// Calibrated against a known actual run (16,481 pts, 17 stops, finished with
// ~1h spare): ~2 min per control to dismount/photo/set GPS, and fuel stops
// doubled as ~15 min rest breaks. At these values that run lands at ~1.1x
// Google pace — modest, believable motorcycle speeding.
const PHOTO_TIME = 2 * 60;       // dismount, photograph control, restart GPS
const FUEL_RANGE = 450_000;      // ~450 km on a GS Adventure tank
const FUEL_STOP_TIME = 15 * 60;  // fuel + short rest break

const COMBO_BONUSES: { a: string; b: string; bonus: number }[] = [
  { a: '020', b: '024', bonus: 2000 },
  { a: '038', b: '083', bonus: 1900 },
  { a: '025', b: '037', bonus: 1500 },
  { a: '071', b: '090', bonus: 1600 },
];

const TUNNEL_LOCATION = '118';
const TUNNEL_BONUS = 2000;
const TUNNEL_TIME = 15 * 60;

// Caps so the search stays tractable. We enumerate many sets, then feasibility
// filtering does the real discrimination.
const MAX_SOLUTIONS = 20000;  // distinct sets to enumerate before stopping
const NODE_BUDGET = 200_000_000;

type Loc = { id: string; pts: number; isTunnel: boolean };

async function main() {
  const gpx = await fs.readFile('./shamrock/route.gpx', 'utf8');

  // Pull every <name>…</name>. Numbered waypoints look like "012 - 386" or
  // "118-1380**". Non-numeric ones (Start A, Finish) are skipped.
  const names = [...gpx.matchAll(/<name>([^<]+)<\/name>/g)].map(m => m[1].trim());

  const locs: Loc[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    // Match: <digits> <sep> <points> with optional trailing ** (tunnel marker).
    const m = raw.match(/^(\d{1,3})\s*-\s*(\d+)(\**)$/);
    if (!m) continue;
    const id = m[1];
    const pts = parseInt(m[2], 10);
    const isTunnel = m[3].length > 0 || id === TUNNEL_LOCATION;
    if (seen.has(id)) continue; // de-dupe repeated waypoints
    seen.add(id);
    locs.push({ id, pts, isTunnel });
  }

  // Only locations that can contribute points matter for the search.
  const scoring = locs.filter(l => l.pts > 0).sort((a, b) => b.pts - a.pts);
  const idToPts = new Map(locs.map(l => [l.id, l.pts]));
  const tunnelPresent = locs.some(l => l.id === TUNNEL_LOCATION);

  console.log(`Parsed ${locs.length} numbered locations from route.gpx (${scoring.length} with points > 0)`);
  console.log(`Tunnel location ${TUNNEL_LOCATION} present: ${tunnelPresent}; combo pairs: ${COMBO_BONUSES.length}`);

  // ---- Road network (times & distances) from output.json ----
  type RouteEntry = {
    fromName: string; toName: string;
    route: { distance: { value: number }; duration: { value: number } };
  };
  const raw: RouteEntry[] = JSON.parse(await fs.readFile('./shamrock/output.json', 'utf8'));
  const dur = new Map<string, number>();   // "from|to" -> seconds
  const dist = new Map<string, number>();   // "from|to" -> meters
  const starts = new Set<string>();
  for (const r of raw) {
    dur.set(`${r.fromName}|${r.toName}`, r.route.duration.value);
    dist.set(`${r.fromName}|${r.toName}`, r.route.distance.value);
    if (r.fromName.startsWith('Start')) starts.add(r.fromName);
    if (r.toName.startsWith('Start')) starts.add(r.toName);
  }
  const startNames = [...starts].sort();
  const D = (a: string, b: string) => dur.get(`${a}|${b}`) ?? Infinity;
  const KM = (a: string, b: string) => dist.get(`${a}|${b}`) ?? Infinity;

  console.log(`Loaded road matrix from output.json: ${raw.length} legs, ${startNames.length} starts`);
  console.log(`On-time wall ${ON_TIME / 3600}h (+ up to ${MAX_LATE_BLOCKS} late blocks of ${LATE_BLOCK / 60}min), plausible up to ${MAX_SPEED_FACTOR}x Google pace`);
  console.log(`Net target ${NET_TARGET}; for L late blocks, gross = ${NET_TARGET} + L*${LATE_PENALTY}, time budget = ${ON_TIME / 3600}h + L*${LATE_BLOCK / 60}min\n`);

  // Suffix sums for the upper-bound prune.
  const suffix = new Array(scoring.length + 1).fill(0);
  for (let i = scoring.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + scoring[i].pts;
  const allCombos = COMBO_BONUSES.reduce((s, c) => s + c.bonus, 0);

  type Solution = {
    ids: string[]; ptsSum: number; comboBonus: number; tunnel: boolean;
    gross: number;        // points actually scored on the road
    lateBlocks: number;   // 15-min blocks finished after 19:00
    penalty: number;      // lateBlocks * LATE_PENALTY
    net: number;          // gross - penalty (== NET_TARGET)
    timeBudget: number;   // seconds available for this many late blocks
    combos: string[];
  };
  const solutions: Solution[] = [];
  let nodes = 0;
  let capHit = false;

  function comboBonusFor(set: Set<string>): { bonus: number; labels: string[] } {
    let bonus = 0;
    const labels: string[] = [];
    for (const c of COMBO_BONUSES) {
      if (set.has(c.a) && set.has(c.b)) { bonus += c.bonus; labels.push(`${c.a}+${c.b}`); }
    }
    return { bonus, labels };
  }

  const chosen: string[] = [];
  const chosenSet = new Set<string>();

  // We search for the WAYPOINT-POINTS-plus-COMBO total to equal `residual`.
  // `residual` is the GROSS waypoint+combo points needed, with the tunnel bonus
  // already removed when doTunnel is set. The gross target itself varies with
  // late-finish blocks (see the loop below).
  function dfs(i: number, ptsSum: number, residual: number, doTunnel: boolean,
               lateBlocks: number, timeBudget: number) {
    if (capHit) return;
    if (solutions.length >= MAX_SOLUTIONS) { capHit = true; return; }
    if (nodes++ > NODE_BUDGET) { capHit = true; return; }

    const { bonus, labels } = comboBonusFor(chosenSet);

    // Prune: points only grow as we add more; combos ADD, so minimum reachable
    // total from here = ptsSum + bonus.
    if (ptsSum + bonus > residual) return;
    if (ptsSum + suffix[i] + allCombos < residual) return;

    // Leaf test.
    if (chosen.length > 0 && ptsSum + bonus === residual) {
      if (!doTunnel || chosenSet.has(TUNNEL_LOCATION)) {
        const gross = ptsSum + bonus + (doTunnel ? TUNNEL_BONUS : 0);
        const penalty = lateBlocks * LATE_PENALTY;
        solutions.push({
          ids: chosen.slice().sort(),
          ptsSum,
          comboBonus: bonus,
          tunnel: doTunnel,
          gross,
          lateBlocks,
          penalty,
          net: gross - penalty,
          timeBudget,
          combos: labels,
        });
      }
      // keep exploring — supersets won't match (pts only grows) so we can return
      return;
    }

    if (i >= scoring.length) return;

    // Include scoring[i].
    chosen.push(scoring[i].id);
    chosenSet.add(scoring[i].id);
    dfs(i + 1, ptsSum + scoring[i].pts, residual, doTunnel, lateBlocks, timeBudget);
    chosen.pop();
    chosenSet.delete(scoring[i].id);

    // Exclude scoring[i].
    dfs(i + 1, ptsSum, residual, doTunnel, lateBlocks, timeBudget);
  }

  // For each possible late-finish penalty, the gross on-road score must be
  // higher (net = gross − penalty == NET_TARGET) and the time budget is larger.
  for (let lateBlocks = 0; lateBlocks <= MAX_LATE_BLOCKS; lateBlocks++) {
    const grossTarget = NET_TARGET + lateBlocks * LATE_PENALTY;
    const timeBudget = ON_TIME + lateBlocks * LATE_BLOCK;
    for (const doTunnel of tunnelPresent ? [false, true] : [false]) {
      const residual = grossTarget - (doTunnel ? TUNNEL_BONUS : 0);
      if (residual < 0) continue;
      dfs(0, 0, residual, doTunnel, lateBlocks, timeBudget);
    }
  }

  // De-dupe (same id-set + tunnel flag + late-block count).
  const uniq = new Map<string, Solution>();
  for (const s of solutions) uniq.set(s.ids.join(',') + '|' + s.tunnel + '|' + s.lateBlocks, s);
  const allSets = [...uniq.values()];

  console.log(`Found ${allSets.length} distinct (location-set × late-blocks) candidate(s) netting ${NET_TARGET}${capHit ? ' (CAP HIT — raise MAX_SOLUTIONS)' : ''}`);

  // ===================================================================
  // FEASIBILITY: can a motorcycle ride this set inside the 12h wall, and
  // at what minimum speed factor vs Google's leg times?
  // ===================================================================

  // Best low-drive-time ordering for a set from a given start: nearest-
  // neighbour then 2-opt on driving duration. Returns null if disconnected.
  function rideTime(order: string[], start: string): { drive: number; km: number } | null {
    let drive = 0, km = 0, prev = start;
    for (const id of order) {
      const d = D(prev, id), m = KM(prev, id);
      if (!isFinite(d) || !isFinite(m)) return null;
      drive += d; km += m; prev = id;
    }
    const fd = D(prev, 'Finish'), fm = KM(prev, 'Finish');
    if (!isFinite(fd) || !isFinite(fm)) return null;
    return { drive: drive + fd, km: km + fm };
  }

  function orderFromStart(ids: string[], start: string): { order: string[]; drive: number; km: number } | null {
    const remaining = new Set(ids);
    const order: string[] = [];
    let prev = start;
    while (remaining.size > 0) {
      let best: string | null = null, bestD = Infinity;
      for (const id of remaining) {
        const d = D(prev, id);
        if (d < bestD) { bestD = d; best = id; }
      }
      if (best === null) return null;
      order.push(best); remaining.delete(best); prev = best;
    }
    let cur = rideTime(order, start);
    if (!cur) return null;
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < order.length - 1; i++) {
        for (let j = i + 1; j < order.length; j++) {
          const cand = order.slice();
          const seg = cand.splice(i, j - i + 1); seg.reverse(); cand.splice(i, 0, ...seg);
          const t = rideTime(cand, start);
          if (t && t.drive < cur!.drive) { order.splice(0, order.length, ...cand); cur = t; improved = true; }
        }
      }
    }
    return { order, drive: cur!.drive, km: cur!.km };
  }

  type Feas = {
    start: string; order: string[]; drive: number; km: number;
    photo: number; fuel: number; legalTotal: number; reqSpeed: number;
  };

  function assess(s: Solution): Feas | null {
    let best: { order: string[]; drive: number; km: number; start: string } | null = null;
    for (const st of startNames) {
      const r = orderFromStart(s.ids, st);
      if (r && (!best || r.drive < best.drive)) best = { ...r, start: st };
    }
    if (!best) return null;
    const photo = s.ids.length * PHOTO_TIME + (s.tunnel ? TUNNEL_TIME : 0);
    let fuelStops = 0, d = best.km;
    while (d > FUEL_RANGE) { fuelStops++; d -= FUEL_RANGE; }
    const fuel = fuelStops * FUEL_STOP_TIME;
    // Time budget is this candidate's own (12h + late blocks).
    const allowance = s.timeBudget - photo - fuel;
    const reqSpeed = allowance <= 0 ? Infinity : best.drive / allowance;
    return { start: best.start, order: best.order, drive: best.drive, km: best.km,
             photo, fuel, legalTotal: best.drive + photo + fuel, reqSpeed };
  }

  type Scored = { s: Solution; f: Feas | null };
  const scored: Scored[] = allSets.map(s => ({ s, f: assess(s) }));
  // Rank by how little speeding is required (most plausible first).
  scored.sort((a, b) => (a.f?.reqSpeed ?? Infinity) - (b.f?.reqSpeed ?? Infinity));

  const plausible = scored.filter(x => x.f && x.f.reqSpeed <= MAX_SPEED_FACTOR);
  const ridable = scored.filter(x => x.f && isFinite(x.f.reqSpeed));
  console.log(`Feasibility: ${plausible.length} plausible (≤${MAX_SPEED_FACTOR}x), ${ridable.length} ridable at some pace, ${scored.length} total\n`);

  // Console: the most plausible matches.
  const show = scored.slice(0, 25);
  for (let i = 0; i < show.length; i++) {
    const { s, f } = show[i];
    const breakdown = s.ids.map(id => `${id}(${idToPts.get(id)})`).join(' + ');
    const extras: string[] = [];
    if (s.combos.length) extras.push(`combos ${s.combos.join(',')} +${s.comboBonus}`);
    if (s.tunnel) extras.push(`tunnel +${TUNNEL_BONUS}`);
    if (s.lateBlocks > 0) extras.push(`late ${s.lateBlocks}×15min −${s.penalty} (gross ${s.gross})`);
    const budgetH = (s.timeBudget / 3600).toFixed(2);
    const tag = f
      ? `${f.reqSpeed <= MAX_SPEED_FACTOR ? '✓' : '✗'} ${f.reqSpeed.toFixed(2)}x  ${(f.km / 1000).toFixed(0)}km  ${f.start}  needs ${(f.legalTotal / 3600).toFixed(1)}h vs ${budgetH}h`
      : 'unridable';
    console.log(`#${String(i + 1).padStart(2, '0')}  ${s.ids.length} stops  net ${s.net} (gross ${s.gross})   [${tag}]`);
    console.log(`     ${breakdown}${extras.length ? '   |   ' + extras.join('   ') : ''}`);
    console.log('');
  }

  // Write full ranked results to CSV.
  const rows = ['Rank,Stops,Net,Gross,LateBlocks,Penalty,BudgetHours,LocationPts,ComboBonus,Combos,Tunnel,ReqSpeedFactor,Plausible,Distance(km),DriveHours,NeedHours,Start,RideOrder,Locations'];
  scored.forEach((x, i) => {
    const { s, f } = x;
    rows.push([
      i + 1, s.ids.length, s.net, s.gross, s.lateBlocks, s.penalty, (s.timeBudget / 3600).toFixed(2),
      s.ptsSum, s.comboBonus,
      s.combos.join('; ') || 'none', s.tunnel ? 'YES' : 'no',
      f ? (isFinite(f.reqSpeed) ? f.reqSpeed.toFixed(3) : 'inf') : 'n/a',
      f ? (f.reqSpeed <= MAX_SPEED_FACTOR ? 'YES' : 'no') : 'unridable',
      f ? (f.km / 1000).toFixed(1) : '-',
      f ? (f.drive / 3600).toFixed(2) : '-',
      f ? (f.legalTotal / 3600).toFixed(2) : '-',
      f ? f.start : '-',
      f ? f.start + ' > ' + f.order.join(' > ') + ' > Finish' : '-',
      s.ids.join(' '),
    ].join(','));
  });
  const outPath = './shamrock/analysis/subset_from_gpx.csv';
  await fs.mkdir('./shamrock/analysis', { recursive: true });
  await fs.writeFile(outPath, rows.join('\n'));
  console.log(`All ${scored.length} sets (ranked by required speed) written to ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
