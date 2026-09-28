# The policy network

!!! abstract "Summary"
    One network, 196 384 parameters, run once per decision. It encodes each aircraft slot
    separately (its scalars, its flight plan and its recent clearances), lets the slots attend to
    each other, and pools them into a context for the whole state. Four small heads read that:
    an **aircraft** head scores every slot, a **clearance** head scores every clearance for every
    slot, an **again** head scores every (slot, clearance) pair for reselection, and a **value**
    head estimates the return for PPO. An action is sampled in that order, each stage masked to
    what is legal, and the log-probability and entropy are those of the whole three-stage tree.
    Weights are shared across slots, so the policy is indifferent to slot order and the same
    network serves 10 aircraft or a stream of any length.

Source: `network/rlm.py` (`ATCEncoder`, `AircraftSelfAttention`, `ATCAutoregressiveNetwork`),
`network/autoregressive_policy.py` (`ATCAutoregressivePolicy`), `config/config.py`. Parameter
counts from the `1_38` checkpoint.

<!-- gen:figure file=diagrams/policy.svg -->
<figure class="tada-fig-wrap"><svg class="tada-dg" viewBox="0 0 760 640" role="img" aria-label="Policy network: per-aircraft encoders, self-attention, pooled context, four heads">
<defs>
  <marker id="pa" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L8,4 L0,8 z"/></marker>
</defs>
<!-- regions -->
<rect class="box muted" x="8" y="8" width="548" height="430" rx="6"/>
<text class="h" x="18" y="26">per aircraft slot · ×10 · shared weights</text>
<rect class="box muted" x="568" y="8" width="184" height="430" rx="6"/>
<text class="h" x="578" y="26">per state</text>

<!-- inputs -->
<rect class="box in fill-in" x="20" y="38" width="164" height="46" rx="4"/>
<text class="t b" x="30" y="57">scalars</text><text class="s" x="30" y="74">17 features</text>
<rect class="box in fill-in" x="200" y="38" width="164" height="46" rx="4"/>
<text class="t b" x="210" y="57">flight plan</text><text class="s" x="210" y="74">20 waypoints × 11</text>
<rect class="box in fill-in" x="380" y="38" width="164" height="46" rx="4"/>
<text class="t b" x="390" y="57">action history</text><text class="s" x="390" y="74">last 8 × (1 + 15)</text>
<rect class="box in fill-in" x="580" y="38" width="160" height="46" rx="4"/>
<text class="t b" x="590" y="57">global</text><text class="s" x="590" y="74">4 features</text>

<!-- encoders -->
<rect class="box enc" x="20" y="108" width="164" height="58" rx="4"/>
<text class="t" x="30" y="127">Linear 17→128</text><text class="s" x="30" y="143">LayerNorm · ReLU</text><text class="s" x="30" y="158">2.6k params</text>
<rect class="box enc" x="200" y="108" width="164" height="58" rx="4"/>
<text class="t" x="210" y="127">Conv1d ×2 (64, k=3)</text><text class="s" x="210" y="143">mean over waypoints → 64</text><text class="s" x="210" y="158">18.7k params</text>
<rect class="box enc" x="380" y="108" width="164" height="58" rx="4"/>
<text class="t" x="390" y="127">GRU → 64</text><text class="s" x="390" y="143">last hidden state</text><text class="s" x="390" y="158">15.7k params</text>
<rect class="box enc" x="580" y="108" width="160" height="58" rx="4"/>
<text class="t" x="590" y="127">Linear 4→128</text><text class="s" x="590" y="143">ReLU</text><text class="s" x="590" y="158">0.6k params</text>
<g class="e"><path class="e" d="M102,84 V106" marker-end="url(#pa)"/><path class="e" d="M282,84 V106" marker-end="url(#pa)"/><path class="e" d="M462,84 V106" marker-end="url(#pa)"/><path class="e" d="M660,84 V106" marker-end="url(#pa)"/></g>

<!-- fuse -->
<rect class="box enc" x="20" y="190" width="524" height="44" rx="4"/>
<text class="t" x="30" y="209">concat 128 + 64 + 64 = 256 → Linear 256→128 · LayerNorm · ReLU</text>
<text class="s" x="30" y="225">per-aircraft embedding eᵢ (128) · 33.2k params</text>
<path class="e" d="M102,166 V188" marker-end="url(#pa)"/><path class="e" d="M282,166 V188" marker-end="url(#pa)"/><path class="e" d="M462,166 V188" marker-end="url(#pa)"/>

<!-- attention -->
<rect class="box enc fill-enc" x="20" y="258" width="524" height="56" rx="4"/>
<text class="t b" x="30" y="277">masked self-attention over the 10 slots</text>
<text class="s" x="30" y="293">4 heads · q, k, v 128→64 · residual + LayerNorm · empty slots masked as keys</text>
<text class="s" x="30" y="307">output projection starts at zero: an exact no-op at step 0 · 33.2k params</text>
<path class="e" d="M282,234 V256" marker-end="url(#pa)"/>

