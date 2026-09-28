# Long streams

!!! abstract "Summary"
    Flown on 60- and 100-flight streams (three and five 20-flight waves), the champion `1_38`, `1_36`,
    the one-pick `1_37` and the curriculum run `1_43` **land every flight of every feasible stream
    without a single loss of separation**, and precision does not drift along the stream. A feasible
    stream is one where no flight needs more than the generator's own 650 s cap of delay. The two
    newest models, trained on 20-flight streams only at the end (`1_44`, `1_46`), each lose
    separation on one feasible 60-flight stream. On unfiltered streams the losses come back, and they sit in the waves that are over
    capacity. Feasible long streams are rare in generated traffic: 4.5% at 60 flights, 0.5% at 100.

Data: `analysis/2026-09-27_scratch/longstreams/` in the code repo (`report.md`, `eval/`, `seeds/`).
Screening: `analysis/long_stream_seeds.py`. Scoring: `score_windowed.py --seed-file --flights-csv`.
Table and plot: `analysis/long_stream_report.py`. Models: [`1_38`](../models/1_38.md) (champion),
[`1_36`](../models/1_36.md), [`1_37`](../models/1_37.md) (one pick), the from-scratch
[`1_43`](../models/1_43.md) and [`1_44`](../models/1_44.md), and [`1_46`](../models/1_46.md)
(`1_43` + 10M); all deterministic.

## Method

