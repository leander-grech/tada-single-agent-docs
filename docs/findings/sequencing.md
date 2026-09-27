# Sequencing: where precision is lost

!!! abstract "Summary"
    Traffic never enters the sector in the order it must land, and precision is lost exactly where
    the agent has to reorder it. Flights that must overtake or be overtaken are on time less often.
    Among landed flights, a swapped pair is on time far less often than a kept one. Showing the
    agent the AMAN sequence (`1_33`) did not help by itself, because nothing paid for keeping it.
    What fixed it was bandwidth: with [reselection](reselection.md) AMAN swaps almost vanished.
    Forcing the order at inference does not work either ([Order first?](order-first.md)).

## The geometry of a miss

On the renders' side view, losses of separation and timing misses share one pattern: **the spacing
between consecutive flights compresses**. Touchdown markers sit closer together than their target
ticks, and the descent profiles merge on the last few thousand feet.

<!-- gen:render file=1_32_solved_seed1001495968.mp4 -->
<figure class="tada-render" title="metadata: analysis/2026-09-25_renders_1_32/1_32_solved_seed1001495968_solutions.json · file verified identical">
<video controls preload="metadata" src="../../assets/renders/1_32_solved_seed1001495968.mp4"></video>
<figcaption><span class="tada-render__by">Rendered by 1_32</span> (final_model.zip) · seed 1001495968 · deterministic · 20 of 20 on time, worst 41 s, 121 clearances</figcaption>
</figure>
<!-- /gen -->

In this solved stream, flight 9 heads for touchdown ~9 minutes early, straight into the slots of 7
and 8, and a 7/9 loss of separation is predicted there before the agent fixes it. Later, 18 and 19
have targets 4 minutes apart but are predicted 1 minute apart, exactly where the orange 3–5 NM band
appears.

## Measured

`analysis/sequence_analysis.py`, `1_32` final, 40 seeds, 20 flights
(`analysis/2026-09-25_windowed_evals/sequence_1_32.csv`):

| | value |
|---|---|
| sector **entry** order vs AMAN order | 8.1 inverted pairs per scenario, in **every** scenario |
| on time, flights that must overtake or be overtaken | 0.78 (median \|dev\| 17 s) |
| on time, flights with no overtake needed | 0.89 (14 s) |
| scenarios where `1_32` lands out of AMAN order | 32% (1.2 inverted pairs on average) |
| on time among landed, sequence **swapped** vs **kept** | **0.63** vs **0.91** |
| scenarios with above- vs below-median entry inversions | 0.75 vs 0.90 on time |
| on time if scored by landing order against the same slot times | 0.798 (vs 0.820 by callsign) |

- **The misses are real timing errors.** Re-assigning slots after a swap would not recover them
  (last row): when two flights swap, neither lands in the other's slot.
- **The governing quantity is per pair:** a flight's predicted landing gap to its AMAN predecessor,
  minus the target gap.

## Showing the sequence was not enough (`1_33`)

`1_33` added four sequence columns per aircraft ([Observations](../how/observations.md)) with the
reward unchanged. Paired against `1_32` at matched checkpoints (100 seeds, same frames; * =
significant at 95%):

| checkpoint | on time, 1_33 − 1_32 | separation, fixed / new | all 20 on time, gained / lost |
|---|---|---|---|
| 1M | −0.018 | 11 / 9 | 12 / 3 * |
| 2M | +0.041 * | 15 / 5 * | 9 / 11 |
| 3M | +0.036 | 11 / 7 | 8 / 9 |
| 4M | −0.021 | 7 / 7 | 4 / 13 * |
| final | +0.019 | 9 / 5 | 4 / 13 * |

No gain holds from one checkpoint to the next, and during training the share of flights landing in
their AMAN position stayed flat at ~0.855 for all 5M steps. The agent could see the sequence; the
reward did not pay it to keep it. That motivated the [lexicographic objective](../how/objective.md)
of `1_34`, whose shaping includes predicted AMAN swaps.

## What did fix it: a second clearance per step

With one clearance per 45 s the policy could not act on two flights that both needed it. With
reselection, AMAN swaps per stream fell by an order of magnitude (`1_37` control vs `1_36`, same
start, same steps). Another 5M steps (`1_38`) traded some of that back for safety, and it still
swaps about half as often as the control:

<!-- gen:compare models=1_37,1_36,1_38 batteries=f20 -->
<table class="tada-table tada-compare"><thead><tr><th>100 seeds, deterministic unless stated</th><th><a href="../../models/1_37/">1_37</a></th><th><a href="../../models/1_36/">1_36</a></th><th><a href="../../models/1_38/">1_38</a></th></tr></thead><tbody><tr><td>20-flight: solved</td><td>34</td><td>65</td><td>63</td></tr><tr><td>20-flight: hard-solved</td><td>1</td><td>29</td><td>24</td></tr><tr><td>20-flight: separation lost</td><td>4</td><td>9</td><td>3</td></tr><tr><td>20-flight: flights on time</td><td>0.832</td><td>0.916</td><td>0.927</td></tr><tr><td>20-flight: clearances / stream</td><td>80.6</td><td>128.3</td><td>121.9</td></tr><tr><td>20-flight: AMAN swaps / stream</td><td>1.02</td><td>0.07</td><td>0.54</td></tr></tbody></table>

<!-- /gen -->

Cards: [`1_37`](../models/1_37.md), [`1_36`](../models/1_36.md), [`1_38`](../models/1_38.md).
