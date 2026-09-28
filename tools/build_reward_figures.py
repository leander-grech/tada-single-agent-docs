#!/usr/bin/env python
"""Reward-mechanics figures for the docs, computed with the code repo's own reward functions.

    python tools/build_reward_figures.py [--code-repo PATH]

Imports (read-only) from the code repo:
    atc_env.windowed_env.landing_value / landing_value_smooth   the bracket objective and its smoothed potential
    utils.infringement_utils.pair_severity                      severity (the 3-5 NM band)
    config.Config, config.windowed_config.WindowedConfig        every constant
The conflict weight 2^(-ttc / half-life), floored, is the formula of actions.rewards.infringement_reward_from_world
(which needs a simulated world to call); its constants are read from Config.

Writes docs/assets/figures/<name>.svg. Pages include them with <!-- gen:figure file=figures/<name>.svg -->,
which inlines the SVG so it follows the light/dark theme (colours are CSS classes, not baked in).
"""
from __future__ import annotations

import argparse
import math
import os
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "assets" / "figures"


def esc(s) -> str:
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


# --------------------------------------------------------------------------------------- heatmap
def heatmap(name, title_x, title_y, xs, ys, f, *, diverging, vmax, xfmt, yfmt, xticks, yticks,
            guides=(), unit="", note="", w=640, h=300):
    """Cells coloured by f(x, y). Sequential: one hue, opacity ~ |v|/vmax. Diverging: two hues
    around a neutral 0. Equal-valued neighbours on a row are merged to keep the SVG small."""
    L, R, T, B = 58, 86, 14, 44
    pw, ph = w - L - R, h - T - B
    nx, ny = len(xs), len(ys)
    cw, ch = pw / nx, ph / ny
    levels = 16
    out = [f'<svg class="tada-fig tada-heat" viewBox="0 0 {w} {h}" role="img" aria-label="{esc(title_x)} by {esc(title_y)}">']
    for j, y in enumerate(ys):              # ys ascending, drawn bottom-up
        row = []
        for x in xs:
            v = f(x, y)
            q = 0 if v == 0 else max(1, min(levels, round(abs(v) / vmax * levels)))
            sign = "neg" if v < 0 else "pos"
            row.append((q, sign if diverging else "seq", v))
        i = 0
        yy = T + ph - (j + 1) * ch
        while i < nx:
            k = i
            while k + 1 < nx and row[k + 1][:2] == row[i][:2]:
                k += 1
            q, cls, v = row[i]
            if q:
                vals = [r[2] for r in row[i:k + 1]]
                tip = f"{title_y} {yfmt(y)}, {title_x} {xfmt(xs[i])}" + (f"–{xfmt(xs[k])}" if k > i else "")
                tip += f": {min(vals):.3g}" + (f" to {max(vals):.3g}" if max(vals) != min(vals) else "") + unit
                out.append(f'<rect class="cell {cls}" x="{L + i * cw:.1f}" y="{yy:.1f}" width="{(k - i + 1) * cw + 0.3:.1f}" '
                           f'height="{ch + 0.3:.1f}" fill-opacity="{q / levels:.3f}"><title>{esc(tip)}</title></rect>')
            i = k + 1
    X = lambda x: L + (x - xs[0]) / (xs[-1] - xs[0]) * pw
    Y = lambda y: T + ph - (y - ys[0]) / (ys[-1] - ys[0]) * ph
    for g in guides:  # ("x", value, label) / ("y", value, label)
        axis, val, lab = g
        if axis == "x":
            out.append(f'<line class="guide" x1="{X(val):.1f}" x2="{X(val):.1f}" y1="{T}" y2="{T + ph}"/>'
                       f'<text class="glabel" x="{X(val) + 3:.1f}" y="{T + 10}">{esc(lab)}</text>')
        else:
            out.append(f'<line class="guide" x1="{L}" x2="{L + pw}" y1="{Y(val):.1f}" y2="{Y(val):.1f}"/>'
                       f'<text class="glabel" x="{L + pw - 3}" y="{Y(val) - 3:.1f}" text-anchor="end">{esc(lab)}</text>')
    out.append(f'<rect class="frame" x="{L}" y="{T}" width="{pw}" height="{ph}"/>')
    for t in xticks:
        out.append(f'<text class="tick" x="{X(t):.1f}" y="{T + ph + 14}" text-anchor="middle">{xfmt(t)}</text>')
    for t in yticks:
        out.append(f'<text class="tick" x="{L - 6}" y="{Y(t) + 3:.1f}" text-anchor="end">{yfmt(t)}</text>')
    out.append(f'<text class="axis" x="{L + pw / 2}" y="{h - 6}" text-anchor="middle">{esc(title_x)}</text>')
    out.append(f'<text class="axis" transform="translate(14 {T + ph / 2}) rotate(-90)" text-anchor="middle">{esc(title_y)}</text>')
    # colour key
    kx, ky, kh = L + pw + 22, T, ph
    steps = 8
    for s in range(steps):
        frac = 1 - s / (steps - 1)
        if diverging:
            v = vmax * (2 * frac - 1)
            cls, op = ("pos" if v > 0 else "neg"), abs(2 * frac - 1)
        else:
            v, cls, op = vmax * frac, "seq", frac
        out.append(f'<rect class="cell {cls}" x="{kx}" y="{ky + s * kh / steps:.1f}" width="14" height="{kh / steps + 0.3:.1f}" fill-opacity="{op:.3f}"/>')
    out.append(f'<rect class="frame" x="{kx}" y="{ky}" width="14" height="{kh}"/>')
    top = f"+{vmax:g}" if diverging else f"{vmax:g}"
    out.append(f'<text class="tick" x="{kx + 18}" y="{ky + 8}">{top}</text>')
    if diverging:
        out.append(f'<text class="tick" x="{kx + 18}" y="{ky + kh / 2 + 3:.1f}">0</text>')
        out.append(f'<text class="tick" x="{kx + 18}" y="{ky + kh}">−{vmax:g}</text>')
    else:
        out.append(f'<text class="tick" x="{kx + 18}" y="{ky + kh}">0</text>')
    out.append("</svg>")
    (OUT / f"{name}.svg").write_text("".join(out))


