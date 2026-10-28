# Bare-bones inference

The published TADA single-agent policies, evaluated with **numpy only**: no torch, no Stable-Baselines3, no
TADA code. This is the policy half of a self-contained (eventually in-browser) lab. Flying an episode also
needs the simulator and the environment that builds observations, which are not part of this repository.

| file | what |
|---|---|
| `tada_policy.py` | torch-free checkpoint reader + the policy network and its masked, autoregressive action choice |
| `fetch_agent.py` | downloads a bundle listed in `lab/registry.json`, checks its sha256, unpacks to `~/.cache/tada-lab/models/<id>/` |
| `check_parity.py` | compares `tada_policy.py` with the torch policy on `fixtures/`: logits, value and action, decision by decision |
| `fixtures/*.npz` | real observations from one deterministic episode per paper agent, with the torch policy's outputs |
| `make_fixtures.py` | records new fixtures (needs the TADA code and its environment) |

```bash
python inference/fetch_agent.py 1_76          # explicit download, ~0.8 MB
python inference/check_parity.py              # fetches what it needs, then checks
```

```python
from tada_policy import Policy
pol = Policy.load("~/.cache/tada-lab/models/1_76")
act = pol.predict(obs)                 # Action(aircraft=slot, clearance=index, again=0|1)
out = pol.forward(obs)                 # masked logits (aircraft [A], clearance [A, C], again [A, C]) and value
```

`obs` is the windowed environment's observation dict for one decision (keys listed in `tada_policy.py`).
Verified 2026-10-28 on both paper agents: 312 of 312 deterministic actions identical to torch, logits within
2e-5, value within 3e-6, ~14 ms per forward pass in numpy on one core. The network has 196k parameters
(~5.5 M multiply-adds per decision for 10 aircraft).
