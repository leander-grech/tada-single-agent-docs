---
hide:
  - navigation
  - toc
---

# TADA Lab

Generate a scenario, pick an agent, fly it. Every flight runs the real simulator and the agent's own checkpoint,
scored exactly as the paper scores it (scenario and observation frame pinned by the seed), so a curated seed on the
MONAD-aligned generator reproduces the paper's episode. The replay is instant; the MP4 render is drawn in the
background and cached. Flights run on your own machine: either right here in the browser (the simulator and the paper's
agents compiled to WebAssembly, nothing to install; it unlocks with an engine key from the TADA team), or through the lab runner (`lab/run.sh` in the docs repo), which
adds every agent, the legacy generator, search and MP4 renders; the page finds a running one by itself. Renders made
before the lab are in the [render archive](renders.md).

<div id="lab-app" class="tada-lab" data-runners="http://localhost:8800 http://127.0.0.1:8800" data-assets="../assets/lab/" data-worker="../javascripts/lab-worker.js">
  <noscript>The lab needs JavaScript.</noscript>
</div>

## Run the Lab on your machine { #run-the-lab }

Without a runner the Lab still works in the browser with an engine key (MONAD generator, the two paper agents, policy
and best-of-K). The key unlocks the published, encrypted simulator; keys are issued by hand by the TADA team.
For everything else, run the **lab runner**: a small local server that drives the simulator and every agent's
checkpoint. You start it once, and this page finds it by itself on `http://localhost:8800`.

**You need**

- Linux on x86-64. The simulator is a compiled wheel for that platform only. On Windows, WSL2 with Ubuntu
  should work but is untested; on macOS use a Linux machine or VM.
- [uv](https://docs.astral.sh/uv/) (`curl -LsSf https://astral.sh/uv/install.sh | sh`), which also fetches
  Python 3.12 for you. Without uv, setup uses a system Python 3.12 that has its `venv` module (on Ubuntu,
  `sudo apt install python3.12-venv`).
- Access to the TADA code repository, `tada-sesarju/monorepo`. It is private, so ask the TADA team for access.
  You need a checkout recent enough for the lab, with the single-agent paper code of late October 2026. The runner
  checks this when it starts and tells you if your checkout is too old.
- About 1.5 GB of disk space and a few minutes for the first setup. No GPU is needed.

**Set up once, then start the runner**

```bash
git clone https://github.com/leander-grech/tada-single-agent-docs.git
git clone git@github.com:tada-sesarju/monorepo.git          # private: needs access
cd tada-single-agent-docs
lab/setup.sh ../monorepo/reinforcement_learning/single_agent_rllib
lab/run.sh
```

`lab/setup.sh` creates a Python environment in `lab/.venv`. It holds CPU-only PyTorch, Stable-Baselines3, the
simulator wheel from the code repository, and mkdocs. Setup ends with a check of everything the runner needs.
After that, `lab/run.sh` is all you need to start the runner. Leave it running, then come back to this page:
it connects within a few seconds.

**First flight**

The paper's agents, 1_76 (trombone) and 1_77 (point merge), are public bundles on the
[`paper-agents-v1` release](https://github.com/leander-grech/tada-single-agent-docs/releases/tag/paper-agents-v1).
Press **Download** in the agent panel. The runner, not your browser, fetches the bundle (under 1 MB), checks it
against the published sha256 and installs it into `~/.cache/tada-lab/models/`. Then pick a scenario and press **Fly**.

**If something does not work**

- Run `lab/run.sh --check`. It lists what the runner needs and how to fix anything missing. If your code checkout
  has no MONAD-aligned generator, the runner says so and offers only the legacy generator, rather than
  silently generating different scenarios.
- If the runner is up but this page does not connect, your browser is probably keeping this https page away
  from `localhost`. Chrome asks first ("access other apps and services on this device"), and some browsers refuse
  silently. The runner serves this same Lab at
  [http://localhost:8800/lab/](http://localhost:8800/lab/), which needs no permission.
- To stop the runner, press Ctrl-C. Your flights and renders stay cached in `lab/cache/`, and downloaded agents
  stay in `~/.cache/tada-lab/models/`.
