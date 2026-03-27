/* eslint-disable no-console */
// Bundle script: creates Chrome + Firefox zip bundles from dist/.

const fs = require("fs");
const path = require("path");
const archiver = require("archiver");

const ROOT = __dirname;
const DIST = path.join(ROOT, "dist");
const DIST_FIREFOX = path.join(ROOT, "dist-firefox");
const pkg = require(path.join(ROOT, "package.json"));

const ZIP_CHROME_NAME = `facebook-video-downloader-v${pkg.version}-chrome.zip`;
const ZIP_FIREFOX_NAME = `facebook-video-downloader-v${pkg.version}-firefox.zip`;
const ZIP_CHROME_PATH = path.join(ROOT, ZIP_CHROME_NAME);
const ZIP_FIREFOX_PATH = path.join(ROOT, ZIP_FIREFOX_NAME);
const MANIFEST_FIREFOX = path.join(ROOT, "manifest.firefox.json");

function rmIfExists(p) {
  try {
    fs.unlinkSync(p);
  } catch (_) {}
}

function assertExists(p, msg) {
  if (!fs.existsSync(p)) throw new Error(msg || `Missing: ${p}`);
}

(function main() {
  assertExists(DIST, "dist/ not found. Run `npm run build` first.");
  assertExists(MANIFEST_FIREFOX, "manifest.firefox.json not found.");

  // Create Chrome zip (dist as-is)
  console.log("[bundle] creating", ZIP_CHROME_NAME);
  rmIfExists(ZIP_CHROME_PATH);

  const outputChrome = fs.createWriteStream(ZIP_CHROME_PATH);
  const archiveChrome = archiver("zip", { zlib: { level: 9 } });

  outputChrome.on("close", function () {
    console.log("[bundle] done:", ZIP_CHROME_NAME, "-", archiveChrome.pointer(), "bytes");
  });

  archiveChrome.on("warning", function (err) {
    if (err.code === "ENOENT") {
      console.warn("[bundle] warning:", err.message);
      return;
    }
    throw err;
  });

  archiveChrome.on("error", function (err) {
    throw err;
  });

  archiveChrome.pipe(outputChrome);
  archiveChrome.directory(DIST, false);
  archiveChrome.finalize();

  // Create Firefox dist by copying dist/ and swapping manifest.json
  try {
    fs.rmSync(DIST_FIREFOX, { recursive: true, force: true });
  } catch (_) {}
  fs.mkdirSync(DIST_FIREFOX, { recursive: true });
  fs.cpSync(DIST, DIST_FIREFOX, { recursive: true });
  fs.copyFileSync(MANIFEST_FIREFOX, path.join(DIST_FIREFOX, "manifest.json"));

  // Create Firefox zip
  console.log("[bundle] creating", ZIP_FIREFOX_NAME);
  rmIfExists(ZIP_FIREFOX_PATH);
  const outputFirefox = fs.createWriteStream(ZIP_FIREFOX_PATH);
  const archiveFirefox = archiver("zip", { zlib: { level: 9 } });

  outputFirefox.on("close", function () {
    console.log("[bundle] done:", ZIP_FIREFOX_NAME, "-", archiveFirefox.pointer(), "bytes");
  });

  archiveFirefox.on("warning", function (err) {
    if (err.code === "ENOENT") {
      console.warn("[bundle] warning:", err.message);
      return;
    }
    throw err;
  });

  archiveFirefox.on("error", function (err) {
    throw err;
  });

  archiveFirefox.pipe(outputFirefox);
  archiveFirefox.directory(DIST_FIREFOX, false);
  archiveFirefox.finalize();
})();

