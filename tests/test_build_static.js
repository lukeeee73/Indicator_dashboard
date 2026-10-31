const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildStatic } = require("../scripts/build_static.js");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-static-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, content] of Object.entries({
    "index.html": '<link href="style.css"><script src="vendor/chart.js"></script><script src="app.js"></script>',
    "app.js": "/* application */",
    "style.css": "body {}",
    "vendor/chart.js": "/* library */",
    "vendor/chart-LICENSE.md": "library license",
    "data/wiki/graph.json": '{"nodes":[{"id":"note"}],"has_content":true}',
    "data/wiki/notes/0.json": '{"content":"required note body"}',
    "data/stocks/EXAMPLE.json": "source time series",
    "data/news/EXAMPLE/2026-10-29.json": "pipeline input",
    "scripts/collector.py": "pipeline code",
    "tests/internal.js": "test code",
    "docs/internal.md": "documentation",
  })) {
    const dest = path.join(root, relative);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
  }
  return root;
}

test("bundle keeps runtime assets and note bodies while preserving pipeline sources", (t) => {
  const root = fixture(t);
  const output = buildStatic(root);
  for (const relative of ["index.html", "app.js", "style.css", "vendor/chart.js",
    "vendor/chart-LICENSE.md", "data/wiki/graph.json", "data/wiki/notes/0.json"]) {
    assert.deepEqual(fs.readFileSync(path.join(output, relative)), fs.readFileSync(path.join(root, relative)));
  }
  for (const relative of ["data/stocks/EXAMPLE.json", "data/news/EXAMPLE/2026-10-29.json",
    "scripts/collector.py", "tests/internal.js", "docs/internal.md"]) {
    assert.ok(fs.existsSync(path.join(root, relative)), relative);
    assert.equal(fs.existsSync(path.join(output, relative)), false, relative);
  }
});

test("rebuild removes stale output without changing source files", (t) => {
  const root = fixture(t);
  const output = buildStatic(root);
  fs.writeFileSync(path.join(output, "obsolete.json"), "old output");
  fs.unlinkSync(path.join(root, "data/wiki/notes/0.json"));
  buildStatic(root);
  assert.equal(fs.existsSync(path.join(output, "obsolete.json")), false);
  assert.equal(fs.existsSync(path.join(output, "data/wiki/notes/0.json")), false);
  assert.equal(fs.readFileSync(path.join(root, "data/stocks/EXAMPLE.json"), "utf8"), "source time series");
});

test("missing required input fails before replacing an existing artifact", (t) => {
  const root = fixture(t);
  const output = buildStatic(root);
  const before = fs.readFileSync(path.join(output, "app.js"));
  fs.unlinkSync(path.join(root, "app.js"));
  assert.throws(() => buildStatic(root), /ENOENT/);
  assert.deepEqual(fs.readFileSync(path.join(output, "app.js")), before);
});

test("absent static wiki retains the app's supported database fallback", (t) => {
  const root = fixture(t);
  fs.rmSync(path.join(root, "data/wiki"), { recursive: true });
  const output = buildStatic(root);
  assert.ok(fs.existsSync(path.join(output, "index.html")));
  assert.equal(fs.existsSync(path.join(output, "data/wiki")), false);
});

test("current HTML and local fetch contracts are covered by the artifact inputs", () => {
  const repo = path.resolve(__dirname, "..");
  const html = fs.readFileSync(path.join(repo, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(repo, "app.js"), "utf8");
  const assets = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"#]+)"/g)].map((m) => m[1]);
  assert.ok(assets.length > 0);
  for (const asset of assets.filter((value) => !/^https?:/.test(value))) {
    assert.ok(["app.js", "style.css"].includes(asset) || asset.startsWith("vendor/"), asset);
    assert.ok(fs.existsSync(path.join(repo, asset)), asset);
  }
  const localFetches = [...app.matchAll(/fetch\(\s*["'`]((?:\.\/)?data\/[^"'`]+)/g)].map((m) => m[1]);
  assert.ok(localFetches.length > 0);
  for (const target of localFetches) assert.ok(target.startsWith("data/wiki/"), target);
  const config = JSON.parse(fs.readFileSync(path.join(repo, "vercel.json"), "utf8"));
  assert.equal(config.buildCommand, "node scripts/build_static.js");
  assert.equal(config.outputDirectory, "dist");
});
