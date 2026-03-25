// Facebook Video Downloader — Background Service Worker
// Video data comes from GraphQL API interception (content script).

const videoData = {}; // tabId → { videos: {videoId: {...}}, activeVideoId }

// ─── Download progress notifications ─────────────────────────
const downloadMeta = {}; // chrome.downloads id -> { tabId, filename, quality }

// MP3 conversion is handled in a hidden extension runner page

// For MP3 downloads started from the runner page:
// chrome download id -> runner tab id. We close the runner tab when the download completes.
const closeRunnerByDownloadId = {}; // downloadId -> runnerTabId

// ─── MP3 Runner Tab (hidden) ────────────────────────────────────
let ffmpegRunnerTabId = null;
const ffmpegRunnerReadyQueue = [];

function ensureFfmpegRunnerTab() {
  return new Promise((resolve) => {
    if (ffmpegRunnerTabId != null) {
      chrome.tabs.get(ffmpegRunnerTabId, (tab) => {
        if (tab && !chrome.runtime.lastError) {
          resolve(ffmpegRunnerTabId);
          return;
        }
        ffmpegRunnerTabId = null;
        ffmpegRunnerReadyQueue.push(resolve);
        chrome.tabs.create(
          { url: chrome.runtime.getURL("ffmpeg-runner.html"), active: false },
          (t) => {
            if (t && t.id) {
              // Runner will also send runnerReady; resolve is handled there.
              // We still keep ffmpegRunnerTabId updated as a best-effort.
              ffmpegRunnerTabId = t.id;
            }
          },
        );
      });
      return;
    }

    ffmpegRunnerReadyQueue.push(resolve);
    chrome.tabs.create(
      { url: chrome.runtime.getURL("ffmpeg-runner.html"), active: false },
      (t) => {
        if (t && t.id) ffmpegRunnerTabId = t.id;
      },
    );
  });
}

// ─── URL Helpers ──────────────────────────────────────────────

function extractVideoId(pageUrl) {
  if (!pageUrl) return null;

  console.log("pageUrl", pageUrl);
  try {
    const u = new URL(pageUrl);
    const v = u.searchParams.get("v");
    if (v) return v;
    let m;
    if ((m = u.pathname.match(/\/reel[s]?\/(\d+)/))) return m[1];
    if ((m = u.pathname.match(/\/watch\/(\d+)/))) return m[1];
    if ((m = u.pathname.match(/\/videos\/(\d+)/))) return m[1];
    if ((m = u.pathname.match(/\/\d+\/videos\/(\d+)/))) return m[1];
    if (u.hostname === "fb.watch") {
      const c = u.pathname.replace(/^\/+|\/+$/g, "");
      if (c) return c;
    }

    return null;
  } catch {
    return null;
  }
}

// Only filter to a single video when on a specific reel page or reel section; on all other pages show all videos.
function shouldFilterVideosByPage(pageUrl) {
  if (!pageUrl) return false;
  try {
    const u = new URL(pageUrl);
    const host = (u.hostname || "").toLowerCase();
    if (
      host !== "facebook.com" &&
      host !== "www.facebook.com" &&
      !host.endsWith(".facebook.com")
    )
      return false;
    const path = (u.pathname || "/").replace(/\/+$/, "") || "/";
    // Filter only on: /reel/<id> or /reel (reel section)
    return /^\/reel\/\d+$/.test(path) || /^\/reel\/?$/.test(path);
  } catch {
    return false;
  }
}

// ─── Per-Tab Storage ──────────────────────────────────────────

function getTab(tabId) {
  if (!videoData[tabId]) videoData[tabId] = { videos: {}, activeVideoId: null };
  return videoData[tabId];
}

function ensureVideo(tab, videoId) {
  if (!tab.videos[videoId]) {
    tab.videos[videoId] = {
      videoId,
      title: "",
      author: "",
      permalink: "",
      duration: 0,
      thumbnail: "",
      urls: [],
    };
  }
  return tab.videos[videoId];
}

