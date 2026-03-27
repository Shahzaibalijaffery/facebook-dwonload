/* eslint-disable no-console */
// Build script: copies extension into dist/ and minifies JS.

const fs = require("fs");
const path = require("path");
const terser = require("terser");

const ROOT = __dirname;
const DIST = path.join(ROOT, "dist");

const SHOULD_SKIP_DIR = new Set([
  "node_modules",
  "dist",
  "dist-firefox",
  ".git",
]);
const ROOT_DIR_ALLOWLIST = new Set([
  "assets",
  "background",
  "content",
  "ffmpeg",
  "icons",
  "popup",
]);
const ROOT_FILE_ALLOWLIST = new Set([
  "manifest.json",
]);

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  fs.rmSync(p, { recursive: true, force: true });
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function isTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return [".js", ".json", ".html", ".css", ".svg", ".txt", ".md"].includes(ext);
}

async function minifyJs(srcCode, srcPath) {
  const result = await terser.minify(srcCode, {
    compress: true,
    mangle: true,
    ecma: 2020,
    module: false,
    toplevel: false,
    format: {
      comments: false,
    },
    sourceMap: false,
  });

  if (result.error) {
    throw new Error(`Terser failed for ${srcPath}: ${String(result.error)}`);
  }
  return result.code || "";
}

async function copyRecursive(srcDir, dstDir) {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const ent of entries) {
    const srcPath = path.join(srcDir, ent.name);
    const rel = path.relative(ROOT, srcPath);
    const isRootLevel = srcDir === ROOT;

    if (isRootLevel && ent.isDirectory() && !ROOT_DIR_ALLOWLIST.has(ent.name)) {
      continue;
    }
    if (isRootLevel && ent.isFile() && !ROOT_FILE_ALLOWLIST.has(ent.name)) {
      continue;
    }

    if (ent.isDirectory()) {
      if (SHOULD_SKIP_DIR.has(ent.name)) continue;
      const dstPath = path.join(dstDir, ent.name);
      ensureDir(dstPath);
      await copyRecursive(srcPath, dstPath);
      continue;
    }

    // Skip root junk files
    if (rel === ".DS_Store") continue;
    if (rel.endsWith(".zip")) continue;
    if (rel.endsWith(".map")) continue;

    const dstPath = path.join(dstDir, ent.name);

    const ext = path.extname(ent.name).toLowerCase();
    if (ext === ".js") {
      const code = fs.readFileSync(srcPath, "utf8");
      const out = await minifyJs(code, rel);
      fs.writeFileSync(dstPath, out, "utf8");
      continue;
    }

    // Copy everything else as-is (binary safe)
    if (!isTextFile(srcPath)) {
      fs.copyFileSync(srcPath, dstPath);
    } else {
      const content = fs.readFileSync(srcPath, "utf8");
      fs.writeFileSync(dstPath, content, "utf8");
    }
  }
}

(async function main() {
  console.log("[build] cleaning dist/");
  rmrf(DIST);
  ensureDir(DIST);

  console.log("[build] copying + minifying into dist/");
  await copyRecursive(ROOT, DIST);

  console.log("[build] done");
})().catch((e) => {
  console.error("[build] failed:", e);
  process.exitCode = 1;
});

