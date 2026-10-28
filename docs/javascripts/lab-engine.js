// The Lab's in-browser engine: the same small API the lab runner serves (lab/server.py), answered by the
// WebAssembly simulator + policy in a Web Worker. Nothing is fetched until the page starts it, and agent
// weights only when their Download button is pressed (then checked against the published sha256).
// MONAD-aligned generator, single or stitched streams, policy, best-of-K and rollout search; MP4 renders need a runner.
(function () {
  "use strict";
  function searchTag(p) {
    return "search-K" + p.K + "-M" + p.M + "-J" + (p.J || 0) + (p.stop ? "s" : "") + (p.prune ? "p" : "") + "-L" + p.look;
  }
  function flightKey(sc, agent, mode, attempts, search) {
    return sc.generator + "-" + sc.procedure + "-f" + sc.flights + "-x" + sc.segments + "-s" + sc.seed + "--" + agent +
      "--" + (mode === "sampled" ? "sampled" + attempts : mode === "search" ? searchTag(search) : mode);
  }
  function scenarioKey(sc) { return sc.generator + "-" + sc.procedure + "-f" + sc.flights + "-x" + sc.segments + "-s" + sc.seed; }
  function hex(buf) { return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join(""); }

  // The published engine is encrypted (browser/tools/encrypt_engine.py): b"TADAENC1" | nonce | AES-256-GCM.
  // The key ("tada1-<base64url>", 256 bit) is handed out by the TADA team; decryption happens in memory here.
  function keyBytes(text) {
    var body = String(text || "").trim().replace(/^tada1-/, "").replace(/-/g, "+").replace(/_/g, "/");
    while (body.length % 4) body += "=";
    var raw;
    try { raw = atob(body); } catch (e) { throw new Error("That is not a TADA engine key."); }
    if (raw.length !== 32) throw new Error("That is not a TADA engine key (it should start with tada1-).");
    return Uint8Array.from(raw, function (c) { return c.charCodeAt(0); });
  }
  function decryptEngine(assets, keyText) {
    var key = keyBytes(keyText);
    return Promise.all([
      fetch(assets + "engine.json").then(function (r) { if (!r.ok) throw new Error("engine manifest missing"); return r.json(); }),
      fetch(assets + "engine.bin").then(function (r) { if (!r.ok) throw new Error("engine file missing"); return r.arrayBuffer(); }),
      crypto.subtle.digest("SHA-256", key),
    ]).then(function (res) {
      var manifest = res[0], blob = new Uint8Array(res[1]);
      if (hex(res[2]).slice(0, 16) !== manifest.key_id) {
        throw new Error("This key does not unlock the current engine (it may be for an earlier build). Ask the TADA team for the current key.");
      }
      if (new TextDecoder().decode(blob.slice(0, 8)) !== "TADAENC1") throw new Error("unknown engine format");
      return crypto.subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]).then(function (k) {
        return crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.slice(8, 20), additionalData: new TextEncoder().encode(manifest.aad) },
          k, blob.slice(20));
      }).catch(function (e) {
        if (e && e.name === "OperationError") throw new Error("The engine file did not decrypt with this key.");
        throw e;
      });
    });
  }

  window.TadaBrowserEngine = {
    available: function (assets) {
      return fetch(assets + "engine.json", { method: "HEAD" }).then(function (r) { return r.ok; }, function () { return false; });
    },
    start: function (assets, workerUrl, keyText) {
      var worker = new Worker(workerUrl), seq = 0, waiting = {};
      worker.onmessage = function (e) {
        var w = waiting[e.data.id];
        if (!w) return;
        if (e.data.error) { delete waiting[e.data.id]; w.reject(new Error(e.data.error)); }
        else if (e.data.done) { delete waiting[e.data.id]; w.resolve(e.data.result); }
        else if (w.progress) w.progress(e.data);
      };
      function call(msg, progress, transfer, onId) {
        return new Promise(function (resolve, reject) {
          msg.id = ++seq;
          if (onId) onId(msg.id);
          waiting[msg.id] = { resolve: resolve, reject: reject, progress: progress };
          worker.postMessage(msg, transfer || []);
        });
      }
      return Promise.all([
        fetch(assets + "agents.json").then(function (r) { return r.json(); }),
        fetch(assets + "curated.json").then(function (r) { return r.json(); }).catch(function () { return {}; }),
        Promise.resolve().then(function () { return decryptEngine(assets, keyText); }).then(function (bytes) { return call({ cmd: "init", bytes: bytes }, null, [bytes]); }),
      ]).then(function (res) {
        var reg = res[0], curated = res[1], scene = res[2] || {};
        var catalog = {
          engine: "browser", code_ok: true, setup: { ok: true, checks: [] }, max_segments: 3, modes: ["det", "sampled", "search"], search_params: true,
          sectors: scene.sectors || [],
          procedures: reg.procedures, reference: reg.reference, curated: curated,
          generators: {
            monad: { label: "MONAD-aligned", available: true, detail: reg.generators.monad },
            legacy: { label: "Legacy", available: false, detail: "Not in the in-browser engine; use a lab runner." },
          },
          agents: reg.agents.map(function (a) {
            return Object.assign({}, a, { installed: false, source: "registry", public: true, paper: true,
              download: { size: a.weights.size, url: a.weights.url } });
          }),
        };
        var jobs = {}, results = {};
        function agent(id) { return catalog.agents.filter(function (a) { return a.id === id; })[0]; }
        function status(key) {
          var j = jobs[key];
          return j ? { key: key, kind: j.kind, status: j.status, stage: j.stage, frac: j.frac, error: j.error, live: j.live,
            partial: j.partial, partialN: j.partialN || 0 }
            : { key: key, status: results[key] ? "done" : "missing" };
        }
        function fly(body) {
          var sc = body.scenario, mode = body.agent === "do-nothing" ? "det" : (body.mode || "det");
          var attempts = mode === "sampled" ? (body.attempts | 0) : 0;
          if (sc.generator !== "monad") throw new Error("the in-browser engine has the MONAD-aligned generator only");
          if (sc.segments < 1 || sc.segments > 3) throw new Error("1 to 3 stream segments");
          var search = null;
          if (mode === "search") {
            var q = body.search || {};
            search = { K: Math.max(1, Math.min(32, q.K | 0 || 8)), M: Math.max(1, Math.min(40, q.M | 0 || 10)), J: Math.max(0, q.J | 0),
              stop: q.stop !== false, prune: q.prune !== false, look: Math.max(0, Math.min(60, q.look | 0 || 20)) };
          }
          if (body.agent !== "do-nothing") { // do-nothing needs no weights: the MDP is built into the engine
            var a = agent(body.agent);
            if (!a || !a.installed) throw new Error("download " + (a ? a.id : body.agent) + " first");
          }
          var key = flightKey(sc, body.agent, mode, attempts, search);
          if (results[key] || (jobs[key] && jobs[key].status === "running")) return status(key);
          if (mode === "search") {  // a new search on this scenario and agent supersedes one still running
            var prefix = flightKey(sc, body.agent, "det", 0).replace(/--det$/, "--search-");
            Object.keys(jobs).forEach(function (k2) {
              var o = jobs[k2];
              if (k2.indexOf(prefix) === 0 && o.status === "running" && o.wid) {
                worker.postMessage({ cmd: "cancel", target: o.wid });
                o.status = "error"; o.error = "cancelled"; delete jobs[k2];
              }
            });
          }
          var job = { scenario: sc, agent: body.agent, mode: mode, attempts: attempts, search: search };
          var j = jobs[key] = { kind: "fly", status: "running", stage: "queued", frac: null, error: null, live: null };
          call({ cmd: "fly", job: job }, function (p) {
            j.stage = p.stage; j.frac = p.frac;
            if (p.live) j.live = p.live;
            if (p.partial) { p.partial.job = job; p.partial.search = p.partial.search || null; j.partial = p.partial; j.partialN = (j.partialN || 0) + 1; }
          }, null,
            function (id) { j.wid = id; }).then(function (r) {
            r.job = job; r.search = null; results[key] = r; j.status = "done"; j.stage = "done"; j.frac = 1;
          }, function (e) { j.status = "error"; j.error = e.message; });
          return status(key);
        }
        function install(id) {
          var a = agent(id), key = "install:" + id;
          if (!a) throw new Error(id + " is not in the registry");
          if (a.installed) return { key: id, kind: "install", status: "done" };
          var j = jobs[key] = { kind: "install", status: "running", stage: "downloading", frac: 0, error: null };
          fetch(assets + a.weights.url).then(function (r) {
            if (!r.ok) throw new Error("download failed: HTTP " + r.status);
            return r.arrayBuffer();
          }).then(function (buf) {
            return crypto.subtle.digest("SHA-256", buf).then(function (d) {
              if (hex(d) !== a.weights.sha256) throw new Error("sha256 mismatch: not the published weights");
              j.stage = "loading";
              return call({ cmd: "policy", agent: id, bytes: buf }, null, [buf]);
            });
          }).then(function () { a.installed = true; j.status = "done"; j.frac = 1; },
            function (e) { j.status = "error"; j.error = e.message; });
          return { key: id, kind: "install", status: "running", stage: "downloading", frac: 0 };
        }
        function rows(q) {
          var sk = scenarioKey({ generator: q.get("generator"), procedure: q.get("procedure"), flights: q.get("flights"),
            segments: q.get("segments"), seed: q.get("seed") });
          var out = [];
          Object.keys(results).forEach(function (k) {
            if (k.indexOf(sk + "--") !== 0) return;
            var r = results[k];
            out.push({ key: k, scenario: sk, agent: r.job.agent, mode: r.job.mode === "sampled" ? "sampled" + r.job.attempts :
              r.job.mode === "search" ? searchTag(r.job.search) : r.job.mode,
              attempts: r.job.attempts, summary: r.summary, chosen_attempt: r.chosen_attempt, has_video: false });
          });
          Object.keys(jobs).forEach(function (k) {
            if (k.indexOf(sk + "--") === 0 && jobs[k].status === "running") {
              var p = k.split("--");
              out.push({ key: k, scenario: sk, agent: p[1], mode: p[2], pending: true, stage: jobs[k].stage });
            }
          });
          return out;
        }
        return {
          info: function () { return { agents: catalog.agents.length, installed: catalog.agents.filter(function (a) { return a.installed; }).length,
            cached: Object.keys(results).length }; },
          flight: function (key) { return results[key] ? Promise.resolve(results[key]) : Promise.reject(new Error("no flight " + key)); },
          api: function (path, body) {
            try {
              var u = new URL(path, "http://x"), p = u.pathname;
              if (p === "/catalog") return Promise.resolve(catalog);
              if (p === "/health") return Promise.resolve(Object.assign({ ok: true }, this.info()));
              if (p === "/fly") return Promise.resolve(fly(body));
              if (p === "/install") return Promise.resolve(install(body.agent));
              if (p === "/render") return Promise.reject(new Error("MP4 renders need a lab runner; the replay is the same flight"));
              if (p.indexOf("/job/") === 0) {
                var id = p.slice(5);
                return Promise.resolve(u.searchParams.get("kind") === "install" ? (function () {
                  var j = jobs["install:" + id];
                  return j ? { key: id, kind: "install", status: j.status, stage: j.stage, frac: j.frac, error: j.error } : { key: id, status: "missing" };
                })() : status(id));
              }
              if (p === "/scenario") return Promise.resolve(rows(u.searchParams));
              return Promise.reject(new Error("unknown " + p));
            } catch (e) { return Promise.reject(e); }
          },
        };
      });
    },
  };
})();
