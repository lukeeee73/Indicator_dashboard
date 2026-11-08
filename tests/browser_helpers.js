const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

// Read the production entry point instead of maintaining a second script list.
function scriptPaths(root = ROOT) {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  return [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)]
    .map((match) => match[1].split(/[?#]/)[0]);
}

function appScriptPaths(root = ROOT) {
  return scriptPaths(root).filter((file) => !file.startsWith("vendor/"));
}

function createBrowser(globals = {}, files = appScriptPaths(), root = ROOT) {
  const context = vm.createContext({
    AbortController,
    setTimeout,
    clearTimeout,
    console,
    document: { addEventListener() {}, getElementById() { return null; } },
    addEventListener() {},
    fetch() { throw new Error("Unexpected network request in browser test"); },
    ...globals,
  });
  context.window = context;
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
  }
  return context;
}

module.exports = { ROOT, scriptPaths, appScriptPaths, createBrowser };
