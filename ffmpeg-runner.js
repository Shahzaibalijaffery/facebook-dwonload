(function () {
  "use strict";

  const LOG_PREFIX = "[FB Downloader][MP3 RUNNER]";
  let runnerReady = false;

  function safeLog(...args) {
    try {
      console.log(LOG_PREFIX, ...args);
    } catch (_) {}
  }

  function fetchAsArrayBuffer(url) {
    return fetch(url, { credentials: "omit", cache: "no-store" }).then((r) => {
      if (!r.ok) throw new Error(`Failed to fetch MP4: ${r.status}`);
      return r.arrayBuffer();
    });
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
        // ignore tab errors (navigated/closed)
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
    sendProgress(targetTabId, operationId, filename, quality, 0, "converting");

    const sourceBuffer = await fetchAsArrayBuffer(url);
    safeLog("fetched source bytes", sourceBuffer?.byteLength || 0);

    await ensureFacebookFFmpegReady();

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
          sendProgress(targetTabId, operationId, filename, quality, d.progress, d.status);
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

