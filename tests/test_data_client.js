const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { createBrowser } = require("./browser_helpers.js");

const tick = () => new Promise(setImmediate);
const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
const plain = (value) => JSON.parse(JSON.stringify(value));

function client(fetch, overrides = {}) {
  const waits = [];
  const context = createBrowser({
    fetch,
    setTimeout(callback, delay) {
      if (delay < 15000) {
        waits.push(delay);
        queueMicrotask(callback);
        return null;
      }
      return setTimeout(callback, delay);
    },
    clearTimeout,
    ...overrides,
  }, ["js/data-client.js"]);
  return { context, waits };
}

test("RPC and document reads keep their wire formats and encoded document filters", async () => {
  const calls = [];
  const { context } = client(async (url, init) => {
    calls.push({ url, init });
    return response(url.includes("/rpc/") ? { payload: true } : [{ payload: { title: "note" } }]);
  });
  assert.deepEqual(await context.sbRpc("get_payload_map", { p_codes: ["AAPL"] }), { payload: true });
  const rpc = calls[0];
  assert.ok(rpc.url.endsWith("/rest/v1/rpc/get_payload_map"));
  assert.equal(rpc.init.method, "POST");
  assert.equal(rpc.init.headers["Content-Type"], "application/json");
  assert.match(rpc.init.headers.apikey, /^sb_publishable_/);
  assert.equal(rpc.init.headers.Authorization, `Bearer ${rpc.init.headers.apikey}`);
  assert.deepEqual(JSON.parse(rpc.init.body), { p_codes: ["AAPL"] });
  assert.equal(rpc.init.signal.aborted, false);

  assert.deepEqual(await context.sbDoc("wiki note", "a/b & 한글"), { title: "note" });
  const url = new URL(calls[1].url);
  assert.equal(url.pathname, "/rest/v1/documents");
  assert.equal(url.searchParams.get("kind"), "eq.wiki note");
  assert.equal(url.searchParams.get("key"), "eq.a/b & 한글");
  assert.equal(url.searchParams.get("select"), "payload");
  assert.equal(url.searchParams.get("limit"), "1");
});

test("the shared queue limits concurrent requests to four and drains every waiter", async () => {
  let active = 0;
  let peak = 0;
  const pending = [];
  const started = [];
  const { context } = client((url, init) => new Promise((resolve) => {
    const { id } = JSON.parse(init.body);
    started.push(id);
    peak = Math.max(peak, ++active);
    pending.push(() => {
      active -= 1;
      resolve(response(id));
    });
  }));
  const requests = Array.from({ length: 11 }, (_, id) => context.sbRpc("queue_probe", { id }));
  await tick();
  assert.equal(started.length, 4);
  let released = 0;
  while (released < requests.length) {
    const batch = pending.splice(0);
    assert.ok(batch.length > 0, "queued requests must continue to make progress");
    released += batch.length;
    batch.forEach((release) => release());
    await tick();
  }
  assert.deepEqual(await Promise.all(requests), Array.from({ length: 11 }, (_, i) => i));
  assert.deepEqual(started, Array.from({ length: 11 }, (_, i) => i));
  assert.equal(peak, 4);
  assert.equal(vm.runInContext("_sbActive", context), 0);
});

test("transient errors retry twice with backoff while permission failures stop immediately", async () => {
  for (const status of [408, 429, 503]) {
    let calls = 0;
    const { context, waits } = client(async () => response(null, ++calls < 3 ? status : 200));
    assert.equal(await context.sbRpc("transient"), null);
    assert.equal(calls, 3);
    assert.deepEqual(waits, [500, 1000]);
  }
  let calls = 0;
  const { context, waits } = client(async () => { calls += 1; return response(null, 403); });
  await assert.rejects(context.sbRpc("forbidden"), /forbidden → HTTP 403/);
  assert.equal(calls, 1);
  assert.deepEqual(waits, []);
});

test("an exhausted retry reports its operation and releases its slot", async () => {
  let calls = 0;
  const { context, waits } = client(async () => { calls += 1; throw new Error("offline"); });
  await assert.rejects(context.sbRpc("get_app_meta"), /get_app_meta → offline/);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [500, 1000]);
  assert.equal(vm.runInContext("_sbActive", context), 0);
});

test("timeout aborts a hung request and releases the semaphore", async () => {
  let expire;
  let cleared = false;
  let signal;
  const { context } = client((url, init) => {
    signal = init.signal;
    return new Promise((resolve, reject) => signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }));
  }, {
    setTimeout(callback, delay) { assert.equal(delay, 15000); expire = callback; return 1; },
    clearTimeout(id) { assert.equal(id, 1); cleared = true; },
  });
  const request = context._sbFetchOnce("https://example.invalid", {});
  await tick();
  assert.equal(signal.aborted, false);
  expire();
  await assert.rejects(request, { name: "AbortError" });
  assert.equal(signal.aborted, true);
  assert.equal(cleared, true);
  assert.equal(vm.runInContext("_sbActive", context), 0);
});

test("payload batches preserve successful chunks and report failed codes", async () => {
  const args = [];
  const { context } = client(async (url, init) => {
    const body = JSON.parse(init.body);
    args.push(body);
    if (body.p_codes.includes("C")) return response(null, 403);
    return response(Object.fromEntries(body.p_codes.map((code) => [code, { code }])));
  });
  const result = await context.fetchPayloadMap(["A", "B", "C", "D", "E"], { p_daily_since: "2025-01-01" }, 2);
  assert.deepEqual(plain(result), {
    map: { A: { code: "A" }, B: { code: "B" }, E: { code: "E" } },
    missing: ["C", "D"],
  });
  assert.deepEqual(args.map((arg) => arg.p_codes), [["A", "B"], ["C", "D"], ["E"]]);
  assert.ok(args.every((arg) => arg.p_daily_since === "2025-01-01"));
  assert.deepEqual(plain(await context.fetchPayloadMap([])), { map: {}, missing: [] });
  assert.equal(args.length, 3, "empty code lists must not make network calls");
});

test("complete payload failure and absent documents remain explicit errors", async () => {
  const failed = client(async () => response(null, 403)).context;
  await assert.rejects(failed.fetchPayloadMap(["A", "B"], null, 1), /get_payload_map → HTTP 403/);
  const missing = client(async () => response([])).context;
  await assert.rejects(missing.sbDoc("wiki", "absent"), /documents wiki\/absent 를 찾을 수 없습니다/);
});
