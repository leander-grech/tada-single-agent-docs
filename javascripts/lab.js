// TADA Lab: scenario generator -> agent -> flight (replay + MP4). Talks to lab/server.py.
(function () {
  "use strict";
  var root = document.getElementById("lab-app");
  if (!root) return;
  // Where flights run: a lab runner (lab/server.py). The page that the runner itself serves uses it directly;
  // any other copy (GitHub Pages, mkdocs serve) looks for one on the viewer's machine.
  var RUNNERS = (root.getAttribute("data-runners") || "http://localhost:8800 http://127.0.0.1:8800").split(/\s+/);
  var SAVED_KEY = "tada-lab-runner";
  var BASE = "";  // runner origin; "" = the origin that served this page
  // The in-browser engine (WebAssembly simulator + policy, javascripts/lab-engine.js): used when started
  // from the page, instead of a runner. Its assets load only then.
  var ENGINE = null;
  var ASSETS = root.getAttribute("data-assets") || "../assets/lab/";
  var WORKER = root.getAttribute("data-worker") || "../javascripts/lab-worker.js";
  var ENGINE_KEY = "tada-lab-engine";
  var KEY_STORE = "tada-lab-key";
  var KEY_REQUEST = root.getAttribute("data-key-request") || "";  // where viewers ask for an engine key

  // ---------------------------------------------------------------- helpers
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    (kids || []).forEach(function (c) { if (c != null) el.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return el;
  }
  function $(sel, el) { return (el || root).querySelector(sel); }
  function api(path, body) {
    if (ENGINE) return ENGINE.api(path, body);
    var opt = body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {};
    return fetch(BASE + "/api" + path, opt).then(function (r) {
      return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.statusText); return j; });
    });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function fmtT(s) {
    s = Math.max(0, Math.round(s)); var m = Math.floor(s / 60), r = s % 60;
    return (m < 10 ? "0" : "") + m + ":" + (r < 10 ? "0" : "") + r;
  }
  function sgn(v) { v = Math.round(v); return (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.abs(v); }
  function css(name) { return getComputedStyle(document.body).getPropertyValue(name).trim() || "#888"; }
  var TAB20 = ["#4cc9f0", "#f72585", "#7bf1a8", "#ffd166", "#b388ff", "#ff8c42", "#06d6a0", "#ef476f", "#a0c4ff", "#f9c74f",
    "#90e0ef", "#ff70a6", "#c3f73a", "#ffadad", "#9b5de5", "#00f5d4", "#fee440", "#f15bb5", "#00bbf9", "#e9ff70"];  // the radar's flight colours
  var ABBR = {
    DO_NOTHING: "·", SLOW_DOWN_SMALL: "S−1", SLOW_DOWN_MEDIUM: "S−2", SLOW_DOWN_LARGE: "S−3", SPEED_UP_SMALL: "S+1",
    SPEED_UP_MEDIUM: "S+2", TURN_LEFT_AND_RETURN_TO_ROUTE: "TL", TURN_RIGHT_AND_RETURN_TO_ROUTE: "TR",
    LENGTHEN_TROMBONE: "TB+", SHORTEN_TROMBONE: "TB−", SKIP_1_WAYPOINT: "SK1", SKIP_2_WAYPOINTS_NOT_NEXT: "SK2",
    SKIP_3_WAYPOINTS_NOT_NEXT: "SK3", SKIP_4_WAYPOINTS_NOT_NEXT: "SK4", VECTOR_TO_ILS: "ILS", DIRECT_TO_MERGE_POINT: "DMP"
  };
  function pretty(name) { return name.toLowerCase().replace(/_/g, " ").replace(/\band return to route\b/, "+ rejoin").replace(/ not next/, ""); }
  var MODE_LABEL = { det: "deterministic policy", sampled: "best of sampled attempts", search: "policy + rollout search" };

  // ---------------------------------------------------------------- state
  var S = {
    catalog: null,
    sc: { procedure: "tmb", generator: "monad", flights: 20, segments: 1, seed: 41 },
    agent: null, mode: "det", attempts: 10, difficulty: "any",
    search: { K: 8, M: 10, J: 0, stop: true, prune: true, lookMin: 15 },
    preview: null, flight: null, flightKey: null, rows: [], filter: "", showAll: false,
    token: 0
  };

  function readHash() {
    var q = new URLSearchParams(location.hash.slice(1));
    if (q.get("p")) S.sc.procedure = q.get("p");
    if (q.get("g")) S.sc.generator = q.get("g");
    if (q.get("f")) S.sc.flights = +q.get("f");
    if (q.get("x")) S.sc.segments = +q.get("x");
    if (q.get("s")) S.sc.seed = +q.get("s");
    S.sc.compose = /^[\d._]+$/.test(q.get("c") || "") ? q.get("c") : null;
    syncCompose();
    if (q.get("a")) S.agent = q.get("a");
    if (q.get("m")) S.mode = q.get("m");
    if (q.get("k")) S.attempts = +q.get("k");
    if (q.get("sK")) S.search = { K: +q.get("sK"), M: +q.get("sM") || 10, J: +q.get("sJ") || 0, stop: q.get("sS") !== "0",
      prune: q.get("sP") !== "0", lookMin: +q.get("sL") || 15, T: S.search.T };
  }
  function writeHash() {
    var q = new URLSearchParams({ p: S.sc.procedure, g: S.sc.generator, f: S.sc.flights, x: S.sc.segments, s: S.sc.seed });
    if (S.sc.compose) q.set("c", S.sc.compose);
    if (S.agent) {
      q.set("a", S.agent); q.set("m", S.mode);
      if (S.mode === "sampled") q.set("k", S.attempts);
      if (S.mode === "search" && S.catalog && S.catalog.search_params) {
        q.set("sK", S.search.K); q.set("sM", S.search.M); q.set("sJ", S.search.J); q.set("sS", S.search.stop ? 1 : 0);
        q.set("sP", S.search.prune ? 1 : 0); q.set("sL", S.search.lookMin);
      }
    }
    history.replaceState(null, "", "#" + q.toString());
  }
  function scQuery() {
    return "procedure=" + S.sc.procedure + "&generator=" + S.sc.generator + "&flights=" + S.sc.flights +
      "&segments=" + S.sc.segments + "&seed=" + S.sc.seed + (S.sc.compose ? "&compose=" + S.sc.compose : "");
  }
  function isPaperSetup() { return S.sc.generator === "monad" && S.sc.flights === 20 && S.sc.segments === 1 && !S.sc.compose; }
  // A composed stream travels as "flights.seed.gapMin_flights.seed.gapMin_..." (the first gap is unused).
  function parseCompose(c) { return (c || "").split("_").filter(Boolean).map(function (t) { var p = t.split("."); return { f: +p[0], s: +p[1], g: +p[2] || 0 }; }); }
  function fmtCompose(segs) { return segs.map(function (x, k) { return x.f + "." + x.s + "." + (k ? x.g : 0); }).join("_"); }
  function syncCompose() {
    if (!S.sc.compose) return;
    var segs = parseCompose(S.sc.compose);
    if (!segs.length) { S.sc.compose = null; return; }
    S.sc.segments = segs.length; S.sc.seed = segs[0].s;
  }
  function totalFlights(sc) {
    sc = sc || S.sc;
    return sc.compose ? parseCompose(sc.compose).reduce(function (n, x) { return n + x.f; }, 0) : sc.flights * (sc.segments || 1);
  }
  function curated() { return (S.catalog.curated || {})[S.sc.procedure] || []; }
  function curatedEntry() {
    var c = curated(); for (var i = 0; i < c.length; i++) if (c[i].seed === S.sc.seed) return c[i]; return null;
  }
  function agentsFor(proc) { return S.catalog.agents.filter(function (a) { return a.procedure === proc; }); }
  function agentById(id) { for (var i = 0; i < S.catalog.agents.length; i++) if (S.catalog.agents[i].id === id) return S.catalog.agents[i]; return null; }

  // ---------------------------------------------------------------- jobs
  function runJob(kind, body, onProgress) {
    var start = api("/" + kind, body);
    return start.then(function poll(st) {
      if (onProgress) onProgress(st);
      if (st.status === "done") return st;
      if (st.status === "error") throw new Error(st.error || "job failed");
      return sleep(kind === "render" ? 1200 : 450).then(function () {
        return api("/job/" + st.key + (kind !== "fly" ? "?kind=" + kind : "")).then(poll);
      });
    });
  }
  function loadFlight(key) { if (ENGINE) return ENGINE.flight(key); return fetch(BASE + "/lab-cache/" + key + ".json").then(function (r) { return r.json(); }); }

  // ---------------------------------------------------------------- downloads (registry agents)
  // A public agent that is not on the runner's machine is fetched only when its Download button is
  // pressed, and by the runner (into ~/.cache/tada-lab/models), never by the browser.
  function isInstalled(id) { var a = agentById(id); return !!(a && a.installed); }
  function mb(n) { return (n / 1048576).toFixed(1) + " MB"; }
  function needDownload(e) { var m = /download (\S+) first/.exec(e && e.message || ""); return m ? m[1] : null; }
  function downloadBtn(a, why) {
    var btn = h("button", { type: "button", class: "lab-btn lab-btn--fly lab-btn--dl", title: a.download ? a.download.url : null },
      ["⬇ Download ", h("b", { text: a.id }), (ENGINE ? " to this browser" : " to the runner") + (a.download ? " · " + mb(a.download.size) : "")]);
    var hint = h("div", { class: "lab-field__hint", text: (why ? why + " " : "") +
      (ENGINE ? "The page fetches the published weights into this tab's memory (nothing is stored) and checks their sha256." :
        "The runner fetches the published bundle (GitHub release) onto its own machine and checks its sha256; nothing is saved by your browser.") });
    btn.addEventListener("click", function () {
      btn.disabled = true; btn.textContent = "Downloading " + a.id + "…";
      runJob("install", { agent: a.id }, function (st) {
        if (st.frac != null) btn.textContent = (st.stage === "unpacking" ? "Unpacking " : "Downloading ") + a.id + " · " + Math.round(st.frac * 100) + "%";
      }).then(function () { return api("/catalog"); }).then(function (cat) {
        S.catalog = cat; renderAgents(); loadScenario();
      }).catch(function (e) { btn.disabled = false; btn.textContent = "Retry download"; hint.textContent = "⚠ " + e.message; });
    });
    return h("div", { class: "lab-dl" }, [btn, hint]);
  }
  function downloadPrompt(body, id, why) {
    var a = agentById(id);
    body.innerHTML = "";
    if (!a || !a.download) { body.appendChild(errBox(new Error(id + " is not on this runner and not in the public registry"))); return; }
    body.appendChild(downloadBtn(a, why));
  }

  // ---------------------------------------------------------------- layout
  function build() {
    root.innerHTML = "";
    var gen = h("section", { class: "lab-panel lab-gen" }, [
      h("header", { class: "lab-panel__head" }, [h("span", { class: "lab-step", text: "1" }), h("span", { text: "Scenario generator" })]),
      h("div", { class: "lab-panel__body", id: "lab-gen-body" })
    ]);
    var agent = h("section", { class: "lab-panel lab-agentpanel" }, [
      h("header", { class: "lab-panel__head" }, [h("span", { class: "lab-step", text: "2" }), h("span", { text: "Agent" })]),
      h("div", { class: "lab-panel__body", id: "lab-agent-body" })
    ]);
    var scen = h("section", { class: "lab-panel lab-scen" }, [
      h("header", { class: "lab-panel__head" }, [h("span", { class: "lab-step lab-step--muted", text: "◎" }), h("span", { id: "lab-scen-title", text: "Scenario" })]),
      h("div", { class: "lab-panel__body", id: "lab-scen-body" })
    ]);
    var flight = h("section", { class: "lab-panel lab-flight" }, [
      h("header", { class: "lab-panel__head" }, [h("span", { class: "lab-step", text: "3" }), h("span", { id: "lab-flight-title", text: "Flight" })]),
      h("div", { class: "lab-panel__body", id: "lab-flight-body" })
    ]);
    var cmp = h("section", { class: "lab-panel lab-cmp" }, [
      h("header", { class: "lab-panel__head" }, [h("span", { class: "lab-step lab-step--muted", text: "≡" }), h("span", { text: "Every agent flown on this scenario" })]),
      h("div", { class: "lab-panel__body", id: "lab-cmp-body" })
    ]);
    root.appendChild(h("div", { class: "lab-grid" }, [gen, scen, agent, flight, cmp]));
    renderGen(); renderAgents();
  }

  // ---------------------------------------------------------------- 1. generator
  function seg(name, options, value, onPick) {
    return h("div", { class: "lab-seg", role: "radiogroup", "aria-label": name }, options.map(function (o) {
      return h("button", {
        type: "button", class: "lab-seg__btn" + (o.value === value ? " is-on" : ""), title: o.title || null, disabled: o.disabled ? true : null,
        role: "radio", "aria-checked": o.value === value ? "true" : "false",
        onclick: function () { onPick(o.value); }
      }, [o.label]);
    }));
  }
  function field(label, control, hint) {
    return h("div", { class: "lab-field" }, [h("label", { class: "lab-field__label", text: label }), control,
      hint ? h("div", { class: "lab-field__hint", html: hint }) : null]);
  }

  function renderGen() {
    var body = $("#lab-gen-body"); body.innerHTML = "";
    var cat = S.catalog;
    body.appendChild(field("Procedure", seg("procedure", Object.keys(cat.procedures).map(function (k) {
      return { value: k, label: cat.procedures[k].label + " · " + cat.procedures[k].name };
    }), S.sc.procedure, function (v) {
      S.sc.procedure = v;
      var a = agentById(S.agent); if (a && a.procedure !== v) S.agent = cat.reference[v];
      renderGen(); renderAgents(); scenarioChanged();
    })));
    body.appendChild(field("Generator", seg("generator", Object.keys(cat.generators).map(function (k) {
      var g = cat.generators[k], off = g.available === false;
      return { value: k, label: g.label + (off ? " (n/a)" : ""), disabled: off,
        title: off ? "This runner's code checkout has no " + g.label + " generator (see the setup notes above)" : g.detail };
    }), S.sc.generator, function (v) { S.sc.generator = v; renderGen(); scenarioChanged(); }),
      cat.generators[S.sc.generator].detail));

    var streams = [1, 2, 3].slice(0, cat.max_segments || 3).map(function (n) { return { value: "x" + n, label: n === 1 ? "single" : n + " stitched" }; });
    if (cat.compose) streams.push({ value: "compose", label: "compose ✎", title: "Build your own stream: segments of different sizes and difficulty, joined by gaps you choose" });
    body.appendChild(field("Stream", seg("stream", streams, S.sc.compose ? "compose" : "x" + S.sc.segments, function (v) {
      if (v === "compose") {
        if (!S.sc.compose) { S.sc.compose = S.lastCompose || null; if (!S.sc.compose) { applyPreset(COMPOSE_PRESETS[0][1]); return; } }
      } else { if (S.sc.compose) S.lastCompose = S.sc.compose; S.sc.compose = null; S.sc.segments = +v.slice(1); }
      syncCompose(); renderGen(); scenarioChanged();
    }), S.sc.compose ? null : S.sc.segments > 1 ? "Generated scenarios joined by a random 2–15 min gap: a continuous-operation stress test." :
      cat.compose ? "Or compose your own traffic: segments of different sizes and difficulty." : null));
    if (S.sc.compose) { body.appendChild(composer()); return; }

    var flights = h("input", { type: "range", min: 4, max: 40, step: 1, value: S.sc.flights, class: "lab-range" });
    var fv = h("output", { class: "lab-num", text: S.sc.flights });
    flights.addEventListener("input", function () { fv.textContent = flights.value; });
    flights.addEventListener("change", function () { S.sc.flights = +flights.value; renderGen(); scenarioChanged(); });
    body.appendChild(field("Flights per stream", h("div", { class: "lab-row" }, [flights, fv]),
      "Agents train on 20; the window always shows the next 10 in AMAN order."));

    // seed + difficulty
    var seedIn = h("input", { type: "number", min: 0, max: 2147483647, value: S.sc.seed, class: "lab-input lab-num" });
    seedIn.addEventListener("change", function () { S.sc.seed = Math.max(0, Math.floor(+seedIn.value || 0)); renderGen(); scenarioChanged(); });
    var dice = h("button", { type: "button", class: "lab-btn lab-btn--ghost", title: "Draw a seed", onclick: drawSeed }, ["⚄ draw"]);
    body.appendChild(field("Seed", h("div", { class: "lab-row" }, [seedIn, dice])));

    var c = curated();
    if (c.length) {
      body.appendChild(field("Draw from", seg("difficulty", [
        { value: "any", label: "any seed" }, { value: "easy", label: "easy" }, { value: "medium", label: "medium" },
        { value: "hard", label: "hard" }
      ], S.difficulty, function (v) { S.difficulty = v; renderGen(); }),
        S.difficulty === "any" ? "A uniformly random scenario seed." :
          "One of the paper's 100 curated seeds, by worst |AMAN time to lose/gain| (thirds)."));
      var ce = curatedEntry();
      if (ce) {
        var note = "Curated seed · worst |AMAN TTL| <b>" + Math.round(ce.difficulty) + " s</b>";
        if (isPaperSetup() && ce.policy) {
          note += " · paper v5: policy " + mark(ce.policy) + ", policy + search " + mark(ce.search);
        } else if (!isPaperSetup()) {
          note += " · paper results apply to MONAD, 20 flights, single stream";
        }
        body.appendChild(h("div", { class: "lab-note", html: note }));
      }
    }
  }
  // ---------------------------------------------------------------- the stream composer (in-browser engine)
  // Difficulty is the curated seeds' measure, the worst |AMAN time to lose/gain| of a segment, in bands at the
  // tertiles of the paper's 100 curated seeds. 20-flight segments draw from those seeds; other sizes search for one.
  var COMPOSE_PRESETS = [
    ["Warm-up · rush · cool-down", [[10, "easy", 0], [25, "hard", 5], [10, "easy", 5]]],
    ["Escalating", [[10, "easy", 0], [15, "medium", 4], [20, "hard", 4]]],
    ["Back-to-back rushes", [[20, "hard", 0], [20, "hard", 2]]],
    ["Long shift", [[15, "easy", 0], [20, "medium", 6], [20, "hard", 3], [15, "easy", 8]]]
  ];
  var BANDS = ["easy", "medium", "hard"], GAPS = [1, 2, 3, 5, 8, 10, 15, 20, 30];
  function bandEdges() {
    var c = curated().map(function (x) { return x.difficulty; }).sort(function (a, b) { return a - b; });
    if (!c.length) return [180, 300];
    return [c[Math.floor(c.length / 3)], c[Math.floor(2 * c.length / 3)]];
  }
  function bandOf(worst) { var e = bandEdges(); return worst < e[0] ? "easy" : worst < e[1] ? "medium" : "hard"; }
  var segCache = {};
  function segInfo(x) {
    var k = S.sc.procedure + "/" + x.s + "/" + x.f;
    if (!segCache[k]) segCache[k] = api("/segment", { procedure: S.sc.procedure, seed: x.s, flights: x.f }).catch(function (e) { delete segCache[k]; throw e; });
    return segCache[k];
  }
  function seedFor(band, flights) {
    if (band === "any") return Promise.resolve(Math.floor(Math.random() * 2147483647));
    var e = bandEdges(), lo = { easy: 0, medium: e[0], hard: e[1] }[band], hi = { easy: e[0], medium: e[1], hard: 1e9 }[band];
    if (flights === 20) {
      var pool = curated().filter(function (x) { return x.difficulty >= lo && x.difficulty < hi; });
      if (pool.length) return Promise.resolve(pool[Math.floor(Math.random() * pool.length)].seed);
    }
    return api("/findseed", { procedure: S.sc.procedure, flights: flights, lo: lo, hi: hi, tries: 40 }).then(function (v) {
      segCache[S.sc.procedure + "/" + v.seed + "/" + flights] = Promise.resolve(v);
      return v.seed;
    });
  }
  function applyPreset(spec) {
    // show the shape at once (random seeds), then the seeds drawn for each segment's difficulty
    if (!S.sc.compose) { S.sc.compose = fmtCompose(spec.map(function (x) { return { f: x[0], s: Math.floor(Math.random() * 2147483647), g: x[2] }; })); syncCompose(); }
    S.composing = true; renderGen();
    Promise.all(spec.map(function (x) { return seedFor(x[1], x[0]).then(function (seed) { return { f: x[0], s: seed, g: x[2] }; }); }))
      .then(function (segs) { S.composing = false; S.sc.compose = fmtCompose(segs); syncCompose(); renderGen(); scenarioChanged(); })
      .catch(function (e) { S.composing = false; renderGen(); $("#lab-gen-body").appendChild(errBox(e)); });
  }
  function composer() {
    var segs = parseCompose(S.sc.compose), box = h("div", { class: "lab-compose" + (S.composing ? " is-busy" : "") });
    function commit() { S.sc.compose = fmtCompose(segs); syncCompose(); renderGen(); scenarioChanged(); }
    function busy(row, on) { row.classList.toggle("is-busy", on); }
    box.appendChild(h("div", { class: "lab-compose__presets" }, [h("span", { class: "lab-layers__label", text: "Start from" })].concat(COMPOSE_PRESETS.map(function (p) {
      return h("button", { type: "button", class: "lab-btn lab-btn--ghost lab-compose__preset", disabled: S.composing ? true : null,
        title: p[1].map(function (x) { return x[0] + " " + x[1]; }).join(" → "), onclick: function () { applyPreset(p[1]); } }, [p[0]]);
    }))));
    var list = h("ol", { class: "lab-compose__list" });
    var preview = h("div", { class: "lab-compose__bar", "aria-label": "the stream over time" });
    var infos = [];
    segs.forEach(function (x, k) {
      var badge = h("span", { class: "lab-compose__info", text: "…" });
      var row = h("li", { class: "lab-compose__seg" });
      var fIn = h("input", { type: "range", min: 2, max: 40, step: 1, value: x.f, class: "lab-range", "aria-label": "flights in segment " + (k + 1) });
      var fOut = h("output", { class: "lab-num", text: x.f });
      fIn.addEventListener("input", function () { fOut.textContent = fIn.value; });
      fIn.addEventListener("change", function () { x.f = +fIn.value; commit(); });
      var bandSeg = h("div", { class: "lab-seg lab-seg--sm", role: "radiogroup", "aria-label": "difficulty" }, BANDS.concat(["any"]).map(function (b) {
        return h("button", { type: "button", class: "lab-seg__btn lab-compose__band--" + b, "data-b": b, title: "Draw a " + (b === "any" ? "random" : b) + " seed for this segment",
          onclick: function () {
            busy(row, true);
            seedFor(b, x.f).then(function (seed) { x.s = seed; commit(); }, function (e) { busy(row, false); badge.textContent = "⚠ " + e.message; });
          } }, [b === "any" ? "⚄" : b]);
      }));
      var sIn = h("input", { type: "number", min: 0, max: 2147483647, value: x.s, class: "lab-input lab-num lab-compose__seed", "aria-label": "seed" });
      sIn.addEventListener("change", function () { x.s = Math.max(0, Math.floor(+sIn.value || 0)); commit(); });
      var gap = k === 0 ? h("span", { class: "lab-compose__gap is-first", text: "starts the stream" }) :
        h("label", { class: "lab-compose__gap" }, ["after a ", h("select", { class: "lab-input", onchange: function () { x.g = +this.value; commit(); } },
          GAPS.concat(GAPS.indexOf(x.g) < 0 ? [x.g] : []).sort(function (a, b) { return a - b; }).map(function (g) {
            return h("option", { value: g, selected: g === x.g ? true : null, text: g + " min" });
          })), " gap"]);
      function move(d) { var t = segs[k + d]; segs[k + d] = segs[k]; segs[k] = t; if (k + d === 0 || k === 0) { segs[0].g = 0; segs[1].g = segs[1].g || 5; } commit(); }
      var tools = h("span", { class: "lab-compose__tools" }, [
        k > 0 ? h("button", { type: "button", class: "lab-btn lab-btn--link", title: "Move earlier", onclick: function () { move(-1); } }, ["↑"]) : null,
        k < segs.length - 1 ? h("button", { type: "button", class: "lab-btn lab-btn--link", title: "Move later", onclick: function () { move(1); } }, ["↓"]) : null,
        segs.length > 1 ? h("button", { type: "button", class: "lab-btn lab-btn--link", title: "Remove this segment", onclick: function () {
          segs.splice(k, 1); if (segs[0]) segs[0].g = 0; commit(); } }, ["✕"]) : null]);
      row.appendChild(h("div", { class: "lab-compose__head" }, [h("b", { class: "lab-compose__n", text: String(k + 1) }), gap, tools]));
      row.appendChild(h("div", { class: "lab-compose__body" }, [
        h("div", { class: "lab-row" }, [fIn, fOut, h("span", { class: "lab-field__hint", text: "flights" })]),
        bandSeg,
        h("label", { class: "lab-row lab-compose__seedrow" }, [h("span", { class: "lab-field__hint", text: "seed" }), sIn]),
        badge]));
      list.appendChild(row);
      infos.push(segInfo(x).then(function (v) {
        var b = bandOf(v.worst_ttl);
        row.setAttribute("data-band", b);
        bandSeg.querySelectorAll("button").forEach(function (bt) { bt.classList.toggle("is-on", bt.getAttribute("data-b") === b); });
        badge.innerHTML = "";
        badge.appendChild(h("span", { class: "lab-compose__chip lab-compose__band--" + b, text: b }));
        badge.appendChild(document.createTextNode(" worst |AMAN TTL| " + Math.round(v.worst_ttl) + " s · " + v.on_time0 + "/" + v.flights +
          " on time with no control · lands over " + fmtT(v.span_s)));
        return v;
      }, function (e) { badge.textContent = "⚠ " + e.message; return null; }));
    });
    box.appendChild(list);
    if (segs.length < ((S.catalog.compose || {}).max_segments || 8))
      box.appendChild(h("button", { type: "button", class: "lab-btn lab-btn--ghost", disabled: S.composing ? true : null, onclick: function () {
        var last = segs[segs.length - 1] || { f: 20 };
        seedFor("medium", last.f).then(function (seed) { segs.push({ f: last.f, s: seed, g: 5 }); commit(); });
      } }, ["+ add a segment"]));
    // the stream at a glance: each segment as wide as it takes to land, gaps dashed
    box.appendChild(preview);
    Promise.all(infos).then(function (vs) {
      if (!preview.isConnected && !box.isConnected) return;
      var total = 0;
      segs.forEach(function (x, k) { total += (vs[k] ? vs[k].span_s : 600) + (k ? x.g * 60 : 0); });
      segs.forEach(function (x, k) {
        if (k) preview.appendChild(h("i", { class: "lab-compose__gapbar", style: "flex-grow:" + (x.g * 60 / total), title: x.g + " min gap" }));
        var b = vs[k] ? bandOf(vs[k].worst_ttl) : "any";
        preview.appendChild(h("i", { class: "lab-compose__segbar lab-compose__band--" + b, style: "flex-grow:" + ((vs[k] ? vs[k].span_s : 600) / total),
          title: "segment " + (k + 1) + ": " + x.f + " flights, " + b }, [String(x.f)]));
      });
    });
    var e = bandEdges();
    box.appendChild(h("div", { class: "lab-field__hint", html: "<b>" + totalFlights() + " flights</b> in " + segs.length + " segment" + (segs.length > 1 ? "s" : "") +
      ". Difficulty is a segment's worst |AMAN time to lose/gain|: easy &lt; " + Math.round(e[0]) + " s ≤ medium &lt; " + Math.round(e[1]) +
      " s ≤ hard (tertiles of the paper's curated seeds). Each segment is exactly the single scenario of its seed and size; a gap " +
      "runs from the previous segment's last target landing to this one's first, widened if a segment's flights would otherwise spawn before t = 0." }));
    if (S.composing) box.appendChild(h("div", { class: "lab-field__hint", text: "Drawing seeds…" }));
    return box;
  }
  function mark(r) {
    if (!r) return "–";
    return r.los ? '<span class="lab-c-bad">LoS</span>' : r.solved ? '<span class="lab-c-ok">solved</span>' : '<span class="lab-c-warn">not solved</span>';
  }
  function drawSeed() {
    var c = curated().slice().sort(function (a, b) { return a.difficulty - b.difficulty; });
    if (S.difficulty === "any" || !c.length) {
      S.sc.seed = Math.floor(Math.random() * 2147483647);
    } else {
      var n = c.length, i0 = { easy: 0, medium: Math.floor(n / 3), hard: Math.floor(2 * n / 3) }[S.difficulty];
      var i1 = { easy: Math.floor(n / 3), medium: Math.floor(2 * n / 3), hard: n }[S.difficulty];
      var pool = c.slice(i0, i1); S.sc.seed = pool[Math.floor(Math.random() * pool.length)].seed;
    }
    renderGen(); scenarioChanged();
  }

  // ---------------------------------------------------------------- 2. agents
  function renderAgents() {
    var body = $("#lab-agent-body"); body.innerHTML = "";
    var list = agentsFor(S.sc.procedure);
    if (!S.agent || !agentById(S.agent) || agentById(S.agent).procedure !== S.sc.procedure) S.agent = S.catalog.reference[S.sc.procedure];
    var paper = list.filter(function (a) { return a.paper; });
    var q = S.filter.toLowerCase();
    var rest = list.filter(function (a) {
      return !a.paper && (!q || (a.id + " " + a.whats_new + " " + a.trainer).toLowerCase().indexOf(q) >= 0);
    });

    var modes = [{ value: "det", label: "Policy", title: "The deterministic policy, as deployed" },
      { value: "sampled", label: "Best of K", title: "Attempt 0 deterministic plus K sampled attempts; the best is kept (no LoS, then brackets, then fewest clearances)" },
      { value: "search", label: "Policy + search", title: "Receding-horizon rollout search: K full-episode candidate rollouts every M decisions (the paper's best agent: K=8, M=10)" }];
    if (S.catalog.modes) modes = modes.filter(function (m) { return S.catalog.modes.indexOf(m.value) >= 0; });
    if (modes.every(function (m) { return m.value !== S.mode; })) S.mode = "det";
    body.appendChild(field("Mode", seg("mode", modes, S.mode, function (v) { S.mode = v; renderAgents(); syncFlightTitle(); })));
    if (S.mode === "sampled") {
      var k = h("select", { class: "lab-input", onchange: function () { S.attempts = +this.value; } },
        [3, 5, 10, 20].map(function (n) { return h("option", { value: n, selected: n === S.attempts ? true : null, text: "K = " + n + " sampled" }); }));
      body.appendChild(k);
    }
    if (S.mode === "search") body.appendChild(searchControls());
    var all = h("button", { type: "button", class: "lab-btn lab-btn--ghost", onclick: flyAll, title: "Deterministic policy of every installed agent of this procedure, on this scenario" }, ["Fly every agent"]);
    if (S.agent !== "do-nothing" && !isInstalled(S.agent)) {
      body.appendChild(downloadBtn(agentById(S.agent), S.agent + (ENGINE ? " is not loaded in this browser yet." : " is not on this runner yet.")));
    } else {
      var fly = h("button", { type: "button", class: "lab-btn lab-btn--fly", id: "lab-fly", onclick: function () { flySelected(); } },
        ["Fly ", h("b", { text: S.agent }), " ▸"]);
      body.appendChild(h("div", { class: "lab-row lab-row--actions" }, [fly, all]));
    }

    var ul = h("div", { class: "lab-agents", role: "listbox", "aria-label": "agents" });
    function card(a) {
      var hl = a.headline ? h("span", { class: "lab-agent__hl", title: "Deterministic policy on the 100 validation seeds (legacy generator): solved / losses of separation" },
        [h("span", { class: "lab-c-ok", text: a.headline.solved + "" }), " / ", h("span", { class: "lab-c-bad", text: a.headline.los + "" })]) : null;
      return h("button", {
        type: "button", role: "option", "aria-selected": a.id === S.agent ? "true" : "false",
        class: "lab-agent" + (a.id === S.agent ? " is-on" : "") + (a.paper ? " is-paper" : ""),
        title: a.whats_new, onclick: function () { S.agent = a.id; renderAgents(); syncFlightTitle(); writeHash(); }
      }, [
        h("span", { class: "lab-agent__id", text: a.id }),
        a.paper ? h("span", { class: "lab-agent__tag", text: "paper" }) : null,
        h("span", { class: "lab-agent__what", text: a.whats_new.split(/[:.]/)[0] }),
        h("span", { class: "lab-agent__meta" }, [a.trainer.replace("jax_sac", "SAC").replace("jax", "PPO·JAX").replace("sb3", "PPO·SB3").replace("distill_bc", "distilled"), hl ? " · " : "", hl,
          !a.installed ? h("span", { class: "lab-agent__dl", text: " · ⬇ " + (a.download ? mb(a.download.size) : "") + (ENGINE ? " to download" : " not on this runner") })
            : a.source === "downloaded" ? " · downloaded" : a.public ? " · public" : ""])
      ]);
    }
    paper.forEach(function (a) { ul.appendChild(card(a)); });
    var doNothing = h("button", {
      type: "button", class: "lab-agent lab-agent--floor" + (S.agent === "do-nothing" ? " is-on" : ""),
      onclick: function () { S.agent = "do-nothing"; renderAgents(); syncFlightTitle(); writeHash(); }
    }, [h("span", { class: "lab-agent__id", text: "do-nothing" }), h("span", { class: "lab-agent__what", text: "No clearance ever: the scenario as generated" })]);
    ul.appendChild(doNothing);
    var search = h("input", { type: "search", class: "lab-input lab-agents__filter", placeholder: "filter " + rest.length + " more agents (id, SAC, distill, fine-tune…)", value: S.filter });
    search.addEventListener("input", function () {
      S.filter = search.value; var pos = search.selectionStart; renderAgents();
      var s2 = $(".lab-agents__filter"); s2.focus(); s2.setSelectionRange(pos, pos);
    });
    body.appendChild(ul);
    body.appendChild(search);
    var more = h("div", { class: "lab-agents lab-agents--more" });
    rest.slice(0, S.showAll || q ? rest.length : 6).forEach(function (a) { more.appendChild(card(a)); });
    body.appendChild(more);
    if (!S.showAll && !q && rest.length > 6) {
      body.appendChild(h("button", { type: "button", class: "lab-btn lab-btn--link", onclick: function () { S.showAll = true; renderAgents(); } }, ["show all " + rest.length]));
    }
    var a = agentById(S.agent);
    if (a) {
      body.appendChild(h("div", { class: "lab-note" }, [
        h("b", { text: a.id + " " }), a.whats_new + " ",
        h("a", { href: "../" + a.card, text: "Model card ›" })
      ]));
    }
    if (a && a.headline) body.appendChild(h("div", { class: "lab-field__hint", text: "Green / red: solved / losses of separation of 100 validation seeds, deterministic policy, legacy generator." }));
  }

  // ---------------------------------------------------------------- search parameters
  var SEARCH_PRESETS = [
    ["Paper", { K: 8, M: 10, J: 0 }, "The paper's best agent: K = 8 candidates every 10 decisions"],
    ["Quick", { K: 4, M: 20, J: 0 }, "Few candidates, rare replanning: fast"],
    ["Thorough", { K: 16, M: 5, J: 0 }, "Twice the candidates, replanning twice as often"],
    ["Exhaustive", { K: 24, M: 3, J: 10 }, "Many short-branched candidates, replanning every 3 decisions: slow"]];
  function searchControls() {
    if (!S.catalog.search_params) {
      return h("div", { class: "lab-field__hint", text: "This runner flies the paper's search: K = 8 candidates every M = 10 decisions. " +
        "The in-browser engine lets you set them, and draws the predicted rollouts on the radar." });
    }
    var sp = S.search, box = h("div", { class: "lab-search" });
    function changed() { writeHash(); renderAgents(); scheduleLiveSearch(); }
    function chips(key, label, values, fmt, hint) {
      return h("div", { class: "lab-search__row", title: hint }, [
        h("span", { class: "lab-search__label", text: label }),
        h("div", { class: "lab-seg lab-seg--sm lab-search__chips", role: "radiogroup", "aria-label": label }, values.map(function (v) {
          var on = sp[key] === v;
          return h("button", { type: "button", class: "lab-seg__btn" + (on ? " is-on" : ""), role: "radio", "aria-checked": on ? "true" : "false",
            onclick: function () { if (sp[key] !== v) { sp[key] = v; changed(); } } }, [fmt(v)]);
        }))]);
    }
    var current = SEARCH_PRESETS.filter(function (p) { return p[1].K === sp.K && p[1].M === sp.M && p[1].J === sp.J; })[0];
    box.appendChild(h("div", { class: "lab-search__presets" }, SEARCH_PRESETS.map(function (p) {
      return h("button", { type: "button", class: "lab-btn lab-search__preset" + (current === p ? " is-on" : ""), title: p[2],
        onclick: function () { sp.K = p[1].K; sp.M = p[1].M; sp.J = p[1].J; changed(); } }, [p[0]]);
    })));
    box.appendChild(chips("K", "Candidates K", [2, 4, 8, 12, 16, 24], String,
      "Full-episode rollouts per plan: the incumbent, the deterministic policy, then sampled ones"));
    box.appendChild(chips("M", "Replan every", [1, 3, 5, 10, 20, 30], function (v) { return v + (v === 1 ? " dec" : ""); },
      "Decisions executed from each plan before the next one (one decision = 45 s of flight)"));
    box.appendChild(chips("J", "Branch depth", [0, 3, 5, 10, 20], function (v) { return v ? String(v) : "all"; },
      "Sampled candidates sample only their first J actions, then follow the deterministic policy (all = sample throughout)"));
    box.appendChild(chips("lookMin", "Show ahead", [5, 10, 15, 30], function (v) { return v + "′"; },
      "How far ahead the radar draws each candidate's predicted tracks (minutes)"));
    var cores = S.catalog.cores;
    if (cores > 1) {  // in-browser engine: a plan's candidates on several cores (same plans, sooner)
      var tOpts = [1, 2, 4, 8, 12, 16].filter(function (t) { return t < cores; }).concat([cores]);
      if (!S.search.T) S.search.T = defaultThreads();
      box.appendChild(chips("T", "CPU threads", tOpts, function (v) { return v === cores ? v + " (all)" : String(v); },
        "Rollouts of a plan run on this many cores at once (this machine reports " + cores + "). The plans chosen are the same " +
        "for any number of threads; more threads only finish them sooner, up to about the number of candidates a plan " +
        "really needs (often 2–5) and the number of fast cores."));
    }
    function toggle(key, label, hint) {
      var cb = h("input", { type: "checkbox", checked: sp[key] ? true : null });
      cb.addEventListener("change", function () { sp[key] = cb.checked; changed(); });
      return h("label", { class: "lab-search__check", title: hint }, [cb, " " + label]);
    }
    var live = h("input", { type: "checkbox", checked: S.liveSearch !== false ? true : null });
    live.addEventListener("change", function () { S.liveSearch = live.checked; });
    box.appendChild(h("div", { class: "lab-search__toggles" }, [
      toggle("stop", "stop when unbeatable", "Skip the rest of a plan once a candidate has no loss of separation and puts every still-recoverable flight on time (flights already landed late stay late): nothing can beat it on the main criteria"),
      toggle("prune", "exact pruning", "Abandon a rollout as soon as it can no longer reach the best candidate's on-time count"),
      h("label", { class: "lab-search__check", title: "Re-run the search on the shown flight as soon as a parameter changes" }, [live, " apply live"])]));
    // worst-case cost: every plan rolls K - 1 fresh candidates to the end of the stream
    var decisions = 115 * totalFlights() / 20, plans = Math.ceil(decisions / sp.M), worst = 1 + plans * (sp.K - 1);
    var tier = worst <= 60 ? ["light", "lab-c-ok"] : worst <= 250 ? ["medium", "lab-c-warn"] : ["heavy", "lab-c-bad"];
    box.appendChild(h("div", { class: "lab-search__cost" }, [
      "every " + fmtT(sp.M * 45) + " of flight · up to ~" + worst + " rollouts · ",
      h("span", { class: tier[1], text: tier[0] }),
      sp.stop ? h("span", { class: "lab-field__hint", text: " (stopping when unbeatable usually needs far fewer)" }) : null]));
    return box;
  }
  var liveTimer = null;
  // apply live: re-fly the shown search flight with the new parameters (a still-running search is cancelled)
  function scheduleLiveSearch() {
    var cur = S.flying ? S.flyingJob : (S.flight && S.flight.job);  // the search running now, or the one on screen
    if (S.liveSearch === false || S.mode !== "search" || !cur || cur.mode !== "search") return;
    if (scKey(cur.scenario) !== scKey(S.sc) || cur.agent !== S.agent) return;
    clearTimeout(liveTimer);
    liveTimer = setTimeout(function () { flySelected(true); }, 350);
  }
  function defaultThreads() {
    var c = (S.catalog && S.catalog.cores) || 1, t = 1;
    try { t = +localStorage.getItem("tada-lab-threads") || 0; } catch (e) {}
    // 4 by default: a plan rarely has more than a few candidates worth running at once, and on laptops the cores
    // beyond the first few are often slower efficiency cores (a plan waits for its slowest candidate)
    return Math.max(1, Math.min(c, t || Math.min(4, c - 1)));
  }
  function searchParamsForJob() {
    var sp = S.search;
    return { K: sp.K, M: sp.M, J: sp.J, stop: sp.stop, prune: sp.prune, look: Math.round(sp.lookMin * 60 / 45) };
  }
  function modeLabel(job) {
    if (job.mode === "search" && job.search) {
      var p = job.search;
      return "policy + search (K " + p.K + ", M " + p.M + (p.J ? ", J " + p.J : "") + ")";
    }
    return MODE_LABEL[job.mode] || job.mode;
  }

  // ---------------------------------------------------------------- scenario preview (do-nothing)
  var scenTimer = null;
  function scenarioChanged() {
    writeHash();
    clearTimeout(scenTimer);
    scenTimer = setTimeout(loadScenario, 250);
  }
  function loadScenario() {
    var tok = ++S.token;
    var body = $("#lab-scen-body");
    $("#lab-scen-title").textContent = "Scenario · " + S.catalog.procedures[S.sc.procedure].label + " · " + scLabel(S.sc);
    body.innerHTML = ""; body.appendChild(progressBox("Generating scenario and flying do-nothing…"));
    refreshRows();
    runJob("fly", { scenario: S.sc, agent: "do-nothing", mode: "det" }, function (st) { setProgress(body, st); })
      .then(function (st) { return loadFlight(st.key); })
      .then(function (d) {
        if (tok !== S.token) return;
        S.preview = d;
        renderScenario(d);
        refreshRows();
        // once an agent has been flown, a new scenario is flown by that agent straight away
        if (S.autoFly && S.agent !== "do-nothing") { if (!S.flying) flySelected(true); }
        else if (!S.flying && (!S.flight || scKey(S.flight.job.scenario) !== scKey(S.sc))) showFlight(d, flightKeyOf(d.job));
      })
      .catch(function (e) {
        if (tok !== S.token) return;
        var id = needDownload(e);
        if (id) { downloadPrompt(body, id, "Scenarios are generated in the MDP of the procedure's paper agent, " + id + ", which is not on this runner yet."); return; }
        body.innerHTML = ""; body.appendChild(errBox(e));
      });
  }
  function scKey(sc) { return [sc.generator, sc.procedure, sc.flights, sc.segments, sc.seed, sc.compose || ""].join("/"); }
  function flightKeyOf(job) {
    var sc = job.scenario, m = job.mode === "sampled" ? "sampled" + job.attempts : job.mode;
    return sc.generator + "-" + sc.procedure + (sc.compose ? "-c" + sc.compose : "-f" + sc.flights + "-x" + sc.segments + "-s" + sc.seed) +
      "--" + job.agent + "--" + m;
  }
  function scLabel(sc) {
    if (!sc.compose) return "seed " + sc.seed + (sc.segments > 1 ? " · " + sc.segments + " stitched" : "");
    var segs = parseCompose(sc.compose);
    return "composed · " + segs.length + " segment" + (segs.length > 1 ? "s" : "") + " · " + totalFlights(sc) + " flights";
  }

  function renderScenario(d) {
    var body = $("#lab-scen-body"); body.innerHTML = "";
    var fl = d.flights, s = d.summary;
    var worst = fl.reduce(function (m, f) { return Math.max(m, Math.abs(f.aman_ttl)); }, 0);
    var sumInit = fl.reduce(function (m, f) { return m + Math.abs(f.initial); }, 0);
    var early = fl.reduce(function (m, f) { return Math.min(m, f.initial); }, 0);
    var late = fl.reduce(function (m, f) { return Math.max(m, f.initial); }, 0);
    var onTime0 = fl.filter(function (f) { return Math.abs(f.initial) <= 60; }).length;
    var dn = s.los ? { v: "LoS", c: "bad", sub: "if left alone" }
      : s.solved ? { v: "OK", c: "ok", sub: "solved as generated" } : { v: s.end_reason, c: "warn", sub: "if left alone" };
    body.appendChild(tiles([
      { label: "Flights", value: fl.length },
      { label: "Worst AMAN TTL", value: Math.round(worst), unit: "s", cls: worst > 600 ? "bad" : worst > 240 ? "warn" : "" },
      { label: "On time, no control", value: onTime0 + "/" + fl.length, cls: onTime0 === fl.length ? "ok" : "warn" },
      { label: "Σ |deviation|", value: Math.round(sumInit), unit: "s", sub: "no control" },
      { label: "Outcome, no control", value: dn.v, cls: dn.c, sub: dn.sub }
    ]));
    body.appendChild(schedule(fl, early, late));
    body.appendChild(h("div", { class: "lab-field__hint", html:
      "Each flight in AMAN order: the bar is its do-nothing landing deviation (left early, right late), the tick the AMAN " +
      "time to lose (+) or gain (−) it was generated with. Green band ±60 s." }));
  }

  function schedule(fl, early, late) {
    var W = 560, rowH = 12, pad = 52, H = fl.length * rowH + 22;
    var lim = Math.max(120, Math.abs(early), Math.abs(late), fl.reduce(function (m, f) { return Math.max(m, Math.abs(f.aman_ttl)); }, 0));
    lim = Math.ceil(lim / 60) * 60;
    var x = function (v) { return pad + (W - pad - 10) * (0.5 + v / (2 * lim)); };
    var svg = '<svg class="lab-sched" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="do-nothing deviation per flight">';
    svg += '<rect x="' + x(-60) + '" y="0" width="' + (x(60) - x(-60)) + '" height="' + (H - 18) + '" class="lab-sched__band"/>';
    svg += '<line x1="' + x(0) + '" x2="' + x(0) + '" y1="0" y2="' + (H - 18) + '" class="lab-sched__zero"/>';
    fl.forEach(function (f, i) {
      var y = i * rowH + 2, v = f.initial, c = Math.abs(v) <= 60 ? "ok" : Math.abs(v) <= 300 ? "warn" : "bad";
      svg += '<text x="' + (pad - 6) + '" y="' + (y + 9) + '" class="lab-sched__cs">' + f.callsign.replace(/^[A-Z]+0*/, "#") + '</text>';
      svg += '<rect x="' + Math.min(x(0), x(v)) + '" y="' + (y + 2) + '" width="' + Math.max(1, Math.abs(x(v) - x(0))) + '" height="' + (rowH - 4) + '" class="lab-sched__bar lab-sched__bar--' + c + '"><title>' + f.callsign + ': do-nothing ' + sgn(v) + ' s, AMAN TTL ' + sgn(f.aman_ttl) + ' s</title></rect>';
      svg += '<line x1="' + x(f.aman_ttl) + '" x2="' + x(f.aman_ttl) + '" y1="' + y + '" y2="' + (y + rowH) + '" class="lab-sched__ttl"/>';
    });
    [-lim, -lim / 2, 0, lim / 2, lim].forEach(function (v) {
      svg += '<text x="' + x(v) + '" y="' + (H - 4) + '" class="lab-sched__ax">' + (v === 0 ? "0" : sgn(v)) + ' s</text>';
    });
    svg += "</svg>";
    return h("div", { class: "lab-sched-wrap", html: svg });
  }

  function tiles(list) {
    return h("div", { class: "tada-tiles lab-tiles" }, list.map(function (t) {
      return h("div", { class: "tada-tile" + (t.cls ? " tada-tile--" + t.cls : "") }, [
        h("span", { class: "tada-tile__label", text: t.label }),
        h("span", { class: "tada-tile__value" }, [String(t.value), t.unit ? h("span", { class: "tada-tile__unit", text: t.unit }) : null]),
        t.sub ? h("span", { class: "tada-tile__delta", text: t.sub }) : null
      ]);
    }));
  }
  function progressBox(text) {
    return h("div", { class: "lab-progress" }, [h("div", { class: "lab-progress__bar" }, [h("span")]), h("div", { class: "lab-progress__text", text: text })]);
  }
  function setProgress(body, st) {
    var bar = body.querySelector(".lab-progress__bar span"), txt = body.querySelector(".lab-progress__text");
    if (!bar) return;
    if (st.frac != null) { bar.style.width = Math.round(st.frac * 100) + "%"; bar.parentNode.classList.remove("is-indet"); }
    else bar.parentNode.classList.add("is-indet");
    if (st.stage && txt) txt.textContent = st.stage === "queued" ? "Queued…" : st.stage.charAt(0).toUpperCase() + st.stage.slice(1) + "…";
    if (st.live) liveConsole(body, st.live);
  }
  // Live view of a running search: where the executed episode is, how good the latest unbeaten plan is
  // (and how that evolved, plan by plan), the candidates of the plan being built, and the last plans as chips.
  // Every "x/N" counts the whole (stitched) stream.
  function liveConsole(body, live) {
    var box = body.querySelector(".lab-live");
    if (!box) { box = h("div", { class: "lab-live" }); var pb = body.querySelector(".lab-progress"); body.insertBefore(box, pb ? pb.nextSibling : null); box._plans = []; }
    var N = live.n_flights || totalFlights();
    if (live.last_plan && (!box._plans.length || box._plans[box._plans.length - 1].t !== live.last_plan.t)) box._plans.push(live.last_plan);
    function chip(c, chosen) {
      var cls = c.pruned ? "pruned" : c.los ? "los" : c.on_time === N ? "solved" : "partial";
      return h("span", { class: "lab-chip-k lab-chip-k--" + cls + (chosen ? " is-chosen" : ""),
        title: "k" + c.k + " " + c.kind + (c.pruned ? " (pruned: could not beat the best)" : ": " + c.on_time + "/" + N + " on time" + (c.los ? ", ends in LoS" : "") +
          (c.dev_sum != null ? ", Σ|dev| " + Math.round(c.dev_sum) + " s" : "") + ", " + c.clearances + " clearances") },
        [c.pruned ? "·" : c.los ? "✗" : String(c.on_time)]);
    }
    box.innerHTML = "";
    box.appendChild(h("div", { class: "lab-live__head" }, [
      h("b", { text: live.planning ? "PLANNING · plan " + live.plan + ", candidate " + live.candidate + "/" + live.of : "FLYING THE PLAN" }),
      h("span", { text: live.rollouts + " rollouts · " + (live.pruned || 0) + " pruned · " + (live.switches || 0) + " switches" +
        (live.threads > 1 ? " · " + live.threads + " threads" : "") + (live.elapsed_s != null ? " · " + live.elapsed_s.toFixed(1) + " s" : "") })]));
    // the executed episode so far
    var landed = live.landed || 0, onT = live.on_time || 0;
    box.appendChild(h("div", { class: "lab-live__now" }, [
      h("span", {}, ["t+", h("b", { text: fmtT(live.t || 0) })]),
      h("span", {}, ["decision ", h("b", { text: String(live.decisions || 0) })]),
      h("span", {}, ["landed ", h("b", { text: landed + "/" + N })]),
      h("span", { class: landed && onT < landed ? "is-warn" : landed ? "is-ok" : null }, ["on time so far ", h("b", { text: onT + "/" + landed })]),
      h("span", {}, ["clearances ", h("b", { text: String(live.clearances || 0) })]),
      h("span", { class: "lab-live__bar" }, [h("i", { style: "width:" + Math.round(100 * landed / Math.max(1, N)) + "%" })])
    ]));
    // the latest unbeaten plan: what it predicts for the whole stream
    var b = live.best || (live.history && live.history.length ? live.history[live.history.length - 1] : null);
    if (b) box.appendChild(h("div", { class: "lab-live__best" + (b.los ? " is-los" : b.on_time === N ? " is-solved" : "") }, [
      h("span", { class: "lab-live__tag", text: live.planning && live.best ? "BEST SO FAR" : "LATEST UNBEATEN PLAN" }),
      h("b", { text: b.on_time + "/" + N }), " on time · ",
      h("b", { text: b.los ? "ends in LoS" : "no LoS" }),
      b.dev_sum != null ? h("span", {}, [" · Σ|dev| ", h("b", { text: Math.round(b.dev_sum) + " s" })]) : null,
      " · ", h("b", { text: String(b.clearances) }), " clearances",
      b.k != null ? h("span", { class: "lab-live__k", text: " (k" + b.k + " " + b.kind + ")" }) : null]));
    // how the chosen plan's prediction evolved
    var hist = live.history || [];
    if (hist.length > 1) {
      var cvs = h("canvas", { class: "lab-live__spark", "aria-label": "predicted on-time flights of the chosen plan, plan by plan" });
      box.appendChild(h("div", { class: "lab-live__sparkrow" }, [h("span", { class: "lab-live__t", text: "per plan" }), cvs]));
      if (cvs.isConnected) spark(cvs, hist, N); else requestAnimationFrame(function () { spark(cvs, hist, N); });
    }
    // the plan being built
    if (live.planning && (live.cands_now || []).length)
      box.appendChild(h("div", { class: "lab-live__row is-latest is-now" }, [
        h("span", { class: "lab-live__t", text: "now" }),
        h("span", { class: "lab-live__chips" }, live.cands_now.map(function (c) { return chip(c, live.best && c.k === live.best.k); })
          .concat(live.candidate < live.of ? [h("span", { class: "lab-chip-k lab-chip-k--pending", text: "…" })] : [])),
        h("span", { class: "lab-live__pick", text: "of " + live.of })]));
    box._plans.slice(-6).reverse().forEach(function (pl, n) {
      box.appendChild(h("div", { class: "lab-live__row" + (n === 0 && !live.planning ? " is-latest" : "") }, [
        h("span", { class: "lab-live__t", text: "t+" + fmtT(pl.t) }),
        h("span", { class: "lab-live__chips" }, (pl.cands || []).map(function (c) { return chip(c, c.chosen); })),
        h("span", { class: "lab-live__pick", text: "→ k" + pl.chosen + (pl.switched ? " ★ switched" : "") })
      ]));
    });
  }
  // sparkline: on-time flights of the chosen plan at every plan (gold), Σ|dev| (muted, lower is better), LoS in red
  function spark(c, hist, N) {
    var dpr = window.devicePixelRatio || 1, w = c.clientWidth || 300, hh = 44;
    c.width = w * dpr; c.height = hh * dpr; c.style.height = hh + "px";
    var x = c.getContext("2d"), n = hist.length, W = c.width, H = c.height, p = 4 * dpr;
    var lo = Math.min.apply(null, hist.map(function (q) { return q.on_time; })), hi = N;
    if (hi - lo < 2) lo = hi - 2;
    var dmax = Math.max.apply(null, hist.map(function (q) { return q.dev_sum || 0; })) || 1;
    function X(k) { return p + (W - 2 * p - 40 * dpr) * k / Math.max(1, n - 1); }
    function Y(v) { return H - p - (H - 2 * p) * (v - lo) / Math.max(1, hi - lo); }
    x.fillStyle = "#02060d"; x.fillRect(0, 0, W, H);
    x.strokeStyle = "rgba(62,224,122,0.25)"; x.setLineDash([3 * dpr, 3 * dpr]); x.beginPath(); x.moveTo(p, Y(N)); x.lineTo(X(n - 1), Y(N)); x.stroke(); x.setLineDash([]);
    x.strokeStyle = "rgba(125,143,179,0.7)"; x.lineWidth = 1 * dpr; x.beginPath();
    hist.forEach(function (q, k) { var yy = H - p - (H - 2 * p) * (1 - (q.dev_sum || 0) / dmax); if (k) x.lineTo(X(k), yy); else x.moveTo(X(k), yy); }); x.stroke();
    x.strokeStyle = "#ffd23f"; x.lineWidth = 2 * dpr; x.beginPath();
    hist.forEach(function (q, k) { if (k) { x.lineTo(X(k), Y(hist[k - 1].on_time)); x.lineTo(X(k), Y(q.on_time)); } else x.moveTo(X(k), Y(q.on_time)); }); x.stroke();
    hist.forEach(function (q, k) {
      if (q.los) { x.fillStyle = "#ff6b8b"; x.beginPath(); x.arc(X(k), Y(q.on_time), 2.6 * dpr, 0, 7); x.fill(); }
      else if (q.switched) { x.fillStyle = "#ffd23f"; x.beginPath(); x.arc(X(k), Y(q.on_time), 2.2 * dpr, 0, 7); x.fill(); }
    });
    var last = hist[n - 1];
    x.fillStyle = "#ffd23f"; x.font = "600 " + (10 * dpr) + "px " + css("--tada-font-mono");
    x.fillText(last.on_time + "/" + N, X(n - 1) + 5 * dpr, Math.max(11 * dpr, Y(last.on_time) + 3 * dpr));
  }
  function errBox(e) { return h("div", { class: "lab-error", text: "⚠ " + (e && e.message || e) }); }

  // ---------------------------------------------------------------- 3. fly
  function syncFlightTitle() {
    var b = $("#lab-fly"); if (b) b.querySelector("b").textContent = S.agent;
  }
  function flySelected(quiet) {
    writeHash();
    var token = S.flyToken = (S.flyToken || 0) + 1;  // a newer flight supersedes this one
    S.flying = true; S.autoFly = S.agent !== "do-nothing";
    var body = $("#lab-flight-body");
    var job = { scenario: S.sc, agent: S.agent, mode: S.agent === "do-nothing" ? "det" : S.mode, attempts: S.mode === "sampled" ? S.attempts : 0 };
    if (job.mode === "search" && S.catalog.search_params) job.search = searchParamsForJob();
    if (job.mode === "search" && S.catalog.cores) {
      job.threads = S.search.T || defaultThreads();
      try { localStorage.setItem("tada-lab-threads", job.threads); } catch (e) {}
    }
    S.flyingJob = job;
    $("#lab-flight-title").textContent = "Flight · " + S.agent + " · " + modeLabel(job);
    body.innerHTML = ""; body.appendChild(progressBox("Flying…"));
    if (!quiet) body.scrollIntoView({ behavior: "smooth", block: "start" });
    var want = scKey(S.sc);
    runJob("fly", job, function (st) {
      if (token !== S.flyToken) return;
      setProgress(body, st);
      // the episode so far, after each finished plan: the radar follows it live
      if (st.partial && st.partialN !== body._partialN) {
        body._partialN = st.partialN;
        var host = body.querySelector(".lab-livereplay");
        if (!host) { host = h("div", { class: "lab-livereplay" }); body.appendChild(host); }
        var el = Replay.mount(st.partial, { live: true, keep: !!host.firstChild });
        if (host.firstChild) host.replaceChild(el, host.firstChild); else host.appendChild(el);
      }
    })
      .then(function (st) { return loadFlight(st.key).then(function (d) {
        if (token !== S.flyToken) return;
        S.flying = false;
        if (want === scKey(S.sc)) showFlight(d, st.key);
        else if (S.autoFly) flySelected(true);  // the scenario changed while this one flew
        refreshRows();
      }); })
      .catch(function (e) {
        if (token !== S.flyToken) return;  // superseded (e.g. a cancelled search)
        S.flying = false;
        var id = needDownload(e);
        if (id) { downloadPrompt(body, id, id + (ENGINE ? " is not loaded in this browser yet." : " is not on this runner yet.")); return; }
        body.innerHTML = ""; body.appendChild(errBox(e));
      });
  }
  function flyAll() {
    var list = agentsFor(S.sc.procedure);
    list.filter(function (a) { return a.installed; }).forEach(function (a) { api("/fly", { scenario: S.sc, agent: a.id, mode: "det" }).catch(function () {}); });
    pollRows(0);
  }
  function pollRows(n) {
    refreshRows().then(function (rows) {
      if (rows.some(function (r) { return r.pending; }) && n < 400) setTimeout(function () { pollRows(n + 1); }, 1500);
    });
  }

  function showFlight(d, key) {
    S.flight = d; S.flightKey = key;
    var j = d.job, s = d.summary;
    $("#lab-flight-title").textContent = "Flight · " + j.agent + (j.agent === "do-nothing" ? " (scenario as generated)" : " · " + modeLabel(j)) +
      " · " + S.catalog.procedures[j.scenario.procedure].label + " " + scLabel(j.scenario);
    var body = $("#lab-flight-body"); body.innerHTML = "";
    var oc = s.los ? { v: "LoS", c: "bad", sub: "loss of separation (≤ 3 NM, ≤ 500 ft)" }
      : s.solved ? { v: s.hard_solved ? "SOLVED ±30" : "SOLVED", c: "ok", sub: "every flight within ±" + (s.hard_solved ? 30 : 60) + " s" }
        : { v: s.end_reason.toUpperCase(), c: "warn", sub: "not every flight on time" };
    var t = [
      { label: "Outcome", value: oc.v, cls: oc.c, sub: oc.sub },
      { label: "On time (±60 s)", value: s.on_time + "/" + s.n_flights, cls: s.on_time === s.n_flights ? "ok" : "" , sub: s.landed + " landed" },
      { label: "Max |landing dev|", value: Math.round(s.max_dev), unit: "s", cls: s.landed ? (s.max_dev <= 60 ? "ok" : "warn") : "" },
      { label: "Clearances", value: s.clearances },
      { label: "Min separation", value: s.min_separation_nm == null ? "–" : (+s.min_separation_nm).toFixed(1), unit: s.min_separation_nm == null ? null : "NM", cls: s.los ? "bad" : "" }
    ];
    if (d.attempts.length > 1) t.push({ label: "Attempt kept", value: d.chosen_attempt, sub: "of " + d.attempts.length + " (0 = deterministic)" });
    if (d.search) t.push({ label: "Search", value: d.search.n_rollouts, unit: "rollouts",
      sub: d.search.n_plans + " plans · " + d.elapsed_s + " s" + (d.threads > 1 ? " on " + d.threads + " threads" : "") });
    body.appendChild(tiles(t));

    var tabs = [["replay", "Replay"], ["video", "MP4 render"], ["flights", "Flights"], ["clearances", "Clearances"]];
    if (d.attempts.length > 1) tabs.push(["attempts", "Attempts"]);
    var bar = h("div", { class: "lab-tabs", role: "tablist" });
    var panes = h("div", { class: "lab-panes" });
    var current = S.tab || "replay";
    if (!tabs.some(function (x) { return x[0] === current; })) current = "replay";
    tabs.forEach(function (tb) {
      bar.appendChild(h("button", { type: "button", role: "tab", class: "lab-tab" + (tb[0] === current ? " is-on" : ""), "data-tab": tb[0],
        onclick: function () { S.tab = tb[0]; root.querySelectorAll(".lab-tab").forEach(function (b) { b.classList.toggle("is-on", b.getAttribute("data-tab") === tb[0]); });
          root.querySelectorAll(".lab-pane").forEach(function (p) { p.hidden = p.getAttribute("data-pane") !== tb[0]; }); if (tb[0] === "replay") Replay.resize(); } }, [tb[1]]));
    });
    body.appendChild(bar); body.appendChild(panes);
    function pane(id, el) { var p = h("div", { class: "lab-pane", "data-pane": id }, [el]); p.hidden = id !== current; panes.appendChild(p); }
    pane("replay", Replay.mount(d, { keep: Replay.isLive() && current === "replay" }));
    pane("video", videoPane(d, key));
    pane("flights", flightsTable(d));
    pane("clearances", clearancesPane(d));
    if (d.attempts.length > 1) pane("attempts", attemptsTable(d));
    markRows();
  }

  function videoPane(d, key) {
    var box = h("div", { class: "lab-video" });
    if (ENGINE) {
      box.appendChild(h("p", { class: "lab-field__hint", html: "The official MP4 render is drawn by a lab runner (matplotlib). " +
        "In the browser, the Replay tab shows the same flight. <a href=\"#run-the-lab\">Run the Lab on your machine \u2193</a>" }));
      return box;
    }
    function show() {
      box.innerHTML = "";
      box.appendChild(h("video", { controls: true, preload: "metadata", src: BASE + "/lab-cache/" + key + ".mp4" }));
      box.appendChild(h("div", { class: "lab-caption" }, [h("span", { class: "tada-render__by", text: "Rendered by " + d.job.agent }),
        " · seed " + d.job.scenario.seed + " · " + MODE_LABEL[d.job.mode] + " · " + d.summary.on_time + " of " + d.summary.n_flights + " on time · " + d.summary.clearances + " clearances",
        " · ", h("a", { href: BASE + "/lab-cache/" + key + ".mp4", download: key + ".mp4", target: "_blank", rel: "noopener", text: "download" })]));
    }
    box.appendChild(progressBox("Drawing the official render (matplotlib, ~1 frame per decision)…"));
    runJob("render", { key: key }, function (st) { setProgress(box, st); }).then(function () {
      if (S.flightKey === key) show(); refreshRows();
    }).catch(function (e) { box.innerHTML = ""; box.appendChild(errBox(e)); });
    return box;
  }

  function devCell(v, src) {
    var c = Math.abs(v) <= 30 ? "ok" : Math.abs(v) <= 60 ? "ok2" : Math.abs(v) <= 300 ? "warn" : "bad";
    return h("td", { class: "num lab-dev lab-dev--" + c, "data-sort": v, title: src && src !== "landed" ? src : null }, [sgn(v) + (src && src !== "landed" ? "*" : "")]);
  }
  function flightsTable(d) {
    var t = h("table", { class: "tada-table lab-table" });
    t.appendChild(h("thead", {}, [h("tr", {}, ["#", "Flight", "AMAN target", "AMAN TTL", "Do-nothing", "Final", "Clearances"].map(function (c) { return h("th", { text: c }); }))]));
    var tb = h("tbody");
    d.flights.forEach(function (f, i) {
      tb.appendChild(h("tr", {}, [
        h("td", { class: "num" }, [h("span", { class: "lab-swatch", style: "background:" + TAB20[i % 20] }), String(i + 1)]),
        h("td", { class: "tada-mono", text: f.callsign }),
        h("td", { class: "num", text: "t+" + fmtT(f.eta_s) }),
        h("td", { class: "num", text: sgn(f.aman_ttl) + " s" }),
        devCell(f.initial), devCell(f.final, f.final_source),
        h("td", { class: "num", text: f.clearances })
      ]));
    });
    t.appendChild(tb);
    return h("div", {}, [h("div", { class: "tada-table-wrap" }, [t]),
      h("div", { class: "lab-field__hint", text: "Deviations in seconds, negative early. * not landed: the do-nothing prediction from where the episode stopped." })]);
  }
  function clearancesPane(d) {
    var picks = d.summary.picks || {}, names = Object.keys(picks).filter(function (n) { return n !== "DO_NOTHING"; });
    names.sort(function (a, b) { return picks[b] - picks[a]; });
    var max = names.reduce(function (m, n) { return Math.max(m, picks[n]); }, 1);
    var box = h("div", { class: "lab-bars" });
    if (!names.length) box.appendChild(h("p", { text: "No clearances issued." }));
    names.forEach(function (n) {
      box.appendChild(h("div", { class: "lab-bars__row" }, [
        h("span", { class: "lab-bars__abbr tada-mono", text: ABBR[n] || n }),
        h("span", { class: "lab-bars__name", text: pretty(n) }),
        h("span", { class: "lab-bars__track" }, [h("span", { class: "lab-bars__fill", style: "width:" + (100 * picks[n] / max) + "%" })]),
        h("span", { class: "lab-bars__n num", text: picks[n] })
      ]));
    });
    return box;
  }
  function attemptsTable(d) {
    var t = h("table", { class: "tada-table lab-table" });
    t.appendChild(h("thead", {}, [h("tr", {}, ["Attempt", "Outcome", "On time", "Max |dev|", "Clearances"].map(function (c) { return h("th", { text: c }); }))]));
    var tb = h("tbody");
    d.attempts.forEach(function (a) {
      tb.appendChild(h("tr", { class: a.attempt === d.chosen_attempt ? "is-champion" : null }, [
        h("td", { class: "num", text: a.attempt === 0 ? "0 (det)" : a.attempt }),
        h("td", {}, [outcomeChip(a)]),
        h("td", { class: "num", text: a.on_time + "/" + a.n_flights }),
        h("td", { class: "num", text: Math.round(a.max_dev) + " s" }),
        h("td", { class: "num", text: a.clearances })
      ]));
    });
    t.appendChild(tb);
    return h("div", { class: "tada-table-wrap" }, [t]);
  }
  function outcomeChip(s) {
    if (s.los) return h("span", { class: "tada-chip tada-chip--bad", text: "LoS" });
    if (s.solved) return h("span", { class: "tada-chip tada-chip--ok", text: s.hard_solved ? "solved ±30" : "solved" });
    return h("span", { class: "tada-chip tada-chip--warn", text: s.end_reason });
  }

  // ---------------------------------------------------------------- comparison on this scenario
  function refreshRows() {
    return api("/scenario?" + scQuery()).then(function (rows) { S.rows = rows; renderRows(); return rows; }).catch(function () { return []; });
  }
  function rank(r) {
    var s = r.summary; if (!s) return [-1, 0, 0, 0];
    return [s.los ? 0 : 1, s.solved ? 1 : 0, s.on_time, -s.clearances];
  }
  function cmpRank(a, b) { var x = rank(a), y = rank(b); for (var i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0; }
  function renderRows() {
    var body = $("#lab-cmp-body"); if (!body) return;
    body.innerHTML = "";
    var rows = S.rows.slice().sort(cmpRank);
    if (!rows.length) { body.appendChild(h("p", { class: "lab-field__hint", text: "Nothing flown here yet." })); return; }
    var t = h("table", { class: "tada-table lab-table lab-table--click" });
    t.appendChild(h("thead", {}, [h("tr", {}, ["Agent", "Mode", "Outcome", "On time", "Max |dev|", "Mean |dev|", "Clearances", "MP4"].map(function (c) { return h("th", { text: c }); }))]));
    var tb = h("tbody");
    rows.forEach(function (r) {
      var s = r.summary;
      var tr = h("tr", { "data-key": r.key, class: r.key === S.flightKey ? "is-champion" : null, onclick: s ? function () {
        loadFlight(r.key).then(function (d) {
          S.agent = d.job.agent; if (d.job.agent !== "do-nothing") { S.mode = d.job.mode; if (d.job.mode === "sampled") S.attempts = d.job.attempts; }
          renderAgents(); writeHash(); showFlight(d, r.key);
          $("#lab-flight-body").scrollIntoView({ behavior: "smooth", block: "start" });
        });
      } : null }, s ? [
        h("td", { class: "tada-mono", text: r.agent }),
        h("td", { text: r.mode.replace(/^sampled/, "best of ").replace(/^search-K(\d+)-M(\d+)-J(\d+)\w*-L\d+$/, function (_, k, m, jj) { return "search K" + k + " M" + m + (+jj ? " J" + jj : ""); }) }),
        h("td", {}, [outcomeChip(s)]),
        h("td", { class: "num", text: s.on_time + "/" + s.n_flights }),
        h("td", { class: "num", text: s.landed ? Math.round(s.max_dev) + " s" : "–" }),
        h("td", { class: "num", text: s.landed ? Math.round(s.mean_dev) + " s" : "–" }),
        h("td", { class: "num", text: s.clearances }),
        h("td", { text: r.has_video ? "▶" : "" })
      ] : [h("td", { class: "tada-mono", text: r.agent }), h("td", { text: r.mode }), h("td", { colspan: 6, class: "lab-field__hint", text: (r.stage || "queued") + "…" })]);
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    body.appendChild(h("div", { class: "tada-table-wrap" }, [t]));
  }
  function markRows() { root.querySelectorAll(".lab-cmp tr[data-key]").forEach(function (tr) { tr.classList.toggle("is-champion", tr.getAttribute("data-key") === S.flightKey); }); }

  // ---------------------------------------------------------------- replay (canvas)
  var Replay = (function () {
    // Bright flight colours for a dark scope, in AMAN order (the strip and the map share them).
    var BRIGHT = ["#4cc9f0", "#f72585", "#7bf1a8", "#ffd166", "#b388ff", "#ff8c42", "#06d6a0", "#ef476f", "#a0c4ff", "#f9c74f",
      "#90e0ef", "#ff70a6", "#c3f73a", "#ffadad", "#9b5de5", "#00f5d4", "#fee440", "#f15bb5", "#00bbf9", "#e9ff70"];
    var SECTOR_HUES = ["#66c2a5", "#fc8d62", "#8da0cb", "#e78ac3", "#a6d854", "#ffd92f", "#e5c494", "#80b1d3", "#fb8072", "#bebada"];
    var FADE = 5;        // decisions a clearance glyph stays on the scope
    var TRAIL = 12;      // decisions of track history drawn behind each aircraft
    var LAYERS_KEY = "tada-lab-layers-v2";
    // starts quiet: call-sign tags only; full data blocks are one click away
    var layers = { sectors: true, rings: true, routes: true, labels: "tags", plans: true, view: "2d", exag: 5 };
    // predicted rollouts of the search: their own palette, so they never read as real traffic. Only the latest
    // unbeaten plan (the one being flown) is gold; the other candidates stay muted.
    var PRED = { chosen: "#ffd23f", other: "#7d8fb3", los: "#b5677a", pruned: "#4c566a", text: "rgba(200,212,235,0.85)" };
    var PAST = 720, AHEAD = 240;   // the clearance window: 12 min of history, 4 min ahead of now
    try { Object.assign(layers, JSON.parse(localStorage.getItem(LAYERS_KEY) || "{}")); } catch (e) {}
    if (["off", "tags", "full"].indexOf(layers.labels) < 0) layers.labels = "tags";
    function saveLayers() { try { localStorage.setItem(LAYERS_KEY, JSON.stringify(layers)); } catch (e) {} }

    var d, frames, colors, playing = false, speed = 2, u = 0, raf = null, lastTs = 0;
    var view = { zoom: 1, cx: null, cy: null }, proj = null;  // zoom/pan (world NM at the canvas centre)
    var tl, tlCtx, tlCache = null, tlGeo = null, tlHover = null, life = {};    // the clearance timeline
    var plans = [];                                                             // search plans (in-browser engine)
    var cv, ctx, strip, sctx, slider, tlabel, playBtn, bounds, evByFrame, wrap, airport, procLabel, sectors;
    var segOf = {};                                                      // composed stream: callsign -> segment
    var initialOf = {}, devHover = null, devGeo = null;                  // the whole-stream deviation chart
    // the 3D view: an orbit camera around a ground point (yaw from north, pitch above the horizon, distance in NM)
    var cam = null, spin = null, FT_NM = 1 / 6076.12;
    var wcv, wctx, evByCs, winN = 10, dtDec = 45, rowsNow = [];          // the agent's window (centre panel)
    var live = false, follow = false;                                   // a search in progress, radar following it

    // ------------------------------------------------------------------ clearance glyphs
    function category(name) {
      var n = { SMALL: 1, MEDIUM: 2, LARGE: 3 };
      if (/^SLOW_DOWN_/.test(name)) return { kind: "slow", n: n[name.slice(10)] || 1, color: "#ffb627", label: "slow down" };
      if (/^SPEED_UP_/.test(name)) return { kind: "fast", n: n[name.slice(9)] || 1, color: "#3fd0ff", label: "speed up" };
      if (/^TURN_LEFT/.test(name)) return { kind: "turn", dir: -1, color: "#ff4fd8", label: "turn left, rejoin" };
      if (/^TURN_RIGHT/.test(name)) return { kind: "turn", dir: 1, color: "#ff4fd8", label: "turn right, rejoin" };
      if (name === "LENGTHEN_TROMBONE") return { kind: "tromb", plus: true, color: "#c39bff", label: "lengthen trombone" };
      if (name === "SHORTEN_TROMBONE") return { kind: "tromb", plus: false, color: "#c39bff", label: "shorten trombone" };
      if (/^SKIP_/.test(name)) return { kind: "skip", n: +name.charAt(5) || 1, color: "#3ee07a", label: "skip waypoints" };
      if (name === "VECTOR_TO_ILS") return { kind: "ils", color: "#f4f8ff", label: "vector to ILS" };
      if (name === "DIRECT_TO_MERGE_POINT") return { kind: "merge", color: "#f4f8ff", label: "direct to merge point" };
      return { kind: "dot", color: "#ffffff", label: name };
    }
    // One glyph, centred on (x, y), about s pixels across.
    function drawGlyph(c, x, y, s, cat) {
      c.save();
      c.translate(x, y);
      c.strokeStyle = cat.color; c.fillStyle = cat.color;
      c.lineWidth = Math.max(1.5, s * 0.14); c.lineJoin = "round"; c.lineCap = "round";
      var h = s / 2;
      if (cat.kind === "slow" || cat.kind === "fast") {
        var k = cat.n, step = s * 0.3, top = -((k - 1) * step) / 2, sign = cat.kind === "slow" ? 1 : -1;
        for (var j = 0; j < k; j++) {
          var cy = top + j * step;
          c.beginPath(); c.moveTo(-h * 0.8, cy - sign * s * 0.16); c.lineTo(0, cy + sign * s * 0.16); c.lineTo(h * 0.8, cy - sign * s * 0.16); c.stroke();
        }
      } else if (cat.kind === "turn") {
        var r = h * 0.72, a0 = -Math.PI / 2, a1 = a0 + cat.dir * Math.PI * 1.35;
        c.beginPath(); c.arc(0, 0, r, a0, a1, cat.dir < 0); c.stroke();
        var ex = r * Math.cos(a1), ey = r * Math.sin(a1), tang = a1 + cat.dir * Math.PI / 2;
        c.beginPath();
        c.moveTo(ex + Math.cos(tang) * s * 0.28, ey + Math.sin(tang) * s * 0.28);
        c.lineTo(ex + Math.cos(tang + 2.5) * s * 0.24, ey + Math.sin(tang + 2.5) * s * 0.24);
        c.lineTo(ex + Math.cos(tang - 2.5) * s * 0.24, ey + Math.sin(tang - 2.5) * s * 0.24);
        c.closePath(); c.fill();
      } else if (cat.kind === "tromb") {
        c.beginPath(); c.moveTo(-h * 0.55, -h * 0.8); c.lineTo(-h * 0.55, h * 0.1);
        c.arc(0, h * 0.1, h * 0.55, Math.PI, 0, true); c.lineTo(h * 0.55, -h * 0.8); c.stroke();
        c.beginPath(); c.moveTo(-h * 0.28, -h * 0.35); c.lineTo(h * 0.28, -h * 0.35);
        if (cat.plus) { c.moveTo(0, -h * 0.63); c.lineTo(0, -h * 0.07); }
        c.stroke();
      } else if (cat.kind === "skip") {
        for (var q = 0; q < 2; q++) {
          var ox = -h * 0.45 + q * h * 0.55;
          c.beginPath(); c.moveTo(ox - h * 0.25, -h * 0.55); c.lineTo(ox + h * 0.25, 0); c.lineTo(ox - h * 0.25, h * 0.55); c.stroke();
        }
        c.font = "700 " + Math.round(s * 0.5) + "px " + css("--tada-font-mono");
        c.fillText(String(cat.n), h * 0.62, h * 0.85);
      } else if (cat.kind === "ils") {
        c.beginPath(); c.moveTo(0, -h); c.lineTo(h * 0.7, 0); c.lineTo(0, h); c.lineTo(-h * 0.7, 0); c.closePath(); c.stroke();
        c.beginPath(); c.moveTo(0, -h * 0.45); c.lineTo(0, h * 0.45); c.stroke();
      } else if (cat.kind === "merge") {
        c.beginPath(); c.arc(0, 0, h * 0.8, 0, 2 * Math.PI); c.stroke();
        c.beginPath(); c.arc(0, 0, h * 0.3, 0, 2 * Math.PI); c.fill();
      } else {
        c.beginPath(); c.arc(0, 0, h * 0.4, 0, 2 * Math.PI); c.fill();
      }
      c.restore();
    }
    function glyphIcon(cat) {
      var dpr = window.devicePixelRatio || 1, px = 18, c = h("canvas", { class: "lab-lg-glyph", width: px * dpr, height: px * dpr });
      c.style.width = px + "px"; c.style.height = px + "px";
      drawGlyph(c.getContext("2d"), px * dpr / 2, px * dpr / 2, 13 * dpr, cat);
      return c;
    }
    function shortCs(cs) { return cs.replace(/^[A-Z]+0*/, "#"); }

    // ------------------------------------------------------------------ setup
    function isLive() { return live && !!(wrap && wrap.isConnected); }
    function mount(data, opts) {
      opts = opts || {};
      var keep = !!(opts.keep && frames && frames.length), was = { u: u, playing: playing, view: view, n: keep ? frames.length : 0,
        follow: follow || (keep && u >= frames.length - 1.01), cv: cv, win: wcv, strip: strip, tl: tl };
      stop();
      d = data; frames = d.trace.frames; u = 0;
      live = !!opts.live;
      colors = {};
      d.trace.queue.forEach(function (cs, k) { colors[cs] = BRIGHT[k % BRIGHT.length]; });
      frames.forEach(function (f) { f.by = {}; f.ac.forEach(function (a) { f.by[a[0]] = a; }); });
      // the agent's window at each decision (AMAN order); older flights without it: the first 10 not yet landed
      winN = 10;
      frames.forEach(function (f) {
        if (!f.win) f.win = d.trace.queue.filter(function (cs) { return f.by[cs] && f.by[cs][5] !== 2; }).slice(0, 10);
        f.slot = {}; f.win.forEach(function (cs, k) { f.slot[cs] = k; });
        winN = Math.max(winN, f.win.length);
      });
      dtDec = frames.length > 1 ? (frames[frames.length - 1].t - frames[0].t) / (frames.length - 1) : 45;
      sectors = (S.catalog && S.catalog.sectors) || [];
      procLabel = ((d.job && d.job.scenario && d.job.scenario.procedure) || "") === "pms" ? "BGY" : "MXP";
      // the airport: where the flight plans end
      var ends = [];
      Object.keys(d.trace.routes).forEach(function (cs) { var r = d.trace.routes[cs]; if (r.length) ends.push(r[r.length - 1]); });
      airport = ends.length ? [ends.reduce(function (s, p) { return s + p[0]; }, 0) / ends.length,
        ends.reduce(function (s, p) { return s + p[1]; }, 0) / ends.length] : [0, 0];
      // bounds: flight plans and every airborne position
      var xs = [], ys = [];
      Object.keys(d.trace.routes).forEach(function (cs) { d.trace.routes[cs].forEach(function (p) { xs.push(p[0]); ys.push(p[1]); }); });
      frames.forEach(function (f) { f.ac.forEach(function (a) { if (a[5] === 1) { xs.push(a[1]); ys.push(a[2]); } }); });
      if (!xs.length) { xs = [-50, 50]; ys = [-50, 50]; }
      var pad = 4;
      bounds = { x0: Math.min.apply(null, xs) - pad, x1: Math.max.apply(null, xs) + pad, y0: Math.min.apply(null, ys) - pad, y1: Math.max.apply(null, ys) + pad };
      // clearances attach to the first frame at or after their time (the state they produced)
      evByFrame = frames.map(function () { return []; });
      var fi = 0;
      d.trace.events.forEach(function (e) {
        while (fi < frames.length - 1 && frames[fi].t < e.t - 1e-6) fi++;
        e.cat = category(d.clearance_names[String(e.clr)] || "");
        e.name = d.clearance_names[String(e.clr)] || "";
        e.slot = evByFrame[fi].filter(function (o) { return o.cs === e.cs; }).length;
        evByFrame[fi].push(e);
      });

      view = { zoom: 1, cx: (bounds.x0 + bounds.x1) / 2, cy: (bounds.y0 + bounds.y1) / 2 };
      if (!cam || !opts.keep) cam = defaultCam();
      // per flight: when it came under control, when it landed and how far off
      life = {};
      d.trace.queue.forEach(function (cs) { life[cs] = { on: null, land: null, dev: null, seen: null }; });
      frames.forEach(function (f) {
        f.ac.forEach(function (a) {
          var L = life[a[0]];
          if (!L) return;
          if (L.seen == null) L.seen = f.t;
          if (a[5] >= 1 && L.on == null) L.on = f.t;
          if (a[5] === 2 && L.land == null) { L.land = f.t; L.dev = a[6]; }
        });
      });
      evByFrame.forEach(function (list, k) { list.forEach(function (e) { e.fi = k; }); });
      initialOf = {};
      (d.flights || []).forEach(function (f) { initialOf[f.callsign] = f.initial; });
      segOf = {};
      (d.composition || []).forEach(function (sg, k) { (sg.callsigns || []).forEach(function (cs) { segOf[cs] = k; }); });
      evByCs = {};
      d.trace.events.forEach(function (e) { (evByCs[e.cs] = evByCs[e.cs] || []).push(e); });
      plans = (d.plans || []).slice().sort(function (a, b) { return a.t - b.t; });
      plans.forEach(function (pl) {
        pl.cands.forEach(function (c) {
          c.byCs = {};
          (c.track || []).forEach(function (f) { f.ac.forEach(function (r) { (c.byCs[r[0]] = c.byCs[r[0]] || []).push([f.t, r[1], r[2], r[3] || 0]); }); });
        });
      });
      tl = h("canvas", { class: "lab-timeline", "aria-label": "clearance timeline: click or drag to seek" });
      tlCache = null; tlHover = null;
      attachTimeline(tl);
      cv = h("canvas", { class: "lab-map", "aria-label": "radar replay: Ctrl + scroll to zoom, drag to pan, double-click to reset" });
      attachZoom(cv);
      strip = h("canvas", { class: "lab-dev", "aria-label": "landing deviation of every flight in the stream: click a flight to jump to its landing" });
      attachDev(strip);
      wcv = h("canvas", { class: "lab-win", "aria-label": "clearances of the flights in the agent's window" });
      slider = h("input", { type: "range", min: 0, max: frames.length - 1, step: 1, value: 0, class: "lab-range lab-scrub", "aria-label": "time" });
      slider.addEventListener("input", function () { u = +slider.value; follow = false; draw(); });
      tlabel = h("span", { class: "lab-num lab-tlabel" });
      playBtn = h("button", { type: "button", class: "lab-btn lab-btn--play", onclick: toggle, "aria-label": "play" }, ["▶"]);
      var spd = h("div", { class: "lab-seg lab-seg--sm" }, [0.5, 1, 2, 4, 8].map(function (s) {
        return h("button", { type: "button", class: "lab-seg__btn" + (s === speed ? " is-on" : ""), "data-s": s, onclick: function () {
          speed = s; spd.querySelectorAll("button").forEach(function (b) { b.classList.toggle("is-on", +b.getAttribute("data-s") === s); });
        } }, [s + "×"]);
      }));
      // display toolbar: layer toggle buttons and the label density
      var layerList = [["sectors", "Sectors", "#8da0cb"], ["rings", "Range rings", "#3fd0ff"], ["routes", "Flight plans", "#9aabc6"]];
      if (plans.length) layerList.push(["plans", "Search plans", PRED.chosen]);
      var labelSeg = seg("labels", [{ value: "off", label: "Off", title: "No aircraft labels" },
        { value: "tags", label: "Tags", title: "Call signs only" },
        { value: "full", label: "Full", title: "Data blocks: call sign, deviation, flight level, speed" }], layers.labels, function (v) {
        layers.labels = v; saveLayers();
        labelSeg.querySelectorAll("button").forEach(function (b, n) { var on = ["off", "tags", "full"][n] === v; b.classList.toggle("is-on", on); b.setAttribute("aria-checked", on ? "true" : "false"); });
        draw();
      });
      labelSeg.classList.add("lab-seg--sm");
      // 2D scope or 3D view, and the 3D view's camera presets and vertical exaggeration
      function setView(v) {
        layers.view = v; saveLayers();
        viewSeg.querySelectorAll("button").forEach(function (b, n) { var on = ["2d", "3d"][n] === v; b.classList.toggle("is-on", on); b.setAttribute("aria-checked", on ? "true" : "false"); });
        view3d.hidden = v !== "3d"; if (v !== "3d") stopSpin();
        viewBtn.textContent = v === "3d" ? "Radar" : "3D"; viewBtn.title = v === "3d" ? "Back to the radar (plan view)" : "3D view with altitudes";
        draw();
      }
      var viewSeg = seg("view", [{ value: "2d", label: "Radar", title: "Plan view" }, { value: "3d", label: "3D", title: "3D view with altitudes: drag to rotate" }],
        layers.view, setView);
      // the same switch on the scope itself
      var viewBtn = h("button", { type: "button", class: "lab-zoom__btn lab-zoom__view", onclick: function () { setView(layers.view === "3d" ? "2d" : "3d"); } },
        [layers.view === "3d" ? "Radar" : "3D"]);
      viewSeg.classList.add("lab-seg--sm");
      var exagSeg = seg("altitude", [1, 3, 5, 10].map(function (x) { return { value: x, label: "×" + x, title: "Vertical exaggeration ×" + x }; }), layers.exag, function (v) {
        layers.exag = v; saveLayers();
        exagSeg.querySelectorAll("button").forEach(function (b) { b.classList.toggle("is-on", b.textContent === "×" + v); });
        draw();
      });
      exagSeg.classList.add("lab-seg--sm");
      var spinBtn = h("button", { type: "button", class: "lab-zoom__btn lab-view3d__spin", title: "Rotate slowly", "aria-pressed": "false", onclick: function () {
        if (spin) stopSpin(); else startSpin(); spinBtn.setAttribute("aria-pressed", spin ? "true" : "false"); spinBtn.classList.toggle("is-on", !!spin);
      } }, ["⟳"]);
      var view3d = h("div", { class: "lab-view3d" }, [
        h("div", { class: "lab-view3d__row" }, [["Top", 0, 89, 1.2], ["Oblique", -25, 32, 1.05], ["Side", 0, 4, 0.8]].map(function (p) {
          return h("button", { type: "button", class: "lab-zoom__btn lab-view3d__preset", title: p[0] + " view", onclick: function () { flyCam(p[1], p[2], p[3]); } }, [p[0]]);
        }).concat([spinBtn])),
        h("div", { class: "lab-view3d__row" }, [h("span", { class: "lab-layers__label", text: "Altitude" }), exagSeg])
      ]);
      view3d.hidden = layers.view !== "3d";
      var toggles = h("div", { class: "lab-layers", role: "toolbar", "aria-label": "radar display" }, [viewSeg, h("span", { class: "lab-layers__sep", "aria-hidden": "true" })].concat(layerList.map(function (l) {
        var b = h("button", { type: "button", class: "lab-tgl" + (layers[l[0]] ? " is-on" : ""), "aria-pressed": layers[l[0]] ? "true" : "false",
          title: (layers[l[0]] ? "Hide " : "Show ") + l[1].toLowerCase() }, [h("i", { class: "lab-tgl__dot", style: "background:" + l[2] }), l[1]]);
        b.addEventListener("click", function () {
          layers[l[0]] = !layers[l[0]]; saveLayers();
          b.classList.toggle("is-on", layers[l[0]]); b.setAttribute("aria-pressed", layers[l[0]] ? "true" : "false");
          b.title = (layers[l[0]] ? "Hide " : "Show ") + l[1].toLowerCase();
          draw();
        });
        return b;
      })).concat([h("span", { class: "lab-layers__sep", "aria-hidden": "true" }), h("span", { class: "lab-layers__label", text: "Labels" }), labelSeg]));
      var cats = [["SLOW_DOWN_LARGE", "slow down (1–3 steps)"], ["SPEED_UP_MEDIUM", "speed up"], ["TURN_LEFT_AND_RETURN_TO_ROUTE", "turn L/R + rejoin"],
        ["LENGTHEN_TROMBONE", "trombone ±"], ["SKIP_2_WAYPOINTS_NOT_NEXT", "skip n waypoints"],
        [procLabel === "BGY" ? "DIRECT_TO_MERGE_POINT" : "VECTOR_TO_ILS", procLabel === "BGY" ? "direct to merge point" : "vector to ILS"]];
      var legend = h("div", { class: "lab-legend" }, cats.map(function (c) {
        return h("span", {}, [glyphIcon(category(c[0])), c[1]]);
      }).concat(plans.length ? [
        h("span", {}, [h("i", { class: "lab-lg lab-lg--plan" }), "latest unbeaten plan, predicted"]),
        h("span", {}, [h("i", { class: "lab-lg lab-lg--cand" }), "other candidates (rose: ends in LoS)"])
      ] : []).concat([
        h("span", {}, [h("i", { class: "lab-lg lab-lg--warn" }), "< 5 NM & 1000 ft"]),
        h("span", {}, [h("i", { class: "lab-lg lab-lg--bad" }), "loss of separation"])
      ]));
      wrap = h("div", { class: "lab-replay", tabindex: 0 }, [
        toggles,
        h("div", { class: "lab-replay__view" }, [h("div", { class: "lab-replay__map" }, [cv, h("div", { class: "lab-zoom" }, [viewBtn,
          h("button", { type: "button", class: "lab-zoom__btn", title: "Zoom in", "aria-label": "zoom in", onclick: function () { zoomBy(1.5); } }, ["+"]),
          h("button", { type: "button", class: "lab-zoom__btn", title: "Zoom out", "aria-label": "zoom out", onclick: function () { zoomBy(1 / 1.5); } }, ["−"]),
          h("button", { type: "button", class: "lab-zoom__btn", title: "Fit the whole stream", "aria-label": "reset view", onclick: resetView }, ["⤢"])
        ]), view3d]), h("div", { class: "lab-replay__win" }, [wcv]), h("div", { class: "lab-replay__dev" }, [strip])]),
        h("div", { class: "lab-timeline-wrap" }, [tl]),
        h("div", { class: "lab-replay__ctl" }, [playBtn, slider, tlabel, spd]),
        legend
      ]);
      wrap.addEventListener("keydown", function (e) {
        if (e.key === " ") { e.preventDefault(); toggle(); }
        else if (e.key === "ArrowRight") { u = Math.min(frames.length - 1, Math.floor(u) + 1); follow = false; draw(); }
        else if (e.key === "ArrowLeft") { u = Math.max(0, Math.ceil(u) - 1); follow = false; draw(); }
      });
      if (keep) {
        // the same flight, further along (a live search) or finished: keep the view and the playhead, no flash
        view = was.view; u = Math.min(was.u, frames.length - 1);
        [[was.cv, cv], [was.win, wcv], [was.strip, strip], [was.tl, tl]].forEach(function (pr) {
          if (!pr[0]) return; pr[1].width = pr[0].width; pr[1].height = pr[0].height; pr[1].style.width = pr[0].style.width; pr[1].style.height = pr[0].style.height;
        });
        follow = was.follow;
        if (live && follow) u = Math.max(u, frames.length - 4);  // never trail a live search by more than a few decisions
        draw();
        if (u < frames.length - 1 && (was.playing || follow)) { playing = true; playBtn.textContent = "❚❚"; lastTs = 0; raf = requestAnimationFrame(tick); }
      } else if (live) { u = frames.length - 1; follow = true; }
      setTimeout(resize, 0);
      return wrap;
    }
    // ------------------------------------------------------------------ zoom / pan
    function resetView() {
      if (layers.view === "3d") cam = defaultCam(); else view = { zoom: 1, cx: (bounds.x0 + bounds.x1) / 2, cy: (bounds.y0 + bounds.y1) / 2 };
      draw();
    }
    function zoomBy(f, px, py) {
      if (layers.view === "3d") { cam.dist = Math.max(10, Math.min(1500, cam.dist / f)); draw(); return; }
      if (!proj) return;
      var z = Math.max(1, Math.min(10, view.zoom * f));
      if (px != null) {  // keep the point under the cursor fixed
        var wx = proj.ix(px), wy = proj.iy(py);
        view.cx = wx - (wx - view.cx) * view.zoom / z; view.cy = wy - (wy - view.cy) * view.zoom / z;
      }
      view.zoom = z; draw();
    }
    function zoomHint(c) {
      var host = c.parentNode, tip = host.querySelector(".lab-zoomhint");
      if (!tip) { tip = h("div", { class: "lab-zoomhint", text: (/Mac/.test(navigator.platform) ? "⌘" : "Ctrl") + " + scroll to zoom · drag to pan" }); host.appendChild(tip); }
      tip.classList.add("is-on");
      clearTimeout(tip._t); tip._t = setTimeout(function () { tip.classList.remove("is-on"); }, 1100);
    }
    function attachZoom(c) {
      var drag = null;
      c.addEventListener("wheel", function (e) {
        // plain scrolling scrolls the page; Ctrl/Cmd + scroll (and trackpad pinch, which sends ctrlKey) zooms
        if (!e.ctrlKey && !e.metaKey) { zoomHint(c); return; }
        e.preventDefault();
        var r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
        if (layers.view === "3d") { cam.dist = Math.max(10, Math.min(1500, cam.dist * Math.exp(e.deltaY * 0.0015))); draw(); return; }
        zoomBy(Math.exp(-e.deltaY * 0.0015), (e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
      }, { passive: false });
      c.addEventListener("contextmenu", function (e) { if (layers.view === "3d") e.preventDefault(); });
      c.addEventListener("pointerdown", function (e) {
        drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey }; c.setPointerCapture(e.pointerId); c.classList.add("is-dragging");
      });
      c.addEventListener("pointermove", function (e) {
        if (!drag) return;
        var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.x = e.clientX; drag.y = e.clientY;
        if (layers.view === "3d") {
          if (drag.pan) {  // move the ground point the camera looks at, in the screen's directions
            var k = cam.dist / 700, co = Math.cos(cam.yaw), si = Math.sin(cam.yaw);
            cam.cx += (-co * dx - si * dy) * k; cam.cy += (-si * dx + co * dy) * k;
          } else {
            cam.yaw -= dx * 0.008; cam.pitch = Math.max(2, Math.min(89, cam.pitch + dy * 0.35));
          }
          draw(); return;
        }
        if (!proj) return;
        var dpr = window.devicePixelRatio || 1;
        view.cx -= dx * dpr / proj.sc; view.cy += dy * dpr / proj.sc;
        draw();
      });
      ["pointerup", "pointercancel"].forEach(function (ev) { c.addEventListener(ev, function () { drag = null; c.classList.remove("is-dragging"); }); });
      c.addEventListener("dblclick", function () { if (layers.view === "3d") { cam = defaultCam(); draw(); } else resetView(); });
    }

    function resize() {
      if (!cv || !cv.isConnected) return;
      var dpr = window.devicePixelRatio || 1;
      var r = cv.parentNode.getBoundingClientRect(), w = Math.max(240, r.width);
      var hgt = Math.min(Math.max(360, w * 0.8), 720);
      cv.style.width = w + "px"; cv.style.height = hgt + "px"; cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr);
      // window and deviation panels: as tall as the scope when beside it, else a fixed height
      var side = Math.abs(wcv.parentNode.getBoundingClientRect().top - r.top) < 4, hw = side ? hgt : Math.max(300, Math.min(440, 40 + winN * 36));
      var rw = wcv.parentNode.getBoundingClientRect(), ww = Math.max(180, rw.width);
      wcv.style.width = ww + "px"; wcv.style.height = hw + "px"; wcv.width = Math.round(ww * dpr); wcv.height = Math.round(hw * dpr);
      var rd = strip.parentNode.getBoundingClientRect(), wd = Math.max(240, rd.width), hd = 210;
      strip.style.width = wd + "px"; strip.style.height = hd + "px"; strip.width = Math.round(wd * dpr); strip.height = Math.round(hd * dpr);
      var rt = tl.parentNode.getBoundingClientRect(), wt = Math.max(240, rt.width), ht = 30 + d.trace.queue.length * tlRowPx() + 22;
      tl.style.width = wt + "px"; tl.style.height = ht + "px"; tl.width = Math.round(wt * dpr); tl.height = Math.round(ht * dpr);
      tlCache = null;
      draw();
    }
    window.addEventListener("resize", function () { clearTimeout(resize._t); resize._t = setTimeout(resize, 150); });
    new MutationObserver(function () { draw(); }).observe(document.body, { attributes: true, attributeFilter: ["data-md-color-scheme"] });

    function toggle() {
      if (playing) { stop(); return; }
      if (u >= frames.length - 1) u = 0;
      playing = true; playBtn.textContent = "❚❚"; lastTs = 0; raf = requestAnimationFrame(tick);
    }
    function stop() { playing = false; if (raf) cancelAnimationFrame(raf); raf = null; if (playBtn) playBtn.textContent = "▶"; }
    function tick(ts) {
      if (!playing) return;
      if (!cv.isConnected) { stop(); return; }
      // 1 decision (45 s) per second at 1×; following a live search, catch up with its edge in about a second
      var sp = live && follow ? Math.max(speed, (frames.length - 1 - u) / 1.2) : speed;
      if (lastTs) u = Math.min(frames.length - 1, u + (ts - lastTs) / 1000 * sp);
      lastTs = ts;
      draw();
      if (u >= frames.length - 1) { stop(); if (live) follow = true; return; }
      raf = requestAnimationFrame(tick);
    }
    function draw() {
      if (!ctx || ctx.canvas !== cv) ctx = cv && cv.getContext("2d");
      if (!sctx || sctx.canvas !== strip) sctx = strip && strip.getContext("2d");
      if (!ctx || !frames.length || !cv.width) return;
      var i = Math.min(frames.length - 1, Math.floor(u));
      slider.value = Math.round(u);
      tlabel.textContent = "t+" + fmtT(stateTime()) + " · " + (i + 1) + "/" + frames.length;
      rowsNow = windowRows();
      if (layers.view === "3d") draw3D(); else drawMap();
      drawWindow(); drawStrip(); drawTimeline();
    }
    // The agent's window at the continuous time u: one row per flight in AMAN order. Over a decision, rows slide to
    // their new slots; a flight leaving the window fades out (sliding up off the front), one joining fades in.
    function windowRows() {
      var i = Math.floor(u), fr = u - i, e = fr * fr * (3 - 2 * fr), out = [], seen = {};
      var A = frames[i], B = frames[Math.min(frames.length - 1, i + 1)];
      A.win.forEach(function (cs, k) {
        seen[cs] = 1;
        var kb = B.slot[cs];
        if (kb != null) out.push({ cs: cs, pos: k + (kb - k) * e, alpha: 1 });
        else out.push({ cs: cs, pos: k === 0 ? -0.7 * e : k, alpha: 1 - e, leaving: true });
      });
      B.win.forEach(function (cs, k) {
        if (!seen[cs]) out.push({ cs: cs, pos: k === B.win.length - 1 ? k + 0.7 * (1 - e) : k, alpha: e, entering: true });
      });
      return out;
    }
    function rowGeom(H, dpr) { var top = 38 * dpr, bot = 22 * dpr; return { top: top, rowH: (H - top - bot) / winN, bottom: H - bot }; }
    function stateTime() {
      var i = Math.floor(u), f = u - i, a = frames[i], b = frames[Math.min(frames.length - 1, i + 1)];
      return a.t + (b.t - a.t) * f;
    }
    // aircraft rows at the continuous time u: positions interpolated between decisions
    function aircraftAt() {
      var i = Math.floor(u), fr = u - i, A = frames[i], B = frames[Math.min(frames.length - 1, i + 1)], out = [];
      A.ac.forEach(function (a) {
        var b = B.by[a[0]] || a, row;
        if (a[5] === b[5]) {
          row = [a[0], a[1] + (b[1] - a[1]) * fr, a[2] + (b[2] - a[2]) * fr, a[3] + (b[3] - a[3]) * fr, a[4] + (b[4] - a[4]) * fr, a[5], fr < 0.5 ? a[6] : b[6]];
        } else {
          row = fr < 0.5 ? a.slice() : b.slice();
        }
        // heading: the direction of travel over this interval (else the previous one)
        var p = (b !== a && (b[1] !== a[1] || b[2] !== a[2])) ? [a, b] : [frames[Math.max(0, i - 1)].by[a[0]] || a, a];
        row.hd = Math.atan2(p[1][2] - p[0][2], p[1][1] - p[0][1]);
        out.push(row);
      });
      return out;
    }

    // ------------------------------------------------------------------ the scope
    function drawMap() {
      var dpr = window.devicePixelRatio || 1, W = cv.width, H = cv.height, now = performance.now() / 1000;
      var ok = css("--tada-ok"), warn = css("--tada-warn"), bad = css("--tada-bad");
      var mono = css("--tada-font-mono"), head = css("--tada-font-head");
      var i = Math.floor(u), fr = u - i;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1; ctx.shadowBlur = 0; ctx.setLineDash([]);
      // background: deep scope with a soft centre
      var m = 14 * dpr, bw = bounds.x1 - bounds.x0, bh = bounds.y1 - bounds.y0;
      var sc = Math.min((W - 2 * m) / bw, (H - 2 * m) / bh) * view.zoom;
      function X(x) { return W / 2 + (x - view.cx) * sc; }
      function Y(y) { return H / 2 - (y - view.cy) * sc; }
      proj = { sc: sc, ix: function (px) { return view.cx + (px - W / 2) / sc; }, iy: function (py) { return view.cy - (py - H / 2) / sc; } };
      var ax = X(airport[0]), ay = Y(airport[1]);
      ctx.fillStyle = "#02060d"; ctx.fillRect(0, 0, W, H);
      var g = ctx.createRadialGradient(ax, ay, 0, ax, ay, Math.max(W, H) * 0.75);
      g.addColorStop(0, "rgba(22,52,92,0.55)"); g.addColorStop(1, "rgba(2,6,13,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

      // range rings and bearings around the airport
      if (layers.rings) {
        var maxR = Math.max(Math.hypot(bounds.x0 - airport[0], bounds.y0 - airport[1]), Math.hypot(bounds.x1 - airport[0], bounds.y1 - airport[1]));
        ctx.lineWidth = 1 * dpr;
        for (var rr = 10; rr <= maxR; rr += 10) {
          ctx.strokeStyle = rr % 50 === 0 ? "rgba(63,208,255,0.22)" : "rgba(63,208,255,0.09)";
          ctx.beginPath(); ctx.arc(ax, ay, rr * sc, 0, 2 * Math.PI); ctx.stroke();
          if (rr % 20 === 0) {
            ctx.fillStyle = "rgba(63,208,255,0.45)"; ctx.font = (9 * dpr) + "px " + mono;
            ctx.fillText(rr + " NM", ax + rr * sc * 0.7071 + 3 * dpr, ay - rr * sc * 0.7071 - 3 * dpr);
          }
        }
        ctx.strokeStyle = "rgba(63,208,255,0.06)";
        for (var deg = 0; deg < 360; deg += 30) {
          var ra = deg * Math.PI / 180;
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + Math.sin(ra) * maxR * sc, ay - Math.cos(ra) * maxR * sc); ctx.stroke();
        }
      }

      // airspace sectors
      if (layers.sectors && sectors.length) {
        sectors.forEach(function (s, k) {
          var col = SECTOR_HUES[k % SECTOR_HUES.length];
          ctx.beginPath();
          s.polygon.forEach(function (p, n) { if (n) ctx.lineTo(X(p[0]), Y(p[1])); else ctx.moveTo(X(p[0]), Y(p[1])); });
          ctx.closePath();
          ctx.globalAlpha = 0.07; ctx.fillStyle = col; ctx.fill();
          ctx.globalAlpha = 0.55; ctx.strokeStyle = col; ctx.lineWidth = 1.3 * dpr; ctx.setLineDash([6 * dpr, 4 * dpr]); ctx.stroke();
          ctx.setLineDash([]);
          var cx = 0, cy = 0;
          s.polygon.forEach(function (p) { cx += p[0]; cy += p[1]; });
          cx /= s.polygon.length; cy /= s.polygon.length;
          ctx.globalAlpha = 0.6; ctx.fillStyle = col; ctx.font = "600 " + (10 * dpr) + "px " + head;
          var tw = ctx.measureText(s.name).width;
          ctx.fillText(s.name, X(cx) - tw / 2, Y(cy) + 4 * dpr);
        });
        ctx.globalAlpha = 1;
      }

      var ac = aircraftAt();
      var landedSet = {};
      ac.forEach(function (a) { if (a[5] === 2) landedSet[a[0]] = 1; });

      // flight plans (as filed at t = 0) of flights still airborne
      if (layers.routes) {
        ctx.lineWidth = 1.6 * dpr; ctx.lineJoin = "round";
        Object.keys(d.trace.routes).forEach(function (cs) {
          var r = d.trace.routes[cs];
          if (r.length < 2 || landedSet[cs]) return;
          ctx.strokeStyle = colors[cs] || "#9aabc6"; ctx.globalAlpha = 0.26;
          ctx.beginPath(); r.forEach(function (p, n) { if (n) ctx.lineTo(X(p[0]), Y(p[1])); else ctx.moveTo(X(p[0]), Y(p[1])); }); ctx.stroke();
          ctx.globalAlpha = 0.45; ctx.fillStyle = colors[cs];
          r.forEach(function (p) { ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), 1.6 * dpr, 0, 2 * Math.PI); ctx.fill(); });
        });
        ctx.globalAlpha = 1;
      }

      // airport
      ctx.strokeStyle = "#f4f8ff"; ctx.lineWidth = 1.6 * dpr;
      ctx.beginPath(); ctx.arc(ax, ay, 5 * dpr, 0, 2 * Math.PI); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ax - 9 * dpr, ay); ctx.lineTo(ax + 9 * dpr, ay); ctx.moveTo(ax, ay - 9 * dpr); ctx.lineTo(ax, ay + 9 * dpr); ctx.stroke();
      ctx.fillStyle = "#f4f8ff"; ctx.font = "600 " + (11 * dpr) + "px " + head; ctx.fillText(procLabel, ax + 10 * dpr, ay + 14 * dpr);

      // track history: fading trails with radar returns
      var byNow = {};
      ac.forEach(function (a) { byNow[a[0]] = a; });
      Object.keys(colors).forEach(function (cs) {
        var now_ = byNow[cs];
        if (!now_ || now_[5] !== 1) return;
        var pts = [];
        for (var k = Math.max(0, i - TRAIL); k <= i; k++) { var a = frames[k].by[cs]; if (a && a[5] === 1) pts.push(a); }
        pts.push(now_);
        var n = pts.length;
        ctx.lineWidth = 2.4 * dpr; ctx.lineCap = "round"; ctx.strokeStyle = colors[cs];
        for (var j = 1; j < n; j++) {
          var w = (j + (j === n - 1 ? fr : 0)) / n;
          ctx.globalAlpha = 0.06 + 0.8 * Math.pow(w, 1.6);
          ctx.shadowColor = colors[cs]; ctx.shadowBlur = j > n - 4 ? 8 * dpr : 0;
          ctx.beginPath(); ctx.moveTo(X(pts[j - 1][1]), Y(pts[j - 1][2])); ctx.lineTo(X(pts[j][1]), Y(pts[j][2])); ctx.stroke();
        }
        ctx.shadowBlur = 0; ctx.fillStyle = colors[cs];
        for (var q = 0; q < n - 1; q++) {
          ctx.globalAlpha = 0.1 + 0.6 * Math.pow((q + 1) / n, 1.6);
          ctx.beginPath(); ctx.arc(X(pts[q][1]), Y(pts[q][2]), 1.8 * dpr, 0, 2 * Math.PI); ctx.fill();
        }
        ctx.globalAlpha = 1;
      });

      // proximity: under-control pairs within 5 NM and 1000 ft (amber, marching dashes), LoS 3 NM / 500 ft (red, pulsing)
      var air = ac.filter(function (a) { return a[5] === 1; });
      for (var p1 = 0; p1 < air.length; p1++) for (var p2 = p1 + 1; p2 < air.length; p2++) {
        var A = air[p1], B = air[p2], dh = Math.hypot(A[1] - B[1], A[2] - B[2]), dv = Math.abs(A[3] - B[3]);
        if (dh >= 5 || dv >= 1000) continue;
        var los = dh <= 3 && dv <= 500;
        var mx = (X(A[1]) + X(B[1])) / 2, my = (Y(A[2]) + Y(B[2])) / 2;
        if (los) {
          var pulse = 0.5 + 0.5 * Math.sin(now * 6);
          ctx.strokeStyle = bad; ctx.lineWidth = 3 * dpr; ctx.shadowColor = bad; ctx.shadowBlur = 12 * dpr;
          ctx.beginPath(); ctx.moveTo(X(A[1]), Y(A[2])); ctx.lineTo(X(B[1]), Y(B[2])); ctx.stroke();
          ctx.globalAlpha = 0.35 + 0.5 * pulse; ctx.lineWidth = 2 * dpr;
          ctx.beginPath(); ctx.arc(mx, my, 3 * sc * (1 + 0.15 * pulse), 0, 2 * Math.PI); ctx.stroke();
          ctx.globalAlpha = 1; ctx.shadowBlur = 0;
          ctx.fillStyle = bad; ctx.font = "700 " + (10 * dpr) + "px " + head;
          ctx.fillText("LoS " + dh.toFixed(1) + " NM", mx + 3 * sc + 4 * dpr, my);
        } else {
          ctx.strokeStyle = warn; ctx.lineWidth = 1.8 * dpr; ctx.setLineDash([5 * dpr, 4 * dpr]); ctx.lineDashOffset = -now * 20 * dpr;
          ctx.beginPath(); ctx.moveTo(X(A[1]), Y(A[2])); ctx.lineTo(X(B[1]), Y(B[2])); ctx.stroke();
          ctx.setLineDash([]); ctx.lineDashOffset = 0;
          ctx.fillStyle = warn; ctx.font = (9 * dpr) + "px " + mono; ctx.fillText(dh.toFixed(1) + " NM", mx + 4 * dpr, my - 4 * dpr);
        }
      }

      // search: the active plan's candidate rollouts, ahead of the playhead, for the flights in the window only
      // (a flight's prediction fades out as it leaves the window). A new plan cross-fades over the old one.
      var nowT = stateTime(), active = null, prevPlan = null, wa = {};
      rowsNow.forEach(function (r) { wa[r.cs] = Math.max(wa[r.cs] || 0, r.alpha); });
      if (layers.plans) plans.forEach(function (pl) { if (pl.t <= nowT + 1e-6) { prevPlan = active; active = pl; } });
      function drawPlan(pl, fade) {
        var order = pl.cands.slice().sort(function (a, b) { return (a.chosen ? 1 : 0) - (b.chosen ? 1 : 0); }); // chosen on top
        order.forEach(function (c) {
          var col = c.pruned ? PRED.pruned : c.chosen ? PRED.chosen : c.los ? PRED.los : PRED.other;
          var base = c.pruned ? 0.12 : c.chosen ? 0.95 : c.los ? 0.4 : 0.3;
          ctx.strokeStyle = col;
          ctx.lineWidth = (c.chosen ? 2.4 : 1) * dpr;
          ctx.setLineDash(c.chosen ? [8 * dpr, 5 * dpr] : [2 * dpr, 5 * dpr]);
          ctx.shadowColor = col; ctx.shadowBlur = c.chosen ? 8 * dpr : 0;
          Object.keys(c.byCs).forEach(function (cs) {
            var a_ = wa[cs] || 0;
            if (a_ <= 0.01) return;
            var pts = c.byCs[cs].filter(function (q) { return q[0] >= nowT - 1e-6; });
            if (pts.length < 2) return;
            ctx.globalAlpha = base * fade * a_;
            var here = byNow[cs];
            ctx.beginPath();
            if (here && here[5] === 1) ctx.moveTo(X(here[1]), Y(here[2])); else ctx.moveTo(X(pts[0][1]), Y(pts[0][2]));
            pts.forEach(function (q) { ctx.lineTo(X(q[1]), Y(q[2])); });
            ctx.stroke();
            if (c.chosen) {
              var e_ = pts[pts.length - 1];
              ctx.setLineDash([]); ctx.beginPath(); ctx.arc(X(e_[1]), Y(e_[2]), 3.2 * dpr, 0, 2 * Math.PI); ctx.stroke();
              ctx.setLineDash([8 * dpr, 5 * dpr]);
            }
          });
          ctx.setLineDash([]); ctx.shadowBlur = 0;
        });
        ctx.globalAlpha = 1;
      }
      if (active) {
        var fin = prevPlan ? Math.max(0, Math.min(1, (nowT - active.t) / (0.7 * dtDec))) : 1;
        if (fin < 1) drawPlan(prevPlan, 1 - fin);
        drawPlan(active, fin);
      }

      // clearances. Life of a glyph: pops in with a ping where it was issued, sits as a badge with a label and a
      // tether to its aircraft, then shrinks back onto the track and fades out over FADE decisions.
      var halo = {}, placed = [], latest = {};
      for (var kL = Math.max(0, i - FADE); kL <= i; kL++) evByFrame[kL].forEach(function (e) { latest[e.cs] = e; });
      for (var k2 = Math.max(0, i - FADE); k2 <= i; k2++) {
        evByFrame[k2].forEach(function (e) {
          if (e.x == null) return;
          var age = u - k2;
          if (age < 0 || age > FADE) return;
          var ex = X(e.x), ey = Y(e.y);
          var shrink = age < 1 ? 1 : Math.max(0.42, 1 - (age - 1) / 1.6 * 0.58);  // 1 -> 0.42 between ages 1 and 2.6
          var pop = 1 + 0.55 * Math.max(0, 1 - age / 0.22);
          var alpha = age < 2.6 ? 1 : Math.max(0, 1 - (age - 2.6) / (FADE - 2.6));
          var off = shrink > 0.5 ? (shrink - 0.42) / 0.58 : 0;                       // badge offset collapses onto the track
          var gx = ex + (16 + 22 * e.slot) * dpr * off, gy = ey - 18 * dpr * off;
          var badge = age < 2.2, isLatest = latest[e.cs] === e;
          if (age < 1.4) {  // ping
            ctx.globalAlpha = 1 - age / 1.4; ctx.strokeStyle = e.cat.color; ctx.lineWidth = 2.2 * dpr;
            ctx.beginPath(); ctx.arc(ex, ey, (5 + 38 * (age / 1.4)) * dpr, 0, 2 * Math.PI); ctx.stroke();
            ctx.beginPath(); ctx.arc(ex, ey, (5 + 20 * (age / 1.4)) * dpr, 0, 2 * Math.PI); ctx.stroke();
            halo[e.cs] = e.cat.color;
          }
          var tgt = byNow[e.cs];
          if (tgt && tgt[5] === 1 && age < 2 && isLatest) {  // tether to the aircraft it went to
            ctx.globalAlpha = 0.6 * (1 - age / 2); ctx.strokeStyle = e.cat.color; ctx.lineWidth = 1.2 * dpr; ctx.setLineDash([2 * dpr, 3 * dpr]);
            ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(X(tgt[1]), Y(tgt[2])); ctx.stroke(); ctx.setLineDash([]);
          }
          var r0 = 11 * dpr * shrink * pop;
          ctx.globalAlpha = alpha;
          if (badge) {
            var ba = age < 1.6 ? 1 : 1 - (age - 1.6) / 0.6;
            ctx.globalAlpha = alpha * ba;
            ctx.fillStyle = "rgba(2,6,13,0.85)"; ctx.beginPath(); ctx.arc(gx, gy, r0, 0, 2 * Math.PI); ctx.fill();
            ctx.shadowColor = e.cat.color; ctx.shadowBlur = 12 * dpr;
            ctx.strokeStyle = e.cat.color; ctx.lineWidth = 1.4 * dpr; ctx.beginPath(); ctx.arc(gx, gy, r0, 0, 2 * Math.PI); ctx.stroke();
            ctx.globalAlpha = alpha;
          } else {
            ctx.shadowColor = e.cat.color; ctx.shadowBlur = 6 * dpr;
          }
          drawGlyph(ctx, gx, gy, 13.5 * dpr * shrink * pop, e.cat);
          ctx.shadowBlur = 0;
          if (age < 2 && isLatest) {  // label pill: which flight, which clearance
            var txt = shortCs(e.cs) + " " + (ABBR[e.name] || e.name);
            ctx.font = "600 " + (10 * dpr) + "px " + mono;
            var tw = ctx.measureText(txt).width, lx = gx + r0 + 5 * dpr, ly = gy - 8 * dpr;
            ctx.globalAlpha = age < 1.4 ? 1 : 1 - (age - 1.4) / 0.6;
            ctx.fillStyle = "rgba(2,6,13,0.88)"; roundRect(ctx, lx - 4 * dpr, ly - 1 * dpr, tw + 14 * dpr, 16 * dpr, 4 * dpr); ctx.fill();
            ctx.strokeStyle = e.cat.color; ctx.lineWidth = 1 * dpr; ctx.stroke();
            ctx.fillStyle = colors[e.cs]; ctx.beginPath(); ctx.arc(lx + 2 * dpr, ly + 7 * dpr, 2.6 * dpr, 0, 2 * Math.PI); ctx.fill();
            ctx.fillStyle = "#f4f8ff"; ctx.fillText(txt, lx + 8 * dpr, ly + 11 * dpr);
            placed.push([lx - 4 * dpr, ly - 1 * dpr, tw + 14 * dpr, 16 * dpr]);
          }
          if (badge) placed.push([gx - r0, gy - r0, 2 * r0, 2 * r0]);
          ctx.globalAlpha = 1;
        });
      }

      // aircraft: glowing chevrons, speed leaders, data blocks
      ac.forEach(function (a) {
        var cs = a[0], x = X(a[1]), y = Y(a[2]), col = colors[cs];
        if (a[5] === 2) return;
        if (a[5] === 0) {
          ctx.globalAlpha = 0.55; ctx.strokeStyle = col; ctx.lineWidth = 1.2 * dpr;
          ctx.beginPath(); ctx.arc(x, y, 3.5 * dpr, 0, 2 * Math.PI); ctx.stroke();
          if (layers.labels === "full") { ctx.fillStyle = "rgba(154,171,198,0.7)"; ctx.font = (9 * dpr) + "px " + mono; ctx.fillText(shortCs(cs), x + 6 * dpr, y + 3 * dpr); }
          ctx.globalAlpha = 1; return;
        }
        if (halo[cs]) {
          var hp = 0.5 + 0.5 * Math.sin(now * 8);
          ctx.strokeStyle = halo[cs]; ctx.lineWidth = 2 * dpr; ctx.globalAlpha = 0.4 + 0.5 * hp;
          ctx.beginPath(); ctx.arc(x, y, (11 + 3 * hp) * dpr, 0, 2 * Math.PI); ctx.stroke(); ctx.globalAlpha = 1;
        }
        // one minute ahead at ground speed
        var lead = a[4] / 60 * sc;
        ctx.strokeStyle = col; ctx.globalAlpha = 0.6; ctx.lineWidth = 1.2 * dpr;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a.hd) * lead, y - Math.sin(a.hd) * lead); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.save(); ctx.translate(x, y); ctx.rotate(-a.hd);
        ctx.shadowColor = col; ctx.shadowBlur = 12 * dpr; ctx.fillStyle = col; ctx.strokeStyle = "#02060d"; ctx.lineWidth = 1.2 * dpr;
        var s = 7.5 * dpr;
        ctx.beginPath(); ctx.moveTo(s * 1.5, 0); ctx.lineTo(-s, s * 0.9); ctx.lineTo(-s * 0.45, 0); ctx.lineTo(-s, -s * 0.9); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
        if (layers.labels === "tags") {  // call sign only, tucked above-right of the aircraft
          ctx.font = "600 " + (9 * dpr) + "px " + mono; ctx.fillStyle = "rgba(244,248,255,0.82)";
          ctx.fillText(shortCs(cs), x + 7 * dpr, y - 7 * dpr);
        } else if (layers.labels === "full") {
          var dev = a[6], dc = Math.abs(dev) <= 60 ? ok : Math.abs(dev) <= 300 ? warn : bad;
          var l1 = shortCs(cs), l1b = sgn(dev) + "s", l2 = "FL" + Math.round(a[3] / 100) + " " + Math.round(a[4]) + "kt";
          ctx.font = "700 " + (10 * dpr) + "px " + mono;
          var w1 = ctx.measureText(l1 + " ").width, w1b = ctx.measureText(l1b).width;
          ctx.font = (9 * dpr) + "px " + mono;
          var w2 = ctx.measureText(l2).width, bwid = Math.max(w1 + w1b, w2) + 8 * dpr, bh_ = 25 * dpr;
          var cands = [[12, -32], [12, 8], [-12, -32], [-12, 8], [24, -12], [-24, -12]].map(function (o) {
            return [o[0] < 0 ? x + o[0] * dpr - bwid : x + o[0] * dpr, y + o[1] * dpr];
          });
          var best = cands[0], bestHit = Infinity;
          cands.forEach(function (c) {
            var hit = placed.reduce(function (acc, r) {
              var ox_ = Math.max(0, Math.min(c[0] + bwid, r[0] + r[2]) - Math.max(c[0], r[0]));
              var oy_ = Math.max(0, Math.min(c[1] + bh_, r[1] + r[3]) - Math.max(c[1], r[1]));
              return acc + ox_ * oy_;
            }, 0);
            if (hit < bestHit - 1) { best = c; bestHit = hit; }
          });
          var bx = best[0], by = best[1];
          placed.push([bx, by, bwid, bh_]);
          ctx.strokeStyle = col; ctx.globalAlpha = 0.5; ctx.lineWidth = 1 * dpr;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(bx < x ? bx + bwid : bx, by + (by < y ? bh_ : 0)); ctx.stroke();
          ctx.globalAlpha = 0.9; ctx.fillStyle = "rgba(2,6,13,0.7)"; roundRect(ctx, bx, by, bwid, bh_, 3 * dpr); ctx.fill();
          ctx.globalAlpha = 1; ctx.fillStyle = col; ctx.fillRect(bx, by, 2 * dpr, bh_);
          ctx.font = "700 " + (10 * dpr) + "px " + mono; ctx.fillStyle = "#f4f8ff"; ctx.fillText(l1, bx + 5 * dpr, by + 10 * dpr);
          ctx.fillStyle = dc; ctx.fillText(l1b, bx + 5 * dpr + w1, by + 10 * dpr);
          ctx.font = (9 * dpr) + "px " + mono; ctx.fillStyle = "rgba(154,171,198,0.95)"; ctx.fillText(l2, bx + 5 * dpr, by + 21 * dpr);
        }
      });

      // HUD: clock, scale, end state
      ctx.fillStyle = "rgba(2,6,13,0.7)"; roundRect(ctx, m, m, 128 * dpr, 34 * dpr, 4 * dpr); ctx.fill();
      ctx.fillStyle = "#f4f8ff"; ctx.font = "600 " + (15 * dpr) + "px " + mono; ctx.fillText("t+" + fmtT(stateTime()), m + 8 * dpr, m + 16 * dpr);
      ctx.fillStyle = "rgba(63,208,255,0.85)"; ctx.font = (9 * dpr) + "px " + mono;
      ctx.fillText("decision " + (i + 1) + "/" + frames.length + " · " + procLabel, m + 8 * dpr, m + 28 * dpr);
      if (active) {  // the active plan's scoreboard
        var rowsN = active.cands.length, bw2 = 196 * dpr, bh2 = (22 + rowsN * 13) * dpr, by2 = m + 40 * dpr;
        ctx.fillStyle = "rgba(2,6,13,0.78)"; roundRect(ctx, m, by2, bw2, bh2, 4 * dpr); ctx.fill();
        ctx.strokeStyle = "rgba(255,210,63,0.5)"; ctx.lineWidth = 1 * dpr; ctx.stroke();
        ctx.fillStyle = PRED.chosen; ctx.font = "600 " + (10 * dpr) + "px " + head;
        ctx.fillText("PLAN " + (plans.indexOf(active) + 1) + " · t+" + fmtT(active.t) + (active.switched ? " · SWITCHED" : ""), m + 8 * dpr, by2 + 14 * dpr);
        ctx.font = (9.5 * dpr) + "px " + mono;
        active.cands.forEach(function (c, n) {
          var yy = by2 + (27 + n * 13) * dpr;
          var col = c.pruned ? PRED.pruned : c.chosen ? PRED.chosen : c.los ? "#d9899b" : PRED.text;
          ctx.fillStyle = col;
          var txt = (c.chosen ? "▶ " : "  ") + "k" + c.k + " " + (c.kind + "         ").slice(0, 9) +
            (c.pruned ? " pruned" : (c.los ? " LoS  " : " " + c.on_time + "/" + d.summary.n_flights + " ") + " " + c.clearances + " clr");
          ctx.fillText(txt, m + 6 * dpr, yy);
        });
      }
      // scale bar: the round length closest to ~110 px
      var nmLen = [1, 2, 5, 10, 20, 50].reduce(function (b, v) { return Math.abs(v * sc - 110 * dpr) < Math.abs(b * sc - 110 * dpr) ? v : b; }, 10);
      var bl = nmLen * sc;
      ctx.strokeStyle = "rgba(233,241,255,0.7)"; ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.moveTo(m, H - m); ctx.lineTo(m + bl, H - m); ctx.moveTo(m, H - m - 4 * dpr); ctx.lineTo(m, H - m); ctx.moveTo(m + bl, H - m - 4 * dpr); ctx.lineTo(m + bl, H - m); ctx.stroke();
      ctx.fillStyle = "rgba(233,241,255,0.75)"; ctx.font = (9 * dpr) + "px " + mono; ctx.fillText(nmLen + " NM", m, H - m - 6 * dpr);
      if (view.zoom > 1.01) { ctx.fillStyle = "rgba(63,208,255,0.8)"; ctx.fillText("×" + view.zoom.toFixed(1) + " · double-click to fit", m + bl + 10 * dpr, H - m); }
      // north
      ctx.fillStyle = "rgba(233,241,255,0.7)"; ctx.font = "600 " + (10 * dpr) + "px " + head;
      ctx.fillText("N", W - m - 6 * dpr, H - m - 18 * dpr);
      ctx.beginPath(); ctx.moveTo(W - m - 2 * dpr, H - m - 14 * dpr); ctx.lineTo(W - m - 6 * dpr, H - m - 4 * dpr); ctx.lineTo(W - m + 2 * dpr, H - m - 4 * dpr); ctx.closePath(); ctx.fill();
      if (live) {  // a search still running: this is the episode so far
        ctx.font = "700 " + (11 * dpr) + "px " + head;
        var lt = "● LIVE · SEARCH RUNNING", ltw = ctx.measureText(lt).width, pulse = 0.55 + 0.45 * Math.sin(now * 4), lx0 = (W - ltw) / 2;
        ctx.fillStyle = "rgba(2,6,13,0.8)"; roundRect(ctx, lx0 - m, m, ltw + 2 * m, 22 * dpr, 4 * dpr); ctx.fill();
        ctx.globalAlpha = pulse; ctx.fillStyle = PRED.chosen; ctx.fillText(lt, lx0, m + 15 * dpr); ctx.globalAlpha = 1;
      } else if (u >= frames.length - 1) {
        var s0 = d.summary, txt = s0.los ? "LOSS OF SEPARATION" : s0.solved ? "SOLVED · " + s0.on_time + "/" + s0.n_flights + " ON TIME" : s0.end_reason.toUpperCase() + " · " + s0.on_time + "/" + s0.n_flights + " ON TIME";
        ctx.font = "700 " + (15 * dpr) + "px " + head;
        var tw2 = ctx.measureText(txt).width, col2 = s0.los ? bad : s0.solved ? ok : warn;
        ctx.fillStyle = "rgba(2,6,13,0.85)"; roundRect(ctx, W - tw2 - 3 * m, m * 2.4, tw2 + 2 * m, 28 * dpr, 4 * dpr); ctx.fill();
        ctx.strokeStyle = col2; ctx.lineWidth = 1.5 * dpr; ctx.stroke();
        ctx.fillStyle = col2; ctx.shadowColor = col2; ctx.shadowBlur = 10 * dpr; ctx.fillText(txt, W - tw2 - 2 * m, m * 2.4 + 19 * dpr); ctx.shadowBlur = 0;
      }
    }
    // ------------------------------------------------------------------ the 3D view
    // A hand-rolled orbit camera with perspective, drawn on the scope's canvas: the scene is lines, points and
    // labels, so no 3D library is needed. Altitudes are exaggerated (×1 to ×10) so the vertical structure shows.
    function defaultCam() {
      var span = Math.max(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0);
      // looking at the middle between the stream's extent and the airport, where the traffic converges
      return { cx: ((bounds.x0 + bounds.x1) / 2 + airport[0]) / 2, cy: ((bounds.y0 + bounds.y1) / 2 + airport[1]) / 2,
               yaw: -25 * Math.PI / 180, pitch: 32, dist: span * 1.05 };
    }
    function flyCam(yawDeg, pitch, distF) {  // ease to a preset over ~0.6 s
      var span = Math.max(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0);
      var a = { yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist }, b = { yaw: yawDeg * Math.PI / 180, pitch: pitch, dist: span * distF }, t0 = performance.now();
      var dyaw = ((b.yaw - a.yaw) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
      (function step() {
        var f = Math.min(1, (performance.now() - t0) / 600), e = f * f * (3 - 2 * f);
        cam.yaw = a.yaw + dyaw * e; cam.pitch = a.pitch + (b.pitch - a.pitch) * e; cam.dist = a.dist + (b.dist - a.dist) * e; draw();
        if (f < 1) requestAnimationFrame(step);
      })();
    }
    function startSpin() {
      var last = performance.now();
      spin = requestAnimationFrame(function go(ts) {
        if (!cv || !cv.isConnected || layers.view !== "3d") { spin = null; return; }
        cam.yaw += (ts - last) / 1000 * 0.12; last = ts;
        if (!playing) draw();
        spin = requestAnimationFrame(go);
      });
    }
    function stopSpin() { if (spin) cancelAnimationFrame(spin); spin = null; }
    function camera(W, H) {
      var ph = cam.pitch * Math.PI / 180, cp = Math.cos(ph), sp = Math.sin(ph), sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
      var eye = [cam.cx + cam.dist * cp * sy, cam.cy - cam.dist * cp * cy, cam.dist * sp];
      var f = [-cp * sy, cp * cy, -sp], r = [cy, sy, 0], up = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
      var focal = Math.min(W, H) * 1.25, ex = layers.exag * FT_NM;
      return {
        // world (NM, NM, ft) -> [screen x, screen y, depth]; null behind the camera
        P: function (x, y, zft) {
          var v0 = x - eye[0], v1 = y - eye[1], v2 = (zft || 0) * ex - eye[2];
          var zc = v0 * f[0] + v1 * f[1] + v2 * f[2];
          if (zc < 1) return null;
          return [W / 2 + focal * (v0 * r[0] + v1 * r[1]) / zc, H / 2 - focal * (v0 * up[0] + v1 * up[1] + v2 * up[2]) / zc, zc];
        },
        focal: focal
      };
    }
    function draw3D() {
      var dpr = window.devicePixelRatio || 1, W = cv.width, H = cv.height, now = performance.now() / 1000;
      var ok = css("--tada-ok"), warn = css("--tada-warn"), bad = css("--tada-bad");
      var mono = css("--tada-font-mono"), head = css("--tada-font-head");
      var i = Math.floor(u), fr = u - i, C = camera(W, H), P = C.P, m = 14 * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.shadowBlur = 0; ctx.setLineDash([]);
      var sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#050b18"); sky.addColorStop(1, "#02060d");
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
      function poly(pts, close) {  // a projected polyline (segments behind the camera are skipped)
        var started = false;
        ctx.beginPath();
        pts.forEach(function (q) {
          var s_ = P(q[0], q[1], q[2]);
          if (!s_) { started = false; return; }
          if (started) ctx.lineTo(s_[0], s_[1]); else { ctx.moveTo(s_[0], s_[1]); started = true; }
        });
        if (close) ctx.closePath();
      }
      // ground: range rings and bearings around the airport
      var maxR = Math.max(Math.hypot(bounds.x0 - airport[0], bounds.y0 - airport[1]), Math.hypot(bounds.x1 - airport[0], bounds.y1 - airport[1]));
      if (layers.rings) {
        ctx.lineWidth = 1 * dpr;
        for (var rr = 10; rr <= maxR; rr += 10) {
          var ring = [];
          for (var a_ = 0; a_ <= 64; a_++) ring.push([airport[0] + rr * Math.cos(a_ / 32 * Math.PI), airport[1] + rr * Math.sin(a_ / 32 * Math.PI), 0]);
          ctx.strokeStyle = rr % 50 === 0 ? "rgba(63,208,255,0.22)" : "rgba(63,208,255,0.09)";
          poly(ring); ctx.stroke();
          var lab = P(airport[0] + rr * 0.7071, airport[1] - rr * 0.7071, 0);
          if (lab && rr % 20 === 0) { ctx.fillStyle = "rgba(63,208,255,0.45)"; ctx.font = (9 * dpr) + "px " + mono; ctx.fillText(rr + " NM", lab[0] + 3 * dpr, lab[1]); }
        }
      }
      // sectors on the ground
      if (layers.sectors) sectors.forEach(function (sct, k) {
        var col = SECTOR_HUES[k % SECTOR_HUES.length];
        poly(sct.polygon.map(function (q) { return [q[0], q[1], 0]; }), true);
        ctx.globalAlpha = 0.06; ctx.fillStyle = col; ctx.fill();
        ctx.globalAlpha = 0.5; ctx.strokeStyle = col; ctx.lineWidth = 1.2 * dpr; ctx.setLineDash([6 * dpr, 4 * dpr]); ctx.stroke(); ctx.setLineDash([]);
        var cx = 0, cy = 0; sct.polygon.forEach(function (q) { cx += q[0]; cy += q[1]; });
        var lp = P(cx / sct.polygon.length, cy / sct.polygon.length, 0);
        if (lp) { ctx.globalAlpha = 0.55; ctx.fillStyle = col; ctx.font = "600 " + (10 * dpr) + "px " + head; ctx.fillText(sct.name, lp[0] - ctx.measureText(sct.name).width / 2, lp[1]); }
        ctx.globalAlpha = 1;
      });
      var ac = aircraftAt(), byNow = {}, landed = {};
      ac.forEach(function (a) { byNow[a[0]] = a; if (a[5] === 2) landed[a[0]] = 1; });
      // flight plans on the ground
      if (layers.routes) Object.keys(d.trace.routes).forEach(function (cs) {
        var r = d.trace.routes[cs];
        if (r.length < 2 || landed[cs]) return;
        ctx.strokeStyle = colors[cs]; ctx.globalAlpha = 0.18; ctx.lineWidth = 1.3 * dpr;
        poly(r.map(function (q) { return [q[0], q[1], 0]; })); ctx.stroke();
      });
      ctx.globalAlpha = 1;
      // airport and an altitude scale standing on it
      var top = 0;
      frames.forEach(function (f) { f.ac.forEach(function (a) { if (a[5] === 1 && a[3] > top) top = a[3]; }); });
      top = Math.max(5000, Math.ceil(top / 5000) * 5000);
      var base = P(airport[0], airport[1], 0), peak = P(airport[0], airport[1], top);
      if (base && peak) {
        ctx.strokeStyle = "rgba(233,241,255,0.45)"; ctx.lineWidth = 1.2 * dpr;
        ctx.beginPath(); ctx.moveTo(base[0], base[1]); ctx.lineTo(peak[0], peak[1]); ctx.stroke();
        ctx.font = (9 * dpr) + "px " + mono;
        for (var fl = 5000; fl <= top; fl += 5000) {
          var tk = P(airport[0], airport[1], fl);
          if (!tk) continue;
          ctx.fillStyle = "rgba(233,241,255,0.6)"; ctx.fillRect(tk[0] - 4 * dpr, tk[1] - 0.5 * dpr, 8 * dpr, 1.2 * dpr);
          ctx.fillText("FL" + String(fl / 100).padStart(3, "0"), tk[0] + 6 * dpr, tk[1] + 3 * dpr);
        }
        ctx.strokeStyle = "#f4f8ff"; ctx.lineWidth = 1.6 * dpr;
        ctx.beginPath(); ctx.arc(base[0], base[1], 4.5 * dpr, 0, 2 * Math.PI); ctx.stroke();
        ctx.fillStyle = "#f4f8ff"; ctx.font = "600 " + (11 * dpr) + "px " + head; ctx.fillText(procLabel, base[0] + 9 * dpr, base[1] + 14 * dpr);
      }
      // trails at altitude, each with a faint curtain down to its ground shadow
      Object.keys(colors).forEach(function (cs) {
        var a0 = byNow[cs];
        if (!a0 || a0[5] !== 1) return;
        var pts = [];
        for (var k = Math.max(0, i - TRAIL); k <= i; k++) { var a = frames[k].by[cs]; if (a && a[5] === 1) pts.push(a); }
        pts.push(a0);
        if (pts.length < 2) return;
        var col = colors[cs];
        for (var j = 1; j < pts.length; j++) {
          var p0 = P(pts[j - 1][1], pts[j - 1][2], pts[j - 1][3]), p1 = P(pts[j][1], pts[j][2], pts[j][3]);
          var g0 = P(pts[j - 1][1], pts[j - 1][2], 0), g1 = P(pts[j][1], pts[j][2], 0);
          if (!p0 || !p1 || !g0 || !g1) continue;
          var w = j / pts.length;
          ctx.globalAlpha = 0.05 * w; ctx.fillStyle = col;
          ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(g1[0], g1[1]); ctx.lineTo(g0[0], g0[1]); ctx.closePath(); ctx.fill();
          ctx.globalAlpha = 0.15 * w; ctx.strokeStyle = "#9aabc6"; ctx.lineWidth = 1 * dpr;
          ctx.beginPath(); ctx.moveTo(g0[0], g0[1]); ctx.lineTo(g1[0], g1[1]); ctx.stroke();
          ctx.globalAlpha = 0.1 + 0.8 * Math.pow(w, 1.5); ctx.strokeStyle = col; ctx.lineWidth = 2.2 * dpr;
          ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      });
      // the active search plan's predicted tracks, at their predicted altitudes (window flights only)
      var nowT = stateTime(), active = null, prevPlan = null, wa = {};
      rowsNow.forEach(function (r) { wa[r.cs] = Math.max(wa[r.cs] || 0, r.alpha); });
      if (layers.plans) plans.forEach(function (pl) { if (pl.t <= nowT + 1e-6) { prevPlan = active; active = pl; } });
      function plan3(pl, fade) {
        pl.cands.slice().sort(function (a, b) { return (a.chosen ? 1 : 0) - (b.chosen ? 1 : 0); }).forEach(function (c) {
          var col = c.pruned ? PRED.pruned : c.chosen ? PRED.chosen : c.los ? PRED.los : PRED.other;
          var baseA = c.pruned ? 0.1 : c.chosen ? 0.95 : c.los ? 0.35 : 0.25;
          ctx.strokeStyle = col; ctx.lineWidth = (c.chosen ? 2.2 : 1) * dpr; ctx.setLineDash(c.chosen ? [8 * dpr, 5 * dpr] : [2 * dpr, 5 * dpr]);
          ctx.shadowColor = col; ctx.shadowBlur = c.chosen ? 8 * dpr : 0;
          Object.keys(c.byCs).forEach(function (cs) {
            var al = wa[cs] || 0;
            if (al <= 0.01) return;
            var pts = c.byCs[cs].filter(function (q) { return q[0] >= nowT - 1e-6; });
            if (pts.length < 2) return;
            var here = byNow[cs], line = (here && here[5] === 1 ? [[here[1], here[2], here[3]]] : []).concat(pts.map(function (q) { return [q[1], q[2], q[3]]; }));
            ctx.globalAlpha = baseA * fade * al; poly(line); ctx.stroke();
          });
          ctx.setLineDash([]); ctx.shadowBlur = 0;
        });
        ctx.globalAlpha = 1;
      }
      if (active) {
        var fin = prevPlan ? Math.max(0, Math.min(1, (nowT - active.t) / (0.7 * dtDec))) : 1;
        if (fin < 1) plan3(prevPlan, 1 - fin);
        plan3(active, fin);
      }
      // proximity between controlled pairs
      var air = ac.filter(function (a) { return a[5] === 1; });
      for (var p1_ = 0; p1_ < air.length; p1_++) for (var p2_ = p1_ + 1; p2_ < air.length; p2_++) {
        var A = air[p1_], B = air[p2_], dh = Math.hypot(A[1] - B[1], A[2] - B[2]), dv = Math.abs(A[3] - B[3]);
        if (dh >= 5 || dv >= 1000) continue;
        var los = dh <= 3 && dv <= 500, sa = P(A[1], A[2], A[3]), sb = P(B[1], B[2], B[3]);
        if (!sa || !sb) continue;
        ctx.strokeStyle = los ? bad : warn; ctx.lineWidth = (los ? 3 : 1.8) * dpr;
        if (!los) { ctx.setLineDash([5 * dpr, 4 * dpr]); ctx.lineDashOffset = -now * 20 * dpr; }
        ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = los ? 12 * dpr : 0;
        ctx.beginPath(); ctx.moveTo(sa[0], sa[1]); ctx.lineTo(sb[0], sb[1]); ctx.stroke();
        ctx.setLineDash([]); ctx.lineDashOffset = 0; ctx.shadowBlur = 0;
        ctx.fillStyle = ctx.strokeStyle; ctx.font = (los ? "700 " : "") + (9 * dpr) + "px " + mono;
        ctx.fillText((los ? "LoS " : "") + dh.toFixed(1) + " NM / " + Math.round(dv) + " ft", (sa[0] + sb[0]) / 2 + 4 * dpr, (sa[1] + sb[1]) / 2 - 4 * dpr);
      }
      // clearances of the last few decisions, on their aircraft
      var latest = {};
      for (var kL = Math.max(0, i - FADE); kL <= i; kL++) evByFrame[kL].forEach(function (e) { latest[e.cs] = e; });
      // aircraft, far to near: drop line, ground shadow, chevron at altitude, label with flight level
      air.map(function (a) { return { a: a, s: P(a[1], a[2], a[3]) }; }).filter(function (o) { return o.s; })
        .sort(function (x, y) { return y.s[2] - x.s[2]; }).forEach(function (o) {
          var a = o.a, sp = o.s, cs = a[0], col = colors[cs], gp = P(a[1], a[2], 0);
          if (gp) {
            ctx.strokeStyle = col; ctx.globalAlpha = 0.4; ctx.lineWidth = 1 * dpr; ctx.setLineDash([2 * dpr, 3 * dpr]);
            ctx.beginPath(); ctx.moveTo(sp[0], sp[1]); ctx.lineTo(gp[0], gp[1]); ctx.stroke(); ctx.setLineDash([]);
            ctx.globalAlpha = 0.5; ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(gp[0], gp[1], 3 * dpr, 1.6 * dpr, 0, 0, 2 * Math.PI); ctx.fill();
            ctx.globalAlpha = 1;
          }
          var ahead = P(a[1] + Math.cos(a.hd) * 2, a[2] + Math.sin(a.hd) * 2, a[3]), ang = ahead ? Math.atan2(ahead[1] - sp[1], ahead[0] - sp[0]) : 0;
          var sz = Math.max(4.5, Math.min(10, 7.5 * cam.dist / sp[2])) * dpr;
          var e = latest[cs];
          if (e) {
            var age = u - e.fi, fade = Math.max(0, 1 - age / FADE);
            ctx.globalAlpha = fade; ctx.strokeStyle = e.cat.color; ctx.lineWidth = 1.6 * dpr; ctx.shadowColor = e.cat.color; ctx.shadowBlur = 8 * dpr;
            ctx.beginPath(); ctx.arc(sp[0], sp[1], sz * 1.9, 0, 2 * Math.PI); ctx.stroke(); ctx.shadowBlur = 0;
            drawGlyph(ctx, sp[0] + sz * 2.6, sp[1] - sz * 2.2, 13 * dpr, e.cat);
            ctx.globalAlpha = 1;
          }
          ctx.save(); ctx.translate(sp[0], sp[1]); ctx.rotate(ang);
          ctx.shadowColor = col; ctx.shadowBlur = 10 * dpr; ctx.fillStyle = col; ctx.strokeStyle = "#02060d"; ctx.lineWidth = 1.1 * dpr;
          ctx.beginPath(); ctx.moveTo(sz * 1.5, 0); ctx.lineTo(-sz, sz * 0.9); ctx.lineTo(-sz * 0.45, 0); ctx.lineTo(-sz, -sz * 0.9); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.restore();
          if (layers.labels !== "off") {
            var flv = "FL" + String(Math.round(a[3] / 100)).padStart(3, "0");
            ctx.font = "600 " + (9 * dpr) + "px " + mono; ctx.fillStyle = "rgba(244,248,255,0.88)";
            ctx.fillText(shortCs(cs) + " " + flv, sp[0] + sz + 3 * dpr, sp[1] - sz);
            if (layers.labels === "full") {
              ctx.fillStyle = Math.abs(a[6]) <= 60 ? ok : Math.abs(a[6]) <= 300 ? warn : bad;
              ctx.fillText(sgn(a[6]) + " s · " + Math.round(a[4]) + " kt", sp[0] + sz + 3 * dpr, sp[1] - sz + 11 * dpr);
            }
          }
        });
      // HUD: clock, controls, compass, live / end state
      ctx.fillStyle = "rgba(2,6,13,0.7)"; roundRect(ctx, m, m, 150 * dpr, 34 * dpr, 4 * dpr); ctx.fill();
      ctx.fillStyle = "#f4f8ff"; ctx.font = "600 " + (15 * dpr) + "px " + mono; ctx.fillText("t+" + fmtT(stateTime()), m + 8 * dpr, m + 16 * dpr);
      ctx.fillStyle = "rgba(63,208,255,0.85)"; ctx.font = (9 * dpr) + "px " + mono;
      ctx.fillText("3D · altitude ×" + layers.exag + " · " + procLabel, m + 8 * dpr, m + 28 * dpr);
      ctx.fillStyle = "rgba(154,171,198,0.75)";
      ctx.fillText("drag rotate · right-drag pan · " + (/Mac/.test(navigator.platform) ? "⌘" : "Ctrl") + " + scroll zoom · double-click reset", m, m + 48 * dpr);
      var nc = [W - m - 22 * dpr, H - m - 30 * dpr], c0 = P(cam.cx, cam.cy, 0), c1 = P(cam.cx, cam.cy + 5, 0);
      if (c0 && c1) {
        var na = Math.atan2(c1[1] - c0[1], c1[0] - c0[0]);
        ctx.save(); ctx.translate(nc[0], nc[1]); ctx.rotate(na + Math.PI / 2);
        ctx.fillStyle = "rgba(233,241,255,0.75)"; ctx.beginPath(); ctx.moveTo(0, -12 * dpr); ctx.lineTo(5 * dpr, 4 * dpr); ctx.lineTo(-5 * dpr, 4 * dpr); ctx.closePath(); ctx.fill();
        ctx.restore();
        ctx.font = "600 " + (10 * dpr) + "px " + head; ctx.fillText("N", nc[0] + Math.cos(na) * 20 * dpr - 3 * dpr, nc[1] + Math.sin(na) * 20 * dpr + 4 * dpr);
      }
      if (live) {
        ctx.font = "700 " + (11 * dpr) + "px " + head;
        var lt = "● LIVE · SEARCH RUNNING", ltw = ctx.measureText(lt).width, lx0 = (W - ltw) / 2;
        ctx.fillStyle = "rgba(2,6,13,0.8)"; roundRect(ctx, lx0 - m, m, ltw + 2 * m, 22 * dpr, 4 * dpr); ctx.fill();
        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(now * 4); ctx.fillStyle = PRED.chosen; ctx.fillText(lt, lx0, m + 15 * dpr); ctx.globalAlpha = 1;
      } else if (u >= frames.length - 1) {
        var s0 = d.summary, txt = s0.los ? "LOSS OF SEPARATION" : (s0.solved ? "SOLVED · " : s0.end_reason.toUpperCase() + " · ") + s0.on_time + "/" + s0.n_flights + " ON TIME";
        ctx.font = "700 " + (15 * dpr) + "px " + head;
        var tw2 = ctx.measureText(txt).width, col2 = s0.los ? bad : s0.solved ? ok : warn;
        ctx.fillStyle = "rgba(2,6,13,0.85)"; roundRect(ctx, W - tw2 - 3 * m, m * 2.4, tw2 + 2 * m, 28 * dpr, 4 * dpr); ctx.fill();
        ctx.strokeStyle = col2; ctx.lineWidth = 1.5 * dpr; ctx.stroke();
        ctx.fillStyle = col2; ctx.fillText(txt, W - tw2 - 2 * m, m * 2.4 + 19 * dpr);
      }
    }

    function roundRect(c, x, y, w, h_, r) {
      c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h_, r); c.arcTo(x + w, y + h_, x, y + h_, r);
      c.arcTo(x, y + h_, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
    }

    // ------------------------------------------------------------------ the clearance timeline
    function tlGeometry() {
      var dpr = window.devicePixelRatio || 1, W = tl.width, H = tl.height;
      var t0 = frames[0].t, t1 = frames[frames.length - 1].t, x0 = 46 * dpr, x1 = W - 14 * dpr;
      return { dpr: dpr, W: W, H: H, t0: t0, t1: t1, x0: x0, x1: x1, top: 26 * dpr, rowH: tlRowPx() * dpr,
        X: function (t) { return x0 + (x1 - x0) * (t - t0) / Math.max(1, t1 - t0); },
        T: function (px) { return t0 + (px - x0) / (x1 - x0) * (t1 - t0); } };
    }
    function tlRowPx() { var n = d.trace.queue.length; return n > 40 ? 9 : n > 24 ? 11 : 14; }
    function buildTimeline() {
      var g = tlGeo = tlGeometry(), dpr = g.dpr, W = g.W, H = g.H;
      var c = document.createElement("canvas"); c.width = W; c.height = H;
      var x = c.getContext("2d"), mono = css("--tada-font-mono"), head = css("--tada-font-head");
      var ok = css("--tada-ok"), warn = css("--tada-warn"), bad = css("--tada-bad");
      x.fillStyle = "#02060d"; x.fillRect(0, 0, W, H);
      x.font = "600 " + (10 * dpr) + "px " + head; x.fillStyle = css("--tada-tile-label");
      x.fillText("CLEARANCES OVER TIME", g.x0, 14 * dpr);
      var nRows = d.trace.queue.length, bottom = g.top + nRows * g.rowH;
      // minute grid
      x.font = (9 * dpr) + "px " + mono;
      var span = g.t1 - g.t0, stepS = span > 5400 ? 900 : span > 2400 ? 600 : 300;
      for (var t = Math.ceil(g.t0 / stepS) * stepS; t <= g.t1; t += stepS) {
        var px = g.X(t);
        x.strokeStyle = "rgba(63,208,255,0.08)"; x.lineWidth = 1;
        x.beginPath(); x.moveTo(px, g.top - 4 * dpr); x.lineTo(px, bottom); x.stroke();
        x.fillStyle = "rgba(154,171,198,0.8)"; var lab = "t+" + fmtT(t), tw = x.measureText(lab).width;
        x.fillText(lab, Math.min(px - tw / 2, W - tw - 2), bottom + 14 * dpr);
      }
      d.trace.queue.forEach(function (cs, k) {
        var y = g.top + k * g.rowH + g.rowH / 2, L = life[cs], col = colors[cs];
        if (segOf[cs] != null && (k === 0 || segOf[cs] !== segOf[d.trace.queue[k - 1]])) {  // a composed stream's next segment
          var sy = g.top + k * g.rowH, sg = d.composition[segOf[cs]];
          if (k) { x.strokeStyle = "rgba(255,210,63,0.35)"; x.lineWidth = 1 * dpr; x.setLineDash([4 * dpr, 4 * dpr]);
            x.beginPath(); x.moveTo(0, sy); x.lineTo(W, sy); x.stroke(); x.setLineDash([]); }
          x.fillStyle = "rgba(255,210,63,0.75)"; x.font = "600 " + (8.5 * dpr) + "px " + mono;
          var st_ = "SEGMENT " + (segOf[cs] + 1) + " · " + sg.flights + " flights" + (k ? " · after " + fmtT(sg.gap_s) : "");
          x.fillText(st_, W - x.measureText(st_).width - 6 * dpr, sy + 9 * dpr);
        }
        if (k % 2 === 0) { x.fillStyle = "rgba(255,255,255,0.025)"; x.fillRect(0, y - g.rowH / 2, W, g.rowH); }
        x.fillStyle = col; x.fillRect(4 * dpr, y - 3 * dpr, 3 * dpr, 6 * dpr);
        x.fillStyle = "rgba(233,241,255,0.85)"; x.font = Math.min(9.5, g.rowH / dpr - 1) * dpr + "px " + mono; x.fillText(shortCs(cs), 11 * dpr, y + g.rowH * 0.28);
        var tEnd = L.land != null ? L.land : g.t1;
        if (L.seen != null) {  // waiting to spawn / not yet under control: dim dotted
          x.strokeStyle = col; x.globalAlpha = 0.25; x.lineWidth = 1 * dpr; x.setLineDash([2 * dpr, 3 * dpr]);
          x.beginPath(); x.moveTo(g.X(L.seen), y); x.lineTo(g.X(L.on != null ? L.on : tEnd), y); x.stroke(); x.setLineDash([]);
        }
        if (L.on != null) {    // under control: solid in the flight's colour
          x.globalAlpha = 0.7; x.lineWidth = 2 * dpr;
          x.beginPath(); x.moveTo(g.X(L.on), y); x.lineTo(g.X(tEnd), y); x.stroke();
        }
        x.globalAlpha = 1;
        if (L.land != null) {  // touchdown: on time or not, and by how much
          var good = Math.abs(L.dev) <= 60, c2 = good ? ok : Math.abs(L.dev) <= 300 ? warn : bad, lx = g.X(L.land);
          x.fillStyle = c2; x.font = "700 " + (10 * dpr) + "px " + mono;
          x.fillText(good ? "✓" : "✗", lx + 3 * dpr, y + 3.5 * dpr);
          x.font = (8.5 * dpr) + "px " + mono; x.fillText(sgn(L.dev), lx + 13 * dpr, y + 3 * dpr);
        }
      });
      // every clearance as its glyph, where and when it was issued
      d.trace.events.forEach(function (e) {
        var k = d.trace.queue.indexOf(e.cs);
        if (k < 0) return;
        var y = g.top + k * g.rowH + g.rowH / 2;
        e.tx = g.X(e.t); e.ty = y;
        drawGlyph(x, e.tx, y, Math.min(9.5 * dpr, g.rowH * 0.72), e.cat);
      });
      // search plans: a tick per plan (a star where it switched to a new candidate)
      plans.forEach(function (pl) {
        var px_ = g.X(pl.t);
        x.fillStyle = PRED.chosen; x.globalAlpha = pl.switched ? 1 : 0.55;
        x.beginPath(); x.moveTo(px_ - 3.5 * dpr, g.top - 9 * dpr); x.lineTo(px_ + 3.5 * dpr, g.top - 9 * dpr); x.lineTo(px_, g.top - 3 * dpr); x.closePath(); x.fill();
        if (pl.switched) { x.font = "700 " + (9 * dpr) + "px " + mono; x.fillText("★", px_ - 3 * dpr, g.top - 11 * dpr); }
        x.globalAlpha = 1;
      });
      // the episode's end
      if (d.summary.los) {
        x.fillStyle = bad; x.font = "700 " + (10 * dpr) + "px " + head;
        x.fillText("LoS", g.x1 - 22 * dpr, g.top - 6 * dpr);
      }
      tlCache = c;
    }
    function drawTimeline() {
      if (!tl || !tl.width) return;
      if (!tlCtx || tlCtx.canvas !== tl) tlCtx = tl.getContext("2d");
      if (!tlCache || tlCache.width !== tl.width || tlCache.height !== tl.height) buildTimeline();
      var g = tlGeo, dpr = g.dpr, x = tlCtx, t = stateTime(), px = g.X(t), bottom = g.top + d.trace.queue.length * g.rowH;
      x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.shadowBlur = 0;
      x.drawImage(tlCache, 0, 0);
      // the future, dimmed
      x.fillStyle = "rgba(2,6,13,0.45)"; x.fillRect(px, g.top - 4 * dpr, g.x1 + 14 * dpr - px, bottom - g.top + 4 * dpr);
      // the flights in the agent's window right now (the centre panel), bracketed on the left
      rowsNow.forEach(function (r) {
        var k = d.trace.queue.indexOf(r.cs);
        if (k < 0) return;
        x.globalAlpha = r.alpha; x.fillStyle = "rgba(63,208,255,0.07)"; x.fillRect(0, g.top + k * g.rowH, g.W, g.rowH);
        x.fillStyle = "rgba(63,208,255,0.8)"; x.fillRect(0, g.top + k * g.rowH, 2 * dpr, g.rowH);
      });
      x.globalAlpha = 1;
      // clearances of the last decision glow
      var i = Math.floor(u);
      for (var k = Math.max(0, i - 1); k <= i; k++) evByFrame[k].forEach(function (e) {
        var age = u - k;
        if (age < 0 || age > 1.6 || e.tx == null) return;
        x.globalAlpha = 1 - age / 1.6; x.strokeStyle = e.cat.color; x.lineWidth = 1.5 * dpr; x.shadowColor = e.cat.color; x.shadowBlur = 8 * dpr;
        x.beginPath(); x.arc(e.tx, e.ty, (6 + 6 * age) * dpr, 0, 2 * Math.PI); x.stroke();
      });
      x.globalAlpha = 1; x.shadowBlur = 0;
      // playhead
      x.strokeStyle = css("--tada-champion"); x.lineWidth = 2 * dpr; x.shadowColor = x.strokeStyle; x.shadowBlur = 8 * dpr;
      x.beginPath(); x.moveTo(px, g.top - 8 * dpr); x.lineTo(px, bottom); x.stroke(); x.shadowBlur = 0;
      x.fillStyle = x.strokeStyle; x.beginPath(); x.moveTo(px - 5 * dpr, g.top - 12 * dpr); x.lineTo(px + 5 * dpr, g.top - 12 * dpr); x.lineTo(px, g.top - 5 * dpr); x.closePath(); x.fill();
      // hover: what that glyph was
      if (tlHover) {
        var e = tlHover, txt = shortCs(e.cs) + " · " + pretty(e.name) + " · t+" + fmtT(e.t);
        x.font = "600 " + (10 * dpr) + "px " + css("--tada-font-mono");
        var tw = x.measureText(txt).width, bx = Math.min(e.tx + 10 * dpr, g.W - tw - 16 * dpr), by = e.ty - 24 * dpr < 2 ? e.ty + 10 * dpr : e.ty - 24 * dpr;
        x.fillStyle = "rgba(2,6,13,0.92)"; roundRect(x, bx, by, tw + 12 * dpr, 17 * dpr, 4 * dpr); x.fill();
        x.strokeStyle = e.cat.color; x.lineWidth = 1 * dpr; x.stroke();
        x.fillStyle = "#f4f8ff"; x.fillText(txt, bx + 6 * dpr, by + 12 * dpr);
        x.strokeStyle = e.cat.color; x.lineWidth = 1.5 * dpr; x.beginPath(); x.arc(e.tx, e.ty, 7 * dpr, 0, 2 * Math.PI); x.stroke();
      }
    }
    function attachTimeline(c) {
      var scrubbing = false;
      function at(ev) {
        var r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
        return [(ev.clientX - r.left) * dpr, (ev.clientY - r.top) * dpr];
      }
      function seek(ev) {
        if (!tlGeo) return;
        var p = at(ev), t = tlGeo.T(p[0]), best = 0;
        frames.forEach(function (f, k) { if (Math.abs(f.t - t) < Math.abs(frames[best].t - t)) best = k; });
        u = best; follow = false; draw();
      }
      c.addEventListener("pointerdown", function (ev) {
        scrubbing = true; c.setPointerCapture(ev.pointerId);
        if (tlHover) { u = tlHover.fi; follow = false; draw(); } else seek(ev);
      });
      c.addEventListener("pointermove", function (ev) {
        if (scrubbing) { seek(ev); return; }
        if (!tlGeo) return;
        var p = at(ev), hit = null, bestD = 8 * tlGeo.dpr;
        d.trace.events.forEach(function (e) {
          if (e.tx == null) return;
          var dd = Math.hypot(e.tx - p[0], e.ty - p[1]);
          if (dd < bestD) { bestD = dd; hit = e; }
        });
        if (hit !== tlHover) { tlHover = hit; c.style.cursor = hit ? "pointer" : "crosshair"; drawTimeline(); }
      });
      ["pointerup", "pointercancel"].forEach(function (n) { c.addEventListener(n, function () { scrubbing = false; }); });
      c.addEventListener("pointerleave", function () { if (tlHover) { tlHover = null; drawTimeline(); } });
    }

    // ------------------------------------------------------------------ the agent's window: clearances (centre)
    function drawWindow() {
      if (!wcv || !wcv.width) return;
      if (!wctx || wctx.canvas !== wcv) wctx = wcv.getContext("2d");
      var x = wctx, dpr = window.devicePixelRatio || 1, W = wcv.width, H = wcv.height, g = rowGeom(H, dpr);
      var mono = css("--tada-font-mono"), head = css("--tada-font-head"), ok = css("--tada-ok"), warn = css("--tada-warn"), bad = css("--tada-bad");
      var t = stateTime(), labW = 46 * dpr, x0 = labW, x1 = W - 6 * dpr, i = Math.floor(u);
      function X(tt) { return x0 + (x1 - x0) * (tt - (t - PAST)) / (PAST + AHEAD); }
      var nowX = X(t), gs = Math.min(g.rowH * 0.6, 17 * dpr);
      x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.shadowBlur = 0; x.setLineDash([]);
      x.fillStyle = "#02060d"; x.fillRect(0, 0, W, H);
      x.font = "600 " + (10 * dpr) + "px " + head; x.fillStyle = css("--tada-tile-label");
      x.fillText("CLEARANCES · AGENT'S WINDOW", 8 * dpr, 13 * dpr);
      x.font = (9 * dpr) + "px " + mono; x.fillStyle = "rgba(154,171,198,0.85)";
      x.fillText(frames[i].win.length + " flights, AMAN order · first to land on top", 8 * dpr, 26 * dpr);
      // the future, and a minute grid relative to now
      x.fillStyle = "rgba(255,255,255,0.025)"; x.fillRect(nowX, g.top - 4 * dpr, x1 - nowX, g.bottom - g.top + 4 * dpr);
      for (var m_ = -Math.floor(PAST / 120) * 120; m_ <= AHEAD; m_ += 120) {
        var gx = X(t + m_); if (gx < x0) continue;
        x.strokeStyle = "rgba(63,208,255,0.07)"; x.lineWidth = 1; x.beginPath(); x.moveTo(gx, g.top - 4 * dpr); x.lineTo(gx, g.bottom); x.stroke();
        var gl = m_ === 0 ? "now" : (m_ > 0 ? "+" : "−") + Math.abs(m_ / 60) + "′";
        x.fillStyle = m_ === 0 ? css("--tada-champion") : "rgba(154,171,198,0.75)"; x.fillText(gl, gx - x.measureText(gl).width / 2, g.bottom + 14 * dpr);
      }
      // rows: zebra by slot, then each flight at its (sliding) position
      for (var k = 0; k < winN; k++) if (k % 2 === 0) { x.fillStyle = "rgba(255,255,255,0.022)"; x.fillRect(0, g.top + k * g.rowH, W, g.rowH); }
      x.save(); x.beginPath(); x.rect(0, g.top - 2 * dpr, W, g.bottom - g.top + 4 * dpr); x.clip();
      rowsNow.forEach(function (r) {
        var cs = r.cs, y = g.top + (r.pos + 0.5) * g.rowH, L = life[cs], col = colors[cs], evs = evByCs[cs] || [];
        x.globalAlpha = r.alpha;
        x.fillStyle = col; x.fillRect(4 * dpr, y - g.rowH * 0.3, 3 * dpr, g.rowH * 0.6);
        x.fillStyle = "rgba(233,241,255,0.92)"; x.font = "600 " + Math.min(11, g.rowH / dpr * 0.42) * dpr + "px " + mono;
        x.fillText(shortCs(cs), 11 * dpr, y + 4 * dpr);
        // life line: waiting (dotted) then under control (solid), up to now or touchdown
        var tEnd = L.land != null && L.land <= t ? L.land : t, ta = Math.max(t - PAST, L.seen != null ? L.seen : t);
        x.save(); x.beginPath(); x.rect(x0, 0, x1 - x0, H); x.clip();
        if (L.on == null || L.on > ta) {
          x.strokeStyle = col; x.globalAlpha = r.alpha * 0.3; x.lineWidth = 1 * dpr; x.setLineDash([2 * dpr, 3 * dpr]);
          x.beginPath(); x.moveTo(X(ta), y); x.lineTo(X(Math.min(tEnd, L.on != null ? L.on : tEnd)), y); x.stroke(); x.setLineDash([]);
        }
        if (L.on != null && L.on < tEnd) {
          x.strokeStyle = col; x.globalAlpha = r.alpha * 0.55; x.lineWidth = 2 * dpr;
          x.beginPath(); x.moveTo(X(Math.max(L.on, t - PAST)), y); x.lineTo(X(tEnd), y); x.stroke();
        }
        x.globalAlpha = r.alpha;
        // its clearances, as glyphs where they were issued; the last decision's glow
        var lastE = null;
        evs.forEach(function (e) {
          if (e.t > t + 1e-6) return;
          lastE = e;
          if (e.t < t - PAST - 30) return;
          var ex = X(e.t) + e.slot * gs * 0.95;
          var age = u - e.fi;
          if (age >= 0 && age < 1.6) {
            x.save(); x.globalAlpha = r.alpha * (1 - age / 1.6); x.strokeStyle = e.cat.color; x.lineWidth = 1.5 * dpr; x.shadowColor = e.cat.color; x.shadowBlur = 8 * dpr;
            x.beginPath(); x.arc(ex, y, gs * (0.65 + 0.5 * age), 0, 2 * Math.PI); x.stroke(); x.restore();
          }
          drawGlyph(x, ex, y, gs, e.cat);
        });
        // touchdown
        if (L.land != null && L.land <= t) {
          var good = Math.abs(L.dev) <= 60, c2 = good ? ok : Math.abs(L.dev) <= 300 ? warn : bad;
          x.fillStyle = c2; x.font = "700 " + (10 * dpr) + "px " + mono; x.fillText((good ? "✓ " : "✗ ") + sgn(L.dev), X(L.land) + 4 * dpr, y + 4 * dpr);
        }
        x.restore();
        // ahead of now: the last clearance in words, fading with age
        if (lastE) {
          var ageD = Math.max(0, u - lastE.fi), aa = Math.max(0.35, 1 - ageD / (FADE * 2));
          x.globalAlpha = r.alpha * aa; x.fillStyle = lastE.cat.color; x.font = (9.5 * dpr) + "px " + mono;
          var txt = pretty(lastE.name), ago = fmtT(Math.max(0, t - lastE.t)) + " ago";
          var tx0 = nowX + gs * 0.7 + 4 * dpr;
          x.fillText(txt, tx0, y - 1 * dpr);
          x.fillStyle = "rgba(154,171,198,0.9)"; x.font = (8.5 * dpr) + "px " + mono; x.fillText(ago, tx0, y + 9 * dpr);
        } else if (L.on != null && L.on <= t) {
          x.globalAlpha = r.alpha * 0.5; x.fillStyle = "rgba(154,171,198,0.9)"; x.font = (9 * dpr) + "px " + mono; x.fillText("on its flight plan", nowX + 6 * dpr, y + 3 * dpr);
        }
        x.globalAlpha = 1;
      });
      x.restore();
      // now
      x.strokeStyle = css("--tada-champion"); x.lineWidth = 1.5 * dpr; x.globalAlpha = 0.9;
      x.beginPath(); x.moveTo(nowX, g.top - 6 * dpr); x.lineTo(nowX, g.bottom); x.stroke(); x.globalAlpha = 1;
    }

    // ------------------------------------------------------------------ landing deviation of the whole stream
    // One column per flight in AMAN order: the bar is its landing deviation (up late, down early), predicted until it
    // lands, then final (✓ / ✗); the tick is where it would land with no control at all. The window's flights are
    // bracketed, flights cleared within the last decision glow, and a composed stream's segments are marked.
    function devGeometry() {
      var dpr = window.devicePixelRatio || 1, W = strip.width, H = strip.height, n = d.trace.queue.length;
      var x0 = 46 * dpr, x1 = W - 10 * dpr, top = 34 * dpr, bottom = H - 30 * dpr, colW = (x1 - x0) / Math.max(1, n), lim = 300;
      return { dpr: dpr, W: W, H: H, n: n, x0: x0, x1: x1, top: top, bottom: bottom, colW: colW, lim: lim, mid: (top + bottom) / 2,
        Y: function (v) { return (top + bottom) / 2 - Math.max(-lim, Math.min(lim, v)) / lim * (bottom - top) / 2; } };
    }
    function drawStrip() {
      if (!sctx || !strip.width) return;
      var g = devGeo = devGeometry(), dpr = g.dpr, W = g.W, H = g.H, x = sctx, Y = g.Y;
      var ok = css("--tada-ok"), warn = css("--tada-warn"), bad = css("--tada-bad"), mono = css("--tada-font-mono"), head = css("--tada-font-head");
      var i = Math.floor(u), fr = u - i, A = frames[i], B = frames[Math.min(frames.length - 1, i + 1)];
      x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.shadowBlur = 0;
      x.fillStyle = "#02060d"; x.fillRect(0, 0, W, H);
      // header and the running totals of the stream
      var landedN = 0, onT = 0, sum = 0, worst = 0;
      A.ac.forEach(function (a) { if (a[5] === 2) { landedN++; if (Math.abs(a[6]) <= 60) onT++; sum += Math.abs(a[6]); worst = Math.max(worst, Math.abs(a[6])); } });
      x.font = "600 " + (10 * dpr) + "px " + head; x.fillStyle = css("--tada-tile-label");
      x.fillText("LANDING DEVIATION · WHOLE STREAM", g.x0, 14 * dpr);
      x.font = (9.5 * dpr) + "px " + mono;
      var tot = "landed " + landedN + "/" + g.n + " · " + onT + " on time" + (landedN ? " · max |dev| " + Math.round(worst) + " s · Σ|dev| " + Math.round(sum) + " s" : "");
      x.fillStyle = landedN && onT < landedN ? warn : landedN ? ok : "rgba(154,171,198,0.85)";
      x.fillText(tot, g.x1 - x.measureText(tot).width, 14 * dpr);
      x.fillStyle = "rgba(154,171,198,0.7)"; x.font = (8.5 * dpr) + "px " + mono;
      x.fillText("bars: predicted until landing, then final · tick: no control", g.x0, 26 * dpr);
      // bands, zero, axis
      x.fillStyle = "rgba(62,224,122,0.08)"; x.fillRect(g.x0, Y(60), g.x1 - g.x0, Y(-60) - Y(60));
      x.fillStyle = "rgba(62,224,122,0.10)"; x.fillRect(g.x0, Y(30), g.x1 - g.x0, Y(-30) - Y(30));
      x.strokeStyle = "rgba(233,241,255,0.3)"; x.lineWidth = 1;
      x.beginPath(); x.moveTo(g.x0, g.mid); x.lineTo(g.x1, g.mid); x.stroke();
      x.font = (8.5 * dpr) + "px " + mono; x.fillStyle = "rgba(154,171,198,0.8)";
      [[300, "+300"], [60, "+60"], [0, "0"], [-60, "−60"], [-300, "−300"]].forEach(function (t) {
        x.fillText(t[1], g.x0 - 6 * dpr - x.measureText(t[1]).width, Y(t[0]) + 3 * dpr);
      });
      x.save(); x.translate(10 * dpr, g.mid); x.rotate(-Math.PI / 2); x.fillStyle = "rgba(154,171,198,0.6)";
      x.fillText("early ← s → late", -x.measureText("early ← s → late").width / 2, 0); x.restore();
      // flights cleared within the last decision; the window's flights
      var fresh = {}, wa = {};
      for (var k = Math.max(0, i - 1); k <= i; k++) evByFrame[k].forEach(function (e) { if (u - k < 1.5) fresh[e.cs] = e.cat.color; });
      rowsNow.forEach(function (r) { wa[r.cs] = Math.max(wa[r.cs] || 0, r.alpha); });
      var bw = Math.max(2 * dpr, Math.min(g.colW * 0.62, 18 * dpr)), every = Math.max(1, Math.ceil(20 * dpr / g.colW));
      d.trace.queue.forEach(function (cs, kk) {
        var cx = g.x0 + (kk + 0.5) * g.colW, a = A.by[cs], b = B.by[cs] || a, L = life[cs];
        if (wa[cs]) {
          x.globalAlpha = wa[cs]; x.fillStyle = "rgba(63,208,255,0.07)"; x.fillRect(cx - g.colW / 2, g.top, g.colW, g.bottom - g.top);
          x.fillStyle = "rgba(63,208,255,0.85)"; x.fillRect(cx - g.colW / 2 + 1, g.bottom + 2 * dpr, g.colW - 2, 2 * dpr); x.globalAlpha = 1;
        }
        if (fresh[cs]) { x.globalAlpha = 0.18; x.fillStyle = fresh[cs]; x.fillRect(cx - g.colW / 2, g.top, g.colW, g.bottom - g.top); x.globalAlpha = 1; }
        if (devHover === kk) { x.fillStyle = "rgba(255,255,255,0.06)"; x.fillRect(cx - g.colW / 2, g.top, g.colW, g.bottom - g.top); }
        // segment boundary of a composed stream
        if (segOf[cs] != null && kk && segOf[cs] !== segOf[d.trace.queue[kk - 1]]) {
          x.strokeStyle = "rgba(255,210,63,0.4)"; x.setLineDash([3 * dpr, 3 * dpr]); x.beginPath(); x.moveTo(cx - g.colW / 2, g.top - 4 * dpr); x.lineTo(cx - g.colW / 2, g.bottom); x.stroke(); x.setLineDash([]);
          x.fillStyle = "rgba(255,210,63,0.75)"; x.font = "600 " + (8 * dpr) + "px " + mono; x.fillText("SEG " + (segOf[cs] + 1), cx - g.colW / 2 + 3 * dpr, g.top + 8 * dpr);
        }
        if (a) {
          var st = fr < 0.5 ? a[5] : b[5], dev = a[5] === b[5] ? a[6] + (b[6] - a[6]) * fr : (fr < 0.5 ? a : b)[6];
          var c = Math.abs(dev) <= 60 ? ok : Math.abs(dev) <= 300 ? warn : bad, y0 = g.mid, y1 = Y(dev);
          x.globalAlpha = st === 2 ? 1 : st === 1 ? 0.75 : 0.3;
          x.fillStyle = c; x.fillRect(cx - bw / 2, Math.min(y0, y1), bw, Math.max(1.5 * dpr, Math.abs(y1 - y0)));
          if (st === 2) { x.shadowColor = c; x.shadowBlur = 6 * dpr; x.fillRect(cx - bw / 2, y1 - (dev >= 0 ? 1 : 0) * 1.5 * dpr, bw, 1.5 * dpr); x.shadowBlur = 0; }
          x.globalAlpha = 1;
          if (Math.abs(dev) > g.lim) { x.fillStyle = c; x.font = (9 * dpr) + "px " + mono; x.fillText(dev > 0 ? "▲" : "▼", cx - 4 * dpr, dev > 0 ? g.top - 2 * dpr : g.bottom + 12 * dpr); }
          if (st === 2 && g.colW > 9 * dpr) {
            x.font = "700 " + (9 * dpr) + "px " + mono; x.fillStyle = c;
            var mk = Math.abs(dev) <= 60 ? "✓" : "✗";
            x.fillText(mk, cx - x.measureText(mk).width / 2, dev >= 0 ? Math.max(g.top + 8 * dpr, y1 - 4 * dpr) : Math.min(g.bottom - 2 * dpr, y1 + 11 * dpr));
          }
        }
        // no control at all
        var ini = initialOf[cs];
        if (ini != null) {
          x.strokeStyle = "rgba(233,241,255,0.7)"; x.lineWidth = 1.5 * dpr;
          x.beginPath(); x.moveTo(cx - g.colW * 0.4, Y(ini)); x.lineTo(cx + g.colW * 0.4, Y(ini)); x.stroke();
        }
        if (kk % every === 0) {
          x.fillStyle = colors[cs]; x.fillRect(cx - 4 * dpr, g.bottom + 8 * dpr, 8 * dpr, 2 * dpr);
          x.font = (8.5 * dpr) + "px " + mono; x.fillStyle = "rgba(233,241,255,0.75)";
          var lb = shortCs(cs); x.fillText(lb, cx - x.measureText(lb).width / 2, g.bottom + 20 * dpr);
        }
      });
      // hover: the flight's numbers
      if (devHover != null && d.trace.queue[devHover]) {
        var cs = d.trace.queue[devHover], a2 = A.by[cs], L2 = life[cs], ini2 = initialOf[cs];
        var lines = [shortCs(cs) + (a2 ? (a2[5] === 2 ? " · landed " + sgn(a2[6]) + " s" : a2[5] === 1 ? " · predicted " + sgn(a2[6]) + " s" : " · not yet under control") : ""),
          "no control " + (ini2 == null ? "–" : sgn(ini2) + " s") + " · " + ((evByCs[cs] || []).length) + " clearances" + (L2 && L2.land != null ? " · click: its landing" : "")];
        x.font = "600 " + (10 * dpr) + "px " + mono;
        var tw = Math.max.apply(null, lines.map(function (l) { return x.measureText(l).width; })), hx = g.x0 + (devHover + 0.5) * g.colW;
        var bx = Math.min(Math.max(4 * dpr, hx + 10 * dpr), W - tw - 16 * dpr), by = g.top + 4 * dpr;
        x.fillStyle = "rgba(2,6,13,0.92)"; roundRect(x, bx, by, tw + 12 * dpr, 32 * dpr, 4 * dpr); x.fill();
        x.strokeStyle = colors[cs]; x.lineWidth = 1 * dpr; x.stroke();
        x.fillStyle = "#f4f8ff"; x.fillText(lines[0], bx + 6 * dpr, by + 13 * dpr);
        x.fillStyle = "rgba(154,171,198,0.95)"; x.font = (9 * dpr) + "px " + mono; x.fillText(lines[1], bx + 6 * dpr, by + 26 * dpr);
      }
    }
    function attachDev(c) {
      function col(ev) {
        if (!devGeo) return null;
        var r = c.getBoundingClientRect(), px = (ev.clientX - r.left) * devGeo.dpr, k = Math.floor((px - devGeo.x0) / devGeo.colW);
        return k >= 0 && k < devGeo.n ? k : null;
      }
      c.addEventListener("pointermove", function (ev) { var k = col(ev); if (k !== devHover) { devHover = k; c.style.cursor = k == null ? "default" : "pointer"; draw(); } });
      c.addEventListener("pointerleave", function () { if (devHover != null) { devHover = null; draw(); } });
      c.addEventListener("click", function (ev) {  // jump to that flight's touchdown
        var k = col(ev), L = k == null ? null : life[d.trace.queue[k]];
        if (!L || L.land == null) return;
        var best = 0;
        frames.forEach(function (f, n) { if (Math.abs(f.t - L.land) < Math.abs(frames[best].t - L.land)) best = n; });
        stop(); u = best; follow = false; draw();
      });
    }
    return { mount: mount, resize: resize, isLive: isLive };
  })();

  // ---------------------------------------------------------------- boot
  // ---------------------------------------------------------------- runner discovery
  function store(v) { try { if (v == null) localStorage.removeItem(SAVED_KEY); else localStorage.setItem(SAVED_KEY, v); } catch (e) {} }
  function saved() { try { return localStorage.getItem(SAVED_KEY); } catch (e) { return null; } }
  function label(base) { return base ? base.replace(/^https?:\/\//, "") : "this server"; }
  function probe(base) {
    var ctl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, 2500);
    return fetch(base + "/api/health", ctl ? { signal: ctl.signal, cache: "no-store" } : {})
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error(r.status)); })
      .then(function (j) { clearTimeout(t); if (!j || !j.ok) throw new Error("not a lab runner"); return { base: base, info: j }; },
        function (e) { clearTimeout(t); throw e; });
  }
  function candidates() {
    var list = [], seen = {};
    function add(b) { b = (b || "").replace(/\/+$/, ""); if (!seen[b]) { seen[b] = 1; list.push(b); } }
    if (saved()) add(saved());
    if (/^https?:$/.test(location.protocol)) add("");
    RUNNERS.forEach(add);
    return list;
  }
  function findRunner() {
    var list = candidates();
    return list.reduce(function (p, b) { return p.catch(function () { return probe(b); }); }, Promise.reject())
      .catch(function () { throw list; });
  }

  function connBar(found) {
    var bar = h("div", { class: "lab-conn" }, [
      h("span", { class: "lab-conn__dot", "aria-hidden": "true" }),
      found.base === "browser"
        ? h("span", {}, ["Engine ", h("code", { text: "this browser (WebAssembly)" }), " · paper agents · MONAD generator · nothing installed on your machine"])
        : h("span", {}, ["Runner ", h("code", { text: label(found.base) }), " · " + found.info.agents + " agents · " + found.info.cached + " cached flights"]),
      found.base === "browser"
        ? h("span", {}, [
            h("button", { type: "button", class: "lab-btn lab-btn--link", onclick: function () { store(null); storeEngine(null); location.reload(); } }, ["use a runner instead"]),
            " · ",
            h("button", { type: "button", class: "lab-btn lab-btn--link", title: "Remove the engine key from this browser",
              onclick: function () { storeKey(null); storeEngine(null); location.reload(); } }, ["forget key"])])
        : h("span", {}, [
            h("button", { type: "button", class: "lab-btn lab-btn--link", onclick: function () { bar.replaceWith(runnerForm(found.base)); } }, ["change"]),
            window.TadaBrowserEngine ? " · " : null,
            window.TadaBrowserEngine ? h("button", { type: "button", class: "lab-btn lab-btn--link",
              title: "Fly the paper agents with the encrypted in-browser engine instead of this runner",
              onclick: function () { storeEngine("browser"); location.reload(); } }, ["use the in-browser engine"]) : null])
    ]);
    return bar;
  }
  function runnerForm(current) {
    var input = h("input", { class: "lab-input lab-conn__url", type: "url", value: current || "http://localhost:8800",
      placeholder: "http://localhost:8800", "aria-label": "runner URL" });
    var msg = h("span", { class: "lab-field__hint" });
    function go() {
      var v = input.value.trim().replace(/\/+$/, "");
      msg.textContent = "Connecting…";
      probe(v).then(function () { store(v); location.reload(); })
        .catch(function () { msg.textContent = "No lab runner answered at " + v + "."; });
    }
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
    return h("div", { class: "lab-conn lab-conn--form" }, [
      h("span", { text: "Runner URL" }), input,
      h("button", { type: "button", class: "lab-btn", onclick: go }, ["Connect"]),
      saved() ? h("button", { type: "button", class: "lab-btn lab-btn--link", onclick: function () { store(null); location.reload(); } }, ["forget saved"]) : null,
      msg
    ]);
  }
  var LAST_TRIED = [];
  function offline(tried, keyError, chosen) {
    LAST_TRIED = tried;
    if (chosen) {
      root.innerHTML = "";
      root.appendChild(h("div", { class: "lab-offline lab-offline--engine" }, [
        engineOffer(keyError),
        h("p", { class: "lab-field__hint" }, ["You chose the in-browser engine. ",
          h("button", { type: "button", class: "lab-btn lab-btn--link", onclick: function () { storeEngine(null); location.reload(); } }, ["Use a lab runner instead"]),
          " (it is looked for on localhost:8800)."])
      ]));
      return;
    }
    root.innerHTML = "";
    var https = location.protocol === "https:";
    root.appendChild(h("div", { class: "lab-offline" }, [
      h("div", { class: "lab-offline__head" }, [h("span", { class: "lab-conn__dot is-off", "aria-hidden": "true" }), "No lab runner found"]),
      window.TadaBrowserEngine ? engineOffer(keyError) : null,
      h("p", { html: "The Lab flies agents with the simulator and the checkpoints on <b>your</b> machine, through a small " +
        "local runner. Set it up once (Linux x86-64, Python 3.12, access to the private TADA code repository), then start it; " +
        "this page connects by itself as soon as it is up:" }),
      h("pre", { class: "lab-offline__cmd" }, [h("code", { text:
        "git clone https://github.com/leander-grech/tada-single-agent-docs.git\n" +
        "git clone git@github.com:tada-sesarju/monorepo.git     # private: needs access\n" +
        "cd tada-single-agent-docs\n" +
        "lab/setup.sh ../monorepo/reinforcement_learning/single_agent_rllib   # once\n" +
        "lab/run.sh" })]),
      h("p", { class: "lab-field__hint", html: "<a href=\"#run-the-lab\">Full instructions and troubleshooting \u2193</a> " +
        "\u00b7 The runner listens on 127.0.0.1:8800; <code>lab/run.sh --check</code> lists anything missing." +
        (https ? " From this https page only a runner on <code>localhost</code> can be reached; a runner on another " +
          "machine has to serve the page itself (<code>--host 0.0.0.0</code>, then open its <code>/lab/</code>)." : "") }),
      https ? h("div", { class: "lab-note", html:
        "<b>Runner already running?</b> Then your browser is keeping this page away from <code>localhost</code>. " +
        "Chrome asks first (\u201cAccess other apps and services on this device\u201d): allow it, or check the site settings " +
        "(lock icon \u2192 Local network access). Embedded and some other browsers refuse silently. " +
        "Either way you can use the Lab straight from your runner: " +
        "<a href=\"http://localhost:8800/lab/" + location.hash + "\">http://localhost:8800/lab/</a> " +
        "(<a href=\"http://localhost:8800/api/health\" target=\"_blank\" rel=\"noopener\">health check</a>: " +
        "if it shows <code>\"ok\": true</code>, the runner is up)." }) : null,
      h("p", { class: "lab-field__hint", text: "Looked at: " + tried.map(label).join(", ") + ". Retrying every few seconds." }),
      runnerForm(saved() || "")
    ]));
  }

  // ---------------------------------------------------------------- boot
  function start(found) {
    BASE = found.base;
    return api("/catalog").then(function (cat) {
      S.catalog = cat;
      if (!cat.code_ok) {
        root.innerHTML = "";
        root.appendChild(h("div", { class: "lab-offline" }, [
          h("div", { class: "lab-offline__head" }, [h("span", { class: "lab-conn__dot is-off" }), "Runner found, but no simulator code"]),
          h("p", { html: "The runner at <code>" + label(found.base) + "</code> cannot find the TADA single-agent code (looked in <code>" +
            cat.code_repo + "</code>). Point it there with <code>TADA_CODE_REPO=/path/to/single_agent_rllib lab/run.sh</code>." })
        ]));
        return;
      }
      if (S.agent && S.agent !== "do-nothing" && !agentById(S.agent)) S.agent = null;
      var setup = cat.setup || { ok: true, checks: [] };
      if (!setup.ok) { setupProblems(found, setup); return; }
      if (!cat.generators[S.sc.generator].available) S.sc.generator = "legacy";
      dropComposeIfUnsupported();
      root.innerHTML = "";
      build();
      root.insertBefore(connBar(found), root.firstChild);
      var warns = setup.checks.filter(function (c) { return !c.ok; });
      if (warns.length) root.insertBefore(h("details", { class: "lab-conn lab-conn--warn" }, [
        h("summary", { text: "⚠ " + warns.length + " setup note" + (warns.length > 1 ? "s" : "") + " from this runner" }),
        h("ul", {}, warns.map(function (c) { return h("li", {}, [h("b", { text: c.name + ": " }), c.msg, c.fix ? h("span", { class: "lab-field__hint", text: " Fix: " + c.fix }) : null]); }))
      ]), root.children[1]);
      loadScenario();
      var q = new URLSearchParams(location.hash.slice(1));
      if (q.get("a") && q.get("a") !== "do-nothing") { S.autoFly = true; }
      // a pasted or edited link (our own updates use replaceState and fire no event)
      window.addEventListener("hashchange", function () {
        readHash(); dropComposeIfUnsupported(); S.flight = null;
        S.autoFly = !!S.agent && S.agent !== "do-nothing";
        renderGen(); renderAgents(); loadScenario();
      });
    });
  }
  // composed streams are an in-browser-engine feature; a runner gets the paper's stitched streams
  function dropComposeIfUnsupported() {
    if (S.catalog.compose || !S.sc.compose) return;
    S.sc.compose = null; S.sc.segments = Math.min(S.sc.segments, S.catalog.max_segments || 3); S.sc.seed = S.sc.seed || 41;
  }
  function setupProblems(found, setup) {
    root.innerHTML = "";
    root.appendChild(h("div", { class: "lab-offline" }, [
      h("div", { class: "lab-offline__head" }, [h("span", { class: "lab-conn__dot is-off" }), "Runner found at " + label(found.base) + ", but it cannot fly yet"]),
      h("ul", { class: "lab-checks" }, setup.checks.map(function (c) {
        return h("li", { class: "lab-check lab-check--" + c.level }, [h("b", { text: (c.ok ? "✓ " : c.level === "error" ? "✗ " : "⚠ ") + c.name + " " }), c.msg,
          !c.ok && c.fix ? h("div", { class: "lab-field__hint", text: "Fix: " + c.fix }) : null]);
      })),
      h("p", { class: "lab-field__hint", html: "Fix the ✗ items, restart <code>lab/run.sh</code> and reload this page. <a href=\"#run-the-lab\">Setup instructions \u2193</a>" })
    ]));
  }
  function savedKey() { try { return localStorage.getItem(KEY_STORE); } catch (e) { return null; } }
  function storeKey(v) { try { if (v == null) localStorage.removeItem(KEY_STORE); else localStorage.setItem(KEY_STORE, v); } catch (e) {} }
  function engineOffer(err) {
    var input = h("input", { class: "lab-input lab-key__input", type: "password", autocomplete: "off", spellcheck: "false",
      placeholder: "tada1-…", "aria-label": "engine key" });
    var remember = h("input", { type: "checkbox", checked: true, id: "lab-key-remember" });
    var go = function () { if (input.value.trim()) startBrowser(input.value.trim(), remember.checked); };
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
    return h("div", { class: "lab-engine-offer" }, [
      h("div", { class: "lab-offline__head lab-key__head", text: "Run the Lab in this browser" }),
      h("p", { class: "lab-field__hint", text: "The in-browser engine is the TADA simulator with the paper's two agents (1_76 trombone, " +
        "1_77 point merge), compiled to WebAssembly: nothing to install. It is shared with registered users, so it is published " +
        "encrypted and unlocks with an engine key. Agent weights (under 1 MB each) load only when you press Download." }),
      err ? h("div", { class: "lab-error", text: "⚠ " + err }) : null,
      h("div", { class: "lab-row lab-key" }, [input,
        h("button", { type: "button", class: "lab-btn lab-btn--fly", onclick: go }, ["Unlock ▸"])]),
      h("label", { class: "lab-field__hint lab-key__remember", for: "lab-key-remember" }, [remember, " remember the key on this browser"]),
      h("p", { class: "lab-field__hint", html: (KEY_REQUEST
        ? "No key? <a href=\"" + KEY_REQUEST + "\" target=\"_blank\" rel=\"noopener\">Request one</a>; keys are issued by hand by the TADA team. "
        : "No key? Ask the TADA team; keys are issued by hand. ") +
        "A lab runner (below) needs no key but needs the TADA code repository." })
    ]);
  }
  function storeEngine(v) { try { if (v == null) localStorage.removeItem(ENGINE_KEY); else localStorage.setItem(ENGINE_KEY, v); } catch (e) {} }
  function startBrowser(key, remember) {
    if (ENGINE) return;
    root.innerHTML = ""; root.appendChild(progressBox("Unlocking the in-browser engine…"));
    window.TadaBrowserEngine.start(ASSETS, WORKER, key).then(function (eng) {
      ENGINE = eng;
      if (remember) { storeKey(key); storeEngine("browser"); }
      return start({ base: "browser", info: eng.info() });
    }).catch(function (e) {
      ENGINE = null;
      var chosen = false;
      try { chosen = localStorage.getItem(ENGINE_KEY) === "browser"; } catch (x) {}
      storeKey(null);
      offline(LAST_TRIED, e.message, chosen);
    });
  }
  function boot(retry) {
    if (ENGINE) return;
    // The viewer's explicit choice wins: "browser" skips runner discovery altogether.
    var choice = null;
    try { choice = localStorage.getItem(ENGINE_KEY); } catch (e) {}
    if (!retry && choice === "browser" && window.TadaBrowserEngine) {
      if (savedKey()) startBrowser(savedKey(), true);
      else offline([], null, true);
      return;
    }
    findRunner().then(start).catch(function (tried) {
      if (ENGINE) return;
      if (!retry) {
        var pref = null;
        try { pref = localStorage.getItem(ENGINE_KEY); } catch (e) {}
        if (pref === "browser" && window.TadaBrowserEngine && savedKey()) { startBrowser(savedKey(), true); return; }
      }
      if (!Array.isArray(tried)) { root.innerHTML = ""; root.appendChild(errBox(tried)); return; }
      if (!retry) offline(tried);
      setTimeout(function () { if (!root.querySelector(".lab-conn--form input:focus")) boot(true); }, 3000);
    });
  }
  readHash();
  root.appendChild(progressBox("Looking for a lab runner…"));
  boot(false);
})();
