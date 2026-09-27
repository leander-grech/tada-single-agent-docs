# Over-capacity scenarios and long streams

!!! abstract "Summary"
    Most losses of separation happen in scenarios that need more delay than the airspace can
    absorb. **49 of the 100 validation seeds** contain a flight more than 650 s early at t = 0,
    beyond the generator's own cap on the delay a flight may need, and they held 16 of `1_33`'s 17
    deterministic losses. Such seeds should be reported apart, and the scenario filter does not
    catch them. On long streams the generator also builds a growing backlog, so a 40-flight
    scenario tests backlog handling, not stability. Stitched streams separate the two: within a
    stream the agent flies the second segment as precisely as the first, and what compounds is the
    separation risk per stretch of traffic.

## How early is the earliest flight?

For each seed: how early the most-early flight would arrive if nothing were done, grouped by
`1_33`'s outcome over 10 attempts (`analysis/scenario_capacity.py`,
`analysis/2026-09-26_attempts/scenario_capacity.txt`):

| outcome over 10 attempts | seeds | largest early arrival, median | predicted losses at t = 0, median |
|---|---|---|---|
| solved at least once | 44 | 531 s | 3 |
| precision-bound | 51 | 839 s | 4 |
| **safety-bound** | 5 | **1 889 s** | **11** |

The deterministic policy lost separation on **16 of the 49** seeds that hold a flight more than
650 s early, against **1 of the other 51**. 650 s (`max_extra_ttl_s`) is not a hard limit: seeds
needing up to ~900 s were solved with speed and vectoring as well as the trombone. But the
safety-bound seeds need ~30 minutes of absorption and start with a pile-up already predicted.

<!-- gen:render file=1_33_safety_best_seed1159417075.mp4 -->
<figure class="tada-render" title="metadata: analysis/2026-09-26_renders_failed_1_33/1_33_safety_best_seed1159417075_solutions.json · file verified identical">
<video controls preload="metadata" src="../../assets/renders/1_33_safety_best_seed1159417075.mp4"></video>
<figcaption><span class="tada-render__by">Rendered by 1_33</span> (final_model.zip) · seed 1159417075 · best of 10 attempts (attempt 2 of 10, chosen by the objective) · 2 of 20 on time, loss of separation at step 12, 11 clearances</figcaption>
</figure>
<!-- /gen -->

At t = 0 in this seed every flight is predicted early, by up to 2 549 s, and the side view already
shows a string of predicted losses on final. Every attempt loses separation; the best one lasts to
step 12.

<!-- gen:render file=1_36_safety_best_seed1566942273.mp4 -->
<figure class="tada-render" title="metadata: analysis/2026-09-26_renders_failed_1_36/1_36_safety_best_seed1566942273_solutions.json · file verified identical">
<video controls preload="metadata" src="../../assets/renders/1_36_safety_best_seed1566942273.mp4"></video>
<figcaption><span class="tada-render__by">Rendered by 1_36</span> (final_model.zip) · seed 1566942273 · best of 10 attempts (attempt 4 of 10, chosen by the objective) · 2 of 20 on time, loss of separation at step 39, 65 clearances</figcaption>
</figure>
<!-- /gen -->

Seed 1566942273: one flight 38 minutes early and six losses of separation predicted at t = 0. Every
attempt of `1_36`, and of `1_35`, loses separation before step 40.

<!-- gen:render file=1_36_precision_best_seed1595180635.mp4 -->
<figure class="tada-render" title="metadata: analysis/2026-09-26_renders_failed_1_36/1_36_precision_best_seed1595180635_solutions.json · file verified identical">
<video controls preload="metadata" src="../../assets/renders/1_36_precision_best_seed1595180635.mp4"></video>
<figcaption><span class="tada-render__by">Rendered by 1_36</span> (final_model.zip) · seed 1595180635 · best of 10 attempts (attempt 7 of 10, chosen by the objective) · 14 of 20 on time, worst 1167 s, 164 clearances</figcaption>
</figure>
<!-- /gen -->

Precision-bound, seed 1595180635: safe, but at best 14 of 20 on time. One flight is 24 minutes
early at t = 0, far over the 650 s cap. `1_35`'s best attempt on this seed gets 8 of 20.

**Consequence.** The headline separation rate is largely a statement about scenario capacity, so it
should be reported split by feasibility. The scenario filter (no realised loss in the first ~270 s)
does not reject over-capacity scenarios; whether it should is an open item on the
[roadmap](../roadmap.md).

## Generated scenarios get harder down the queue

Under do-nothing, 20 seeds each (`analysis/2026-09-25_windowed_evals/`):

| flights | ETA gap | \|dev\| 1–10 | 11–20 | 21–30 | 31–40 |
|---|---|---|---|---|---|
| 20 | 251–279 s | 183 s | 368 s | | |
| 40 | 232–249 s | 224 s | 513 s | 687 s | **913 s** |

Landing spacing stays flat while the deviation to recover grows along the queue. The mechanism is
not established (knock-on delay down the trombone, or how the generator times spawns).

## Stability along a stream

`1_29` zero-shot vs `1_32`, 100 paired seeds, by queue position. *Landed* is the share of flights
that land at all (a loss of separation strands everything behind it); *on time | landed* is
precision among those that did.

| stream | queue position | landed (1_29 / 1_32) | on time \| landed | median \|dev\| (1_32) |
|---|---|---|---|---|
| 20 | 1–4 | 0.99 / 0.95 | 0.87 / 0.91 | 14 s |
| 20 | 9–12 | 0.87 / 0.84 | 0.80 / 0.81 | 15 s |
| 20 | 17–20 | 0.79 / 0.79 | 0.91 / 0.89 | 0 s |
| 40 | 1–8 | 0.95 / 0.94 | 0.85 / 0.88 | 14 s |
| 40 | 17–24 | 0.63 / 0.69 | 0.71 / 0.68 | 21 s |
| 40 | 25–32 | 0.47 / 0.58 | 0.63 / **0.57** | **40 s** |
| 40 | 33–40 | 0.38 / 0.47 | 0.70 / 0.68 | 15 s |

- **Within 20 flights the agent is stable:** precision is flat along the queue; the late-queue drop
  is entirely episodes ending in a loss of separation.
- **At 40 generated flights it is not:** most episodes lose separation and precision drifts (median
  deviation 40 s at positions 25–32). That is the backlog above.

**Stitched 2×20 streams** (`1_32`, same seeds, gap 120–900 s):

| `1_32`, 40 flights | flights 1–20: landed / on time \| landed | flights 21–40: landed / on time \| landed | separation lost |
|---|---|---|---|
| generated in one sequence | 0.85 / 0.80 | 0.55 / **0.63** | 53% |
| **stitched 2×20** | 0.90 / 0.84 | 0.68 / **0.81** | **41%** |

The second stitched segment is landed as precisely as the first (0.81 vs 0.84), so the collapse at
40 contiguous flights was the generator's backlog, not drift in the agent. What limits continuous
use is the per-stretch loss rate compounding: two independent 20-flight episodes at 21% each would
lose separation 1 − 0.79² ≈ 38% of the time, close to the 41% observed. Every later model is
scored on stitched streams as part of the standard battery. The current numbers are on the
[leaderboard](../models/index.md).
