# Findings

What the experiments established, one short page each. Model scores live on the generated
[report cards](../models/index.md); these pages explain what the scores mean.

| finding | in one line |
|---|---|
| [Reselection](reselection.md) | Precision was bandwidth-limited: a second clearance per step roughly doubled solved streams; the safety cost trained away on 20-flight streams. |
| [Sequencing](sequencing.md) | Precision is lost where traffic must be reordered; showing the sequence did not help until the agent could act on two flights at once. |
| [Order first? (Phase 0)](order-first.md) | Establishing the AMAN order early does not predict success, and forcing it lowers precision for all 16 agents tested. |
| [Over-capacity scenarios](capacity.md) | Most losses of separation are in scenarios needing more delay than the airspace can absorb; 17 validation seeds have never been solved by anything. |
| [Long streams](long-streams.md) | On feasible 60- and 100-flight streams the champion's lineage, `1_43` and the hard-solved fine-tunes never lose separation, and precision does not drift; losses come from over-capacity waves, the norm in generated traffic. |
| [Search at inference](lookahead.md) | Critic-guided lookahead keeps both safety and precision only on the reselection policies; shields are net harmful. |
| [Point merge](point-merge.md) | Zero-shot, MXP agents keep their sequencing on the BGY point merge but lose separation on a quarter to half of streams. Trained on point merge, agents lose separation almost only on over-capacity seeds, and none on feasible 20-flight seeds for the from-scratch agent. |
| [Training from scratch](curriculum.md) | The full design learns from random weights; you get what you train on (a curriculum ending on 20-flight streams is best there, one ending on stitched streams safer on long ones); none reaches the fine-tuned champion. |
| [Evaluation noise](evaluation-noise.md) | In-training success rates, best-model picks, unpaired small differences and single bands have all misled; the protocol now avoids each. |

Findings from the 10-aircraft track are in the [Archive](../archive/index.md): the 22- vs
15-clearance comparison, the reward's staircase potential, network capacity, and the early runs.
