# Reselection: precision was bandwidth-limited

!!! abstract "Summary"
    Allowed to issue a second clearance within the same 45 s step, the policy learned to ask for one
    on about a third of its decisions. Against an identical control without it, solved streams
    roughly doubled and AMAN swaps almost disappeared: **precision had been limited by how many
    clearances the agent could issue, not by what it knew**. The price was some safety. Another 5M
    steps (`1_38`) removed that cost on 20-flight streams; on stitched 40-flight ones it still loses
    separation a little more often than the control (not significant). A
    larger separation penalty (`1_39`) made the policy timid everywhere and was not adopted. With
    the critic-guided lookahead the reselection policy is both safe and precise.

Mechanics: [Actions → reselection](../how/actions.md#reselection). Cards: [`1_35`](../models/1_35.md)
(start) → [`1_37`](../models/1_37.md) (control) and [`1_36`](../models/1_36.md) (reselection) →
[`1_38`](../models/1_38.md) (+5M) and [`1_39`](../models/1_39.md) (+5M, penalty 240).

## The experiment

What the policy can do with reselection: within one 45 s step, clear one flight, see the
prediction with that clearance applied, and clear a second before the clock moves.

<!-- gen:figure file=diagrams/reselection.svg -->
<figure class="tada-fig-wrap"><svg class="tada-dg" viewBox="0 0 760 330" role="img" aria-label="Reselection: two picks within one 45-second step">
<defs>
  <marker id="ra" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L8,4 L0,8 z"/></marker>
</defs>
<!-- time axis -->
<line class="clock" x1="40" y1="290" x2="720" y2="290"/>
<text class="s" x="660" y="276">simulated time →</text>
<line class="e" x1="120" y1="282" x2="120" y2="298"/><text class="t b" x="108" y="318">t</text>
<line class="e" x1="640" y1="282" x2="640" y2="298"/><text class="t b" x="616" y="318">t + 45 s</text>
<text class="s" x="250" y="276">the clock does not move between pick 1 and pick 2</text>

<!-- pick 1 -->
<rect class="box head fill-head" x="30" y="30" width="200" height="96" rx="5"/>
<text class="h" x="42" y="48">pick 1 · observation o₁</text>
<text class="t" x="42" y="68">flight 4: SLOW_DOWN_MEDIUM</text>
<text class="t b c-head" x="42" y="88">again = 1</text>
<text class="s" x="42" y="106">clearance is queued, not flown</text>
<text class="s" x="42" y="119">reward −0.006 + Φ(o₂) − Φ(o₁)</text>

<!-- re-predict -->
<rect class="box enc" x="270" y="30" width="200" height="96" rx="5"/>
<text class="h" x="282" y="48">re-predict</text>
<text class="t" x="282" y="68">do-nothing rollout</text>
<text class="t" x="282" y="86">with the queued clearance</text>
<text class="s" x="282" y="106">o₂: flight 4 now flagged</text>
<text class="s" x="282" y="119">"cleared at this step"</text>

<!-- pick 2 -->
<rect class="box head fill-head" x="510" y="30" width="220" height="96" rx="5"/>
<text class="h" x="522" y="48">pick 2 · observation o₂</text>
<text class="t" x="522" y="68">flight 6: LENGTHEN_TROMBONE</text>
<text class="t b c-head" x="522" y="88">again = 0 (budget spent)</text>
<text class="s" x="522" y="106">flight 4 is masked: it can only</text>
<text class="s" x="522" y="119">be left alone until the clock moves</text>

<path class="e" d="M230,78 H268" marker-end="url(#ra)"/>
<path class="e" d="M470,78 H508" marker-end="url(#ra)"/>

<!-- apply -->
<rect class="box env fill-env" x="270" y="166" width="460" height="74" rx="5"/>
<text class="h" x="282" y="184">apply and advance</text>
<text class="t" x="282" y="204">both clearances fly together; the simulator advances 45 s</text>
<text class="s" x="282" y="222">reward −0.006 + landings this step − 90 · [loss of separation] + γΦ(o′) − Φ(o₂)</text>
<path class="e" d="M620,126 V164" marker-end="url(#ra)"/>
<path class="e dash" d="M640,240 V280" marker-end="url(#ra)"/>

<!-- discounting note -->
<rect class="box muted" x="30" y="166" width="220" height="74" rx="5"/>
<text class="h" x="42" y="184">discounting</text>
<text class="s" x="42" y="202">pick 1 → pick 2: discount 1</text>
<text class="s" x="42" y="216">(no simulated time passes)</text>
<text class="s" x="42" y="232">pick 2 → next step: discount γ</text>
<path class="e dash" d="M120,126 V282" marker-end="url(#ra)"/>
</svg>
</figure>
<!-- /gen -->

`1_36` and `1_37` both start from `1_35` at 4.65M steps and train 5M more steps on identical
settings; only `1_36` may ask for a second pick. `1_36` starts computing exactly `1_35`'s function
(the new input is zero on a first pick, and the new head starts at a 5% chance of asking). During
training the share of decisions asking for another pick grew from 3.5% to ~35%.

<!-- gen:compare models=1_35,1_37,1_36,1_38,1_39 batteries=f20,s2x20,att10,la4 -->
<table class="tada-table tada-compare"><thead><tr><th>100 seeds, deterministic unless stated</th><th><a href="../../models/1_35/">1_35</a></th><th><a href="../../models/1_37/">1_37</a></th><th><a href="../../models/1_36/">1_36</a></th><th><a href="../../models/1_38/">1_38</a></th><th><a href="../../models/1_39/">1_39</a></th></tr></thead><tbody><tr><td>20-flight: solved</td><td>24</td><td>34</td><td>65</td><td>63</td><td>40</td></tr><tr><td>20-flight: hard-solved</td><td>0</td><td>1</td><td>29</td><td>24</td><td>5</td></tr><tr><td>20-flight: separation lost</td><td>8</td><td>4</td><td>9</td><td>3</td><td>5</td></tr><tr><td>20-flight: flights on time</td><td>0.826</td><td>0.832</td><td>0.916</td><td>0.927</td><td>0.858</td></tr><tr><td>20-flight: clearances / stream</td><td>86.8</td><td>80.6</td><td>128.3</td><td>121.9</td><td>125.2</td></tr><tr><td>20-flight: AMAN swaps / stream</td><td>0.85</td><td>1.02</td><td>0.07</td><td>0.54</td><td>0.66</td></tr><tr><td>stitched 2×20: solved</td><td>5</td><td>10</td><td>38</td><td>34</td><td>12</td></tr><tr><td>stitched 2×20: hard-solved</td><td>0</td><td>0</td><td>6</td><td>9</td><td>1</td></tr><tr><td>stitched 2×20: separation lost</td><td>10</td><td>11</td><td>16</td><td>15</td><td>9</td></tr><tr><td>stitched 2×20: flights on time</td><td>0.788</td><td>0.770</td><td>0.878</td><td>0.865</td><td>0.822</td></tr><tr><td>pass@10 (seeds)</td><td>47</td><td>54</td><td>80</td><td>76</td><td>67</td></tr><tr><td>separation lost, best of 10</td><td>4</td><td>1</td><td>2</td><td>2</td><td>1</td></tr><tr><td>with lookahead: solved</td><td>8</td><td>7</td><td>39</td><td>30</td><td>26</td></tr><tr><td>with lookahead: hard-solved</td><td>0</td><td>0</td><td>10</td><td>8</td><td>6</td></tr><tr><td>with lookahead: separation lost</td><td>5</td><td>7</td><td>2</td><td>1</td><td>5</td></tr><tr><td>with lookahead: flights on time</td><td>0.781</td><td>0.774</td><td>0.896</td><td>0.893</td><td>0.833</td></tr></tbody></table>

<!-- /gen -->

### Every reselection agent so far

The controlled comparison above is fixed by design. This table lists every agent that can use a
second pick, newest runs included:

<!-- gen:compare models=reselection batteries=f20,s2x20,att10,la4 -->
<table class="tada-table tada-compare"><thead><tr><th>100 seeds, deterministic unless stated</th><th><a href="../../models/1_36/">1_36</a></th><th><a href="../../models/1_38/">1_38</a></th><th><a href="../../models/1_39/">1_39</a></th><th><a href="../../models/1_40/">1_40</a></th><th><a href="../../models/1_41/">1_41</a></th><th><a href="../../models/1_42/">1_42</a></th><th><a href="../../models/1_43/">1_43</a></th><th><a href="../../models/1_44/">1_44</a></th><th><a href="../../models/1_46/">1_46</a></th><th><a href="../../models/1_47/">1_47</a></th><th><a href="../../models/1_48/">1_48</a></th><th><a href="../../models/1_50/">1_50</a><br><span class="tada-chip tada-chip--muted" title="Trained and scored in the release MDP: locked flights leave the window">release MDP</span></th></tr></thead><tbody><tr><td>20-flight: solved</td><td>65</td><td>63</td><td>40</td><td>22</td><td>14</td><td>16</td><td>22</td><td>37</td><td>44</td><td>36</td><td>48</td><td>51</td></tr><tr><td>20-flight: hard-solved</td><td>29</td><td>24</td><td>5</td><td>2</td><td>2</td><td>1</td><td>6</td><td>13</td><td>13</td><td>9</td><td>21</td><td>26</td></tr><tr><td>20-flight: separation lost</td><td>9</td><td>3</td><td>5</td><td>9</td><td>9</td><td>7</td><td>6</td><td>6</td><td>7</td><td>8</td><td>4</td><td>20</td></tr><tr><td>20-flight: flights on time</td><td>0.916</td><td>0.927</td><td>0.858</td><td>0.779</td><td>0.793</td><td>0.790</td><td>0.801</td><td>0.817</td><td>0.852</td><td>0.849</td><td>0.863</td><td>0.844</td></tr><tr><td>20-flight: clearances / stream</td><td>128.3</td><td>121.9</td><td>125.2</td><td>161.9</td><td>158.1</td><td>155.8</td><td>140.6</td><td>153.7</td><td>158.7</td><td>180.5</td><td>158.2</td><td>136.9</td></tr><tr><td>20-flight: AMAN swaps / stream</td><td>0.07</td><td>0.54</td><td>0.66</td><td>0.98</td><td>0.60</td><td>0.62</td><td>1.05</td><td>1.07</td><td>0.56</td><td>0.86</td><td>0.60</td><td>0.01</td></tr><tr><td>stitched 2×20: solved</td><td>38</td><td>34</td><td>12</td><td>1</td><td>3</td><td>1</td><td>8</td><td>10</td><td>17</td><td>13</td><td>16</td><td>22</td></tr><tr><td>stitched 2×20: hard-solved</td><td>6</td><td>9</td><td>1</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>3</td><td>1</td><td>0</td><td>4</td></tr><tr><td>stitched 2×20: separation lost</td><td>16</td><td>15</td><td>9</td><td>13</td><td>21</td><td>21</td><td>11</td><td>17</td><td>8</td><td>8</td><td>6</td><td>32</td></tr><tr><td>stitched 2×20: flights on time</td><td>0.878</td><td>0.865</td><td>0.822</td><td>0.730</td><td>0.725</td><td>0.704</td><td>0.745</td><td>0.738</td><td>0.818</td><td>0.818</td><td>0.827</td><td>0.780</td></tr><tr><td>pass@10 (seeds)</td><td>80</td><td>76</td><td>67</td><td>38</td><td>34</td><td>37</td><td>34</td><td>51</td><td>56</td><td>57</td><td>62</td><td>—</td></tr><tr><td>separation lost, best of 10</td><td>2</td><td>2</td><td>1</td><td>0</td><td>2</td><td>1</td><td>1</td><td>2</td><td>1</td><td>0</td><td>1</td><td>—</td></tr><tr><td>with lookahead: solved</td><td>39</td><td>30</td><td>26</td><td>19</td><td>22</td><td>29</td><td>24</td><td>31</td><td>37</td><td>37</td><td>25</td><td>24</td></tr><tr><td>with lookahead: hard-solved</td><td>10</td><td>8</td><td>6</td><td>0</td><td>1</td><td>1</td><td>4</td><td>7</td><td>19</td><td>17</td><td>17</td><td>10</td></tr><tr><td>with lookahead: separation lost</td><td>2</td><td>1</td><td>5</td><td>7</td><td>2</td><td>5</td><td>1</td><td>4</td><td>4</td><td>1</td><td>2</td><td>15</td></tr><tr><td>with lookahead: flights on time</td><td>0.896</td><td>0.893</td><td>0.833</td><td>0.802</td><td>0.835</td><td>0.817</td><td>0.788</td><td>0.825</td><td>0.849</td><td>0.865</td><td>0.818</td><td>0.824</td></tr></tbody></table>

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
  still loses separation more often than the one-pick control, though not significantly.
- **A bigger penalty is not the lexicographic order.** `1_39` (240 = 40 flights × 6) lost precision
  broadly; its only safety gain was fewer losses on stitched streams, and not a significant one. Scaling one penalty makes the policy cautious
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
