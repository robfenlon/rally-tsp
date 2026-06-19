# SaddleSore SS1600K — Ireland Route Plan (Limerick start/finish)

**Goal:** 1,600 km in under 24 hours, IBA-certifiable. Start *and* finish in **Limerick**.
**Strategy:** Lean & fast → maximise motorway %, minimise stop time, small distance buffer.

---

## Why a triangle loop, not spokes

Limerick sits on the **western edge** of the motorway network, so out-and-back spokes
would all reuse the same M7 corridor — monotonous and inefficient. The clean
high-average answer is a **triangle**:

> **Limerick → Dublin (M7) → Cork (M8) → Limerick (N/M20)**, repeated 3×.

- ~81% motorway (only the Cork→Limerick N20 leg is single-carriageway).
- Always **forward progress** — far less mind-numbing than repeated out-and-backs.
- Every turn point (Dublin, Cork) is a major city with **24h fuel** → easy receipts.
- Start and finish naturally land back in Limerick.

A coastal loop of Ireland is only ~1,000 km of slow N-roads — it can't hit 1,600 km
at a high average, which is why we trade scenery for motorway.

---

## The route (~1,695 km, ~81% motorway)

Hub = a **24h fuel station in Limerick** (e.g. on the M7/N18 ring — pick your start point).

| Lap | Leg | Corridor | From → To | km | Cum km |
|----:|----:|----------|-----------|---:|-------:|
| 1 | 1 | M7 | Limerick → Dublin | 200 | 200 |
| 1 | 2 | M7/M8 | Dublin → Cork | 260 | 460 |
| 1 | 3 | N20/M20 | Cork → Limerick | 105 | 565 |
| 2 | 4 | M7 | Limerick → Dublin | 200 | 765 |
| 2 | 5 | M7/M8 | Dublin → Cork | 260 | 1025 |
| 2 | 6 | N20/M20 | Cork → Limerick | 105 | 1130 |
| 3 | 7 | M7 | Limerick → Dublin | 200 | 1330 |
| 3 | 8 | M7/M8 | Dublin → Cork | 260 | 1590 |  
| 3 | 9 | N20/M20 | Cork → Limerick (**FINISH**) | 105 | 1695 |

> **1,600 km is passed early on the final Cork→Limerick leg** (~10 km after leaving Cork).
> Distances are corridor approximations — **verify against your GPX/router** before
> committing. Planned ~1,695 km gives a ~95 km buffer over the 1,600 minimum.

**Direction tip:** ride the triangle the same way each lap so navigation becomes
muscle memory. The N20 (Cork→Limerick) is the slow, tiring leg — it lands at the end
of each lap, conveniently near your Limerick fuel/food stop.

---

## Time schedule (motorway ~100 km/h, N20 ~70 km/h moving)

| Clock | Cum km | Event |
|------:|-------:|-------|
| 04:00 | 0 | **START** — fuel receipt in Limerick (timestamped) |
| 06:10 | 200 | Dublin — fuel |
| 09:00 | 460 | Cork — fuel + coffee (food stop 1) |
| 10:40 | 565 | Limerick — fuel |
| 12:50 | 765 | Dublin — fuel |
| 15:40 | 1025 | Cork — fuel + food (food stop 2) |
| 17:20 | 1130 | Limerick — fuel |
| 19:30 | 1330 | Dublin — fuel |
| 22:20 | 1590 | Cork — fuel (**1,600 passed just after**) |
| 23:55 → finish ~24:00 — too tight, see note | 1695 | Limerick |

⚠️ At a strict 04:00 start the 3-lap version finishes right on the 24h edge once you
add stop time. **Two fixes — pick one:**
- **Trim the buffer:** stop the clock as soon as your end receipt shows **≥ 1,600 km**.
  You don't have to complete the full third lap — get the finish receipt in Cork or
  on the N20 the moment the odometer clears 1,600 + margin. That brings finish to ~22:30.
- **Raise the average:** the pace model (`pace-model.ts`) shows ~90 km/h *door-to-door*
  is plenty; the schedule above is conservative on the N20. Realistic finish ≈ **21:00–22:00**.

Either way you keep **2–3 h of slack** inside the 24h window. Run `pace-model.ts` to
re-balance moving average vs. stop time for your real bike/tank figures.

---

## Risk notes

- **Stop the clock at 1,600 + buffer, not at "a tidy lap."** Your end receipt only needs
  to show ≥ 1,600 km from the start receipt. Don't ride extra distance for neatness.
- **N20 Cork↔Limerick is single-carriageway** and the weak link in the average — it's
  ridden 3×. If you're behind schedule, the time loss shows up here first.
- **M50 toll (eFlow):** the Dublin turn uses the M7/M50 interchange; if you touch the
  M50 itself, it's barrier-free — pay online by 20:00 next day. Register the bike first.
- **Roadworks / closures:** the ~95 km buffer covers one significant detour. If you lose
  it early, take the finish receipt the instant you clear 1,600 km rather than completing lap 3.
- **Fatigue:** three identical laps are mentally numbing. The 2 food stops are mandatory
  rest, not optional. Consider reversing lap 3 (Limerick→Cork→Dublin→Limerick) purely to
  break the monotony — distance is the same.