# ------------------------------------------------------------------------------------ line chart
def lines(name, title_x, title_y, xs, series, *, xfmt, yfmt, xticks, yticks, ymin, ymax, guides=(), w=640, h=260):
    L, R, T, B = 52, 150, 14, 44
    pw, ph = w - L - R, h - T - B
    X = lambda x: L + (x - xs[0]) / (xs[-1] - xs[0]) * pw
    Y = lambda y: T + ph - (y - ymin) / (ymax - ymin) * ph
    out = [f'<svg class="tada-fig tada-lines" viewBox="0 0 {w} {h}" role="img" aria-label="{esc(title_y)} against {esc(title_x)}">']
    for t in yticks:
        out.append(f'<line class="grid" x1="{L}" x2="{L + pw}" y1="{Y(t):.1f}" y2="{Y(t):.1f}"/>'
                   f'<text class="tick" x="{L - 6}" y="{Y(t) + 3:.1f}" text-anchor="end">{yfmt(t)}</text>')
    for t in xticks:
        out.append(f'<text class="tick" x="{X(t):.1f}" y="{T + ph + 14}" text-anchor="middle">{xfmt(t)}</text>')
    for axis, val, lab in guides:
        out.append(f'<line class="guide" x1="{X(val):.1f}" x2="{X(val):.1f}" y1="{T}" y2="{T + ph}"/>'
                   f'<text class="glabel" x="{X(val) + 3:.1f}" y="{T + 10}">{esc(lab)}</text>')
    labels = []
    for sname, cls, dash, ys in series:
        d = " ".join(f"{'M' if i == 0 else 'L'}{X(x):.1f},{Y(y):.1f}" for i, (x, y) in enumerate(zip(xs, ys)))
        out.append(f'<path class="line {cls}" d="{d}" stroke-dasharray="{dash}"><title>{esc(sname)}</title></path>')
        labels.append([Y(ys[-1]), sname, cls])
    labels.sort()
    for i in range(1, len(labels)):
        if labels[i][0] - labels[i - 1][0] < 13:
            labels[i][0] = labels[i - 1][0] + 13
    for y, sname, cls in labels:
        out.append(f'<text class="dlabel {cls}" x="{L + pw + 8}" y="{y + 4:.1f}">{esc(sname)}</text>')
    out.append(f'<text class="axis" x="{L + pw / 2}" y="{h - 6}" text-anchor="middle">{esc(title_x)}</text>')
    out.append(f'<text class="axis" transform="translate(12 {T + ph / 2}) rotate(-90)" text-anchor="middle">{esc(title_y)}</text>')
    out.append("</svg>")
    (OUT / f"{name}.svg").write_text("".join(out))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--code-repo", default=os.environ.get("TADA_CODE_REPO"))
    args = ap.parse_args()
    code = Path(args.code_repo or yaml.safe_load(open(ROOT / "models.yaml"))["code_repo"])
    sys.path.insert(0, str(code))
    os.chdir(code)  # the config package resolves some paths relative to the repo
    from config.config import Config
    from config.windowed_config import WindowedConfig as WC
    from atc_env.windowed_env import landing_value, landing_value_smooth
    from utils.infringement_utils import pair_severity
    OUT.mkdir(parents=True, exist_ok=True)

    brackets = WC.LANDING_BRACKETS
    ramp = float(WC.DEVIATION_RAMP_S)
    w_prox = lambda t_to_land: 1.0 - min(1.0, max(0.0, t_to_land) / ramp)

    # 1. The objective per flight (a step function) and the smoothed version used inside Phi_dev.
    devs = [i * 2.0 for i in range(0, 351)]
    lines("bracket_objective", "landing deviation |dev| (s)", "value per flight", devs,
          [("objective (paid at touchdown)", "s-obj", "", [landing_value(d, brackets) for d in devs]),
           ("smoothed, inside Φ_dev", "s-pot", "5 4", [landing_value_smooth(d, brackets) for d in devs])],
          xfmt=lambda v: f"{v:g}", yfmt=lambda v: f"{v:+g}" if v else "0",
          xticks=[0, 60, 120, 300, 600, 700], yticks=[-3, -1.5, 0, 1, 3], ymin=-3.4, ymax=3.4,
          guides=[("x", 60, "60 s"), ("x", 120, "120 s"), ("x", 300, "300 s"), ("x", 600, "600 s")])

    # 2. One flight's contribution to Phi_dev: proximity ramp x smoothed bracket value.
    xs = [i * 10.0 for i in range(0, 71)]            # |predicted dev| 0..700 s
    ys = [i * 60.0 for i in range(0, 61)]            # time to predicted landing 0..3600 s
    heatmap("phi_dev", "predicted landing deviation (s)", "time to landing (s)", xs, ys,
            lambda d, t: w_prox(t) * landing_value_smooth(d, brackets), diverging=True, vmax=3.0,
            xfmt=lambda v: f"{v:g}", yfmt=lambda v: f"{v:g}", xticks=[0, 60, 120, 300, 600],
            yticks=[0, 600, 1200, 1800, 2400, 2880, 3600],
            guides=[("x", 60, "60"), ("x", 120, "120"), ("x", 300, "300"), ("x", 600, "600"),
                    ("y", ramp, f"ramp starts ({ramp:g} s)")])

    # 3. Severity over horizontal x vertical separation (Config's band and shape).
    hs = [i * 0.1 for i in range(0, 71)]             # 0..7 NM
    vs = [i * 20.0 for i in range(0, 76)]            # 0..1500 ft
    sev = pair_severity
    heatmap("severity", "horizontal separation (NM)", "vertical separation (ft)", hs, vs, sev,
            diverging=False, vmax=1.0, xfmt=lambda v: f"{v:g}", yfmt=lambda v: f"{v:g}",
            xticks=[0, 1, 2, 3, 4, 5, 6, 7], yticks=[0, 500, 1000, 1500],
            guides=[("x", Config.SEVERITY_CONFLICT_NM, "3 NM"), ("x", Config.SEVERITY_SAFEZONE_NM, "5 NM"),
                    ("y", Config.VERTICAL_CONFLICT_RADIUS_FT, "500 ft"), ("y", Config.VERTICAL_SAFEZONE_RADIUS_FT, "1000 ft")])

    # 4. One predicted conflict's contribution to Phi_conf: -weight x severity x imminence (co-altitude pair).
    half, floor, wgt = float(Config.CONFLICT_HALF_LIFE_S), float(Config.CONFLICT_FAR_FLOOR), float(WC.PHI_CONFLICT_WEIGHT)
    ttcs = [i * 30.0 for i in range(0, 61)]          # 0..1800 s
    heatmap("phi_conf", "predicted horizontal separation at closest approach (NM), same altitude", "time to the predicted conflict (s)",
            hs, ttcs, lambda hh, t: -wgt * sev(hh, 0.0) * max(floor, 2 ** (-t / half)),
            diverging=True, vmax=wgt, xfmt=lambda v: f"{v:g}", yfmt=lambda v: f"{v:g}",
            xticks=[0, 1, 2, 3, 4, 5, 6, 7], yticks=[0, 240, 480, 900, 1200, 1800],
            guides=[("x", 3.0, "3 NM"), ("x", 5.0, "5 NM"), ("y", half, f"half-life {half:g} s"), ("y", 2 * half, "")])

    # 5. One AMAN-consecutive pair's contribution to Phi_gap: compression below the minimum spacing.
    gmin, per_min = float(WC.PHI_GAP_MIN_S), float(WC.PHI_GAP_PER_MIN)
    gaps = [i * 2.0 for i in range(0, 76)]           # 0..150 s
    heatmap("phi_gap", "predicted landing gap to the AMAN predecessor (s)", "time to landing (s)", gaps, ys,
            lambda g, t: -per_min * w_prox(t) * max(0.0, gmin - g) / 60.0, diverging=True, vmax=1.5,
            xfmt=lambda v: f"{v:g}", yfmt=lambda v: f"{v:g}", xticks=[0, 30, 60, 90, 120, 150],
            yticks=[0, 600, 1200, 1800, 2400, 2880, 3600],
            guides=[("x", gmin, f"minimum spacing {gmin:g} s"), ("y", ramp, "")])
    print("wrote", sorted(p.name for p in OUT.glob("*.svg")))


if __name__ == "__main__":
    main()
