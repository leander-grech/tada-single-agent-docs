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
  var TAB20 = ["#1f77b4", "#aec7e8", "#ff7f0e", "#ffbb78", "#2ca02c", "#98df8a", "#d62728", "#ff9896", "#9467bd", "#c5b0d5",
    "#8c564b", "#c49c94", "#e377c2", "#f7b6d2", "#7f7f7f", "#c7c7c7", "#bcbd22", "#dbdb8d", "#17becf", "#9edae5"];
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
    if (q.get("a")) S.agent = q.get("a");
    if (q.get("m")) S.mode = q.get("m");
    if (q.get("k")) S.attempts = +q.get("k");
  }
  function writeHash() {
    var q = new URLSearchParams({ p: S.sc.procedure, g: S.sc.generator, f: S.sc.flights, x: S.sc.segments, s: S.sc.seed });
    if (S.agent) { q.set("a", S.agent); q.set("m", S.mode); if (S.mode === "sampled") q.set("k", S.attempts); }
    history.replaceState(null, "", "#" + q.toString());
  }
  function scQuery() {
    return "procedure=" + S.sc.procedure + "&generator=" + S.sc.generator + "&flights=" + S.sc.flights +
      "&segments=" + S.sc.segments + "&seed=" + S.sc.seed;
  }
  function isPaperSetup() { return S.sc.generator === "monad" && S.sc.flights === 20 && S.sc.segments === 1; }
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
  function loadFlight(key) { return fetch(BASE + "/lab-cache/" + key + ".json").then(function (r) { return r.json(); }); }

  // ---------------------------------------------------------------- downloads (registry agents)
  // A public agent that is not on the runner's machine is fetched only when its Download button is
  // pressed, and by the runner (into ~/.cache/tada-lab/models), never by the browser.
  function isInstalled(id) { var a = agentById(id); return !!(a && a.installed); }
  function mb(n) { return (n / 1048576).toFixed(1) + " MB"; }
  function needDownload(e) { var m = /download (\S+) first/.exec(e && e.message || ""); return m ? m[1] : null; }
  function downloadBtn(a, why) {
    var btn = h("button", { type: "button", class: "lab-btn lab-btn--fly lab-btn--dl", title: a.download ? a.download.url : null },
      ["⬇ Download ", h("b", { text: a.id }), " to the runner" + (a.download ? " · " + mb(a.download.size) : "")]);
    var hint = h("div", { class: "lab-field__hint", text: (why ? why + " " : "") +
      "The runner fetches the published bundle (GitHub release) onto its own machine and checks its sha256; nothing is saved by your browser." });
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
        type: "button", class: "lab-seg__btn" + (o.value === value ? " is-on" : ""), title: o.title || null,
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
      return { value: k, label: cat.generators[k].label, title: cat.generators[k].detail };
    }), S.sc.generator, function (v) { S.sc.generator = v; renderGen(); scenarioChanged(); }),
      cat.generators[S.sc.generator].detail));

    var flights = h("input", { type: "range", min: 4, max: 40, step: 1, value: S.sc.flights, class: "lab-range" });
    var fv = h("output", { class: "lab-num", text: S.sc.flights });
    flights.addEventListener("input", function () { fv.textContent = flights.value; });
    flights.addEventListener("change", function () { S.sc.flights = +flights.value; renderGen(); scenarioChanged(); });
    body.appendChild(field("Flights per stream", h("div", { class: "lab-row" }, [flights, fv]),
      "Agents train on 20; the window always shows the next 10 in AMAN order."));

    body.appendChild(field("Stream segments", seg("segments", [1, 2, 3].map(function (n) {
      return { value: n, label: n === 1 ? "single" : n + " stitched" };
    }), S.sc.segments, function (v) { S.sc.segments = v; renderGen(); scenarioChanged(); }),
      S.sc.segments > 1 ? "Generated scenarios joined by a random 2–15 min gap: a continuous-operation stress test." : null));

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
      { value: "search", label: "Policy + search", title: "Receding-horizon rollout search: K=8 full-episode rollouts every 10 decisions (the paper's best agent)" }];
    body.appendChild(field("Mode", seg("mode", modes, S.mode, function (v) { S.mode = v; renderAgents(); syncFlightTitle(); })));
    if (S.mode === "sampled") {
      var k = h("select", { class: "lab-input", onchange: function () { S.attempts = +this.value; } },
        [3, 5, 10, 20].map(function (n) { return h("option", { value: n, selected: n === S.attempts ? true : null, text: "K = " + n + " sampled" }); }));
      body.appendChild(k);
    }
    var all = h("button", { type: "button", class: "lab-btn lab-btn--ghost", onclick: flyAll, title: "Deterministic policy of every installed agent of this procedure, on this scenario" }, ["Fly every agent"]);
    if (S.agent !== "do-nothing" && !isInstalled(S.agent)) {
      body.appendChild(downloadBtn(agentById(S.agent), S.agent + " is not on this runner yet."));
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
          !a.installed ? h("span", { class: "lab-agent__dl", text: " · ⬇ " + (a.download ? mb(a.download.size) : "") + " not on this runner" })
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
    $("#lab-scen-title").textContent = "Scenario · " + S.catalog.procedures[S.sc.procedure].label + " · seed " + S.sc.seed;
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
  function scKey(sc) { return [sc.generator, sc.procedure, sc.flights, sc.segments, sc.seed].join("/"); }
  function flightKeyOf(job) {
    var sc = job.scenario, m = job.mode === "sampled" ? "sampled" + job.attempts : job.mode;
    return sc.generator + "-" + sc.procedure + "-f" + sc.flights + "-x" + sc.segments + "-s" + sc.seed + "--" + job.agent + "--" + m;
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
  }
  function errBox(e) { return h("div", { class: "lab-error", text: "⚠ " + (e && e.message || e) }); }

  // ---------------------------------------------------------------- 3. fly
  function syncFlightTitle() {
    var b = $("#lab-fly"); if (b) b.querySelector("b").textContent = S.agent;
  }
  function flySelected(quiet) {
    writeHash();
    S.flying = true; S.autoFly = S.agent !== "do-nothing";
    var body = $("#lab-flight-body");
    var job = { scenario: S.sc, agent: S.agent, mode: S.agent === "do-nothing" ? "det" : S.mode, attempts: S.mode === "sampled" ? S.attempts : 0 };
    $("#lab-flight-title").textContent = "Flight · " + S.agent + " · " + MODE_LABEL[job.mode];
    body.innerHTML = ""; body.appendChild(progressBox("Flying…"));
    if (!quiet) body.scrollIntoView({ behavior: "smooth", block: "start" });
    var want = scKey(S.sc);
    runJob("fly", job, function (st) { setProgress(body, st); })
      .then(function (st) { return loadFlight(st.key).then(function (d) {
        S.flying = false;
        if (want === scKey(S.sc)) showFlight(d, st.key);
        else if (S.autoFly) flySelected(true);  // the scenario changed while this one flew
        refreshRows();
      }); })
      .catch(function (e) {
        S.flying = false;
        var id = needDownload(e);
        if (id) { downloadPrompt(body, id, id + " is not on this runner yet."); return; }
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
    $("#lab-flight-title").textContent = "Flight · " + j.agent + (j.agent === "do-nothing" ? " (scenario as generated)" : " · " + MODE_LABEL[j.mode]) +
      " · " + S.catalog.procedures[j.scenario.procedure].label + " seed " + j.scenario.seed;
    var body = $("#lab-flight-body"); body.innerHTML = "";
    var oc = s.los ? { v: "LoS", c: "bad", sub: "loss of separation (≤ 3 NM, ≤ 500 ft)" }
      : s.solved ? { v: s.hard_solved ? "SOLVED ±30" : "SOLVED", c: "ok", sub: "every flight within ±" + (s.hard_solved ? 30 : 60) + " s" }
        : { v: s.end_reason.toUpperCase(), c: "warn", sub: "not every flight on time" };
    var t = [
      { label: "Outcome", value: oc.v, cls: oc.c, sub: oc.sub },
      { label: "On time (±60 s)", value: s.on_time + "/" + s.n_flights, cls: s.on_time === s.n_flights ? "ok" : "" , sub: s.landed + " landed" },
      { label: "Max |landing dev|", value: Math.round(s.max_dev), unit: "s", cls: s.landed ? (s.max_dev <= 60 ? "ok" : "warn") : "" },
      { label: "Clearances", value: s.clearances },
      { label: "Min separation", value: s.min_separation_nm == null ? "–" : (+s.min_separation_nm).toFixed(1), unit: "NM", cls: s.los ? "bad" : "" }
    ];
    if (d.attempts.length > 1) t.push({ label: "Attempt kept", value: d.chosen_attempt, sub: "of " + d.attempts.length + " (0 = deterministic)" });
    if (d.search) t.push({ label: "Search", value: d.search.n_rollouts, unit: "rollouts", sub: d.search.n_plans + " plans · " + d.elapsed_s + " s" });
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
    pane("replay", Replay.mount(d));
    pane("video", videoPane(d, key));
    pane("flights", flightsTable(d));
    pane("clearances", clearancesPane(d));
    if (d.attempts.length > 1) pane("attempts", attemptsTable(d));
    markRows();
  }

  function videoPane(d, key) {
    var box = h("div", { class: "lab-video" });
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
        h("td", { text: r.mode.replace(/^sampled/, "best of ") }),
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
    var d, frames, colors, idx, playing = false, speed = 2, i = 0, raf = null, lastTs = 0, acc = 0;
    var cv, ctx, strip, sctx, slider, tlabel, playBtn, bounds, evByFrame, wrap;

    function mount(data) {
      stop();
      d = data; frames = d.trace.frames; i = 0;
      colors = {}; idx = {};
      d.trace.queue.forEach(function (cs, k) { colors[cs] = TAB20[k % 20]; idx[cs] = k; });
      // bounds over routes and every airborne position
      var xs = [], ys = [];
      Object.keys(d.trace.routes).forEach(function (cs) { d.trace.routes[cs].forEach(function (p) { xs.push(p[0]); ys.push(p[1]); }); });
      frames.forEach(function (f) { f.ac.forEach(function (a) { if (a[5] === 1) { xs.push(a[1]); ys.push(a[2]); } }); });
      if (!xs.length) { xs = [-50, 50]; ys = [-50, 50]; }
      bounds = { x0: Math.min.apply(null, xs), x1: Math.max.apply(null, xs), y0: Math.min.apply(null, ys), y1: Math.max.apply(null, ys) };
      // clearance events attached to the first frame at or after their time
      evByFrame = frames.map(function () { return []; });
      var fi = 0;
      d.trace.events.forEach(function (e) {
        while (fi < frames.length - 1 && frames[fi].t < e.t - 1e-6) fi++;
        evByFrame[fi].push(e);
      });

      cv = h("canvas", { class: "lab-map", "aria-label": "map replay" });
      strip = h("canvas", { class: "lab-strip", "aria-label": "deviation per flight" });
      slider = h("input", { type: "range", min: 0, max: frames.length - 1, value: 0, class: "lab-range lab-scrub", "aria-label": "time" });
      slider.addEventListener("input", function () { i = +slider.value; draw(); });
      tlabel = h("span", { class: "lab-num lab-tlabel" });
      playBtn = h("button", { type: "button", class: "lab-btn lab-btn--play", onclick: toggle, "aria-label": "play" }, ["▶"]);
      var spd = h("div", { class: "lab-seg lab-seg--sm" }, [1, 2, 4, 8].map(function (s) {
        return h("button", { type: "button", class: "lab-seg__btn" + (s === speed ? " is-on" : ""), onclick: function () {
          speed = s; spd.querySelectorAll("button").forEach(function (b) { b.classList.toggle("is-on", b.textContent === s + "×"); });
        } }, [s + "×"]);
      }));
      var legend = h("div", { class: "lab-legend" }, [
        h("span", {}, [h("i", { class: "lab-lg lab-lg--ac" }), "under control"]),
        h("span", {}, [h("i", { class: "lab-lg lab-lg--pre" }), "not yet under control"]),
        h("span", {}, [h("i", { class: "lab-lg lab-lg--clr" }), "clearance (S± speed, TL/TR turn, TB± trombone, SKn skip, ILS, DMP merge)"]),
        h("span", {}, [h("i", { class: "lab-lg lab-lg--warn" }), "< 5 NM & 1000 ft"]),
        h("span", {}, [h("i", { class: "lab-lg lab-lg--bad" }), "LoS"])
      ]);
      wrap = h("div", { class: "lab-replay", tabindex: 0 }, [
        h("div", { class: "lab-replay__view" }, [h("div", { class: "lab-replay__map" }, [cv]), h("div", { class: "lab-replay__strip" }, [strip])]),
        h("div", { class: "lab-replay__ctl" }, [playBtn, slider, tlabel, spd]),
        legend
      ]);
      wrap.addEventListener("keydown", function (e) {
        if (e.key === " ") { e.preventDefault(); toggle(); }
        else if (e.key === "ArrowRight") { i = Math.min(frames.length - 1, i + 1); draw(); }
        else if (e.key === "ArrowLeft") { i = Math.max(0, i - 1); draw(); }
      });
      setTimeout(resize, 0);
      return wrap;
    }
    function resize() {
      if (!cv || !cv.isConnected) return;
      var dpr = window.devicePixelRatio || 1;
      [cv, strip].forEach(function (c) {
        var r = c.parentNode.getBoundingClientRect();
        var w = Math.max(200, r.width), hgt = c === cv ? Math.min(Math.max(320, w * 0.78), 640) : null;
        if (c === strip) hgt = cv.height / dpr;
        c.style.width = w + "px"; c.style.height = hgt + "px";
        c.width = Math.round(w * dpr); c.height = Math.round(hgt * dpr);
      });
      // strip height follows the map
      var sh = cv.height / dpr; strip.style.height = sh + "px"; strip.height = Math.round(sh * dpr);
      draw();
    }
    window.addEventListener("resize", function () { clearTimeout(resize._t); resize._t = setTimeout(resize, 150); });
    new MutationObserver(function () { draw(); }).observe(document.body, { attributes: true, attributeFilter: ["data-md-color-scheme"] });

    function toggle() { if (playing) stop(); else { if (i >= frames.length - 1) i = 0; playing = true; playBtn.textContent = "❚❚"; lastTs = 0; acc = 0; raf = requestAnimationFrame(tick); } }
    function stop() { playing = false; if (raf) cancelAnimationFrame(raf); raf = null; if (playBtn) playBtn.textContent = "▶"; }
    function tick(ts) {
      if (!playing) return;
      if (!cv.isConnected) { stop(); return; }
      if (lastTs) acc += (ts - lastTs) / 1000 * speed;
      lastTs = ts;
      // ~1 decision (45 s simulated) per second at 1×
      while (acc >= 1 && i < frames.length - 1) { acc -= 1; i++; }
      draw();
      if (i >= frames.length - 1) { stop(); return; }
      raf = requestAnimationFrame(tick);
    }

    function draw() {
      if (!ctx || ctx.canvas !== cv) ctx = cv && cv.getContext("2d");
      if (!sctx || sctx.canvas !== strip) sctx = strip && strip.getContext("2d");
      if (!ctx || !frames.length || !cv.width) return;
      slider.value = i;
      var f = frames[i], fprev = frames[Math.max(0, i - 1)];
      tlabel.textContent = "t+" + fmtT(f.t) + " · " + (i + 1) + "/" + frames.length;
      drawMap(f, fprev); drawStrip(f);
    }

    function drawMap(f, fprev) {
      var dpr = window.devicePixelRatio || 1, W = cv.width, H = cv.height;
      var fg = css("--md-default-fg-color"), fgl = css("--md-default-fg-color--lighter"), rule = css("--tada-rule");
      var ok = css("--tada-ok"), warn = css("--tada-warn"), bad = css("--tada-bad"), champ = css("--tada-champion");
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = css("--tada-tile-bg"); ctx.fillRect(0, 0, W, H);
      var m = 18 * dpr, bw = bounds.x1 - bounds.x0 || 1, bh = bounds.y1 - bounds.y0 || 1;
      var sc = Math.min((W - 2 * m) / bw, (H - 2 * m) / bh);
      var ox = (W - bw * sc) / 2, oy = (H - bh * sc) / 2;
      function X(x) { return ox + (x - bounds.x0) * sc; }
      function Y(y) { return H - (oy + (y - bounds.y0) * sc); }
      // grid every 10 NM
      ctx.strokeStyle = "rgba(63,208,255,0.07)"; ctx.lineWidth = 1;
      for (var gx = Math.ceil(bounds.x0 / 10) * 10; gx <= bounds.x1; gx += 10) { ctx.beginPath(); ctx.moveTo(X(gx), Y(bounds.y0)); ctx.lineTo(X(gx), Y(bounds.y1)); ctx.stroke(); }
      for (var gy = Math.ceil(bounds.y0 / 10) * 10; gy <= bounds.y1; gy += 10) { ctx.beginPath(); ctx.moveTo(X(bounds.x0), Y(gy)); ctx.lineTo(X(bounds.x1), Y(gy)); ctx.stroke(); }
      // scale bar
      ctx.strokeStyle = "rgba(233,241,255,0.5)"; ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.moveTo(m, H - m); ctx.lineTo(m + 20 * sc, H - m); ctx.stroke();
      ctx.fillStyle = "rgba(233,241,255,0.6)"; ctx.font = (10 * dpr) + "px " + css("--tada-font-mono");
      ctx.fillText("20 NM", m, H - m - 5 * dpr);
      // flight plans (as filed at t = 0)
      ctx.lineWidth = 1 * dpr;
      Object.keys(d.trace.routes).forEach(function (cs) {
        var r = d.trace.routes[cs]; if (r.length < 2) return;
        ctx.strokeStyle = colors[cs] || fgl; ctx.globalAlpha = 0.16;
        ctx.beginPath(); r.forEach(function (p, k) { if (k) ctx.lineTo(X(p[0]), Y(p[1])); else ctx.moveTo(X(p[0]), Y(p[1])); }); ctx.stroke();
      });
      ctx.globalAlpha = 1;
      // trails: the last 10 decisions
      var lo = Math.max(0, i - 10), byCs = {};
      for (var k = lo; k <= i; k++) frames[k].ac.forEach(function (a) { if (a[5] === 1) (byCs[a[0]] = byCs[a[0]] || []).push(a); });
      Object.keys(byCs).forEach(function (cs) {
        var pts = byCs[cs]; if (pts.length < 2) return;
        ctx.strokeStyle = colors[cs]; ctx.lineWidth = 1.6 * dpr; ctx.globalAlpha = 0.55;
        ctx.beginPath(); pts.forEach(function (a, n) { if (n) ctx.lineTo(X(a[1]), Y(a[2])); else ctx.moveTo(X(a[1]), Y(a[2])); }); ctx.stroke();
      });
      ctx.globalAlpha = 1;
      // clearance markers: last 6 decisions, fading
      for (var e = Math.max(0, i - 6); e <= i; e++) {
        var age = i - e;
        evByFrame[e].forEach(function (ev) {
          if (ev.x == null) return;
          var name = d.clearance_names[String(ev.clr)] || "";
          ctx.globalAlpha = Math.max(0.15, 1 - age / 7);
          ctx.strokeStyle = champ; ctx.lineWidth = 1.5 * dpr;
          var x = X(ev.x), y = Y(ev.y), s = 4 * dpr;
          ctx.beginPath(); ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s); ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s); ctx.stroke();
          ctx.fillStyle = champ; ctx.font = "600 " + (10 * dpr) + "px " + css("--tada-font-mono");
          ctx.fillText(ABBR[name] || name, x + 6 * dpr, y + 12 * dpr);
        });
      }
      ctx.globalAlpha = 1;
      // proximity: under-control pairs within 5 NM and 1000 ft (amber), LoS 3 NM / 500 ft (red)
      var air = f.ac.filter(function (a) { return a[5] === 1; });
      for (var p = 0; p < air.length; p++) for (var q = p + 1; q < air.length; q++) {
        var A = air[p], B = air[q], dh = Math.hypot(A[1] - B[1], A[2] - B[2]), dv = Math.abs(A[3] - B[3]);
        if (dh < 5 && dv < 1000) {
          var los = dh <= 3 && dv <= 500;
          ctx.strokeStyle = los ? bad : warn; ctx.lineWidth = (los ? 2.5 : 1.5) * dpr; ctx.setLineDash(los ? [] : [4 * dpr, 3 * dpr]);
          ctx.beginPath(); ctx.moveTo(X(A[1]), Y(A[2])); ctx.lineTo(X(B[1]), Y(B[2])); ctx.stroke(); ctx.setLineDash([]);
          if (los) { ctx.beginPath(); ctx.arc((X(A[1]) + X(B[1])) / 2, (Y(A[2]) + Y(B[2])) / 2, 3 * sc, 0, 2 * Math.PI); ctx.stroke(); }
        }
      }
      // aircraft
      var prev = {}; fprev.ac.forEach(function (a) { prev[a[0]] = a; });
      ctx.font = (10 * dpr) + "px " + css("--tada-font-mono");
      f.ac.forEach(function (a) {
        var cs = a[0], x = X(a[1]), y = Y(a[2]);
        if (a[5] === 2) return;
        if (a[5] === 0) {
          ctx.strokeStyle = colors[cs]; ctx.globalAlpha = 0.45; ctx.lineWidth = 1 * dpr;
          ctx.beginPath(); ctx.arc(x, y, 3 * dpr, 0, 2 * Math.PI); ctx.stroke(); ctx.globalAlpha = 1; return;
        }
        var pa = prev[cs], hd = pa && (pa[1] !== a[1] || pa[2] !== a[2]) ? Math.atan2(-(a[2] - pa[2]), a[1] - pa[1]) : 0;
        ctx.save(); ctx.translate(x, y); ctx.rotate(hd);
        ctx.fillStyle = colors[cs]; ctx.strokeStyle = "#02060d"; ctx.lineWidth = 1 * dpr;
        var s = 6 * dpr; ctx.beginPath(); ctx.moveTo(s * 1.4, 0); ctx.lineTo(-s, s * 0.8); ctx.lineTo(-s * 0.5, 0); ctx.lineTo(-s, -s * 0.8); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
        var dev = a[6], dc = Math.abs(dev) <= 60 ? ok : Math.abs(dev) <= 300 ? warn : bad;
        ctx.fillStyle = "rgba(233,241,255,0.85)";
        var label = cs.replace(/^[A-Z]+0*/, "#");
        ctx.fillText(label, x + 8 * dpr, y - 4 * dpr);
        ctx.fillStyle = dc; ctx.fillText(sgn(dev) + "s", x + 8 * dpr + ctx.measureText(label + " ").width, y - 4 * dpr);
        ctx.fillStyle = "rgba(154,171,198,0.8)"; ctx.fillText("FL" + Math.round(a[3] / 100) + " " + a[4] + "kt", x + 8 * dpr, y + 8 * dpr);
      });
      // end banner
      if (i === frames.length - 1) {
        var s0 = d.summary, txt = s0.los ? "LOSS OF SEPARATION" : s0.solved ? "SOLVED · " + s0.on_time + "/" + s0.n_flights + " ON TIME" : s0.end_reason.toUpperCase() + " · " + s0.on_time + "/" + s0.n_flights + " ON TIME";
        ctx.font = "600 " + (14 * dpr) + "px " + css("--tada-font-head");
        var tw = ctx.measureText(txt).width;
        ctx.fillStyle = "rgba(2,6,13,0.8)"; ctx.fillRect(W - tw - 3 * m, m * 0.6, tw + 2 * m, 26 * dpr);
        ctx.fillStyle = s0.los ? bad : s0.solved ? ok : warn; ctx.fillText(txt, W - tw - 2 * m, m * 0.6 + 18 * dpr);
      }
      void fg; void rule;
    }

    function drawStrip(f) {
      if (!sctx) return;
      var dpr = window.devicePixelRatio || 1, W = strip.width, H = strip.height;
      var ok = css("--tada-ok"), warn = css("--tada-warn"), bad = css("--tada-bad");
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.fillStyle = css("--tada-tile-bg"); sctx.fillRect(0, 0, W, H);
      var n = d.trace.queue.length, top = 22 * dpr, rowH = Math.min(22 * dpr, (H - top - 18 * dpr) / n);
      var labW = 44 * dpr, valW = 46 * dpr, x0 = labW, x1 = W - valW, lim = 300;
      function X(v) { return x0 + (x1 - x0) * (0.5 + Math.max(-lim, Math.min(lim, v)) / (2 * lim)); }
      sctx.fillStyle = "rgba(62,224,122,0.10)"; sctx.fillRect(X(-60), top, X(60) - X(-60), rowH * n);
      sctx.fillStyle = "rgba(62,224,122,0.12)"; sctx.fillRect(X(-30), top, X(30) - X(-30), rowH * n);
      sctx.strokeStyle = "rgba(233,241,255,0.35)"; sctx.lineWidth = 1;
      sctx.beginPath(); sctx.moveTo(X(0), top - 4 * dpr); sctx.lineTo(X(0), top + rowH * n); sctx.stroke();
      sctx.font = "600 " + (10 * dpr) + "px " + css("--tada-font-head"); sctx.fillStyle = css("--tada-tile-label");
      sctx.fillText("PREDICTED LANDING DEVIATION", x0, 13 * dpr);
      sctx.font = (9 * dpr) + "px " + css("--tada-font-mono"); sctx.fillStyle = "rgba(154,171,198,0.8)";
      [-300, -60, 60, 300].forEach(function (v) { var t = sgn(v); sctx.fillText(t, X(v) - sctx.measureText(t).width / 2, top + rowH * n + 12 * dpr); });
      var byCs = {}; f.ac.forEach(function (a) { byCs[a[0]] = a; });
      sctx.font = (Math.min(11, rowH / dpr - 2) * dpr) + "px " + css("--tada-font-mono");
      d.trace.queue.forEach(function (cs, k) {
        var a = byCs[cs], y = top + k * rowH;
        if (!a) return;
        var dev = a[6], st = a[5], c = Math.abs(dev) <= 60 ? ok : Math.abs(dev) <= 300 ? warn : bad;
        sctx.fillStyle = colors[cs]; sctx.fillRect(2 * dpr, y + rowH * 0.2, 4 * dpr, rowH * 0.6);
        sctx.fillStyle = st === 0 ? "rgba(154,171,198,0.55)" : "rgba(233,241,255,0.9)";
        sctx.fillText(cs.replace(/^[A-Z]+0*/, "#"), 9 * dpr, y + rowH * 0.72);
        sctx.globalAlpha = st === 0 ? 0.45 : 1;
        sctx.fillStyle = c;
        var bx = Math.min(X(0), X(dev)), bwid = Math.max(2 * dpr, Math.abs(X(dev) - X(0)));
        sctx.fillRect(bx, y + rowH * 0.22, bwid, rowH * 0.56);
        if (Math.abs(dev) > lim) { sctx.fillText(dev > 0 ? "▸" : "◂", dev > 0 ? x1 - 8 * dpr : x0, y + rowH * 0.72); }
        sctx.globalAlpha = 1;
        sctx.fillStyle = st === 2 ? c : "rgba(233,241,255,0.75)";
        var label = (st === 2 ? "✓" : "") + sgn(dev);
        if (st === 2 && Math.abs(dev) > 60) label = "✗" + sgn(dev);
        sctx.fillText(label, W - sctx.measureText(label).width - 4 * dpr, y + rowH * 0.72);
      });
    }
    return { mount: mount, resize: resize };
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
      h("span", {}, ["Runner ", h("code", { text: label(found.base) }), " · " + found.info.agents + " agents · " + found.info.cached + " cached flights"]),
      h("button", { type: "button", class: "lab-btn lab-btn--link", onclick: function () { bar.replaceWith(runnerForm(found.base)); } }, ["change"])
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
  function offline(tried) {
    root.innerHTML = "";
    var https = location.protocol === "https:";
    root.appendChild(h("div", { class: "lab-offline" }, [
      h("div", { class: "lab-offline__head" }, [h("span", { class: "lab-conn__dot is-off", "aria-hidden": "true" }), "No lab runner found"]),
      h("p", { html: "The Lab flies agents with the simulator and the checkpoints on <b>your</b> machine, through a small " +
        "local runner. Start it from the docs repo; this page connects by itself as soon as it is up:" }),
      h("pre", { class: "lab-offline__cmd" }, [h("code", { text: "lab/run.sh" })]),
      h("p", { class: "lab-field__hint", html: "It needs the single-agent code repo and its <code>tada</code> conda env " +
        "(<code>TADA_CODE_REPO</code>, <code>TADA_PY</code> to override the paths) and listens on 127.0.0.1:8800. " +
        "Chrome may ask to let this site reach apps on your device: allow it." +
        (https ? " From this https page only a runner on <code>localhost</code> can be reached; a runner on another " +
          "machine has to serve the page itself (<code>--host 0.0.0.0</code>, then open its <code>/lab/</code>)." : "") }),
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
      root.innerHTML = "";
      build();
      root.insertBefore(connBar(found), root.firstChild);
      loadScenario();
      var q = new URLSearchParams(location.hash.slice(1));
      if (q.get("a") && q.get("a") !== "do-nothing") { S.autoFly = true; }
      // a pasted or edited link (our own updates use replaceState and fire no event)
      window.addEventListener("hashchange", function () {
        readHash(); S.flight = null;
        S.autoFly = !!S.agent && S.agent !== "do-nothing";
        renderGen(); renderAgents(); loadScenario();
      });
    });
  }
  function boot(retry) {
    findRunner().then(start).catch(function (tried) {
      if (!Array.isArray(tried)) { root.innerHTML = ""; root.appendChild(errBox(tried)); return; }
      if (!retry) offline(tried);
      setTimeout(function () { if (!root.querySelector(".lab-conn--form input:focus")) boot(true); }, 3000);
    });
  }
  readHash();
  root.appendChild(progressBox("Looking for a lab runner…"));
  boot(false);
})();
