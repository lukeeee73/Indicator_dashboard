const fs = require("node:fs");
const path = require("node:path");

// Time series and documents are served by Supabase. Wiki JSON is the app's
// static-first source, so keep it and every note body alongside the UI assets.
function buildStatic(root = path.resolve(__dirname, "..")) {
  const required = ["index.html", "app.js", "style.css", "js", "vendor"];
  for (const relative of required) fs.accessSync(path.join(root, relative));

  // index.html owns browser script order. Validate every referenced local asset
  // before replacing dist so a missing split module cannot erase a good build.
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/g)) {
    const asset = match[1];
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(asset)) continue;
    fs.accessSync(path.join(root, asset.split(/[?#]/)[0]));
  }

  const output = path.join(root, "dist");
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  for (const relative of [...required, "data/wiki"]) {
    const source = path.join(root, relative);
    // A missing wiki export keeps the existing Supabase fallback available.
    if (!fs.existsSync(source)) continue;
    const destination = path.join(output, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, { recursive: true });
  }
  return output;
}

if (require.main === module) {
  buildStatic();
  console.log("Built dist/: dashboard UI, vendor libraries and wiki JSON only.");
}

module.exports = { buildStatic };
