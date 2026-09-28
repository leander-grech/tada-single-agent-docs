# Order first? (Phase 0)

!!! abstract "Summary"
    Hypothesis: the agent fails because it does not establish the AMAN landing order early enough,
    so forcing the order first should help. **The data say no.** On the same scenario, attempts
    that solve it do not have better early order than attempts that fail. Forcing the order with an
    inference-time override makes all three models tested worse, significantly on solved streams
    and on losses of separation. Inversions matter for the few *actual* losses of separation, but
    those are predicted a median 16–23 minutes ahead, so they are not a problem of seeing the order
    too late.

Data: `analysis/2026-09-27_phase0_order_first/` (`order_first.py`, `order_first_report.py`,
`report.txt`). Models: [`1_38`](../models/1_38.md), [`1_37`](../models/1_37.md),
[`1_35`](../models/1_35.md); 100 validation seeds, the deterministic policy plus 9 sampled attempts
each (1000 episodes per model), plus the override runs.

!!! note "Coverage"
    Phase 0 has been run on three agents so far. The others, the newest included, are queued in
    [BACKFILL](../backfill.md); the [coverage page](../coverage.md) tracks which agent has had
    which test.

## The tests

| test | question |
|---|---|
| T0 | Where do AMAN-order inversions come from: present at entry, or created later, and on which steps? |
| T1 | On the same seed, do attempts that solve it have fewer early inversions than attempts that fail? Pairing within a seed removes scenario difficulty. Early = the first 20 min; only inversions whose earlier flight is ≥ 600 s from landing. |
| T2 | Are predicted and actual losses of separation between pairs that were out of order in the 20 min before? |
| T3 | Does an **order-first override** help? Among the policy's 4 most likely actions, take the one leaving the fewest predicted inversions (ties keep the policy's choice; never trade into an immediate loss of separation). Paired against the plain deterministic policy. |

## Results

**T0: inversions are mostly inherited, and the rest come from clearances.** 63–70% of inversion
episodes are present when both flights first come under control. Of those that arise later,
**100%** arise on a step that issued a clearance (71–75% of all steps issue one). 4–6% are still
unresolved at the end of the episode.

**T1: early order does not predict success on the same scenario.**

| | `1_38` | `1_37` | `1_35` |
|---|---|---|---|
| seeds with both solving and failing attempts | 49 | 31 | 24 |
| solving attempt has fewer early inversions | 47% (p = 0.78) | 55% (p = 0.72) | 54% (p = 0.84) |
| within-seed correlation, early inversions vs on-time rate | r = +0.11 | r = +0.16 | r = −0.00 |

If anything the correlation has the "wrong" sign: attempts with more early inversions are slightly
*more* on time.

**T2: predicted conflicts are only mildly associated with order; actual losses strongly.**

| | `1_38` | `1_37` | `1_35` |
|---|---|---|---|
| predicted losses: pair out of order before, vs base rate | 39% vs 29.6% (1.3×) | 37% vs 23.7% (1.5×) | 37% vs 23.1% (1.6×) |
| predicted losses between AMAN neighbours | 50% | 56% | 56% |
| **actual** losses: pair out of order in the 20 min before | **85%** of 61 pairs | 61% of 57 | 59% of 81 |
| actual losses: out of order already at entry / put out of order later | 36% / 51% | 40% / 23% | 33% / 26% |
| actual losses: first predicted, median minutes before | 16.5 | 22.5 | 19.1 |

Every actual loss was predicted beforehand (none unpredicted).

**T3: forcing order first hurts.** The override fires on 22–37 decisions per episode.

| override (threshold 0 s) vs plain | `1_38` | `1_37` | `1_35` |
|---|---|---|---|
| solved | 63 → 51 (+2 / −14, **z −3.00**) | 34 → 22 (+2 / −14, **z −3.00**) | 24 → 17 (+5 / −12, z −1.70) |
| hard-solved | 24 → 21 (n.s.) | 1 → 4 (n.s.) | 0 → 1 (n.s.) |
| separation lost | 3 → 8 (+5 / −0, **z +2.24**) | 4 → 12 (**z +2.31**) | 8 → 11 (n.s.) |
| flights on time | **−0.052** (SE 0.013) | **−0.104** (SE 0.015) | **−0.083** (SE 0.013) |

With the threshold at 600 s (only inversions still far from landing) the picture is the same.

## What it means

- The policy's own ordering is not the bottleneck, and overriding it with a greedy order rule
  trades away both precision and safety.
- For `1_38` in particular, most actual losses of separation involve a pair it put out of order
  after entry (51%), and it saw each one coming a median 16.5 min ahead. The remaining losses are
  a control problem on pairs the agent can see, not a perception problem.
- This closes Phase 0 of the "order first" idea. See the [roadmap](../roadmap.md).
