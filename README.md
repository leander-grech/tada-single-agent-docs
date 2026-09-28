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