// Store rich video data from GraphQL interception
function storeGraphQLVideo(tabId, info) {
  const tab = getTab(tabId);
  const v = ensureVideo(tab, info.videoId);

  if (info.title) v.title = info.title;
  if (info.author) v.author = info.author;
  if (info.permalink) v.permalink = info.permalink;
  if (info.duration) v.duration = info.duration;
  if (info.thumbnail) v.thumbnail = info.thumbnail;

  for (const u of info.urls) {
    const key = `${u.quality}-${u.type}`;
    const idx = v.urls.findIndex((e) => `${e.quality}-${e.type}` === key);
    if (idx >= 0) {
      v.urls[idx] = { ...u, timestamp: Date.now() };
    } else {
      v.urls.push({ ...u, timestamp: Date.now() });
    }
  }

  tab.activeVideoId = info.videoId;
  persist(tabId);
  updateBadge(tabId);
  console.log(
    `[GraphQL] Video ${info.videoId}: ${v.urls.length} URLs, title="${v.title.substring(0, 50)}"`,
  );
}

function persist(tabId) {
  if (!videoData[tabId]) return;
  chrome.storage.local.set({ [`vd_${tabId}`]: videoData[tabId] });
}

function restore(tabId, cb) {
  chrome.storage.local.get([`vd_${tabId}`], (r) => {
    const stored = r[`vd_${tabId}`];
    if (stored?.videos && Object.keys(stored.videos).length)
      videoData[tabId] = stored;
    cb(videoData[tabId] || { videos: {}, activeVideoId: null });
  });
}

function updateBadge(tabId) {
  const tab = videoData[tabId];
  const count = tab ? Object.keys(tab.videos).length : 0;
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : "", tabId });
  if (count > 0)
    chrome.action.setBadgeBackgroundColor({ color: "#667eea", tabId });
}

// ─── Message Handler ──────────────────────────────────────────

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  // Runner handshake: runner page tells us it's ready to accept jobs.
  if (req && req.type === "runnerReady") {
    const tabId = sender?.tab?.id;
    if (tabId != null) ffmpegRunnerTabId = tabId;
    while (ffmpegRunnerReadyQueue.length) {
      const r = ffmpegRunnerReadyQueue.shift();
      try {
        r(ffmpegRunnerTabId);
      } catch (_) {}
    }
    return false;
  }

  // Runner reports a downloadId so we can close its tab on completion.
  if (req && req.type === "runnerDownloadStarted") {
    const runnerTabId = sender?.tab?.id;
    const downloadId = req.downloadId;
    if (runnerTabId != null && downloadId != null) {
      closeRunnerByDownloadId[downloadId] = runnerTabId;
    }
    return false;
  }

  // Runner reports an unrecoverable failure; close immediately.
  if (req && req.type === "runnerJobFailed") {
    const runnerTabId = sender?.tab?.id;
    if (runnerTabId != null) {
      try {
        chrome.tabs.remove(runnerTabId, function () {});
      } catch (_) {}
    }
    return false;
  }

  if (req.action === "ping") {
    sendResponse({ ok: true });
    return;
  }

  // Rich video data from GraphQL or reel document (content script)
  if (req.action === "FB_VIDEO_DATA") {
    const tabId = sender?.tab?.id;
    if (!tabId || !req.videos) {
      sendResponse({ ok: false, reason: !tabId ? "no tab" : "no videos" });
      return;
    }
    for (const video of req.videos) {
      if (video.videoId) storeGraphQLVideo(tabId, video);
    }
    sendResponse({ ok: true });
    return;
  }

  // Popup or content script requesting video data (content script may omit tabId → use sender tab)
  if (req.action === "getVideoData") {
    const tabId = req.tabId ?? sender?.tab?.id;
    if (!tabId) {
      sendResponse({ videos: [] });
      return true;
    }

    const finish = (data) => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          sendResponse({ videos: Object.values(data.videos || {}) });
          return;
        }

        let videos = Object.values(data.videos || {});
        const pageVid = extractVideoId(tab.url);
        const filterByPage = shouldFilterVideosByPage(tab.url);

        // Only filter to one video on specific reel page (/reel/<id>) or reel section (/reel/); on all other pages show all videos.
        if (filterByPage) {
          if (pageVid) {
            const f = videos.filter((v) => v.videoId === pageVid);
            if (f.length) videos = f;
          } else if (data.activeVideoId) {
            const f = videos.filter((v) => v.videoId === data.activeVideoId);
            if (f.length) videos = f;
          }
        }

        sendResponse({ videos });
      });
    };

    if (videoData[tabId] && Object.keys(videoData[tabId].videos).length) {
      finish(videoData[tabId]);
    } else {
      restore(tabId, finish);
    }
    return true;
  }

  // Download request from popup
  if (req.action === "download") {
    const tabId = req.tabId ?? sender?.tab?.id;

    // FFmpeg conversion: convert selected progressive mp4 to mp3, then download.
    if (req.convertToMp3 === true) {
      if (!tabId) {
        sendResponse({ ok: false, reason: "no tab" });
        return true;
      }

      const operationId = Date.now() + Math.floor(Math.random() * 1000000);

      const runnerFilename = req.filename || "Facebook Video - MP3.mp3";
      const runnerQuality = req.quality || "MP3";

      ensureFfmpegRunnerTab()
        .then((rid) => {
          if (rid == null) throw new Error("FFmpeg runner tab missing");
          chrome.tabs.sendMessage(rid, {
            action: "runFFmpeg",
            operationId,
            targetTabId: tabId,
            url: req.url,
            filename: runnerFilename,
            quality: runnerQuality,
            format: "mp3",
          });
        })
        .catch((e) => {
          try {
            chrome.tabs.sendMessage(tabId, {
              action: "fbDownloadProgress",
              downloadId: operationId,
              filename: runnerFilename,
              quality: runnerQuality,
              progress: 0,
              status: `failed: ${(e && e.message) || String(e)}`,
            });
          } catch (_) {}
        });

      sendResponse({
        ok: true,
        downloadId: null,
        convertToMp3: true,
        operationId,
      });
      return true;
    }

    chrome.downloads.download(
      {
        url: req.url,
        filename: req.filename || "facebook_video.mp4",
        saveAs: true,
      },
      (id) => {
        if (id == null) {
          sendResponse({ downloadId: id });
          return;
        }

        // Track download meta for progress notifications.
        if (tabId != null) {
          downloadMeta[id] = {
            tabId,
            filename: req.filename || "Facebook Video",
            quality: req.quality || "",
          };
          // Initial notification card bound to the real downloadId.
          try {
            chrome.tabs.sendMessage(tabId, {
              action: "fbShowDownloadNotification",
              downloadId: id,
              filename: req.filename || "Facebook Video",
              quality: req.quality || "",
            });
          } catch {}
        }

        sendResponse({ downloadId: id });
      },
    );
    return true;
  }
});

