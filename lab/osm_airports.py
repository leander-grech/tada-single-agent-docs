#!/usr/bin/env python3
"""Bake the Lab's airport layouts from OpenStreetMap: docs/assets/lab/osm/{MXP,BGY}.json.

The replay draws the airport (runways, taxiways, aprons, terminals and the other airport buildings) and, as plain
geometry only, its surroundings (built-up areas, woods, water, rivers, major roads) once the view is zoomed in far enough. Geometry is in metres (each line or
ring delta-encoded: first point, then offsets), east/north of the landing threshold the simulator uses (scenario_generator: every flight lands at the airport's
`position`, approaching along the runway heading), so the page only has to rotate it onto a flight's final
approach and move it to the airport. Data © OpenStreetMap contributors, under the ODbL.

    python3 lab/osm_airports.py RAW_DIR      # RAW_DIR holds the Overpass JSON (see QUERIES below)

QUERIES (Overpass QL, run against any Overpass endpoint, saved as RAW_DIR/<key>_<part>.json):
    airport  aeroway runway|taxiway|taxilane|apron|terminal|hangar|stopway|helipad, building, area:aeroway
             inside the aerodrome (LIMC relation 20397999, LIME way 74362857)
    land     landuse residential|industrial|commercial|retail, natural wood|water, landuse forest,
             waterway river, highway motorway|trunk|primary in AIRPORTS[...]["land_bbox"]
"""
import json
import math
import sys
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent
AIRPORTS = {
    # key: (site name, ICAO, runway ref, which end of it is the landing threshold the simulator uses)
    "limc": {"name": "MXP", "icao": "LIMC", "runway": "17R/35L", "threshold": "35L", "end": "south",
             "land_bbox": (45.55, 8.60, 45.71, 8.86)},
    # the simulator's BGY runway "10" is flown westwards (approach waypoints east of the airport): runway 28
    "lime": {"name": "BGY", "icao": "LIME", "runway": "10/28", "threshold": "28", "end": "east",
             "land_bbox": (45.59, 9.57, 45.75, 9.84)},
}
DEFAULT_HEIGHT = {"terminal": 18.0, "hangar": 20.0, "tower": 45.0, "building": 8.0}


def metres_per_degree(lat):
    p = math.radians(lat)
    return (111412.84 * math.cos(p) - 93.5 * math.cos(3 * p),
            111132.95 - 559.85 * math.cos(2 * p) + 1.175 * math.cos(4 * p))


def rdp(pts, eps):
    """Ramer-Douglas-Peucker simplification of a polyline [(x, y), ...]."""
    if len(pts) < 3:
        return pts
    (x0, y0), (x1, y1) = pts[0], pts[-1]
    dx, dy = x1 - x0, y1 - y0
    n = math.hypot(dx, dy) or 1e-9
    best, k = 0.0, 0
    for i in range(1, len(pts) - 1):
        d = abs(dy * (pts[i][0] - x0) - dx * (pts[i][1] - y0)) / n
        if d > best:
            best, k = d, i
    if best <= eps:
        return [pts[0], pts[-1]]
    return rdp(pts[:k + 1], eps)[:-1] + rdp(pts[k:], eps)


