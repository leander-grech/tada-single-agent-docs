// Loader for the TADA browser engine (browser/src/wasm.rs): plain WebAssembly, no generated bindings.
// Usable on the page or inside a Web Worker.
// `source`: the module's URL, its bytes (the Lab decrypts the published engine first), or a compiled
// WebAssembly.Module (one compile shared by the Lab's worker pool).
async function loadTadaEngine(source) {
  let instance;
  if (source instanceof WebAssembly.Module) {
    instance = await WebAssembly.instantiate(source, {});
  } else if (typeof source === "string") {
    const resp = await fetch(source);
    instance = (WebAssembly.instantiateStreaming
      ? await WebAssembly.instantiateStreaming(resp, {})
      : await WebAssembly.instantiate(await resp.arrayBuffer(), {})).instance;
  } else {
    instance = (await WebAssembly.instantiate(source, {})).instance;
  }
  const x = instance.exports;
  const text = new TextDecoder();
  function readOut(ptr) {
    const n = new DataView(x.memory.buffer).getUint32(ptr, true);
    return text.decode(new Uint8Array(x.memory.buffer, ptr + 4, n));
  }
  function withText(s, f) {
    const u8 = new TextEncoder().encode(s), p = x.tada_alloc(u8.length || 1);
    new Uint8Array(x.memory.buffer, p, u8.length).set(u8);
    try { return f(p, u8.length); } finally { x.tada_free(p, u8.length || 1); }
  }
  function check(handle) {
    if (!handle) throw new Error(readOut(x.tada_error()));
    return handle;
  }
  return {
    loadPolicy(bytes) {
      const u8 = new Uint8Array(bytes), p = x.tada_alloc(u8.length);
      new Uint8Array(x.memory.buffer, p, u8.length).set(u8);
      const h = x.tada_policy_load(p, u8.length);
      x.tada_free(p, u8.length);
      return check(h);
    },
    // procedure: "tmb" | "pms"; policy: handle or 0 for do-nothing
    newEpisode(procedure, seed, flights, policy, deterministic, sampleSeed, segments) {
      return check(x.tada_episode_new(procedure === "pms" ? 1 : 0, seed, flights, segments || 1, policy || 0, deterministic ? 1 : 0, sampleSeed || 0));
    },
    // policy + rollout search: { K, M, J (0 = sample all), stop (bool), prune (bool), look (clock steps of predicted tracks) }
    newSearchEpisode(procedure, seed, flights, policy, p, segments) {
      return check(x.tada_episode_new_search(procedure === "pms" ? 1 : 0, seed, flights, segments || 1, policy, p.K, p.M, p.J || 0,
        (p.stop ? 1 : 0) | (p.prune ? 2 : 0), p.look || 0));
    },
    // a user-composed stream: { procedure, segments: [{ seed, flights, gap_s }], policy, deterministic, sample_seed,
    // search: null | { K, M, J, stop, prune, look } }
    newEpisodeSpec(spec) {
      const s = Object.assign({}, spec, { policy: spec.policy || 0 });
      if (spec.search) {
        const p = spec.search;
        s.search = { k: p.K, m: p.M, j: p.J || 0, flags: (p.stop ? 1 : 0) | (p.prune ? 2 : 0), look: p.look || 0 };
      }
      const u8 = new TextEncoder().encode(JSON.stringify(s)), ptr = x.tada_alloc(u8.length);
      new Uint8Array(x.memory.buffer, ptr, u8.length).set(u8);
      const h = x.tada_episode_new_spec(ptr, u8.length);
      x.tada_free(ptr, u8.length);
      return check(h);
    },
    // a segment's difficulty before flying it: { worst_ttl, on_time0, sum_dev0, span_s }
    segmentInfo(procedure, seed, flights) {
      const v = JSON.parse(readOut(x.tada_segment_info(procedure === "pms" ? 1 : 0, seed, flights)));
      if (v.error) throw new Error(v.error);
      return v;
    },
    // parallel planning (see wasm.rs): the coordinating engine begins a plan, hands out jobs and takes results;
    // following engines replay the executed actions and roll jobs out. Jobs, actions and rollouts travel as JSON text.
    planBegin(ep) { return x.tada_plan_begin(ep) === 1; },
    planJobs(ep, max) { return JSON.parse(readOut(x.tada_plan_jobs(ep, max))); },
    planSubmit(ep, jobText, rolloutText) {
      const ok = withText(jobText, (jp, jl) => withText(rolloutText, (rp, rl) => x.tada_plan_submit(ep, jp, jl, rp, rl)));
      if (!ok) throw new Error(readOut(x.tada_error()));
    },
    planDecided(ep) { return x.tada_plan_decided(ep) === 1; },
    planFinish(ep) { x.tada_plan_finish(ep); },
    actions(ep, from) { return readOut(x.tada_episode_actions(ep, from || 0)); },
    apply(ep, actsText) { if (!withText(actsText, (p, n) => x.tada_episode_apply(ep, p, n))) throw new Error(readOut(x.tada_error())); },
    rollout(ep, policy, jobText) {
      const r = withText(jobText, (p, n) => readOut(x.tada_rollout(ep, policy, p, n)));
      if (r.startsWith('{"error"')) throw new Error(JSON.parse(r).error);
      return r;
    },
    status(ep) { return JSON.parse(readOut(x.tada_episode_status(ep))); },
    step(ep, n) { return x.tada_episode_step(ep, n || 1) === 1; },
    progress(ep) { return x.tada_episode_progress(ep); },
    rank(ep) { return JSON.parse(readOut(x.tada_episode_rank(ep))); },
    result(ep) { return JSON.parse(readOut(x.tada_episode_result(ep))); },
    free(ep) { x.tada_episode_free(ep); },
    sectors() {
      const cat = JSON.parse(readOut(x.tada_sectors())).sectors || {};
      return Object.keys(cat).map((name) => ({ name, polygon: cat[name].polygon }));
    },
  };
}
if (typeof self !== "undefined") self.loadTadaEngine = loadTadaEngine;
