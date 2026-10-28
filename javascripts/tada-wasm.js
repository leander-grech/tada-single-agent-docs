// Loader for the TADA browser engine (browser/src/wasm.rs): plain WebAssembly, no generated bindings.
// Usable on the page or inside a Web Worker.
// `source`: the module's URL, or its bytes (the Lab decrypts the published engine first).
async function loadTadaEngine(source) {
  let instance;
  if (typeof source === "string") {
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
    newEpisode(procedure, seed, flights, policy, deterministic, sampleSeed) {
      return check(x.tada_episode_new(procedure === "pms" ? 1 : 0, seed, flights, policy || 0, deterministic ? 1 : 0, sampleSeed || 0));
    },
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
