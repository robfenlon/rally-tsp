/**
 * SaddleSore SS1600K pace / fuel / rest model.
 *
 * The award: ride 1,600 km in under 24 hours, IBA-certified.
 * This is NOT an optimisation-over-waypoints problem (unlike the rally solver).
 * It is a sustained-average + logistics problem. The single governing fact:
 *
 *     1600 km / 24 h = 66.7 km/h DOOR-TO-DOOR average, stops included.
 *
 * Everything below works backwards from that. Run with:  npx tsx saddlesore/pace-model.ts
 */

// ----- Inputs you tune -----------------------------------------------------

const TARGET_KM = 1600;          // award minimum
const PLANNED_KM = 1650;         // "lean & fast": small buffer over the minimum
const WINDOW_H = 24;             // hard time limit for the award

// Bike / rider parameters
const TANK_RANGE_KM = 240;       // usable range before you start sweating (reserve ~40km)
const FUEL_STOP_MIN = 12;        // splash & go: pay-at-pump, helmet stays on-ish
const FOOD_STOP_MIN = 25;        // a couple of proper food/coffee stops
const FOOD_STOPS = 2;            // number of longer breaks (excludes fuel-only stops)

// Moving-average scenarios (km/h) — driven by how much motorway you ride
const SCENARIOS = [
  { label: '80 km/h (lots of N-roads)', movingAvg: 80 },
  { label: '90 km/h (mostly motorway)', movingAvg: 90 },
  { label: '100 km/h (max motorway)',  movingAvg: 100 },
];

// ----- Model ---------------------------------------------------------------

type Result = {
  label: string;
  movingH: number;
  fuelStops: number;
  fuelMin: number;
  foodMin: number;
  totalStopH: number;
  totalH: number;
  restH: number;       // slack: time available for sleep/contingency inside 24h
  doorToDoorAvg: number;
  feasible: boolean;
};

function model(movingAvg: number, label: string): Result {
  const movingH = PLANNED_KM / movingAvg;

  // One fuel stop per tank-range, rounded up, minus the start (leave full).
  const fuelStops = Math.max(0, Math.ceil(PLANNED_KM / TANK_RANGE_KM) - 1);
  const fuelMin = fuelStops * FUEL_STOP_MIN;
  const foodMin = FOOD_STOPS * FOOD_STOP_MIN;

  const totalStopH = (fuelMin + foodMin) / 60;
  const totalH = movingH + totalStopH;
  const restH = WINDOW_H - totalH;
  const doorToDoorAvg = PLANNED_KM / totalH;

  return {
    label, movingH, fuelStops, fuelMin, foodMin, totalStopH, totalH, restH,
    doorToDoorAvg,
    feasible: totalH <= WINDOW_H && PLANNED_KM >= TARGET_KM,
  };
}

function fmt(h: number): string {
  const sign = h < 0 ? '-' : '';
  const a = Math.abs(h);
  const hh = Math.floor(a);
  const mm = Math.round((a - hh) * 60);
  return `${sign}${hh}h ${String(mm).padStart(2, '0')}m`;
}

// ----- Report ---------------------------------------------------------------

console.log('SaddleSore SS1600K — pace / fuel / rest model');
console.log('='.repeat(64));
console.log(`Target:   ${TARGET_KM} km in < ${WINDOW_H} h  (${(TARGET_KM / WINDOW_H).toFixed(1)} km/h door-to-door minimum)`);
console.log(`Planned:  ${PLANNED_KM} km  (+${PLANNED_KM - TARGET_KM} km buffer)`);
console.log(`Tank:     ${TANK_RANGE_KM} km range -> fuel stop ~every ${TANK_RANGE_KM} km`);
console.log(`Stops:    fuel ${FUEL_STOP_MIN} min each, ${FOOD_STOPS} food stops ${FOOD_STOP_MIN} min each`);
console.log('='.repeat(64));

for (const s of SCENARIOS) {
  const r = model(s.movingAvg, s.label);
  console.log(`\n${r.label}`);
  console.log(`  Moving time .......... ${fmt(r.movingH)}`);
  console.log(`  Fuel stops ........... ${r.fuelStops} x ${FUEL_STOP_MIN}m = ${fmt(r.fuelMin / 60)}`);
  console.log(`  Food stops ........... ${FOOD_STOPS} x ${FOOD_STOP_MIN}m = ${fmt(r.foodMin / 60)}`);
  console.log(`  Total elapsed ........ ${fmt(r.totalH)}`);
  console.log(`  Door-to-door avg ..... ${r.doorToDoorAvg.toFixed(1)} km/h  (need >= ${(TARGET_KM / WINDOW_H).toFixed(1)})`);
  console.log(`  Slack for sleep/contingency in 24h: ${fmt(r.restH)}  ${r.restH > 0 ? '[OK]' : '[FAIL]'}`);
}

console.log('\n' + '='.repeat(64));
console.log('Takeaway: every km traded from N-road to motorway raises the moving');
console.log('average, and ALL of that gain converts directly into rest/contingency.');
console.log('On an Ireland loop, maximise motorway % even if the route repeats legs.');
