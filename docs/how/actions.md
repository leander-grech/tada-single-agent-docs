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

- **Speed** steps are −10/−20/−30 kt and +10/+20 kt (no +30), deliberately asymmetric (three
  slow-downs, two speed-ups). The TMB runs from `1_58` on add the MONAD airport overlay
  (`TADA_AIRPORT_MASK=monad`), which blocks −10 and +20 kt. Arrivals fly near their speed ceiling: six consecutive large speed-ups move the
  landing by −18 s, six large slow-downs by +339 s.
- **The trombone** lengthens or shortens by one level. The two are exact inverses and stack
  (capacity 4 levels); shortening never goes below the published route, so it only undoes the
  agent's own lengthening.
- **Turns** leave the route 40° off the target heading and resume route following after 10 NM,
  direct to the unchanged next waypoint. The rejoin is a timed command, so a clock step that issues
  a turn lasts about 150 s instead of 45 s. **Skips** cut waypoints; `VECTOR_TO_ILS` sends the
  aircraft to final.
- **Turn legality was mirrored (found 9 Oct 2026).** The command turns +40° for `TURN_LEFT`
  (mathematical heading, counter-clockwise) and −40° for `TURN_RIGHT`, but the mask tested
  `TURN_LEFT` on the −40° geometry and `TURN_RIGHT` on the +40° one. About 13% of TMB and 11% of PMS
  turn-legality decisions disagree with the turn actually flown. Every model to date trained with
  it. `TADA_TURN_MASK_FIX=1` tests the flown turn; it is off by default, recorded in `run_meta.json`
  (`turn_mask_fix`) and matched to a checkpoint when it is loaded, so old models replay unchanged.
  The first fine-tunes with the fix (`1_94`, `1_95`) ran on a faulty GPU host and are void. A clean
  fine-tune of `1_76` with the fix (`1_101`, 5M steps at stage-3 settings) performs the same: 66 vs 59
  solved on validation, 53 vs 59 on the test seeds, 119 vs 118 over both. The policy turns right about
  nine times per stream and left under once, so the mirrored legality barely mattered.

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

An action is sampled in three stages, each masked to what is legal at that point:

<!-- gen:figure file=diagrams/action.svg -->
<figure class="tada-fig-wrap"><svg class="tada-dg" viewBox="0 0 760 300" role="img" aria-label="Sampling one action: aircraft, then clearance conditioned on it, then the again flag">
<defs>
  <marker id="aa" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L8,4 L0,8 z"/></marker>
</defs>
<!-- stage 1 -->
<text class="h" x="16" y="22">1 · which aircraft</text>
<rect class="box head" x="10" y="32" width="230" height="182" rx="5"/>
<g>
  <!-- ten slot logits as bars; masked ones hollow -->
  <rect class="slot" x="24" y="120" width="16" height="40"/><rect class="slot" x="44" y="95" width="16" height="65"/>
  <rect class="slot off" x="64" y="150" width="16" height="10"/><rect class="slot" x="84" y="70" width="16" height="90"/>
  <rect class="slot" x="104" y="130" width="16" height="30"/><rect class="slot off" x="124" y="150" width="16" height="10"/>
  <rect class="slot off" x="144" y="150" width="16" height="10"/><rect class="slot" x="164" y="110" width="16" height="50"/>
  <rect class="slot off" x="184" y="150" width="16" height="10"/><rect class="slot off" x="204" y="150" width="16" height="10"/>
</g>
<text class="s" x="24" y="176">slots 0 … 9 (AMAN order)</text>
<text class="s" x="24" y="192">hollow = masked: pending / cleared</text>
<text class="t b c-head" x="84" y="62">a</text>

<!-- stage 2 -->
<text class="h" x="276" y="22">2 · which clearance, given a</text>
<rect class="box head" x="270" y="32" width="230" height="182" rx="5"/>
<g>
  <rect class="slot" x="282" y="100" width="11" height="60"/><rect class="slot" x="296" y="120" width="11" height="40"/>
  <rect class="slot" x="310" y="135" width="11" height="25"/><rect class="slot off" x="324" y="152" width="11" height="8"/>
  <rect class="slot" x="338" y="140" width="11" height="20"/><rect class="slot off" x="352" y="152" width="11" height="8"/>
  <rect class="slot" x="366" y="145" width="11" height="15"/><rect class="slot" x="380" y="148" width="11" height="12"/>
  <rect class="slot" x="394" y="70" width="11" height="90"/><rect class="slot off" x="408" y="152" width="11" height="8"/>
  <rect class="slot" x="422" y="138" width="11" height="22"/><rect class="slot off" x="436" y="152" width="11" height="8"/>
  <rect class="slot off" x="450" y="152" width="11" height="8"/><rect class="slot off" x="464" y="152" width="11" height="8"/>
  <rect class="slot" x="478" y="146" width="11" height="14"/>
</g>
<text class="s" x="282" y="176">15 clearances · row a of the head</text>
<text class="s" x="282" y="192">hollow = illegal for this aircraft</text>
<text class="t b c-head" x="390" y="62">c</text>
<text class="s" x="282" y="92">DO_NOTHING</text>

<!-- stage 3 -->
<text class="h" x="536" y="22">3 · ask again? (reselection)</text>
<rect class="box head" x="530" y="32" width="220" height="182" rx="5"/>
<rect class="slot" x="560" y="90" width="50" height="70"/><rect class="slot off" x="640" y="130" width="50" height="30"/>
<text class="s" x="560" y="176">again = 1 · again = 0</text>
<text class="s" x="544" y="192">Bernoulli at (a, c); 0 if no budget</text>
<text class="s" x="544" y="206">left or c = DO_NOTHING</text>

<path class="e" d="M240,117 H268" marker-end="url(#aa)"/>
<path class="e" d="M500,117 H528" marker-end="url(#aa)"/>

<!-- to env -->
<rect class="box env fill-env" x="10" y="232" width="740" height="52" rx="5"/>
<text class="t b" x="24" y="253">to the environment: (a, c, again)</text>
<text class="s" x="24" y="272">log π = log p(a) + log p(c | a) + log p(again | a, c) · entropy: exact, over the whole tree</text>
<path class="e" d="M640,214 V230" marker-end="url(#aa)"/>
</svg>
</figure>
<!-- /gen -->

## The policy network

A shared encoder turns each aircraft slot into an embedding, one self-attention block lets the
slots read each other, and four heads (aircraft, clearance, again, value) read the result. It has
196 384 parameters; the [policy page](policy.md) walks through every layer. Slot order is inert:
across 8 orderings on 25 scenarios the first action and the outcome were byte-identical.

## Reselection { #reselection }

With one clearance per 45 s, the agent cannot act on two flights that both need it now. In a
crowded stretch that is exactly the situation the failed seeds show.

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

In the example, flights 4 and 6 both need a clearance now. The first pick asks for another: its
clearance is queued and the do-nothing prediction re-run with it, so the second pick already sees
flight 4 slowed. The second pick spends the budget, both clearances fly together, and the clock
moves on. The flight numbers and clearances are illustrative.

- **Action:** (aircraft, clearance, **again**). With again = 1 the clearance is queued, the clock
  does not move, and the next observation's prediction includes every queued clearance. With
  again = 0 the queued clearances and this one are applied together and the clock advances 45 s
  (longer if a turn is among them), as in a one-pick step.
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
