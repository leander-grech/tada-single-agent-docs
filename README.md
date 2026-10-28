# TADA single-agent docs

The public docs of the TADA single-agent RL project (mkdocs-material, Glass Cockpit theme).

## Layout

| path | what |
|---|---|
| `models.yaml` | the model registry: lineage, what changed, checkpoint, evaluation files, credited renders |
| `tools/build_model_docs.py` | builds every page that carries model numbers from the registry and the code repo's evaluation files |
| `docs/models/`, `docs/renders.md`, `docs/backfill.md`, `BACKFILL.md` | **generated**; do not edit |
| `<!-- gen:… --><!-- /gen -->` blocks in `docs/**/*.md` | generated content inside hand-written pages (`best-box`, `compare`, `render`) |
| everything else in `docs/` | hand-written |
| `render-meta/<batch>/` | renders made on this machine: the script, each video's `_solutions.json` and log (the videos themselves go to `docs/assets/renders/`) |
| `docs/stylesheets/theme.css`, `tada-components.css`, `docs/javascripts/tada.js` | theme tokens, components, sortable tables |
| `lab/`, `docs/lab.md`, `docs/javascripts/lab.js`, `docs/stylesheets/lab.css` | the TADA Lab: scenario generator, agent picker, live flights and cached renders |

## Adding a model or an evaluation

1. Add or edit the model's entry in `models.yaml` (paths are relative to the code repo).
2. `python tools/build_model_docs.py` (`--code-repo PATH` or `TADA_CODE_REPO` if the code repo is
   not at the registry's default). It reads the code repo and never writes to it.
3. `mkdocs build --strict`, then look at the result with `mkdocs serve --livereload`.

The build refuses to run if a video in `docs/assets/renders/` is not registered, if a render lacks
the metadata its caption needs (a `*_solutions.json`, or a filename that names model and
checkpoint), or if a hand-written page embeds a `<video>` directly. `--check` fails if any
generated file is stale. The champion rule lives in `models.yaml` under `champion`.

## Backfill

When evaluations or renders from `BACKFILL.md` land in the code repo, run
`python tools/import_backfill.py` then the generator. The importer copies the renders into
`docs/assets/renders/` and writes `models.backfill.yaml`, which the generator merges into the
registry (evaluations only where a model has none for that battery).

## Publishing

Manual, and only after review: `git push origin main`, then `mkdocs gh-deploy --force`.

## TADA Lab

The Lab tab replaces the render gallery: pick scenario parameters (procedure, generator, flights, stitched
segments, seed or a curated-seed difficulty), pick an agent and a mode (deterministic policy, best of K sampled,
policy + rollout search), and fly it. Flights run live through the code repo on the viewer's machine, through the
lab runner. Viewer-facing setup instructions are on the Lab page itself ("Run the Lab on your machine"):

```bash
lab/setup.sh /path/to/monorepo/reinforcement_learning/single_agent_rllib   # once: lab/.venv (uv if present), checks
lab/run.sh            # runner on 127.0.0.1:8800; --check only checks; --open opens the published Lab page
```

The Lab page looks for a runner by itself (a runner URL saved in the page, then the server that served the page, then
`http://localhost:8800`, then `http://127.0.0.1:8800`), so the **published** page works with a runner on the
viewer's own machine: browsers treat `http://localhost` as a secure origin, and the runner answers CORS and Chrome's
private-network preflight for `https://leander-grech.github.io` and localhost pages only (`--allow-origin` adds
others); POSTs must be JSON from an allowed origin. From the https page only localhost is reachable; to use a runner
on another machine, serve the page from it: `lab/run.sh --build --host 0.0.0.0`, then open `http://<host>:8800/lab/`.
`--build` runs `mkdocs build` first; the server serves `site/` (if built), the job API and `lab/cache/` (flights as
JSON, renders as MP4, gitignored).

Chrome (Local Network Access) asks before an https page may reach `localhost`; embedded browsers may refuse silently,
and then the requests never reach the runner. The Lab page says so when it finds no runner and links to
`http://localhost:8800/lab/`: the runner serves the whole docs site itself (`lab/run.sh` builds `site/` on first start),
and that page needs no permission. Each job is one `lab/worker.py` process with the agent's
environment variables from its `run_meta.json`; episodes are flown exactly as `analysis/score_windowed.py` scores
them, and a render replays the flight's executed actions and refuses to write a video if the replay diverges.
Agents come from `models.yaml` (windowed track, checkpoint present; point-merge runs before the v2pms action set
are left out). Renders made before the lab stay in the render archive (`renders.md`, under Archive).

### Public agents and downloads

The paper agents (1_76 TMB, 1_77 PMS) are published as bundles on the GitHub release
[`paper-agents-v1`](https://github.com/leander-grech/tada-single-agent-docs/releases/tag/paper-agents-v1); `lab/registry.json`
lists each bundle's URL, size and sha256. A runner lists registry agents it does not have with a **Download** button:
only when that button is pressed does the runner (never the browser) fetch the bundle, check the hash and unpack it
into `~/.cache/tada-lab/models/<id>/` (`TADA_LAB_MODELS` overrides). Agents whose checkpoints are already in the code
repo's `experiments/` need no download. To publish more agents: `python lab/make_agent_bundles.py OUT_DIR <ids>` (it
rewrites `lab/registry.json`), upload `OUT_DIR/*.zip` to a release, commit the registry. `lab/run.sh --registry-only`
shows what a machine without `experiments/` sees.