// ─── Download progress forwarding ─────────────────────────────
if (chrome.downloads && chrome.downloads.onChanged) {
  chrome.downloads.onChanged.addListener((delta) => {
    const downloadId = delta.id;
    if (downloadId == null) return;
    const meta = downloadMeta[downloadId];
    const runnerTabId = closeRunnerByDownloadId[downloadId];

    // If this download is a normal MP4/HLS download, forward progress to the right tab.
    if (meta) {
      const tabId = meta.tabId;

      chrome.downloads.search({ id: downloadId }, (items) => {
        if (chrome.runtime.lastError || !items || !items.length) return;
        const item = items[0];

        const totalBytes =
          item.totalBytes != null ? item.totalBytes : undefined;
        const bytesReceived =
          item.bytesReceived != null ? item.bytesReceived : undefined;

        let progress = 0;
        if (
          typeof totalBytes === "number" &&
          totalBytes > 0 &&
          typeof bytesReceived === "number" &&
          bytesReceived >= 0
        ) {
          progress = Math.max(
            0,
            Math.min(100, Math.round((bytesReceived / totalBytes) * 100)),
          );
        }

        const status = item.state || "";

        try {
          chrome.tabs.sendMessage(tabId, {
            action: "fbDownloadProgress",
            downloadId,
            filename: meta.filename,
            quality: meta.quality,
            progress,
            status,
          });
        } catch {}

        if (status && status !== "in_progress") {
          delete downloadMeta[downloadId];
        }
      });
    }

    // Close runner tab after the MP3 conversion's download completes.
    if (runnerTabId != null) {
      const state = delta.state?.current || delta.state?.previous || "";
      if (
        state === "complete" ||
        state === "interrupted" ||
        state === "canceled"
      ) {
        delete closeRunnerByDownloadId[downloadId];
        try {
          chrome.tabs.remove(runnerTabId, function () {});
        } catch (_) {}
      }
    }
  });
}

// ─── Tab Lifecycle ────────────────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  delete videoData[tabId];
  chrome.storage.local.remove([`vd_${tabId}`]);
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (
    info.url &&
    !info.url.includes("facebook.com") &&
    !info.url.includes("fb.com")
  ) {
    delete videoData[tabId];
    chrome.storage.local.remove([`vd_${tabId}`]);
    updateBadge(tabId);
  }
});
