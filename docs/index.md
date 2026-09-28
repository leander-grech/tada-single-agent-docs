# TADA: single-agent arrival sequencing

One reinforcement-learning agent sequences arrival traffic into **Milan Malpensa** through the
trombone arrival. Every 45 s it issues a clearance, two with [reselection](how/actions.md#reselection),
to land every flight on its AMAN target time without ever losing separation, using as few
clearances as it can. The current agent flies a stream of 20 flights through a window of the next
10 in the landing queue.

<!-- gen:best-box -->
<div class="tada-best">
<div class="tada-best__head"><span class="tada-best__label">Current best</span><a class="tada-best__model" href="models/1_38/">1_38</a><span class="tada-best__what">1_36 continued for another 5M steps on the same settings (reselection, budget 2).</span></div>
<div class="tada-tiles"><div class="tada-tile tada-tile--ok"><span class="tada-tile__label">Solved</span><span class="tada-tile__value">63<span class="tada-tile__unit">/100</span></span><span class="tada-tile__delta">1_36: 65</span></div><div class="tada-tile tada-tile--ok"><span class="tada-tile__label">Hard-solved ±30 s</span><span class="tada-tile__value">24<span class="tada-tile__unit">/100</span></span><span class="tada-tile__delta">1_36: 29</span></div><div class="tada-tile tada-tile--bad"><span class="tada-tile__label">Separation lost</span><span class="tada-tile__value">3<span class="tada-tile__unit">/100</span></span><span class="tada-tile__delta">1_36: 9</span></div><div class="tada-tile tada-tile--champ"><span class="tada-tile__label">Flights on time</span><span class="tada-tile__value">92.7<span class="tada-tile__unit">%</span></span><span class="tada-tile__delta">1_36: 91.6%</span></div><div class="tada-tile tada-tile--"><span class="tada-tile__label">Clearances</span><span class="tada-tile__value">121.9<span class="tada-tile__unit"></span></span><span class="tada-tile__delta">1_36: 128.3</span></div></div>
<div class="tada-best__foot">20-flight streams · 100 validation seeds · deterministic · tile footnotes: parent 1_36 · source <code>analysis/2026-09-26_1_36_multipick/eval_cont/f20.csv</code> · <a href="models/">champion rule</a></div>
</div>
<!-- /gen -->

<div class="grid cards" markdown>

-   **[Leaderboard](models/index.md)**

    Every model, sortable, with the champion rule. Each links to a report card.

-   **[How it works](how/problem.md)**

    The problem, the environments, what the agent sees and can do, the policy network, the objective, the separation rules, with diagrams.

-   **[Findings](findings/index.md)**

    What the experiments established: reselection, sequencing, capacity, search, training from scratch.

-   **[Train one yourself](training/index.md)**

    The from-scratch recipe, how to score it while it trains, and reference curves to compare against.

-   **[Renders](renders.md)**

    Every video, credited to the model, checkpoint and seed that produced it.

-   **[Evaluation protocol](evaluation.md)**

    100 validation seeds, a pinned frame, the standard battery, paired tests.

</div>

## What changed recently

- **Reselection** (a second clearance within the 45 s step) was the largest single gain: precision
  had been limited by bandwidth ([Findings](findings/reselection.md)).
- **Long streams:** on feasible 60- and 100-flight streams the champion never loses separation, and
  precision does not drift ([Long streams](findings/long-streams.md)).
- **Order first?** Forcing the AMAN order early lowers precision for all 16 agents tested
  ([Phase 0](findings/order-first.md)).
- **From scratch:** the full design learns from random weights. You get what you train on: a
  curriculum ending on 20-flight streams (the new recipe default) is best there, one ending on
  stitched streams is safer on long ones ([Training from scratch](findings/curriculum.md)).

Full history: [experiment log](log.md). What's next: [roadmap](roadmap.md). Terms: [glossary](glossary.md).

!!! info "Sources"
    Every model number on this site is generated from the code repo's evaluation files by
    `tools/build_model_docs.py` from `models.yaml`. The in-training success rate is never quoted
    ([why](findings/evaluation-noise.md)). Code: `reinforcement_learning/single_agent_rllib` on
    branch `UM-lg`.