def rdp_any(pts, eps):
    """As rdp; a closed ring (first point == last) is split at its farthest point first, or it would collapse."""
    if len(pts) > 3 and pts[0] == pts[-1]:
        k = max(range(len(pts)), key=lambda i: (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2)
        return rdp(pts[:k + 1], eps)[:-1] + rdp(pts[k:], eps)
    return rdp(pts, eps)


def area(pts):
    return abs(sum(pts[i][0] * pts[i - 1][1] - pts[i - 1][0] * pts[i][1] for i in range(len(pts)))) / 2


def height(tags, kind):
    for key in ("height", "building:height"):
        try:
            return round(float(str(tags[key]).split()[0].replace(",", ".")), 1)
        except (KeyError, ValueError):
            pass
    try:
        return round(float(tags["building:levels"]) * 3.2, 1)
    except (KeyError, ValueError):
        return DEFAULT_HEIGHT.get(kind, DEFAULT_HEIGHT["building"])


def width(tags, default):
    try:
        return float(str(tags["width"]).split()[0].replace(",", "."))
    except (KeyError, ValueError):
        return default


def bake(key, raw):
    cfg = AIRPORTS[key]
    air = json.loads((raw / f"{key}_airport.json").read_text())["elements"]
    rw = [e for e in air if e["tags"].get("aeroway") == "runway" and e["tags"].get("ref") == cfg["runway"]][0]
    ends = [rw["geometry"][0], rw["geometry"][-1]]
    pick = {"south": min(ends, key=lambda g: g["lat"]), "east": max(ends, key=lambda g: g["lon"])}[cfg["end"]]
    far = ends[1] if pick is ends[0] else ends[0]
    lat0, lon0 = pick["lat"], pick["lon"]
    mx, my = metres_per_degree(lat0)

    def xy(g):
        return ((g["lon"] - lon0) * mx, (g["lat"] - lat0) * my)

    fx, fy = xy(far)
    approach = math.degrees(math.atan2(-fy, -fx))  # from the threshold out along the extended centreline

    def line(geom, eps, nd):
        # delta-encoded: the first point, then each point's offset from the previous one (short numbers)
        pts = rdp_any([xy(g) for g in geom], eps)
        q = [(round(p[0], nd), round(p[1], nd)) for p in pts]
        out_ = list(q[0])
        for (x0, y0), (x1, y1) in zip(q, q[1:]):
            out_ += [round(x1 - x0, nd), round(y1 - y0, nd)]
        return [int(v) if nd == 0 else v for v in out_]

    out = {"airport": cfg["name"], "icao": cfg["icao"], "unit": "m", "encoding": "delta",
           "attribution": "© OpenStreetMap contributors (ODbL)",
           "anchor": {"lat": lat0, "lon": lon0, "runway": cfg["threshold"]},
           "approach_deg": round(approach, 2),
           "runways": [], "taxiways": [], "aprons": [], "terminals": [], "buildings": [],
           "urban": [], "wood": [], "water": [], "rivers": [], "roads": []}
    seen = set()
    for e in air:
        t, geom = e["tags"], e.get("geometry")
        if not geom or e["type"] != "way":
            continue
        seen.add(e["id"])
        aw = t.get("aeroway")
        closed = geom[0] == geom[-1]
        if aw in ("runway", "stopway") and not closed:
            out["runways"].append([width(t, 45.0)] + line(geom, 0.5, 1))
        elif aw in ("taxiway", "taxilane") and not closed:
            out["taxiways"].append([width(t, 18.0 if aw == "taxiway" else 10.0)] + line(geom, 1.0, 1))
        elif aw in ("apron", "helipad") and closed:
            out["aprons"].append(line(geom, 1.0, 1))
        elif closed and (aw in ("terminal", "hangar", "tower") or "building" in t):
            kind = aw if aw in ("terminal", "hangar", "tower") else ("tower" if t.get("building") == "control_tower" else "building")
            pts = [xy(g) for g in geom]
            if area(pts) < 25:
                continue
            out["terminals" if kind == "terminal" else "buildings"].append([height(t, kind)] + line(geom, 0.8, 1))
    for e in json.loads((raw / f"{key}_land.json").read_text())["elements"]:  # the landscape
        t, geom = e["tags"], e.get("geometry")
        if not geom:
            continue
        closed = geom[0] == geom[-1]
        if t.get("highway"):
            out["roads"].append([{"motorway": 3, "trunk": 2}.get(t["highway"], 1)] + line(geom, 12, 0))
        elif t.get("waterway") == "river" and not closed:
            out["rivers"].append(line(geom, 12, 0))
        elif closed:
            pts = [xy(g) for g in geom]
            if area(pts) < 8000:
                continue
            cls = "water" if t.get("natural") == "water" else "wood" if t.get("natural") == "wood" or t.get("landuse") == "forest" else "urban"
            out[cls].append(line(geom, 15, 0))
    dest = DOCS / "docs/assets/lab/osm" / (cfg["name"] + ".json")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, separators=(",", ":")))
    counts = {k: len(v) for k, v in out.items() if isinstance(v, list)}
    print(f"{dest.relative_to(DOCS)}: {dest.stat().st_size / 1024:.0f} KB, threshold {cfg['threshold']} at {lat0:.6f},{lon0:.6f}, "
          f"approach {approach:.1f} deg, {counts}")


if __name__ == "__main__":
    raw = Path(sys.argv[1])
    for k in AIRPORTS:
        bake(k, raw)