<!-- pool and per-slot input -->
<rect class="box enc" x="300" y="338" width="244" height="40" rx="4"/>
<text class="t" x="310" y="356">masked mean over slots</text><text class="s" x="310" y="371">pooled fleet summary · 128</text>
<rect class="box" x="20" y="338" width="264" height="40" rx="4"/>
<text class="t" x="30" y="356">e′ᵢ, after attention</text><text class="s" x="30" y="371">128 per slot, pairwise-aware</text>
<path class="e" d="M150,314 V336" marker-end="url(#pa)"/><path class="e" d="M420,314 V336" marker-end="url(#pa)"/>

<!-- context -->
<rect class="box" x="300" y="398" width="440" height="30" rx="4"/>
<text class="t" x="310" y="418">context c = [pooled 128 ‖ global 128] = 256</text>
<path class="e" d="M420,378 V396" marker-end="url(#pa)"/><path class="e" d="M660,166 V396" marker-end="url(#pa)"/>

<rect class="box" x="20" y="398" width="264" height="30" rx="4"/>
<text class="t" x="30" y="418">head input per slot [e′ᵢ ‖ c] = 384</text>
<path class="e" d="M150,378 V396" marker-end="url(#pa)"/><path class="e dash" d="M300,413 H286" marker-end="url(#pa)"/>

<!-- heads -->
<rect class="box head fill-head" x="20" y="472" width="170" height="70" rx="4"/>
<text class="t b" x="30" y="491">aircraft</text><text class="s" x="30" y="507">384→64→1 per slot</text><text class="s" x="30" y="521">softmax over slots</text><text class="s" x="30" y="535">24.7k params</text>
<rect class="box head fill-head" x="200" y="472" width="170" height="70" rx="4"/>
<text class="t b" x="210" y="491">clearance</text><text class="s" x="210" y="507">384→64→15 per slot</text><text class="s" x="210" y="521">row of the chosen slot</text><text class="s" x="210" y="535">25.6k params</text>
<rect class="box head fill-head" x="380" y="472" width="170" height="70" rx="4"/>
<text class="t b" x="390" y="491">again (reselection)</text><text class="s" x="390" y="507">384→64→15 per slot</text><text class="s" x="390" y="521">Bernoulli at (slot, clr)</text><text class="s" x="390" y="535">25.6k params</text>
<rect class="box env fill-env" x="580" y="472" width="160" height="70" rx="4"/>
<text class="t b" x="590" y="491">value V(s)</text><text class="s" x="590" y="507">256→64→1</text><text class="s" x="590" y="521">reads c only</text><text class="s" x="590" y="535">16.5k params</text>
<path class="e" d="M105,428 V470" marker-end="url(#pa)"/><path class="e" d="M150,428 V448 H285 V470" marker-end="url(#pa)"/><path class="e" d="M200,428 V440 H465 V470" marker-end="url(#pa)"/><path class="e" d="M660,428 V470" marker-end="url(#pa)"/>

<!-- outputs -->
<text class="s" x="20" y="566">masked by mask_select</text>
<text class="s" x="200" y="566">masked by mask_action_per_ac</text>
<text class="s" x="380" y="566">masked by mask_again; never</text>
<text class="s" x="380" y="580">after DO_NOTHING</text>
<text class="s" x="580" y="566">critic for GAE; lookahead</text>
<text class="t" x="20" y="616">196 384 parameters in all (checkpoint of 1_38) · every head: Linear → 64 · ReLU → out · ~6 ms per decision on one CPU core</text>
</svg>
</figure>
<!-- /gen -->

## Encoding one aircraft

Every slot goes through the same three encoders, whatever flight it holds:

| input | shape | encoder | out |
|---|---|---|---|
| [scalars](observations.md) | 17 | Linear 17→128, LayerNorm, ReLU | 128 |
| flight plan | 20 waypoints × 11 | two Conv1d (64 channels, kernel 3, ReLU) along the route, masked mean over real waypoints, Linear 64→64, ReLU | 64 |
| action history | 8 × 16 | GRU, hidden 64; its last hidden state | 64 |

