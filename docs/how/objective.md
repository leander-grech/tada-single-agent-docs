# Objective & reward

!!! abstract "Summary"
    Since `1_34` the reward is the objective itself, in lexicographic order. A loss of separation
    costs 90 and ends the stream. Each flight earns a deviation-bracket reward once, at touchdown.
    Each real clearance costs 0.006 and `DO_NOTHING` is free. The scales make the order strict: no
    amount of clearance saving can buy a worse bracket, and no bracket gain can pay for a loss of
    separation within one window. Everything else is potential-based shaping, which provably
    cannot change which policy is optimal. The shaping comes from the do-nothing prediction:
    brackets, conflicts, AMAN swaps, compression.

Source: `actions/rewards.py` (`REWARD_MODE = "outcome_pbrs"`, `main.py --reward-mode`).

## The objective

| criterion | reward |
|---|---|
| deviation bracket, per flight at touchdown | \|dev\| ≤ 60 s: **3** · ≤ 120 s: **1** · ≤ 300 s: **0** · ≤ 600 s: **−1.5** · beyond: **−3** |
| actions | **−0.006 per real clearance**; `DO_NOTHING` free; a pure count |
| safety | a loss of separation costs **90** and ends the stream |

**Why these scales enforce the order.**

- *Actions below brackets:* a clearance on every step of a ~160-step stream costs 0.96, less than
  the smallest gap between brackets (1.0). On stitched 2×20 streams the per-clearance cost is
  halved so the same holds.
- *Brackets below safety:* 90 exceeds moving a whole visible window of 10 flights from the best
  bracket to the worst (10 × 6).

**Why it replaced the earlier windowed reward.** `1_31`–`1_33` used a per-flight landing bonus plus
dense per-step deviation and conflict costs. Measured on `1_33`, the dense terms swamped the goal.
Per step: predicted deviation −0.47, predicted conflict −0.36, and landing bonuses net of losses
only +0.21. `DO_NOTHING` also cost as much as a real clearance, and the agent issued one on ~92% of
steps. After the change, `1_35` does nothing on 30% of steps (8% before) with better precision.

## Shaping

Everything beyond the objective is potential-based, F = γΦ(s′) − Φ(s), with Φ computed from the
do-nothing prediction:

- the brackets, smoothed with sigmoids so the gradient exists between bracket edges;
- predicted conflicts;
- predicted AMAN-order swaps;
- compression below the 90 s minimum landing spacing.

Ng, Harada & Russell (1999) showed this form is necessary and sufficient for policy invariance. The
discounted shaping sum telescopes to γᵀΦ_T − Φ_0; verified numerically to ~2·10⁻¹⁵. Φ is 0 at a
terminal state. The recipe's arm B ([Training](../training/index.md)) tests *flat* sequence and
conflict potentials instead of ones that ramp in as a flight approaches.

## Reselection and the discount { #reselection-discount }

A queued second pick pays its clearance cost plus the change in potential, and takes no simulated
time. The learner (`jax_ppo`) therefore discounts it by **1**, not γ, both in GAE and in the
truncation bootstrap; the env marks it with `info["zero_time"]`. Discounting it by γ would charge
every extra pick (1 − γ)·V(s′), a cost whose sign follows the value (a bonus whenever V is
negative), and that is not in the objective. With discount 1 a second clearance costs exactly one
clearance, and the shaping still telescopes: over random episodes with frequent extra picks
Σ Γₜ Fₜ = Γ_T Φ(s_T) − Φ(s₀) holds to 10⁻¹⁵, where discounting by γ leaves residuals of 0.06–0.29.

## Sizing the separation penalty

90 was sized to one window's bracket range (10 flights × 6). Training streams hold 40 flights, so
a policy precise enough could rationally accept some extra risk. `1_39` tested a penalty sized to
the training stream (240 = 40 × 6). The policy became more cautious everywhere, not only where
separation was at stake: precision fell and only long streams got safer. The default stayed at 90
([`1_39`](../models/1_39.md), [Findings → reselection](../findings/reselection.md)).

## Earlier rewards

The 10-aircraft env used a very different reward: dense deviation, conflict and action terms, a
five-tier success ladder delivered as potential-based shaping, and a horizon-aware violation
penalty. Its design, its measured defects (the tier potential was a staircase) and the fixes are
in [Archive → the 10-aircraft reward](../archive/ten-aircraft-reward.md).
