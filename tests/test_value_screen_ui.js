const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

function render(vs) {
  const picks = { innerHTML: "" };
  const near = { innerHTML: "" };
  const host = {
    innerHTML: "",
    querySelector(selector) {
      if (selector === "#vs-picks") return picks;
      if (selector === "#vs-near" && vs.near_miss.length) return near;
      return null;
    },
  };
  const context = vm.createContext({
    document: {
      addEventListener() {}, // Keep startup dormant; no data sources are contacted.
      getElementById: (id) => id === "value-screen-host" ? host : null,
    },
    window: { addEventListener() {} },
  });
  vm.runInContext(source, context);
  context.renderValuePicks(vs, {});
  return { host, picks, near };
}

test("near misses display each unmet quality or price criterion accurately", () => {
  const keys = ["roe", "margin", "profit", "discount"];
  const criteria = keys.map((key) => ({ key, label: `${key} criterion`, desc: key }));
  const results = Object.fromEntries(keys.map((failed) => [failed, {
    name: failed,
    checks: Object.fromEntries(keys.map((key) => [key, { ok: key !== failed, value: null }])),
  }]));
  const { host, near } = render({ criteria, results, passed: [], near_miss: keys });
  assert.match(host.innerHTML, /기준 3개 통과 <b>4<\/b>/);
  assert.match(host.innerHTML, /사업의 질 또는 가격 기준/);
  assert.doesNotMatch(host.innerHTML, /가격만 남은|좋은 기업인데 아직 비싼/);
  assert.equal((near.innerHTML.match(/class="vs-near-row"/g) || []).length, 4);
  for (const key of keys) assert.match(near.innerHTML, new RegExp(`✗ ${key} criterion`));
});

test("empty screening results keep the no-picks state and omit near misses", () => {
  const { host, picks, near } = render({ criteria: [], results: {}, passed: [], near_miss: [] });
  assert.match(host.innerHTML, /기준 3개 통과 <b>0<\/b>/);
  assert.doesNotMatch(host.innerHTML, /id="vs-near"/);
  assert.match(picks.innerHTML, /4가지 기준을 모두 통과한 기업이 없습니다/);
  assert.equal(near.innerHTML, "");
});

test("missing screening data keeps its loading guidance", () => {
  const { host } = render(null);
  assert.match(host.innerHTML, /아직 스크리닝 데이터가 없습니다/);
});
