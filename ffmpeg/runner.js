(function () {
  "use strict";

  const LOG_PREFIX = "[FB Downloader][MP3 RUNNER]";
  let runnerReady = false;

  function safeLog(...args) {
    try {
      console.log(LOG_PREFIX, ...args);
    } catch (_) {}
  }

  function clampPct(n) {
    if (typeof n !== "number" || !isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  async function probeContentLength(url) {
    try {
      const head = await fetch(url, {
        method: "HEAD",
        credentials: "omit",
        cache: "no-store",
      });
      if (!head || !head.ok) return undefined;
      const len = Number(head.headers.get("content-length"));
      if (!Number.isFinite(len) || len <= 0) return undefined;
      return len;
    } catch (_) {
      return undefined;
    }
  }

  async function fetchAsArrayBuffer(url, onProgress) {
    const headSize = await probeContentLength(url);
    const r = await fetch(url, { credentials: "omit", cache: "no-store" });
    if (!r.ok) throw new Error(`Failed to fetch MP4: ${r.status}`);

    const totalStr = r.headers && r.headers.get ? r.headers.get("content-length") : null;
    const total = totalStr ? Number(totalStr) : NaN;
    const hasTotal = Number.isFinite(total) && total > 0;
    const resolvedTotal = hasTotal ? total : headSize;
    const hasResolvedTotal = Number.isFinite(resolvedTotal) && resolvedTotal > 0;

    if (!r.body || !r.body.getReader) {
      const full = await r.arrayBuffer();
      if (onProgress) onProgress(100, full.byteLength, hasResolvedTotal ? resolvedTotal : undefined);
      return full;
    }

    const reader = r.body.getReader();
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      received += value.byteLength;
      if (onProgress) {
        if (hasResolvedTotal) {
          onProgress((received / resolvedTotal) * 100, received, resolvedTotal);
        } else {
          onProgress(undefined, received, undefined);
        }
      }
    }

    const out = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    if (onProgress) onProgress(100, received, hasResolvedTotal ? resolvedTotal : undefined);
    return out.buffer;
  }

  function ensureFacebookFFmpegReady(timeoutMs = 20000) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const tick = () => {
        try {
          if (
            window.FacebookFFmpeg &&
            typeof window.FacebookFFmpeg.handleOperation === "function"
          ) {
            resolve();
            return;
          }
        } catch (_) {}
        if (Date.now() - start >= timeoutMs) {
          reject(new Error("FacebookFFmpeg not available"));
          return;
        }
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  function sendToTab(tabId, message) {
    if (!tabId) return;
    try {
      chrome.tabs.sendMessage(tabId, message, () => {
        // Suppress expected errors when the source tab was closed/navigated.
        // Reading lastError prevents "Unchecked runtime.lastError" noise.
        if (chrome.runtime && chrome.runtime.lastError) {
          // no-op
        }
      });
    } catch (_) {}
  }

  function sendProgress(targetTabId, operationId, filename, quality, progress, status) {
    sendToTab(targetTabId, {
      action: "fbDownloadProgress",
      downloadId: operationId,
      filename,
      quality,
      progress,
      status,
    });
  }

  function showStarted(targetTabId, operationId, filename, quality) {
    sendToTab(targetTabId, {
      action: "fbShowDownloadNotification",
      downloadId: operationId,
      filename,
      quality,
    });
  }

  async function runConversion(request) {
    const operationId = request.operationId;
    const targetTabId = request.targetTabId;
    const url = request.url;
    const filename = request.filename || "Facebook Video - MP3.mp3";
    const quality = request.quality || "MP3";
    const format = request.format || "mp3";

    showStarted(targetTabId, operationId, filename, quality);
    sendProgress(targetTabId, operationId, filename, quality, 0, "Downloading source...");

    const sourceBuffer = await fetchAsArrayBuffer(url, (downloadPct, received, total) => {
      // Real network progress for source MP4 download: map to 0..90.
      if (typeof downloadPct === "number") {
        const pct = clampPct((downloadPct * 90) / 100);
        sendProgress(
          targetTabId,
          operationId,
          filename,
          quality,
          pct,
          `Downloading source... ${pct}%`,
        );
      } else {
        const mb = (received / (1024 * 1024)).toFixed(1);
        const totalMb = total ? (total / (1024 * 1024)).toFixed(1) : null;
        sendProgress(
          targetTabId,
          operationId,
          filename,
          quality,
          0,
          totalMb
            ? `Downloading source... ${mb}/${totalMb} MB`
            : `Downloading source... ${mb} MB`,
        );
      }
    });
    safeLog("fetched source bytes", sourceBuffer?.byteLength || 0);

    await ensureFacebookFFmpegReady();
    sendProgress(targetTabId, operationId, filename, quality, 90, "Converting to MP3...");

    return new Promise((resolve, reject) => {
      let done = false;

      const cleanup = () => {
        if (done) return;
        done = true;
        window.removeEventListener("message", onMessage);
        window.removeEventListener("message", onError);
      };

      const onMessage = (ev) => {
        const d = ev && ev.data;
        if (!d || d.operationId !== operationId) return;
        if (d.type === "FACEBOOK_FFMPEG_PROGRESS") {
          // Real conversion progress only: map helper 0..100 to 90..99.
          const helperPct = typeof d.progress === "number" ? clampPct(d.progress) : 0;
          const convPct = clampPct(90 + (helperPct * 9) / 100);
          const statusText =
            (d.message && String(d.message)) || d.status || "Converting to MP3...";
          sendProgress(targetTabId, operationId, filename, quality, convPct, statusText);
          return;
        }
        if (d.type === "FACEBOOK_FFMPEG_RESULT") {
          cleanup();
          resolve(d);
        }
      };

      const onError = (ev) => {
        const d = ev && ev.data;
        if (!d || d.operationId !== operationId) return;
        if (d.type === "FACEBOOK_FFMPEG_ERROR") {
          cleanup();
          reject(new Error(d.error || "FFmpeg conversion failed"));
        }
      };

      window.addEventListener("message", onMessage);
      window.addEventListener("message", onError);

      window.FacebookFFmpeg.handleOperation(operationId, {
        videoData: sourceBuffer,
        format,
        filename,
      }).catch((err) => {
        cleanup();
        reject(err);
      });
    });
  }

  // Notify the service worker that the runner is alive.
  try {
    chrome.runtime.sendMessage({ type: "runnerReady" });
    runnerReady = true;
  } catch (_) {}

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || request.action !== "runFFmpeg") return;

    runConversion(request)
      .then((result) => {
        const processed = result && result.processedData;
        const outFilename = result.filename || request.filename || "Facebook Video - MP3.mp3";
        const mimeType = result.mimeType || "audio/mpeg";

        if (!processed) throw new Error("No processed data from FFmpeg");

        const u8 =
          processed instanceof ArrayBuffer
            ? new Uint8Array(processed)
            : processed?.buffer instanceof ArrayBuffer
            ? new Uint8Array(processed.buffer)
            : null;

        if (!u8 || !u8.length) throw new Error("FFmpeg produced empty output");

        const blob = new Blob([u8], { type: mimeType });
        const blobUrl = URL.createObjectURL(blob);

        chrome.downloads.download(
          { url: blobUrl, filename: outFilename, saveAs: true },
          (downloadId) => {
            // Notify the service worker so it can close this runner tab
            // when the download reaches "complete".
            try {
              chrome.runtime.sendMessage({
                type: "runnerDownloadStarted",
                downloadId,
              });
            } catch (_) {}

            // Make sure UI doesn't get stuck if downloads takes a moment.
            sendProgress(
              request.targetTabId,
              request.operationId,
              outFilename,
              request.quality || "MP3",
              100,
              "complete",
            );

            setTimeout(() => {
              try {
                URL.revokeObjectURL(blobUrl);
              } catch (_) {}
            }, 5000);
          }
        );
      })
      .catch((err) => {
        safeLog("conversion failed", err);
        sendProgress(
          request.targetTabId,
          request.operationId,
          request.filename || "Facebook Video - MP3.mp3",
          request.quality || "MP3",
          0,
          `failed: ${(err && err.message) || String(err)}`
        );

        try {
          chrome.runtime.sendMessage({ type: "runnerJobFailed", operationId: request.operationId });
        } catch (_) {}
      });

    sendResponse?.({ ok: true });
    return true;
  });
})();

