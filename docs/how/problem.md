# The problem

!!! abstract "Summary"
    Arrivals into Milan Malpensa come in through a trombone arrival. An arrival manager (AMAN) gives
    every flight a target landing time and an order. One reinforcement-learning agent issues
    clearances, one every 45 s (two with [reselection](actions.md#reselection)). It has to land every
    flight within ±60 s of its target without ever letting two aircraft lose separation, and use as
    few clearances as it can. Safety comes first, then precision, then economy.

## What the agent controls

A controller at MXP sequences arrivals by adjusting speed, taking aircraft off the published route
and back, skipping waypoints, extending or shortening the trombone's downwind leg, and vectoring
onto the ILS. The agent has the same instruments as a fixed set of [clearances](actions.md). It
gives one aircraft one clearance per 45 s decision, and the simulator (a Rust flight simulator
driven from Python) advances the world between decisions.

The scenario generator releases arrivals over time. They do not enter the sector in the order they
must land: in every scenario some flights have to overtake others. That reordering is where most of
the difficulty lives (see [Findings → sequencing](../findings/sequencing.md)).

## What "good" means

The objective is **lexicographic**, in this order:

1. **Safety.** No two aircraft within 3 NM and 500 ft of each other. A loss of separation ends the
   episode.
2. **Precision.** Every flight lands close to its AMAN target: within ±60 s counts as on time, and
   the reward pays per flight by deviation bracket.
3. **Economy.** Among solutions equally safe and equally precise, fewer clearances is better.

A stream is **solved** when there is no loss of separation and every flight is within ±60 s;
**hard-solved** when every flight is within ±30 s. The [objective page](objective.md) shows how the
reward encodes this order exactly.

## Two versions of the task

| | 10-aircraft env | windowed env |
|---|---|---|
| scenario | up to 10 arrivals | a stream of 20 (or 2×20, or 40) |
| what the agent sees | every aircraft | the next 10 flights in the AMAN queue |
| reward | tier ladder over the fleet | per flight at touchdown, lexicographic |
| runs | 1_16–1_30 | 1_31 onward |
| status | archived | current |

The [environments page](environments.md) explains both. The windowed agent started from the
10-aircraft agent `1_29`; the from-scratch recipe now trains it without that checkpoint (see
[Training](../training/index.md)).

## Where to go next

- The current best agent and its numbers: [Best model](../models/best.md).
- How agents are scored: [Evaluation protocol](../evaluation.md).
- What the experiments taught us: [Findings](../findings/index.md).
