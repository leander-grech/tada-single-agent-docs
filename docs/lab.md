---
hide:
  - navigation
  - toc
---

# TADA Lab

Generate a scenario, pick an agent, fly it. Every flight runs the real simulator and the agent's own checkpoint,
scored exactly as the paper scores it (scenario and observation frame pinned by the seed), so a curated seed on the
MONAD-aligned generator reproduces the paper's episode. The replay is instant; the MP4 render is drawn in the
background and cached. Flights run on your own machine through the lab runner (`lab/run.sh` in the docs repo), which
this page finds by itself. Renders made before the lab are in the [render archive](renders.md).

<div id="lab-app" class="tada-lab" data-runners="http://localhost:8800 http://127.0.0.1:8800">
  <noscript>The lab needs JavaScript.</noscript>
</div>
