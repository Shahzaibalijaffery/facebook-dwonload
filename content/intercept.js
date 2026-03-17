// Runs in MAIN world — patches fetch/XHR to intercept Facebook GraphQL responses
// and reel document (HTML) responses; extracts video data in the same format for both.

(function () {
  const GQL = "/api/graphql/";

  function isFbOrigin(url) {
    if (!url || typeof url !== "string") return false;
    try {
      const u = new URL(url, window.location.origin);
      const h = u.hostname.toLowerCase();
      return h === "facebook.com" || h === "www.facebook.com" || h.endsWith(".facebook.com") || h === "fb.com" || h.endsWith(".fb.com");
    } catch {
      return false;
    }
  }

  // Reel document API: response of GET https://www.facebook.com/reel/1208391874833205 (HTML)
  function isReelDocumentUrl(url) {
    if (!isFbOrigin(url)) return false;
    try {
      const path = new URL(url, window.location.origin).pathname.replace(/\/+$/, "");
      return /^\/reel\/\d+$/.test(path.toLowerCase());
    } catch {
      return false;
    }
  }

  // Brace-matched extraction of enclosing JSON object from string (handles nested strings).
  function extractEnclosingJson(str, anchorIndex) {
    if (anchorIndex < 0 || anchorIndex >= str.length) return null;
    let start = str.lastIndexOf("{", anchorIndex);
    if (start === -1) return null;
    let depth = 0, inString = false, escape = false, quote = null;
    for (let i = start; i < str.length; i++) {
      const c = str[i];
      if (escape) { escape = false; continue; }
      if (c === "\\" && inString) { escape = true; continue; }
      if (!inString) {
        if (c === '"' || c === "'") { inString = true; quote = c; continue; }
        if (c === "{") depth++;
        else if (c === "}") { depth--; if (depth === 0) return str.substring(start, i + 1); }
        continue;
      }
      if (c === quote) inString = false;
    }
    return null;
  }

  // Extract Video nodes from reel HTML by finding "__typename":"Video" and parsing enclosing object.
  function extractVideoNodesFromRawText(text) {
    const results = [];
    const seen = new Set();
    const markers = ['"__typename":"Video"', '"__typename": "Video"'];
    for (const marker of markers) {
      let idx = 0;
      while (true) {
        const pos = text.indexOf(marker, idx);
        if (pos === -1) break;
        const jsonStr = extractEnclosingJson(text, pos);
        if (jsonStr && jsonStr.length > 50 && !seen.has(jsonStr)) {
          seen.add(jsonStr);
          try {
            const obj = JSON.parse(jsonStr);
            if (obj && obj.__typename === "Video" && obj.id && obj.videoDeliveryResponseFragment)
              results.push(obj);
          } catch {}
        }
        idx = pos + 1;
      }
    }
    return results;
  }

  // Extract delivery block (object with progressive_urls + id) from raw HTML when full Video parse fails.
  function extractDeliveryBlocksFromRawText(text) {
    const results = [];
    const marker = '"progressive_urls":';
    let idx = 0;
    const seen = new Set();
    while (true) {
      const pos = text.indexOf(marker, idx);
      if (pos === -1) break;
      const jsonStr = extractEnclosingJson(text, pos);
      if (jsonStr && jsonStr.length > 100 && !seen.has(jsonStr)) {
        seen.add(jsonStr);
        try {
          const obj = JSON.parse(jsonStr);
          const hasUrls = obj && Array.isArray(obj.progressive_urls) && obj.progressive_urls.length > 0;
          const id = obj && (obj.id || obj.video_id);
          if (hasUrls && id) results.push({ id: String(id), videoDeliveryResponseResult: obj });
        } catch {}
      }
      idx = pos + 1;
    }
    return results;
  }

  // Extract data.video payload (creation_story with message + attachments) so we get title/author.
  function extractVideoPayloadFromRawText(text) {
    const marker = '"creation_story":';
    let idx = 0;
    while (true) {
      const pos = text.indexOf(marker, idx);
      if (pos === -1) break;
      const jsonStr = extractEnclosingJson(text, pos);
      if (jsonStr && jsonStr.length > 200) {
        try {
          const obj = JSON.parse(jsonStr);
          if (!obj) continue;
          if (obj.creation_story) return { video: { creation_story: obj.creation_story } };
          if (obj.video?.creation_story) return obj;
          if (obj.attachments?.[0]?.media?.__typename === "Video") return { video: { creation_story: obj } };
        } catch {}
      }
      idx = pos + 1;
    }
    return null;
  }

  // ─── Patch fetch ────────────────────────────────────────────
  const _fetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await _fetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
      if (url && url.includes(GQL)) {
        res.clone().text().then(processResponse).catch(() => {});
      } else if (url && isReelDocumentUrl(url)) {
        res.clone().text().then((text) => processReelDocumentResponse(url, text)).catch(() => {});
      }
    } catch {}
    return res;
  };

  // ─── Patch XMLHttpRequest ───────────────────────────────────
  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._fbUrl = url;
    return _open.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    const url = this._fbUrl;
    if (url && url.includes(GQL)) {
      this.addEventListener("load", function () {
        try { processResponse(this.responseText); } catch {}
      });
    } else if (url && isReelDocumentUrl(url)) {
      this.addEventListener("load", function () {
        try { processReelDocumentResponse(url, this.responseText); } catch {}
      });
    }
    return _send.apply(this, args);
  };

  // ─── Reel document (HTML) response: same video format as GQL ─
  function processReelDocumentResponse(url, responseText) {
    if (!url || typeof responseText !== "string") return;
    const trimmed = responseText.trim();
    const isHtml = trimmed.startsWith("<!") || trimmed.startsWith("<html") || trimmed.includes("</html>") || (trimmed.length > 500 && trimmed.includes("<"));
    if (!isHtml) return;

    const seen = new Map();

    // 1) Try full payload so we get title (message.text) and author (owner/actors)
    const payload = extractVideoPayloadFromRawText(responseText);
    if (payload) {
      try { findVideos(payload, {}, seen); } catch (_) {}
    }

    // 2) Raw Video nodes (__typename: Video with videoDeliveryResponseFragment)
    const rawNodes = extractVideoNodesFromRawText(responseText);
    for (const node of rawNodes) {
      try { findVideos(node, {}, seen); } catch (_) {}
    }

    // 3) Fallback: delivery blocks (progressive_urls + id) when script is truncated
    const deliveryBlocks = extractDeliveryBlocksFromRawText(responseText);
    for (const block of deliveryBlocks) {
      const minimal = {
        id: block.id,
        videoDeliveryResponseFragment: { videoDeliveryResponseResult: block.videoDeliveryResponseResult },
      };
      try {
        const v = parseVideo(minimal, {});
        if (v && v.urls.length > 0) {
          const existing = seen.get(block.id);
          if (existing) mergeUrls(existing, v);
          else seen.set(block.id, v);
        }
      } catch (_) {}
    }

    const videos = [...seen.values()].filter((v) => v.urls.length > 0);
    if (videos.length > 0) {
      const msg = { type: "FB_VIDEO_DATA", videos };
      window.postMessage(msg, "*");
      document.dispatchEvent(new CustomEvent("FB_VIDEO_DATA", { detail: msg }));
    }
  }

  // When we're on a reel page, get video data from (1) fetch of URL and (2) already-loaded DOM as fallback.
  function runReelExtraction() {
    const url = window.location.href;
    if (!isReelDocumentUrl(url)) return;
    fetch(url, { credentials: "include", redirect: "follow" })
      .then((r) => r.text())
      .then((text) => processReelDocumentResponse(url, text))
      .catch(() => {});
    // Fallback: after a delay, use the current document HTML (what the browser actually loaded).
    setTimeout(function () {
      const docHtml = document.documentElement && document.documentElement.outerHTML;
      if (docHtml && docHtml.length > 5000) {
        processReelDocumentResponse(url, docHtml);
      }
    }, 2500);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runReelExtraction);
  } else {
    runReelExtraction();
  }

  // ─── Process GraphQL response text ──────────────────────────
  function processResponse(text) {
    if (!text.includes("progressive_url")) return;

    const seen = new Map();
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        findVideos(JSON.parse(line), {}, seen);
      } catch {}
    }

    const videos = [...seen.values()].filter((v) => v.urls.length > 0);
    if (videos.length > 0) {
      window.postMessage({ type: "FB_VIDEO_DATA", videos }, "*");
    }
  }

  // ─── Recursive video finder ─────────────────────────────────
  function findVideos(obj, ctx, seen, depth = 0) {
    if (depth > 25 || !obj || typeof obj !== "object") return;

    const c = { ...ctx };
    if (obj.message?.text && !c.title) {
      c.title = obj.message.text
        .split("\n")[0]
        .replace(/#\S+/g, "")
        .trim()
        .substring(0, 120);
    }
    if (obj.owner?.name) c.author = obj.owner.name;
    else if (obj.actors?.[0]?.name && !c.author) c.author = obj.actors[0].name;

    if (
      obj.__typename === "Video" &&
      obj.id &&
      obj.videoDeliveryResponseFragment
    ) {
      const vid = String(obj.id);
      if (!seen.has(vid)) {
        const v = parseVideo(obj, c);
        if (v) seen.set(vid, v);
      } else {
        mergeUrls(seen.get(vid), parseVideo(obj, c));
      }
    }

    const items = Array.isArray(obj) ? obj : Object.values(obj);
    for (const val of items) {
      if (val && typeof val === "object") findVideos(val, c, seen, depth + 1);
    }
  }

  // ─── Parse a Video object ───────────────────────────────────
  function parseVideo(v, ctx) {
    const delivery =
      v.videoDeliveryResponseFragment?.videoDeliveryResponseResult;
    if (!delivery) return null;

    const result = {
      videoId: String(v.id),
      title: ctx.title || "",
      author: ctx.author || v.owner?.name || "",
      permalink: v.permalink_url || v.shareable_url || "",
      duration: v.playable_duration_in_ms
        ? v.playable_duration_in_ms / 1000
        : v.length_in_second || 0,
      thumbnail:
        v.preferred_thumbnail?.image?.uri || v.thumbnailImage?.uri || "",
      urls: [],
    };

    // Progressive URLs (complete video+audio files — best for downloading)
    if (delivery.progressive_urls) {
      for (const p of delivery.progressive_urls) {
        if (p.progressive_url && !p.failure_reason) {
          result.urls.push({
            url: p.progressive_url,
            quality: p.metadata?.quality || "Unknown",
            type: "progressive",
          });
        }
      }
    }

    // DASH manifest — individual quality representations (video-only)
    if (delivery.dash_manifests) {
      for (const m of delivery.dash_manifests) {
        if (m.manifest_xml) parseDash(m.manifest_xml, result.urls);
      }
    }

    return result;
  }

  // ─── Parse DASH manifest XML ────────────────────────────────
  function parseDash(xml, urls) {
    try {
      const doc = new DOMParser().parseFromString(xml, "text/xml");
      for (const rep of doc.querySelectorAll("Representation")) {
        const mime = rep.getAttribute("mimeType") || "";
        if (!mime.includes("video")) continue;

        const base = rep.querySelector("BaseURL")?.textContent;
        if (!base) continue;

        urls.push({
          url: base,
          quality:
            rep.getAttribute("FBQualityLabel") ||
            `${rep.getAttribute("width")}x${rep.getAttribute("height")}`,
          type: "dash",
          bandwidth: parseInt(rep.getAttribute("bandwidth") || "0"),
          width: parseInt(rep.getAttribute("width") || "0"),
          height: parseInt(rep.getAttribute("height") || "0"),
        });
      }
    } catch {}
  }

  // ─── Merge URLs from duplicate Video objects ────────────────
  function mergeUrls(target, source) {
    if (!source) return;
    if (source.title && !target.title) target.title = source.title;
    if (source.author && !target.author) target.author = source.author;
    for (const u of source.urls) {
      if (
        !target.urls.some((e) => e.quality === u.quality && e.type === u.type)
      ) {
        target.urls.push(u);
      }
    }
  }
})();
