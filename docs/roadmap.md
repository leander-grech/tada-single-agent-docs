# Roadmap

!!! abstract "Summary"
    **In progress:** the last items of the evaluation backfill (three 10-aircraft scores). **Next questions:** can the
    reselection policy's safety on long, stitched streams catch up with its safety on 20-flight
    streams? Does the from-scratch recipe close the gap to the fine-tuned lineage with more steps
    or a curriculum? Should separation be reported split by scenario capacity, and should the
    scenario filter reject over-capacity scenarios? **Ruled out, with evidence:** a bigger
    network, forcing the AMAN order first, a larger separation penalty, a shorter action interval,
    refusal shields.

## In progress

- **Backfill.** Every missing evaluation and render is listed per model in [BACKFILL](backfill.md),
  with the exact seeds for the standard render slots. The training session runs them on a rented
  host; the generator picks them up from `models.yaml` without hand-editing any page.

## Open questions

| question | why it is open | evidence |
|---|---|---|
| Long-stream safety with reselection | on feasible 60- and 100-flight streams the champion never loses separation (the newest from-scratch models lose one stream each); on unfiltered ones the losses are in over-capacity waves, and `1_38` loses fewer than the one-pick control at 100 flights. What remains is behaviour inside over-capacity waves | [Long streams](findings/long-streams.md) |
| How far does from-scratch training go? | arm A was still climbing steeply at 10M; seed variance is as large as the arm differences | [Training from scratch](findings/curriculum.md) |
| More seeds per arm | one seed per arm cannot separate arms that differ by less than the seed spread; arm D's second seed (`1_45`) was aborted for budget | same |
| Train on both | arm D is best on 20-flight streams, arm C safer on long ones; a curriculum or mixture that keeps both is untested | [Training from scratch](findings/curriculum.md) |
| Report separation by feasibility | most losses are in seeds needing more delay than the airspace absorbs; the long-stream evaluation already splits feasible from unfiltered | [Over-capacity scenarios](findings/capacity.md) |
| Should the scenario filter reject over-capacity scenarios? | it only rejects a realised loss in the first ~270 s | same |
| Deploy the lookahead | on reselection policies it keeps most of both safety and precision; it costs 4 simulator steps per decision | [Search at inference](findings/lookahead.md) |
| Attribute `1_26`'s bundle | three changes shipped together; the `USE_LOG_DEVIATION_OBS = False` ablation was never run | [Archive](archive/ten-aircraft-reward.md) |

## Designed, not built

| item | why | evidence |
|---|---|---|
| Δt-stamped action history | history rows carry no time, and the history GRU uses ~4.5 of 64 effective directions | [Archive → network capacity](archive/ten-aircraft-tests.md#embedding-capacity) |
| `time_to_conflict` matched to the conflict cost | the feature ramps linearly over 20 min while the cost halves every 4 min | [Observations](how/observations.md) |
| Fix `time_to_target` in the 10-aircraft env | read from the rollout's end, dead in every 10-aircraft run; fixed in the windowed env only | [Observations](how/observations.md#time-to-target-bug) |

## Ruled out

| idea | result |
|---|---|
| A bigger network | the encoder uses ~1/8 of its width; shape, not size, was the lever (attention, from `1_29`) |
| Forcing the AMAN order first | early order does not predict success; an order-first override made all three models worse ([Phase 0](findings/order-first.md)) |
| A larger separation penalty | `1_39`: cautious everywhere, precision lost; fewer losses only on stitched streams, not significantly |
| A 22 s action interval | `1_16_b`, `1_17`: destabilised training and lost; reselection gives the extra bandwidth without shortening the step |
| Refusal shields | net harmful in both tracks ([Search at inference](findings/lookahead.md)) |
| Seeing the sequence without being paid for it | `1_33`: no consistent gain ([Sequencing](findings/sequencing.md)) |
| A smaller clearance set | `1_27`, `1_27a`: faster to learn, worse at the end ([Archive](archive/clearance-sets.md)) |
| Cutting the prediction rollout's horizon | measured 0.96×; the rollout already stops when every aircraft has landed |