- **Streams:** stitched 3×20 = 60 and 5×20 = 100 flights, with a 600–900 s (10–15 min) gap
  between waves ([stitched streams](../how/environments.md#stitching)). Stream seeds come from a
  fixed generator and are never among the 100 validation seeds.
- **Feasible:** flown do-nothing, no flight is predicted more than **650 s early** anywhere in the
  stream. 650 s is the scenario generator's own cap on the delay a flight may need.
- **Unfiltered:** the first 40 candidate streams of each length, as generated.

**Feasible long streams are rare.**

| stream | candidates | feasible | largest early arrival: median / 90th pct / max |
|---|---|---|---|
| 60 flights | 600 | **27 (4.5%)** | 1 210 / 1 735 / 2 599 s |
| 100 flights | 2 500 | **12 (0.5%)** | 1 359 / 1 859 / 2 679 s |

The 100-flight feasible set is only 12 streams: a small sample, so read its rates loosely.

## Results

Counts are streams; "on time" is the share of flights within ±60 s of their AMAN target
(`longstreams/report.md`, rescored with every stream run to its own horizon).

| stream | n | model | no loss of separation | solved (±60 s) | hard-solved (±30 s) | on time, all flights | on time, landed flights | mean \|dev\|, landed | clearances / flight |
|---|---|---|---|---|---|---|---|---|---|
| 60, feasible | 27 | `1_38` | **27** | 11 | 1 | 0.986 | 0.986 | 9 s | 5.7 |
| | 27 | `1_36` | **27** | 9 | 1 | 0.985 | 0.985 | 9 s | 6.5 |
| | 27 | `1_37` | **27** | 4 | 0 | 0.976 | 0.976 | 16 s | 3.6 |
| | 27 | `1_43` (from scratch) | **27** | 1 | 0 | 0.952 | 0.952 | 15 s | 6.9 |
| | 27 | `1_44` (from scratch, arm D) | 26 | 8 | 0 | 0.949 | 0.973 | 12 s | 7.5 |
| | 27 | `1_46` (`1_43` + 10M) | 26 | 5 | 0 | 0.947 | 0.974 | 10 s | 8.4 |
| 60, unfiltered | 40 | `1_38` | 34 | 7 | 0 | 0.836 | 0.914 | 39 s | 5.8 |
| | 40 | `1_36` | 31 | 6 | 0 | 0.798 | 0.930 | 28 s | 6.1 |
| | 40 | `1_37` | 34 | 1 | 0 | 0.748 | 0.819 | 73 s | 3.7 |
| | 40 | `1_43` (from scratch) | 35 | 0 | 0 | 0.755 | 0.793 | 95 s | 6.6 |
| | 40 | `1_44` (from scratch, arm D) | 31 | 0 | 0 | 0.693 | 0.792 | 85 s | 6.4 |
| | 40 | `1_46` (`1_43` + 10M) | 36 | 1 | 0 | 0.781 | 0.833 | 69 s | 7.4 |
| 100, feasible | 12 | `1_38` | **12** | 0 | 0 | 0.976 | 0.976 | 10 s | 5.6 |
| | 12 | `1_38` + lookahead | **12** | 2 | 0 | 0.965 | 0.965 | 15 s | 6.0 |
| | 12 | `1_36` | **12** | 1 | 0 | 0.983 | 0.983 | 9 s | 6.4 |
| | 12 | `1_37` | **12** | 0 | 0 | 0.967 | 0.967 | 16 s | 3.6 |
| | 12 | `1_43` (from scratch) | **12** | 0 | 0 | 0.954 | 0.954 | 14 s | 6.7 |
| | 12 | `1_44` (from scratch, arm D) | 11 | 0 | 0 | 0.939 | 0.967 | 13 s | 8.3 |
| | 12 | `1_46` (`1_43` + 10M) | **12** | 0 | 0 | 0.968 | 0.968 | 12 s | 8.7 |
| 100, unfiltered | 40 | `1_38` | 30 | 1 | 0 | 0.812 | 0.915 | 43 s | 5.8 |
| | 40 | `1_36` | 25 | 2 | 0 | 0.730 | 0.936 | 26 s | 5.7 |
| | 40 | `1_37` | 24 | 0 | 0 | 0.662 | 0.791 | 81 s | 3.5 |
| | 40 | `1_43` (from scratch) | 28 | 0 | 0 | 0.659 | 0.767 | 103 s | 5.9 |
| | 40 | `1_44` (from scratch, arm D) | 22 | 0 | 0 | 0.582 | 0.794 | 88 s | 5.3 |
| | 40 | `1_46` (`1_43` + 10M) | 29 | 0 | 0 | 0.741 | 0.811 | 77 s | 7.0 |

- **Feasible streams are flown safely by every model trained on stitched streams to the end.** `1_38`,
  `1_36`, `1_37` and `1_43` fly all of them without a loss, and every flight lands. The reselection
  models put 98–99% of flights on time, 9–10 s off on average; the one-pick control about 97%, 16 s
  off.
- **The two models whose last stage trained on 20-flight streams only lose one feasible stream
  each.** `1_44` (arm D) loses separation on one feasible 60-flight and one feasible 100-flight
  stream, and `1_46` (`1_43` continued on 20-flight streams) on one feasible 60-flight stream. Both
  are more precise than `1_43` on the 20-flight validation seeds ([Training from
  scratch](curriculum.md)): what a policy is trained on last is what it is best at.
- **Unfiltered streams lose separation, in the over-capacity waves.** `1_38` loses separation on 6
  of 40 60-flight streams and 10 of 40 100-flight streams, after a median of 27 and 57 landed
  flights. The one-pick `1_37` loses 16 of 40 at 100 flights, and its precision among landed flights
  falls to 0.791 against `1_38`'s 0.915.
- **The from-scratch `1_43` is as safe as the champion on long streams, but less precise.** It
  flies every feasible stream without a loss and loses about as many unfiltered streams as `1_38`,
  but lands fewer flights on time, most clearly on unfiltered streams. `1_46` keeps unfiltered
  streams clean about as often as `1_38` (36 and 29 of 40) with lower precision; `1_44` loses the
  most unfiltered 100-flight streams of any model here (18 of 40).
- **Reselection costs clearances:** ~5.6–6.5 per flight for the fine-tuned models, up to 8.7 for
  `1_46`, against ~3.5 without it.
- **Lookahead** on feasible 100-flight streams solved 2 of 12 strictly, against 0 without; its
  on-time rate is slightly lower.

## No drift along the stream

On time among landed flights, by 20-flight wave:

![On-time rate by 20-flight segment, feasible and unfiltered 100-flight streams](../assets/findings/long_streams_on_time_by_segment.png)

| 100 flights | wave 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| `1_38`, feasible | 0.958 | 0.975 | 0.979 | 0.983 | 0.983 |
| `1_38`, unfiltered | 0.929 | 0.868 | 0.939 | 0.951 | 0.884 |
| `1_37`, unfiltered | 0.872 | 0.734 | 0.848 | 0.764 | 0.714 |
| `1_43`, feasible | 0.946 | 0.950 | 0.967 | 0.963 | 0.946 |
| `1_43`, unfiltered | 0.815 | 0.714 | 0.821 | 0.798 | 0.673 |
| `1_44`, feasible | 0.942 | 0.975 | 0.979 | 0.964 | 0.977 |
| `1_46`, feasible | 0.954 | 0.967 | 0.971 | 0.979 | 0.967 |

On feasible streams precision does not decay; if anything it rises after the first wave. On
unfiltered streams it dips in the waves that carry over-capacity traffic and recovers after
them; the one-pick control recovers less.

## Why strict solves are rare

Solving a long stream means every one of 60 or 100 flights within ±60 s. For `1_38` that is 11 of
27 feasible 60-flight streams and 0 of 12 at 100 flights, which is what its per-flight precision
predicts. If each flight is on time independently with probability 0.986, all 60 are on time in
0.986⁶⁰ ≈ 43% of streams (observed 11 of 27 = 41%), and all 100 at 0.976 in 0.976¹⁰⁰ ≈ 9%
(observed 0 of 12, about one expected). Strict solves are rare because one or two misses in 60–100
flights are enough to fail, not because precision decays along the stream (see the wave table).

!!! note "An evaluation bug, found and fixed"
    A first scoring of these streams (and of the stitched 2×20 validation battery) stopped
    episodes early: the scorer capped a stream at `max(200, 7 × flights × segments)` steps, below
    the environment's own `200 × segments`. On 13 of 27 feasible 60-flight streams and 7 of 12
    100-flight streams it cut the stream off before its last landing, and those flights counted as
    late. It surfaced because a render, which ran to the natural end, did not match its score.
    Since commit `8dd6539` evaluation runs to each stream's own horizon, records a `horizon_capped`
    column and warns if any episode is still cut off. Every number on this site is from the
    rescored files. On the 20-flight evaluations the cap never bound.

## Renders

All by `1_38`, deterministic, 100-flight streams.

The feasible stream it flies best:

<!-- gen:render file=1_38_k5_best_seed868278894.mp4 -->
<figure class="tada-render" title="metadata: analysis/2026-09-27_scratch/longstreams/renders/1_38_k5_best_seed868278894_solutions.json · file verified identical">
<video controls preload="metadata" src="../../assets/renders/1_38_k5_best_seed868278894.mp4"></video>
<figcaption><span class="tada-render__by">Rendered by 1_38</span> (final_model.zip) · seed 868278894 · 5×20-flight stitched stream, feasible, gaps 600–900 s · deterministic · 99 of 100 on time, worst 66 s, 568 clearances</figcaption>
</figure>
<!-- /gen -->

The feasible stream at its median on-time rate:

<!-- gen:render file=1_38_k5_typical_seed1417723440.mp4 -->
<figure class="tada-render" title="metadata: analysis/2026-09-27_scratch/longstreams/renders/1_38_k5_typical_seed1417723440_solutions.json · file verified identical">
<video controls preload="metadata" src="../../assets/renders/1_38_k5_typical_seed1417723440.mp4"></video>
<figcaption><span class="tada-render__by">Rendered by 1_38</span> (final_model.zip) · seed 1417723440 · 5×20-flight stitched stream, feasible, gaps 600–900 s · deterministic · 98 of 100 on time, worst 85 s, 608 clearances</figcaption>
</figure>
<!-- /gen -->

An unfiltered stream on which it loses separation:

<!-- gen:render file=1_38_k5_loss_seed1357624909.mp4 -->
<figure class="tada-render" title="metadata: analysis/2026-09-27_scratch/longstreams/renders/1_38_k5_loss_seed1357624909_solutions.json · file verified identical">
<video controls preload="metadata" src="../../assets/renders/1_38_k5_loss_seed1357624909.mp4"></video>
<figcaption><span class="tada-render__by">Rendered by 1_38</span> (final_model.zip) · seed 1357624909 · 5×20-flight stitched stream, unfiltered, gaps 600–900 s · deterministic · 76 of 100 on time, loss of separation at step 527, 645 clearances</figcaption>
</figure>
<!-- /gen -->

What makes a wave over capacity, and the validation seeds no agent has ever flown safely:
[Over-capacity scenarios](capacity.md).
