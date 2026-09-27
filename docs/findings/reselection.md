# Reselection: precision was bandwidth-limited

!!! abstract "Summary"
    Allowed to issue a second clearance within the same 45 s step, the policy learned to ask for one
    on about a third of its decisions. Against an identical control without it, solved streams
    roughly doubled and AMAN swaps almost disappeared: **precision had been limited by how many
    clearances the agent could issue, not by what it knew**. The price was some safety. Another 5M
    steps (`1_38`) removed that cost on 20-flight streams but not on stitched 40-flight ones. A
    larger separation penalty (`1_39`) made the policy timid everywhere and was not adopted. With
    the critic-guided lookahead the reselection policy is both safe and precise.

Mechanics: [Actions → reselection](../how/actions.md#reselection). Cards: [`1_35`](../models/1_35.md)
(start) → [`1_37`](../models/1_37.md) (control) and [`1_36`](../models/1_36.md) (reselection) →
[`1_38`](../models/1_38.md) (+5M) and [`1_39`](../models/1_39.md) (+5M, penalty 240).

## The experiment

`1_36` and `1_37` both start from `1_35` at 4.65M steps and train 5M more steps on identical
settings; only `1_36` may ask for a second pick. `1_36` starts computing exactly `1_35`'s function
(the new input is zero on a first pick, and the new head starts at a 5% chance of asking). During
training the share of decisions asking for another pick grew from 3.5% to ~35%.

<!-- gen:compare models=1_35,1_37,1_36,1_38,1_39 batteries=f20,s2x20,att10,la4 -->
<table class="tada-table tada-compare"><thead><tr><th>100 seeds, deterministic unless stated</th><th><a href="../../models/1_35/">1_35</a></th><th><a href="../../models/1_37/">1_37</a></th><th><a href="../../models/1_36/">1_36</a></th><th><a href="../../models/1_38/">1_38</a></th><th><a href="../../models/1_39/">1_39</a></th></tr></thead><tbody><tr><td>20-flight: solved</td><td>24</td><td>34</td><td>65</td><td>63</td><td>40</td></tr><tr><td>20-flight: hard-solved</td><td>0</td><td>1</td><td>29</td><td>24</td><td>5</td></tr><tr><td>20-flight: separation lost</td><td>8</td><td>4</td><td>9</td><td>3</td><td>5</td></tr><tr><td>20-flight: flights on time</td><td>0.826</td><td>0.832</td><td>0.916</td><td>0.927</td><td>0.858</td></tr><tr><td>20-flight: clearances / stream</td><td>86.8</td><td>80.6</td><td>128.3</td><td>121.9</td><td>125.2</td></tr><tr><td>20-flight: AMAN swaps / stream</td><td>0.85</td><td>1.02</td><td>0.07</td><td>0.54</td><td>0.66</td></tr><tr><td>stitched 2×20: solved</td><td>4</td><td>8</td><td>36</td><td>32</td><td>12</td></tr><tr><td>stitched 2×20: hard-solved</td><td>0</td><td>0</td><td>5</td><td>9</td><td>1</td></tr><tr><td>stitched 2×20: separation lost</td><td>10</td><td>11</td><td>16</td><td>15</td><td>9</td></tr><tr><td>stitched 2×20: flights on time</td><td>0.784</td><td>0.765</td><td>0.873</td><td>0.860</td><td>0.818</td></tr><tr><td>pass@10 (seeds)</td><td>47</td><td>54</td><td>80</td><td>76</td><td>67</td></tr><tr><td>separation lost, best of 10</td><td>4</td><td>1</td><td>2</td><td>2</td><td>1</td></tr><tr><td>with lookahead: solved</td><td>8</td><td>7</td><td>39</td><td>30</td><td>26</td></tr><tr><td>with lookahead: hard-solved</td><td>0</td><td>0</td><td>10</td><td>8</td><td>6</td></tr><tr><td>with lookahead: separation lost</td><td>5</td><td>7</td><td>2</td><td>1</td><td>5</td></tr><tr><td>with lookahead: flights on time</td><td>0.781</td><td>0.774</td><td>0.896</td><td>0.893</td><td>0.833</td></tr></tbody></table>

<!-- /gen -->

The paired tests behind each difference (which seeds were gained or lost, and whether it is
significant) are on the cards, against each model's parent and against the champion.

## What it shows

- **Precision was bandwidth-limited.** The reselection policy acts on two flights that both need
  it now; in `1_36` flights almost never land out of AMAN order (`1_38` swaps somewhat more, still
  about half as often as the control). It is the largest single gain in the
  project ([Sequencing](sequencing.md)).
- **It cost safety at first.** `1_36` loses separation more often than the control on both stream
  lengths: not significant on either alone, but consistent. The penalty (90) was sized to one
  window's bracket range, while training streams hold 40 flights, so a policy this precise can
  rationally accept a little more risk.
- **More training removed that cost on 20-flight streams.** `1_38` fixes several of `1_36`'s losses
  and introduces none (significant on its card) at unchanged precision. On stitched 2×20 streams it
  is still riskier than the one-pick control.
- **A bigger penalty is not the lexicographic order.** `1_39` (240 = 40 flights × 6) lost precision
  broadly and got safer only on long streams. Scaling one penalty makes the policy cautious
  everywhere, not only where separation is at stake.
- **More training alone mostly buys safety.** The control `1_37` has fewer losses than its start
  `1_35` and solves more; reselection on the same step budget solves far more again.
- **Lookahead works with a reselection critic.** Search on a one-pick critic buys safety with most
  of the precision (on `1_37` it does not even buy safety). On `1_36`/`1_38` it keeps most of both
  ([Lookahead](lookahead.md)).

## One scenario, four agents

Seed 599310825, 20 flights, each model's deterministic policy. `1_36` loses separation; `1_38` lands
all 20 in AMAN order with the worst flight 30 s off, using a second pick on 56 of its 183
decisions.

<!-- gen:render file=1_37_deterministic_seed599310825.mp4 -->
<figure class="tada-render" title="metadata: analysis/2026-09-27_renders_seed599310825/1_37_deterministic_seed599310825_solutions.json · file verified identical">
<video controls preload="metadata" src="../../assets/renders/1_37_deterministic_seed599310825.mp4"></video>
<figcaption><span class="tada-render__by">Rendered by 1_37</span> (final_model.zip) · seed 599310825 · deterministic · 17 of 20 on time, worst 453 s, 100 clearances</figcaption>
</figure>
<!-- /gen -->

<!-- gen:render file=1_36_rescued_deterministic_seed599310825.mp4 -->
<figure class="tada-render" title="metadata: analysis/2026-09-26_renders_failed_1_36/1_36_rescued_deterministic_seed599310825_solutions.json · file verified identical">
<video controls preload="metadata" src="../../assets/renders/1_36_rescued_deterministic_seed599310825.mp4"></video>
<figcaption><span class="tada-render__by">Rendered by 1_36</span> (final_model.zip) · seed 599310825 · deterministic · 5 of 20 on time, loss of separation at step 56, 68 clearances</figcaption>
</figure>
<!-- /gen -->

<!-- gen:render file=1_38_deterministic_seed599310825.mp4 -->
<figure class="tada-render" title="metadata: analysis/2026-09-27_renders_seed599310825/1_38_deterministic_seed599310825_solutions.json · file verified identical">
<video controls preload="metadata" src="../../assets/renders/1_38_deterministic_seed599310825.mp4"></video>
<figcaption><span class="tada-render__by">Rendered by 1_38</span> (final_model.zip) · seed 599310825 · deterministic · 20 of 20 on time, worst 30 s, 128 clearances</figcaption>
</figure>
<!-- /gen -->

<!-- gen:render file=1_39_deterministic_seed599310825.mp4 -->
<figure class="tada-render" title="metadata: analysis/2026-09-27_renders_seed599310825/1_39_deterministic_seed599310825_solutions.json · file verified identical">
<video controls preload="metadata" src="../../assets/renders/1_39_deterministic_seed599310825.mp4"></video>
<figcaption><span class="tada-render__by">Rendered by 1_39</span> (final_model.zip) · seed 599310825 · deterministic · 12 of 20 on time, worst 398 s, 122 clearances</figcaption>
</figure>
<!-- /gen -->

`1_36`'s own sampled attempts include three that land all 20 on time; the best by the objective:

<!-- gen:render file=1_36_rescued_best_seed599310825.mp4 -->
<figure class="tada-render" title="metadata: analysis/2026-09-26_renders_failed_1_36/1_36_rescued_best_seed599310825_solutions.json · file verified identical">
<video controls preload="metadata" src="../../assets/renders/1_36_rescued_best_seed599310825.mp4"></video>
<figcaption><span class="tada-render__by">Rendered by 1_36</span> (final_model.zip) · seed 599310825 · best of 10 attempts (attempt 5 of 10, chosen by the objective) · 20 of 20 on time, worst 57 s, 151 clearances</figcaption>
</figure>
<!-- /gen -->
