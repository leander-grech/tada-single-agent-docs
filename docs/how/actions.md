# Actions & reselection

!!! abstract "Summary"
    Each decision is a pair, **(aircraft, clearance)**. An autoregressive policy picks the aircraft
    first and then a clearance conditioned on it, both masked to what is currently legal. There are
    15 clearances (set `v2`); the 22-clearance `v1` set is frozen so that `1_26` stays replayable.
    With **reselection** (`TADA_MAX_PICKS=2`, from `1_36`) the policy may ask for a second clearance
    before the 45 s clock moves, and the second pick sees the first one's predicted effect. That
    turned out to be the largest single improvement in the project.

Source: `actions/actions_v2.py`, `actions/action_set.py`, `network/autoregressive_policy.py`,
`atc_env/single_agent_env.py`.

## The clearance set (v2)

```
 0 DO_NOTHING          5 SPEED_UP_MEDIUM       10 SKIP_1_WAYPOINT
 1 SLOW_DOWN_SMALL     6 TURN_LEFT_…_ROUTE     11 SKIP_2_WAYPOINTS_NOT_NEXT
 2 SLOW_DOWN_MEDIUM    7 TURN_RIGHT_…_ROUTE    12 SKIP_3_WAYPOINTS_NOT_NEXT
 3 SLOW_DOWN_LARGE     8 LENGTHEN_TROMBONE     13 SKIP_4_WAYPOINTS_NOT_NEXT
 4 SPEED_UP_SMALL      9 SHORTEN_TROMBONE      14 VECTOR_TO_ILS
```

- **Speed** steps are ±10/20/30 kt, and the set is deliberately asymmetric (three slow-downs, two
  speed-ups). Arrivals fly near their speed ceiling: six consecutive large speed-ups move the
  landing by −18 s, six large slow-downs by +339 s.
- **The trombone** lengthens or shortens by one level. The two are exact inverses and stack
  (capacity 4 levels); shortening never goes below the published route, so it only undoes the
  agent's own lengthening.
- **Turns** leave the route and rejoin it; **skips** cut waypoints; `VECTOR_TO_ILS` sends the
  aircraft to final.

The move from 22 clearances to 15, and the evidence for each cut, is in
[Archive → 22 clearances vs 15](../archive/clearance-sets.md). The set is chosen by an environment
variable read at import time (`TADA_ACTION_SET=v1|v2`, default `v2`). A checkpoint loads only into
the set it was trained on, and a mismatch fails with the command to fix it.

## Masks and the aircraft head

`mask_aircraft` marks selectable slots and `mask_action_per_ac` the clearances legal for each
(geometry, route constraints, design limits). The policy reads both from the observation: invalid
logits are removed before sampling and before the policy gradient.

In the windowed env, not-yet-spawned flights are visible but only `DO_NOTHING` is legal for them,
and the aircraft head may pick them only when no flight is under control. Without that rule the
policy wasted steps on pending flights ([Environments](environments.md#windowed)).

## The policy network

A shared encoder turns each aircraft (scalars, flight plan through a 1-D CNN, action history
through a GRU) into a 128-d embedding. One masked self-attention block over the slots (from `1_29`)
mixes the embeddings, and a pooled context plus the global features gives the state vector. The
**aircraft head** scores each slot; the **clearance head** is conditioned on the chosen aircraft's
embedding. With reselection a third head, the **again flag**, decides whether to ask for another
pick. The value head reads the same encoder. Slot order is inert: across 8 orderings on 25
scenarios the first action and the outcome were byte-identical.

## Reselection { #reselection }

With one clearance per 45 s, the agent cannot act on two flights that both need it now. In a
crowded stretch that is exactly the situation the failed seeds show.

- **Action:** (aircraft, clearance, **again**). With again = 1 the clearance is queued, the clock
  does not move, and the next observation's prediction includes every queued clearance. With
  again = 0 the queued clearances and this one are applied together and the clock advances 45 s,
  as in a one-pick step.
- **Masks:** `mask_select` allows only under-control flights not yet cleared at this step; an
  aircraft cleared at this step can only be left alone until the clock moves; `mask_again` allows
  another pick only with budget left and another aircraft to clear. `DO_NOTHING` always ends the
  step. The env never offers a second pick; only the policy asks.
- **The flag** is a third autoregressive stage (Bernoulli), conditioned on the chosen aircraft and
  clearance, with the exact entropy of the whole tree. A one-pick checkpoint warm-starts exactly:
  the new input is zero on a step's first pick, and the new head starts at a 5% chance of asking.
- **Discounting:** a queued pick takes no simulated time, so the learner discounts it by 1, not γ
  ([Objective](objective.md#reselection-discount)). SB3's GAE cannot do that per transition, so SB3
  refuses to *train* with reselection. It still loads, scores, renders and replays those
  checkpoints.

Verified (`tests/test_multi_pick.py`): again = 0 throughout reproduces the one-pick env exactly;
the torch policy equals the JAX network including the again head; one PPO update matches SB3's to
1.2·10⁻⁷.

What it bought, measured against a control trained identically without it:
[Findings → reselection](../findings/reselection.md).