The three are concatenated (256) and fused by Linear 256→128, LayerNorm and ReLU into the
aircraft's embedding **eᵢ**. The flight-plan CNN reads the remaining route as a sequence of
waypoints (so the shape of the route ahead, trombone legs included, is visible to it). The GRU
summarises what the agent has already told this aircraft; it is the part of the encoder with the
least effective width ([network capacity](../archive/ten-aircraft-tests.md#embedding-capacity)).

## Letting aircraft see each other

A separation problem is about pairs: *these two* are converging. A mean over ten embeddings cannot
express that, so from `1_29` on, one **masked multi-head self-attention** block runs over the
slots before anything is pooled:

- 4 heads; queries, keys and values are low-rank projections 128→64 (16 per head);
- empty slots are masked as keys, so nothing attends to a slot with no aircraft;
- a residual connection and LayerNorm: **e′ᵢ = LayerNorm(eᵢ + W_out · attention)**;
- **W_out starts at zero**, so at initialisation the block is an exact no-op and a warm-started
  network computes precisely what it computed before; attention has to be learned;
- it is permutation-equivariant: reordering the slots reorders the outputs identically, which
  the [slot-ordering test](../archive/ten-aircraft-tests.md) checks.

It costs 33k parameters. Before it, the pooled context used 3–4% of its width and the aircraft
embeddings sat at a mean cosine of 0.70
([network capacity](../archive/ten-aircraft-tests.md#embedding-capacity)).

## The context

The attended embeddings e′ᵢ are averaged over valid slots (128) and concatenated with the
encoded global features (4→128), giving the state's **context c** (256). The context is the only
thing the value head sees; the policy heads see it *next to* each aircraft.

## The heads

Each head is Linear → 64 → ReLU → output, applied with shared weights.

| head | input | output | read as | init of the last layer |
|---|---|---|---|---|
| aircraft | [e′ᵢ ‖ c] = 384, per slot | 1 per slot | softmax over the 10 slots | gain 0.01: near uniform |
| clearance | [e′ᵢ ‖ c], per slot | 15 per slot | softmax over the chosen slot's row | gain 0.01 |
| again | [e′ᵢ ‖ c], per slot | 15 per slot | sigmoid at (chosen slot, chosen clearance) | weights 0, bias −3: every flag starts at 4.7% |
| value | c = 256 | 1 | V(s), the critic | gain 1 |

The clearance and again heads compute an output for **every** slot, not only the chosen one.
That costs little (10 slots) and lets the entropy be computed exactly (below).

## Sampling an action, with masks { #sampling }

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

1. **Aircraft.** Logits of slots that may not be picked are set to −10⁸ before the softmax:
   pending flights, empty slots, and with reselection any aircraft already cleared at this step
   (`mask_select`). If no flight is under control, any visible slot may be picked, so no row is
   ever all-masked.
2. **Clearance.** The clearance head's row for the chosen slot, masked by `mask_action_per_ac`
   (geometry, route constraints, what the aircraft can still do). `DO_NOTHING` is always legal.
3. **Again.** With reselection, the again head's logit at (aircraft, clearance) gives a
   Bernoulli. It is forced to 0 when the budget is spent or no other aircraft could be picked
   (`mask_again`), and after `DO_NOTHING`, which always ends the step.

Deterministic play takes the argmax at each stage (again = 1 if its logit is positive). The
action's log-probability is the sum of the three stages' log-probabilities, as PPO needs.

**Exact entropy.** PPO's entropy bonus uses the entropy of the whole tree, not of the sampled
branch:

H = H(aircraft) + Σₐ p(a) · [ H(clearance | a) + Σ_c p(c | a) · H(again | a, c) ]

It depends only on the observation, so the same value is computed when acting and when training.
A masked stage contributes nothing.

Masks are read from the observation itself, so the policy runs on stock SB3 `PPO` (and on the JAX
learner, which computes the same function to 2·10⁻⁵). SB3's MaskablePPO takes one flat mask and
cannot express a clearance mask that depends on the aircraft just sampled.

## Warm starts that preserve the function

Every change to the input or the heads was made so a trained policy could carry on unchanged:

- **New input columns** (the 4 sequence features in `1_33`, the "cleared at this step" flag in
  `1_36`) widen the first layer's weight matrix; the old columns are copied and the new ones are
  zeroed. The network ignores the new inputs until training gives them weight.
- **The again head** (`1_36`) is added fresh; with zero output weights and bias −3, every flag is
  4.7% likely, and again = 0 reproduces the one-pick policy.
- **Attention** (`1_29`) starts as an identity (above).

So `1_33` started out computing exactly `1_32`'s function (difference 0.0 over 60 states), and
`1_36` exactly `1_35`'s on a step's first pick. Anything else that does not match, such as a
checkpoint from the other clearance set, raises an error instead of training from a half-loaded
network.

## Parameters

| component | parameters |
|---|---|
| scalar encoder | 2 560 |
| flight-plan CNN | 18 688 |
| action-history GRU | 15 744 |
| fusion (Linear + LayerNorm) | 33 152 |
| self-attention | 33 152 |
| global encoder | 640 |
| aircraft head | 24 705 |
| clearance head | 25 615 |
| again head | 25 615 |
| value head | 16 513 |
| **total** | **196 384** |

A single forward pass takes ~6 ms on one CPU core, small next to the 23 ms the simulator's
prediction rollout takes per step ([Compute](../training/compute.md#profile)).

## What it does not see

- **Aircraft beyond the window.** Flights more than 10 places back in the queue, about 3% of steps.
- **Time in the action history.** Rows are ordered but not timestamped
  ([roadmap](../roadmap.md)).
- **The future beyond the do-nothing prediction.** Every predicted feature assumes no further
  clearances; the lookahead's value comes from trying candidates for real
  ([Search at inference](../findings/lookahead.md)).
