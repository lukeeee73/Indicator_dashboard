const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

// Time series and documents are served by Supabase. Stocks research notes use
// static-first wiki JSON, so keep it and every note body alongside the UI assets.
function buildStatic(root = path.resolve(__dirname, "..")) {
  const required = ["index.html", "app.js", "style.css", "js", "vendor"];
  for (const relative of required) fs.accessSync(path.join(root, relative));

  // index.html owns browser script order. Validate every referenced local asset
  // before replacing dist so a missing split module cannot erase a good build.
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  // A new page must not reuse old scripts that still open deleted panels.
  // Content versions also work on a plain static preview server, without CDN rules.
  const builtHtml = html.replace(
    /(<(?:script|link)\b[^>]*\b(?:src|href)=["'])([^"']+)(["'])/g,
    (tag, prefix, asset, quote) => {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(asset)) return tag;
      const file = asset.split(/[?#]/)[0];
      const contents = fs.readFileSync(path.join(root, file));
      const version = createHash("sha256").update(contents).digest("hex").slice(0, 16);
      const url = new URL(asset, "https://build.local/");
      url.searchParams.set("v", version);
      return `${prefix}${file}${url.search}${url.hash}${quote}`;
    },
  );

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
  fs.writeFileSync(path.join(output, "index.html"), builtHtml);
  return output;
}

if (require.main === module) {
  buildStatic();
  console.log("Built dist/: dashboard UI, vendor libraries and stock research note JSON only.");
}

module.exports = { buildStatic };
